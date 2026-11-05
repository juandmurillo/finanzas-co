"""Proveedores de IA intercambiables y la clave de cada persona.

La clave nunca viene en el código ni la devuelve la API. Se guarda en un archivo junto a la base, fuera de la base a
propósito: así no viaja en las copias, respaldos ni exportaciones. Los límites gratuitos cambian sin aviso; por eso el
modelo se puede editar y la app no promete cupos."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import httpx

from finanzas.config import Config
from finanzas.dominio.errores import ErrorDominio

MAX_RONDAS = 8
LIMITE_RESULTADO = 6_000  # recorta lo que devuelve una herramienta para no agotar el cupo gratis
ARCHIVO_CLAVES = "claves_ia.json"


class IANoDisponible(ErrorDominio):
    estado_http = 409
    titulo = "Asistente no disponible"


@dataclass(frozen=True)
class Proveedor:
    id: str
    nombre: str
    modelo: str
    base_url: str | None  # None = SDK propio (Anthropic)
    requiere_clave: bool
    url_clave: str | None
    privacidad: str
    local: bool = False


PROVEEDORES: dict[str, Proveedor] = {
    p.id: p
    for p in (
        Proveedor(
            "gemini",
            "Google Gemini",
            "gemini-3.1-flash-lite",
            "https://generativelanguage.googleapis.com/v1beta/openai",
            True,
            "https://aistudio.google.com/apikey",
            "Tiene nivel gratis con límites. Google puede usar el contenido del nivel gratis para mejorar sus "
            "productos: úsalo con datos de ejemplo o acepta ese uso.",
        ),
        Proveedor(
            "groq",
            "Groq",
            "openai/gpt-oss-20b",
            "https://api.groq.com/openai/v1",
            True,
            "https://console.groq.com/keys",
            "Tiene un plan gratis con límites. Tus preguntas y totales salen hacia Groq: revisa sus términos.",
        ),
        Proveedor(
            "openrouter",
            "OpenRouter",
            "openrouter/free",
            "https://openrouter.ai/api/v1",
            True,
            "https://openrouter.ai/keys",
            "Elige al azar entre modelos gratis, con pocas solicitudes al día. Cada proveedor tiene sus términos y "
            "algunos usan los datos para entrenar: mejor con datos de ejemplo.",
        ),
        Proveedor(
            "ollama",
            "Ollama (en tu computador)",
            "llama3.1",
            "http://localhost:11434/v1",
            False,
            None,
            "Tus datos no salen de tu computador. Requiere instalar Ollama, descargar un modelo con herramientas y un "
            "equipo capaz. Recomendado para datos reales.",
            local=True,
        ),
        Proveedor(
            "anthropic",
            "Claude (Anthropic)",
            "claude-opus-5-5",
            None,
            True,
            "https://console.anthropic.com/settings/keys",
            "De pago: cada pregunta tiene un costo en tu cuenta. Tus preguntas y totales salen hacia Anthropic según "
            "los términos de su API.",
        ),
    )
}
_DE_ENTORNO = {
    "anthropic": "anthropic_api_key",
    "gemini": "gemini_api_key",
    "groq": "groq_api_key",
    "openrouter": "openrouter_api_key",
}
_VARIABLES = {
    "anthropic": "ANTHROPIC_API_KEY",
    "gemini": "GEMINI_API_KEY",
    "groq": "GROQ_API_KEY",
    "openrouter": "OPENROUTER_API_KEY",
}


def _ruta(config: Config) -> Path:
    return config.db_ruta.parent / ARCHIVO_CLAVES


def _guardadas(config: Config) -> dict[str, str]:
    ruta = _ruta(config)
    try:
        datos = json.loads(ruta.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return {k: v for k, v in datos.items() if isinstance(v, str)} if isinstance(datos, dict) else {}


def clave(config: Config, proveedor: str) -> str | None:
    """Primero la guardada en la app; luego la de `.env` o del entorno."""
    guardada = _guardadas(config).get(proveedor)
    if guardada:
        return guardada
    campo = _DE_ENTORNO.get(proveedor)
    return (getattr(config, campo, None) if campo else None) or os.environ.get(_VARIABLES.get(proveedor, "")) or None


def guardar_clave(config: Config, proveedor: str, valor: str) -> None:
    claves = _guardadas(config)
    if valor.strip():
        claves[proveedor] = valor.strip()
    else:
        claves.pop(proveedor, None)
    ruta = _ruta(config)
    ruta.parent.mkdir(parents=True, exist_ok=True)
    ruta.write_text(json.dumps(claves), encoding="utf-8")
    ruta.chmod(0o600)


def borrar_claves(config: Config) -> None:
    _ruta(config).unlink(missing_ok=True)


def preguntar_compatible(
    proveedor: Proveedor,
    modelo: str,
    clave_api: str | None,
    sistema: str,
    mensajes: list[dict[str, Any]],
    herramientas: list[Any],
    transporte: httpx.BaseTransport | None = None,
) -> tuple[str, str]:
    """Bucle de herramientas con la interfaz de OpenAI, que sirve para Gemini, Groq, OpenRouter y Ollama.
    Devuelve el texto final y el motivo de parada."""
    por_nombre = {h.name: h for h in herramientas}
    definiciones = [
        {"type": "function", "function": {"name": h.name, "description": h.description, "parameters": h.input_schema}}
        for h in herramientas
    ]
    conversacion: list[dict[str, Any]] = [{"role": "system", "content": sistema}, *mensajes]
    encabezados = {"Authorization": f"Bearer {clave_api or 'local'}"}
    with httpx.Client(transport=transporte, timeout=180.0, headers=encabezados) as cliente:
        for _ in range(MAX_RONDAS):
            eleccion = _pedir(cliente, proveedor, modelo, conversacion, definiciones)
            mensaje = eleccion.get("message") or {}
            llamadas = mensaje.get("tool_calls") or []
            if not llamadas:
                return (mensaje.get("content") or "").strip(), str(eleccion.get("finish_reason") or "stop")
            conversacion.append({"role": "assistant", "content": mensaje.get("content") or "", "tool_calls": llamadas})
            for llamada in llamadas:
                funcion = llamada.get("function") or {}
                conversacion.append(
                    {
                        "role": "tool",
                        "tool_call_id": llamada.get("id", ""),
                        "name": funcion.get("name", ""),
                        "content": _ejecutar(por_nombre, funcion)[:LIMITE_RESULTADO],
                    }
                )
    raise IANoDisponible("El asistente dio demasiadas vueltas sin responder. Prueba con una pregunta más concreta.")


def _ejecutar(por_nombre: dict[str, Any], funcion: dict[str, Any]) -> str:
    herramienta = por_nombre.get(funcion.get("name", ""))
    if herramienta is None:
        return json.dumps({"error": "Esa herramienta no existe"})
    try:
        argumentos = json.loads(funcion.get("arguments") or "{}")
        return str(herramienta.call(argumentos))
    except Exception as exc:  # el modelo puede mandar argumentos inválidos: se le avisa para que corrija
        return json.dumps({"error": f"No se pudo usar la herramienta: {type(exc).__name__}"})


def _pedir(
    cliente: httpx.Client,
    proveedor: Proveedor,
    modelo: str,
    conversacion: list[dict[str, Any]],
    definiciones: list[dict[str, Any]],
) -> dict[str, Any]:
    try:
        r = cliente.post(
            f"{proveedor.base_url}/chat/completions",
            json={"model": modelo, "messages": conversacion, "tools": definiciones},
        )
    except httpx.TransportError as exc:
        if proveedor.local:
            raise IANoDisponible("No encuentro Ollama en este computador. Ábrelo y descarga el modelo.") from exc
        raise IANoDisponible(f"No hay conexión con {proveedor.nombre}.") from exc
    if r.status_code in (401, 403):
        raise IANoDisponible(f"{proveedor.nombre} rechazó la clave. Revísala en la privacidad del asistente.")
    if r.status_code == 404:
        raise IANoDisponible(f"{proveedor.nombre} no reconoce el modelo «{modelo}». Revisa el nombre.")
    if r.status_code == 429:
        raise IANoDisponible(f"Se agotó el cupo de {proveedor.nombre} por ahora. Espera un rato o cambia de proveedor.")
    if r.status_code >= 400:
        raise IANoDisponible(f"{proveedor.nombre} respondió con un error ({r.status_code}).")
    try:
        opciones = r.json().get("choices") or []
        return dict(opciones[0])
    except (ValueError, IndexError, AttributeError, TypeError) as exc:
        raise IANoDisponible(f"{proveedor.nombre} devolvió una respuesta que no entiendo.") from exc
