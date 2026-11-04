"""Asistente opcional (RF-IA-01): preguntas en lenguaje natural sobre tus datos, vía la API de Claude.

Privacidad (RNF-05): está apagado hasta que des tu consentimiento explícito en Configuración, y la clave
de la API va en `app/backend/.env` (no versionado) o en tu perfil de `ant auth login`. Claude solo recibe
lo que piden sus herramientas: agregados en pesos y, al buscar, hasta 15 descripciones de movimientos.
Nunca números de cuenta ni de crédito."""

from __future__ import annotations

import json
import os
from collections.abc import Callable
from datetime import datetime
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

import anthropic
from anthropic import beta_tool
from sqlalchemy.orm import Session

from finanzas.config import obtener_config
from finanzas.dominio.errores import ErrorDominio, ErrorValidacion
from finanzas.infra import herramientas_asistente as h
from finanzas.infra.modelos import Parametro
from finanzas.servicios.sistema import leer

MODELO = "claude-opus-5-5"
CLAVE_CONSENTIMIENTO = "ia_consentimiento"
SISTEMA = """Eres un analista experto en finanzas personales, crédito, impuestos de independientes en
Colombia, inversión y generación de ingresos, dentro de una app local de finanzas.
Respondes en español de Colombia, breve y concreto, con montos como $ 1.234.567 (punto de miles) y tasas
en E.A. Usa las herramientas para leer los datos antes de responder; no inventes cifras. Si los datos no
alcanzan, dilo. Las apuestas se muestran sin
juicio. Prioriza: flujo de caja, deuda más cara primero (avalancha), colchón de emergencia, ingresos.
Valores que cambian (UVT, usura, TRM, tasa del Banco de la República) vienen de los datos de la app.
Das educación y escenarios con números, pero no eres asesor financiero licenciado: no recomiendes
productos de inversión concretos y nunca realizas ni sugieres realizar operaciones por el usuario."""


class AsistenteNoDisponible(ErrorDominio):
    estado_http = 409
    titulo = "Asistente no disponible"


def consentimiento(sesion: Session) -> dict[str, Any] | None:
    fila = (
        sesion.query(Parametro)
        .filter(Parametro.clave == CLAVE_CONSENTIMIENTO)
        .order_by(Parametro.vigencia_desde.desc())
        .first()
    )
    if fila is None or fila.valor < 1:
        return None
    return {"desde": fila.vigencia_desde, "detalle": fila.fuente}


def cambiar_consentimiento(sesion: Session, activo: bool) -> None:
    ahora = datetime.now(ZoneInfo("America/Bogota")).isoformat(timespec="microseconds")
    sesion.add(
        Parametro(
            clave=CLAVE_CONSENTIMIENTO,
            vigencia_desde=ahora,
            valor=1.0 if activo else 0.0,
            fuente="Aceptado por el usuario en Configuración" if activo else "Retirado por el usuario",
        )
    )
    sesion.commit()


def _clave() -> str | None:
    return obtener_config().anthropic_api_key or os.environ.get("ANTHROPIC_API_KEY") or None


def credenciales_disponibles() -> bool:
    """Clave en .env o en el entorno, un token, o un perfil de `ant auth login` (el SDK lo lee solo).
    El constructor del cliente no falla sin credenciales, por eso se revisa cada fuente."""
    if _clave() or os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_PROFILE"):
        return True
    return (Path.home() / ".config" / "anthropic").is_dir()


def _cliente() -> anthropic.Anthropic:
    clave = _clave()
    return anthropic.Anthropic(api_key=clave) if clave else anthropic.Anthropic()


def _herramientas(sesion: Session, usadas: list[str]) -> list[Any]:
    def registrar(nombre: str, datos: dict[str, Any]) -> str:
        usadas.append(nombre)
        return json.dumps(datos, ensure_ascii=False)

    @beta_tool
    def resumen_mensual(desde: str = "", hasta: str = "") -> str:
        """Ingresos, gasto de vida, cuotas de deuda, apuestas (neto) y flujo operativo por mes, en pesos.

        Args:
            desde: Mes inicial AAAA-MM (vacío = desde el inicio).
            hasta: Mes final AAAA-MM (vacío = hasta hoy).
        """
        return registrar("resumen_mensual", h.resumen_mensual(sesion, desde or None, hasta or None))

    @beta_tool
    def gasto_por_categoria(grupo: str = "gasto_vida", desde: str = "", hasta: str = "") -> str:
        """Totales por categoría y subcategoría de un grupo en un periodo, en pesos.

        Args:
            grupo: 'gasto_vida', 'ingreso', 'servicio_deuda' o 'apuestas'.
            desde: Mes inicial AAAA-MM (vacío = desde el inicio).
            hasta: Mes final AAAA-MM (vacío = hasta hoy).
        """
        return registrar("gasto_por_categoria", h.gasto_por_categoria(sesion, desde or None, hasta or None, grupo))

    @beta_tool
    def buscar_movimientos(texto: str, desde: str = "", hasta: str = "") -> str:
        """Movimientos cuya descripción o categoría contiene un texto: cantidad, total y hasta 15 ejemplos.

        Args:
            texto: Palabra a buscar, por ejemplo 'uber' o 'mercado'.
            desde: Mes inicial AAAA-MM (vacío = desde el inicio).
            hasta: Mes final AAAA-MM (vacío = hasta hoy).
        """
        return registrar("buscar_movimientos", h.buscar_movimientos(sesion, texto, desde or None, hasta or None))

    @beta_tool
    def deudas() -> str:
        """Créditos activos: saldo, tasa pactada y costo real E.A., cuota y fecha estimada de fin."""
        return registrar("deudas", h.deudas(sesion))

    @beta_tool
    def presupuesto(mes: str) -> str:
        """Presupuesto de un mes: asignado y gastado por categoría, e ingreso de referencia.

        Args:
            mes: Mes AAAA-MM.
        """
        return registrar("presupuesto", h.presupuesto(sesion, mes))

    @beta_tool
    def recurrentes() -> str:
        """Pagos fijos y suscripciones: monto, frecuencia, estado (activo, pausado, cancelado) y próxima fecha."""
        return registrar("recurrentes", h.recurrentes(sesion))

    @beta_tool
    def calendario(dias: int = 45) -> str:
        """Pagos e ingresos programados de los próximos días, vencidos sin registrar y saldo líquido proyectado.

        Args:
            dias: Días hacia adelante (7 a 90).
        """
        return registrar("calendario", h.calendario(sesion, dias))

    @beta_tool
    def metas() -> str:
        """Metas de ahorro, deuda, topes de gasto y hábitos con su progreso."""
        return registrar("metas", h.metas(sesion))

    @beta_tool
    def revision_mensual(mes: str) -> str:
        """Revisión de un mes: hallazgos, comparativo con el promedio y KPIs (tasa de ahorro, carga de deuda,
        cobertura de fijos, meses de colchón, costo financiero, gasto hormiga, racha sin apostar).

        Args:
            mes: Mes AAAA-MM.
        """
        return registrar("revision_mensual", h.revision(sesion, mes))

    @beta_tool
    def termometro_renta() -> str:
        """Termómetro de renta del año: topes en UVT para declarar y qué tan cerca está cada uno."""
        return registrar("termometro_renta", h.termometro_renta(sesion))

    @beta_tool
    def prestamos_personales() -> str:
        """Préstamos con personas (sin nombres): si debo o me deben, pendiente, tasa equivalente y próxima cuota."""
        return registrar("prestamos_personales", h.prestamos_personales(sesion))

    return [
        resumen_mensual,
        gasto_por_categoria,
        buscar_movimientos,
        deudas,
        presupuesto,
        recurrentes,
        calendario,
        metas,
        revision_mensual,
        termometro_renta,
        prestamos_personales,
    ]


def sistema(sesion: Session, hoy: str) -> str:
    """Rol + resumen de la situación actual (agregados, sin nombres de personas ni números de cuenta)."""
    perfil = leer(sesion, "perfil")
    sobre = f"\n\nLo que la persona cuenta de sí misma: {perfil}" if perfil else ""
    return f"{SISTEMA}{sobre}\n\nHoy es {hoy}.\n{h.contexto(sesion, hoy[:7])}"


Ejecutor = Callable[[Session, str], dict[str, Any]]


def ejecutar(sesion: Session, pregunta: str) -> dict[str, Any]:
    """Corre el bucle de herramientas con el tool runner del SDK y devuelve la respuesta final."""
    usadas: list[str] = []
    hoy = datetime.now(ZoneInfo("America/Bogota")).date().isoformat()
    try:
        if not credenciales_disponibles():
            raise AsistenteNoDisponible("Falta configurar la clave de la API de Claude.")
        cliente = _cliente()
        runner = cliente.beta.messages.tool_runner(
            model=MODELO,
            max_tokens=16000,
            max_iterations=8,
            system=sistema(sesion, hoy),
            output_config={"effort": "medium"},
            # Si el modelo declina, la API reintenta con el modelo de respaldo dentro de la misma llamada.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            tools=_herramientas(sesion, usadas),
            messages=[{"role": "user", "content": pregunta}],
        )
        final = None
        for mensaje in runner:
            final = mensaje
    except anthropic.AuthenticationError as exc:
        raise AsistenteNoDisponible("La clave de la API de Claude no es válida.") from exc
    except anthropic.RateLimitError as exc:
        raise AsistenteNoDisponible("La API de Claude está limitando las solicitudes; intenta en un minuto.") from exc
    except anthropic.APIConnectionError as exc:
        raise AsistenteNoDisponible("No hay conexión con la API de Claude.") from exc
    except anthropic.APIStatusError as exc:
        raise AsistenteNoDisponible(f"La API de Claude respondió con un error ({exc.status_code}).") from exc
    except anthropic.AnthropicError as exc:  # sin credenciales configuradas
        raise AsistenteNoDisponible("Falta configurar la clave de la API de Claude.") from exc
    if final is None:
        raise AsistenteNoDisponible("El asistente no devolvió respuesta.")
    if final.stop_reason == "refusal":
        texto = "El asistente no pudo responder esa pregunta. Prueba a formularla de otra manera."
    else:
        texto = "\n".join(b.text for b in final.content if b.type == "text").strip()
    return {"respuesta": texto, "herramientas": usadas, "modelo": final.model, "fin": final.stop_reason}


def preguntar(sesion: Session, pregunta: str, ejecutor: Ejecutor = ejecutar) -> dict[str, Any]:
    if not pregunta.strip():
        raise ErrorValidacion("Escribe una pregunta")
    if consentimiento(sesion) is None:
        raise AsistenteNoDisponible("Activa el asistente en Configuración: necesita tu consentimiento explícito.")
    return ejecutor(sesion, pregunta.strip())
