"""Fixtures: cada prueba usa una base SQLite temporal migrada con Alembic (nunca data/finanzas.db)."""

from __future__ import annotations

import os
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from finanzas.cli import migrar
from finanzas.config import Config
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.main import crear_app
from finanzas.servicios.semillas import sembrar

# Las pruebas nunca dependen de los datos reales del usuario.
FIXTURES = Path(__file__).parent / "fixtures"
os.environ["FINANZAS_SEMILLAS"] = str(FIXTURES / "semillas_prueba.json")
os.environ["FINANZAS_PERFIL_CLASIFICACION"] = str(FIXTURES / "perfil_prueba.json")


@pytest.fixture
def db(tmp_path: Path) -> BaseDatos:
    url = f"sqlite:///{(tmp_path / 'prueba.db').as_posix()}"
    migrar(url)
    return BaseDatos(url)


@pytest.fixture
def bus() -> BusEventos:
    return BusEventos()


@pytest.fixture
def uow(db: BaseDatos, bus: BusEventos) -> UnidadDeTrabajo:
    return UnidadDeTrabajo(db.fabrica, bus)


@pytest.fixture
def db_sembrada(db: BaseDatos, bus: BusEventos) -> BaseDatos:
    with UnidadDeTrabajo(db.fabrica, bus) as u:
        sembrar(u)
    return db


@pytest.fixture
def cliente(db_sembrada: BaseDatos, bus: BusEventos, tmp_path: Path) -> Iterator[TestClient]:
    config = Config(db_ruta=tmp_path / "prueba.db", backups_dir=tmp_path / "Backups", tareas_diarias=False)
    with TestClient(crear_app(config, db_sembrada, bus)) as c:
        yield c


@pytest.fixture
def csv_cashew() -> bytes:
    return (FIXTURES / "cashew_ficticio.csv").read_bytes()
