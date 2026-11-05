"""Asistente opcional (RF-IA-01): preguntas en lenguaje natural sobre tus datos, con el proveedor que elijas.

Privacidad (RNF-05): está apagado hasta que des tu consentimiento explícito, y cambiar de proveedor lo pide de nuevo.
La clave es de cada persona (ver `infra/ia_proveedores.py`). El modelo solo recibe lo que piden sus herramientas:
agregados en pesos y, al buscar, hasta 15 descripciones de movimientos. Nunca números de cuenta ni de crédito.

La IA no puede escribir: sus herramientas de «escritura» solo preparan una propuesta, que la persona revisa y confirma
en el formulario de siempre. Borrar datos no está disponible para ella."""

from __future__ import annotations

import json
import os
from collections.abc import Callable, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any, cast
from zoneinfo import ZoneInfo

import anthropic
from anthropic import beta_tool
from sqlalchemy.orm import Session

from finanzas.config import Config, obtener_config
from finanzas.dominio.errores import ErrorValidacion
from finanzas.infra import herramientas_asistente as h
from finanzas.infra import ia_proveedores as ia
from finanzas.infra.modelos import Categoria, Parametro
from finanzas.servicios.sistema import guardar, leer

CLAVE_CONSENTIMIENTO = "ia_consentimiento"
SISTEMA = """Eres un analista experto en finanzas personales, crédito, impuestos de independientes en
Colombia, inversión y generación de ingresos, dentro de una app local de finanzas.
Respondes en español de Colombia, breve y concreto, con montos como $ 1.234.567 (punto de miles) y tasas
en E.A. Usa las herramientas para leer los datos antes de responder; no inventes cifras. Si los datos no
alcanzan, dilo. Las apuestas se muestran sin
juicio. Prioriza: flujo de caja, deuda más cara primero (avalancha), colchón de emergencia, ingresos.
Valores que cambian (UVT, usura, TRM, tasa del Banco de la República) vienen de los datos de la app.
Das educación y escenarios con números, pero no eres asesor financiero licenciado: no recomiendes
productos de inversión concretos y nunca realizas ni sugieres realizar operaciones por el usuario.
No puedes guardar, editar ni borrar nada. Si la persona pide registrar algo, usa proponer_movimiento: queda un
borrador que ella revisa y confirma. Para llevarla a una pantalla usa proponer_abrir."""
SECCIONES = {
    "inicio": "/",
    "movimientos": "/movimientos",
    "presupuesto": "/presupuesto",
    "deudas": "/deudas",
    "prestamos": "/prestamos",
    "activos": "/activos",
    "recurrentes": "/recurrentes",
    "metas": "/metas",
    "flujo": "/flujo",
    "categorias": "/categorias",
    "revision": "/revision",
    "renta": "/impuestos",
    "cuentas": "/cuentas",
}
MAX_HISTORIAL = 12


AsistenteNoDisponible = ia.IANoDisponible


def proveedor_activo(sesion: Session, config: Config) -> ia.Proveedor:
    """El elegido; si no has elegido, Claude si ya lo usabas (un consentimiento anterior a los proveedores fue para
    Claude y no se traslada a otro destino) y si no, el de nivel gratis."""
    elegido = leer(sesion, "ia_proveedor")
    if elegido in ia.PROVEEDORES:
        return ia.PROVEEDORES[elegido]
    ya_lo_usaba = _credenciales_anthropic(config) or consentimiento(sesion) is not None
    return ia.PROVEEDORES["anthropic" if ya_lo_usaba else "gemini"]


def modelo_activo(sesion: Session, proveedor: ia.Proveedor) -> str:
    return leer(sesion, f"ia_modelo_{proveedor.id}") or proveedor.modelo


def configurar(sesion: Session, config: Config, proveedor: str, modelo: str | None, clave: str | None) -> None:
    if proveedor not in ia.PROVEEDORES:
        raise ErrorValidacion("Ese proveedor no existe")
    anterior = proveedor_activo(sesion, config).id
    guardar(sesion, "ia_proveedor", proveedor)
    if modelo is not None:
        guardar(sesion, f"ia_modelo_{proveedor}", modelo.strip())
    if clave is not None:
        ia.guardar_clave(config, proveedor, clave)
    sesion.commit()
    # Los datos irían a otro destino: lo aceptado para el anterior no vale para este.
    if anterior != proveedor and consentimiento(sesion) is not None:
        cambiar_consentimiento(sesion, False)


def estado(sesion: Session, config: Config) -> dict[str, Any]:
    activo = proveedor_activo(sesion, config)
    return {
        "consentimiento": consentimiento(sesion),
        "credenciales": _tiene_credenciales(config, activo),
        "modelo": modelo_activo(sesion, activo),
        "proveedor": activo.id,
        "proveedores": [
            {
                "id": p.id,
                "nombre": p.nombre,
                "modelo": modelo_activo(sesion, p),
                "modelo_defecto": p.modelo,
                "requiere_clave": p.requiere_clave,
                "tiene_clave": _tiene_credenciales(config, p),
                "url_clave": p.url_clave,
                "privacidad": p.privacidad,
                "local": p.local,
            }
            for p in ia.PROVEEDORES.values()
        ],
    }


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


def _credenciales_anthropic(config: Config) -> bool:
    """Clave guardada, en .env o en el entorno, un token, o un perfil de `ant auth login` (el SDK lo lee solo).
    El constructor del cliente no falla sin credenciales, por eso se revisa cada fuente."""
    if ia.clave(config, "anthropic") or os.environ.get("ANTHROPIC_AUTH_TOKEN") or os.environ.get("ANTHROPIC_PROFILE"):
        return True
    return (Path.home() / ".config" / "anthropic").is_dir()


def _tiene_credenciales(config: Config, p: ia.Proveedor) -> bool:
    if not p.requiere_clave:
        return True
    return _credenciales_anthropic(config) if p.id == "anthropic" else bool(ia.clave(config, p.id))


def credenciales_disponibles() -> bool:
    return _credenciales_anthropic(obtener_config())


def _cliente(config: Config) -> anthropic.Anthropic:
    clave = ia.clave(config, "anthropic")
    return anthropic.Anthropic(api_key=clave) if clave else anthropic.Anthropic()


def _categoria_por_texto(sesion: Session, texto: str, grupos: tuple[str, ...]) -> int | None:
    """La categoría que nombra el modelo, para dejarla elegida en el borrador. Si no la halla, la persona la elige."""
    buscado = texto.strip().lower()
    if not buscado:
        return None
    candidatas = sesion.query(Categoria).filter(Categoria.grupo.in_(grupos)).all()
    exacta = next((c for c in candidatas if c.nombre.lower() == buscado), None)
    parcial = next((c for c in candidatas if buscado in c.nombre.lower()), None)
    elegida = exacta or parcial
    return elegida.id if elegida else None


def _herramientas(sesion: Session, usadas: list[str], propuestas: list[dict[str, Any]]) -> list[Any]:
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

    @beta_tool
    def activos() -> str:
        """Patrimonio neto y activos por clase: valor, aportado, ganancia, rentabilidad y vencimiento (sin nombres)."""
        return registrar("activos", h.activos(sesion))

    @beta_tool
    def proponer_movimiento(
        tipo: str, monto_pesos: int, descripcion: str = "", categoria: str = "", fecha: str = ""
    ) -> str:
        """Prepara el borrador de un gasto o ingreso para que la persona lo revise. NO guarda nada.

        Args:
            tipo: 'gasto' o 'ingreso'.
            monto_pesos: Monto en pesos, positivo.
            descripcion: Descripción corta.
            categoria: Nombre de la categoría, si la mencionó.
            fecha: AAAA-MM-DD, si la mencionó.
        """
        if tipo not in ("gasto", "ingreso"):
            return json.dumps({"error": "tipo debe ser gasto o ingreso"})
        if monto_pesos <= 0:
            return json.dumps({"error": "el monto debe ser positivo"})
        grupos = ("ingreso",) if tipo == "ingreso" else ("gasto_vida", "servicio_deuda", "apuestas", "ahorro_inversion")
        propuestas.append(
            {
                "tipo": "movimiento",
                "movimiento": tipo,
                "monto": monto_pesos * 100,
                "descripcion": descripcion[:200],
                "categoria_id": _categoria_por_texto(sesion, categoria, grupos),
                "fecha": fecha[:10],
            }
        )
        usadas.append("proponer_movimiento")
        return json.dumps({"estado": "borrador listo: la persona debe revisarlo y confirmarlo; aún no está guardado"})

    @beta_tool
    def proponer_abrir(seccion: str) -> str:
        """Ofrece un botón para ir a una sección de la app. NO cambia nada.

        Args:
            seccion: inicio, movimientos, presupuesto, deudas, prestamos, activos, recurrentes, metas, flujo,
                categorias, revision, renta o cuentas.
        """
        ruta = SECCIONES.get(seccion.strip().lower())
        if ruta is None:
            return json.dumps({"error": "sección desconocida"})
        propuestas.append({"tipo": "abrir", "seccion": seccion.strip().lower(), "ruta": ruta})
        usadas.append("proponer_abrir")
        return json.dumps({"estado": "botón ofrecido"})

    return [
        activos,
        proponer_movimiento,
        proponer_abrir,
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


Historial = Sequence[dict[str, str]]
Ejecutor = Callable[[Session, str, Historial], dict[str, Any]]


def _mensajes(pregunta: str, historial: Historial) -> list[dict[str, Any]]:
    """Memoria del hilo: solo los últimos turnos, para no agotar el cupo de los planes gratis."""
    previos = [
        {"role": "user" if m["rol"] == "yo" else "assistant", "content": m["texto"]} for m in historial[-MAX_HISTORIAL:]
    ]
    return [*previos, {"role": "user", "content": pregunta}]


def _con_anthropic(
    sesion: Session,
    config: Config,
    modelo: str,
    mensajes: list[dict[str, Any]],
    herramientas: list[Any],
    hoy: str,
) -> tuple[str, str, str]:
    """Bucle de herramientas con el tool runner del SDK."""
    try:
        cliente = _cliente(config)
        runner = cliente.beta.messages.tool_runner(
            model=modelo,
            max_tokens=16000,
            max_iterations=8,
            system=sistema(sesion, hoy),
            output_config={"effort": "medium"},
            # Si el modelo declina, la API reintenta con el modelo de respaldo dentro de la misma llamada.
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
            tools=herramientas,
            messages=cast(Any, mensajes),
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
    return texto, final.model, str(final.stop_reason)


def ejecutar_con(config: Config, transporte: Any = None) -> Ejecutor:
    def ejecutar(sesion: Session, pregunta: str, historial: Historial = ()) -> dict[str, Any]:
        usadas: list[str] = []
        propuestas: list[dict[str, Any]] = []
        hoy = datetime.now(ZoneInfo("America/Bogota")).date().isoformat()
        proveedor = proveedor_activo(sesion, config)
        modelo = modelo_activo(sesion, proveedor)
        if not _tiene_credenciales(config, proveedor):
            raise AsistenteNoDisponible(
                f"Falta la clave de {proveedor.nombre}. Agrégala en la privacidad del asistente."
            )
        herramientas = _herramientas(sesion, usadas, propuestas)
        mensajes = _mensajes(pregunta, historial)
        if proveedor.base_url is None:
            texto, usado, fin = _con_anthropic(sesion, config, modelo, mensajes, herramientas, hoy)
        else:
            texto, fin = ia.preguntar_compatible(
                proveedor,
                modelo,
                ia.clave(config, proveedor.id),
                sistema(sesion, hoy),
                mensajes,
                herramientas,
                transporte,
            )
            usado = modelo
        return {"respuesta": texto, "herramientas": usadas, "modelo": usado, "fin": fin, "propuestas": propuestas}

    return ejecutar


def preguntar(sesion: Session, pregunta: str, ejecutor: Ejecutor, historial: Historial = ()) -> dict[str, Any]:
    if not pregunta.strip():
        raise ErrorValidacion("Escribe una pregunta")
    if consentimiento(sesion) is None:
        raise AsistenteNoDisponible("Activa el asistente: necesita tu consentimiento explícito.")
    return ejecutor(sesion, pregunta.strip(), historial)
