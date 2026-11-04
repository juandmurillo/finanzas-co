"""Dependencias compartidas por los routers."""

from __future__ import annotations

from collections.abc import Iterator

from fastapi import Request
from sqlalchemy.orm import Session

from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.uow import UnidadDeTrabajo


def base_datos(request: Request) -> BaseDatos:
    db: BaseDatos = request.app.state.db
    return db


def bus_eventos(request: Request) -> BusEventos:
    bus: BusEventos = request.app.state.bus
    return bus


def sesion_lectura(request: Request) -> Iterator[Session]:
    yield from base_datos(request).sesion()


def unidad_de_trabajo(request: Request) -> UnidadDeTrabajo:
    return UnidadDeTrabajo(base_datos(request).fabrica, bus_eventos(request))
