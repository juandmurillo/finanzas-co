"""Motor SQLite, sesiones y vistas derivadas (ADR-0003: los derivados no se persisten)."""

from __future__ import annotations

from collections.abc import Iterator
from pathlib import Path
from typing import Any

from sqlalchemy import Connection, Engine, create_engine, event, text
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker


class Base(DeclarativeBase):
    pass


VISTAS_SQL = {
    "v_saldo_cuenta": """
        CREATE VIEW v_saldo_cuenta AS
        SELECT c.id AS cuenta_id, c.nombre, c.tipo,
               c.saldo_inicial + COALESCE(SUM(t.monto), 0) AS saldo
        FROM cuenta c
        LEFT JOIN transaccion t ON t.cuenta_id = c.id AND t.estado = 'confirmada'
        GROUP BY c.id
    """,
    "v_movimiento_mensual": """
        CREATE VIEW v_movimiento_mensual AS
        SELECT substr(t.fecha, 1, 7) AS mes, cat.grupo AS grupo, t.categoria_id,
               SUM(t.monto) AS total, COUNT(*) AS n
        FROM transaccion t
        JOIN categoria cat ON cat.id = t.categoria_id
        WHERE t.estado = 'confirmada'
        GROUP BY mes, cat.grupo, t.categoria_id
    """,
}


def crear_vistas(conexion: Connection) -> None:
    """(Re)crea las vistas derivadas. Lo usan la migración inicial y las pruebas."""
    for nombre, sql in VISTAS_SQL.items():
        conexion.execute(text(f"DROP VIEW IF EXISTS {nombre}"))
        conexion.execute(text(sql))


def _pragmas(dbapi_conn: Any, _registro: Any) -> None:
    cursor = dbapi_conn.cursor()
    cursor.execute("PRAGMA foreign_keys = ON")
    cursor.execute("PRAGMA journal_mode = WAL")
    cursor.execute("PRAGMA busy_timeout = 5000")
    cursor.close()


def crear_motor(url: str) -> Engine:
    if url.startswith("sqlite:///"):
        Path(url.removeprefix("sqlite:///")).parent.mkdir(parents=True, exist_ok=True)
    motor = create_engine(url, connect_args={"check_same_thread": False})
    event.listen(motor, "connect", _pragmas)
    return motor


class BaseDatos:
    """Motor + fábrica de sesiones de una base concreta (la real o la de pruebas)."""

    def __init__(self, url: str) -> None:
        self.url = url
        self.motor = crear_motor(url)
        self.fabrica = sessionmaker(self.motor, expire_on_commit=False)

    def sesion(self) -> Iterator[Session]:
        with self.fabrica() as sesion:
            yield sesion
