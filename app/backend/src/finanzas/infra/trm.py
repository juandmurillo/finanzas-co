"""TRM oficial (Superfinanciera, publicada en datos.gov.co). Única llamada externa de la app (RNF-05).

Se guarda en la tabla `parametro` (clave 'trm') para no volver a pedirla y para funcionar sin red
con la última conocida."""

from __future__ import annotations

import json
import urllib.parse
import urllib.request
from collections.abc import Callable
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from finanzas.infra.modelos import Parametro

URL = "https://www.datos.gov.co/resource/32sa-8pi3.json"
FUENTE = "Superfinanciera vía datos.gov.co"
Descargar = Callable[[str], list[dict[str, str]]]


def _descargar(url: str) -> list[dict[str, str]]:
    with urllib.request.urlopen(url, timeout=8) as r:  # noqa: S310 (URL fija y HTTPS)
        datos: list[dict[str, str]] = json.loads(r.read())
        return datos


def _pedir(fecha: date, descargar: Descargar) -> tuple[str, float] | None:
    consulta = urllib.parse.urlencode(
        {"$where": f"vigenciadesde <= '{fecha.isoformat()}T00:00:00'", "$order": "vigenciadesde DESC", "$limit": "1"}
    )
    filas = descargar(f"{URL}?{consulta}")
    if not filas:
        return None
    return filas[0]["vigenciadesde"][:10], float(filas[0]["valor"])


def obtener(sesion: Session, fecha: date, descargar: Descargar = _descargar) -> dict[str, object] | None:
    """TRM vigente en `fecha`. Primero la guardada; si no está la de ese día, la pide y la guarda.
    Sin red, devuelve la última conocida marcada como `aproximada`."""
    guardada = sesion.scalar(
        select(Parametro)
        .where(Parametro.clave == "trm", Parametro.vigencia_desde <= fecha.isoformat())
        .order_by(Parametro.vigencia_desde.desc())
        .limit(1)
    )
    if guardada is not None and guardada.vigencia_desde == fecha.isoformat():
        return {
            "fecha": guardada.vigencia_desde,
            "valor": guardada.valor,
            "fuente": guardada.fuente,
            "aproximada": False,
        }
    try:
        hallada = _pedir(fecha, descargar)
    except (OSError, ValueError, KeyError):
        hallada = None
    if hallada is not None:
        vigencia, valor = hallada
        if sesion.get(Parametro, ("trm", vigencia)) is None:
            sesion.add(Parametro(clave="trm", vigencia_desde=vigencia, valor=valor, fuente=FUENTE))
            sesion.commit()
        # la TRM de un fin de semana es la del último día hábil: sigue siendo la oficial
        return {"fecha": vigencia, "valor": valor, "fuente": FUENTE, "aproximada": False}
    if guardada is not None:
        return {
            "fecha": guardada.vigencia_desde,
            "valor": guardada.valor,
            "fuente": guardada.fuente,
            "aproximada": True,
        }
    return None
