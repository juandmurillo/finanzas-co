"""Parámetros de Colombia (RF-CO-01): UVT, salario mínimo, usura y TRM, con vigencia y fuente.

Los valores públicos se verificaron en la web el 29-oct-2026 (regla del proyecto: lo que cambia se
verifica antes de usarlo). Se insertan solo si faltan; el usuario puede corregirlos desde la API."""

from __future__ import annotations

from sqlalchemy.orm import Session

from finanzas.dominio.errores import ErrorValidacion
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.modelos import Parametro
from finanzas.infra.uow import UnidadDeTrabajo

INVALIDA = ("parametros", "reportes")

PARAMETROS_PUBLICOS: tuple[tuple[str, str, float, str], ...] = (
    ("uvt", "2025-01-01", 49_799, "DIAN, Resolución 000193 de 2024 (UVT 2025)"),
    ("uvt", "2026-01-01", 52_374, "DIAN, Resolución 000238 de 2025 (UVT 2026)"),
    ("smmlv", "2025-01-01", 1_423_500, "Decreto 1572 de 2024"),
    ("smmlv", "2026-01-01", 1_750_905, "Decreto 1469 de 2025"),
)
EDITABLES = {"uvt", "smmlv", "usura_consumo", "usura_consumo_bajo_monto", "trm", "ibc_porcentaje"}


def asegurar_publicos(sesion: Session) -> int:
    nuevos = 0
    for clave, desde, valor, fuente in PARAMETROS_PUBLICOS:
        if sesion.get(Parametro, (clave, desde)) is None:
            sesion.add(Parametro(clave=clave, vigencia_desde=desde, valor=valor, fuente=fuente))
            nuevos += 1
    return nuevos


def guardar(uow: UnidadDeTrabajo, clave: str, vigencia_desde: str, valor: float, fuente: str) -> None:
    if clave not in EDITABLES:
        raise ErrorValidacion(f"'{clave}' no es un parámetro editable")
    if valor <= 0:
        raise ErrorValidacion("El valor debe ser mayor que cero")
    if not fuente.strip():
        raise ErrorValidacion("Indica la fuente (resolución, decreto o sitio oficial)")
    fila = uow.sesion.get(Parametro, (clave, vigencia_desde))
    if fila is None:
        uow.sesion.add(Parametro(clave=clave, vigencia_desde=vigencia_desde, valor=valor, fuente=fuente.strip()))
    else:
        fila.valor = valor
        fila.fuente = fuente.strip()
    uow.registrar(DominioCambio(INVALIDA, "guardar", ()))
