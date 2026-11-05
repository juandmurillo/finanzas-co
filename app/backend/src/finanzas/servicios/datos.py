"""Tus datos: cargar un archivo, restaurar un respaldo o borrar todo, siempre con un respaldo automático antes."""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from finanzas.config import Config
from finanzas.dominio.errores import ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra import datos, ia_proveedores, respaldos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import parametros, sistema

CONFIRMACION_BORRAR = "BORRAR"
_ARCHIVO_RESPALDO = re.compile(r"finanzas-\d{8}-\d{6}\.db")
# Lo que la vista previa le muestra a la persona, en orden.
RESUMEN = (
    ("cuenta", "Cuentas"),
    ("transaccion", "Movimientos"),
    ("categoria", "Categorías"),
    ("credito", "Créditos"),
    ("prestamo_personal", "Préstamos"),
    ("recurrente", "Recurrentes"),
    ("presupuesto_grupo", "Presupuestos"),
    ("meta", "Metas"),
    ("activo", "Activos"),
)


def _carpeta(config: Config) -> Path:
    return config.backups_dir / "db"


def _resumen(conteos: dict[str, int]) -> list[dict[str, Any]]:
    return [{"tabla": t, "nombre": n, "filas": conteos.get(t, 0)} for t, n in RESUMEN if t in conteos]


def vista_previa(config: Config, contenido: bytes) -> dict[str, Any]:
    """Valida el archivo sin tocar la base y compara lo que entra con lo que hay."""
    with datos.candidato(contenido) as ruta:
        entra = datos.conteos(ruta)
    actual = datos.conteos(config.db_ruta)
    return {
        "entra": _resumen(entra),
        "actual": _resumen(actual),
        "tipo": "sqlite" if contenido.startswith(datos.ENCABEZADO_SQLITE) else "json",
    }


def _avisar(bus: BusEventos) -> None:
    bus.publicar(DominioCambio(("todo",), "reemplazar"))


def cargar(config: Config, bus: BusEventos, contenido: bytes) -> dict[str, Any]:
    with datos.candidato(contenido) as ruta:
        copia = respaldos.respaldar(config.db_ruta, _carpeta(config))
        datos.reemplazar(config.db_ruta, ruta)
    _avisar(bus)
    return {"respaldo": copia.name if copia else None}


def restaurar_respaldo(config: Config, bus: BusEventos, archivo: str) -> dict[str, Any]:
    """Solo acepta nombres de la carpeta de respaldos: nunca una ruta que venga del cliente."""
    if not _ARCHIVO_RESPALDO.fullmatch(archivo):
        raise ErrorValidacion("Nombre de respaldo no válido")
    ruta = _carpeta(config) / archivo
    if not ruta.is_file():
        raise NoEncontrado("Ese respaldo ya no existe")
    return cargar(config, bus, ruta.read_bytes())


def borrar_todo(config: Config, uow: UnidadDeTrabajo, confirmacion: str) -> dict[str, Any]:
    """Deja la instalación como nueva: la app vuelve a la pantalla de primer uso."""
    if confirmacion != CONFIRMACION_BORRAR:
        raise ErrorValidacion(f"Escribe {CONFIRMACION_BORRAR} para confirmar")
    copia = respaldos.respaldar(config.db_ruta, _carpeta(config))
    datos.reemplazar(config.db_ruta, None)
    ia_proveedores.borrar_claves(config)
    with uow:
        parametros.asegurar_publicos(uow.sesion)
        sistema.asegurar_categorias(uow.sesion)
        uow.registrar(DominioCambio(("todo",), "borrar"))
    return {"respaldo": copia.name if copia else None}
