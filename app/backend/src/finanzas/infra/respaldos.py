"""Respaldos de la base (RF-IO-05, RNF-07). Usa la API de backup de SQLite, que copia una foto
consistente aunque la app esté escribiendo (copiar el archivo a mano puede dejar fuera el WAL)."""

from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

PATRON = "finanzas-*.db"


def _copiar(origen: Path, destino: Path) -> None:
    fuente = sqlite3.connect(f"file:{origen.as_posix()}?mode=ro", uri=True)
    copia = sqlite3.connect(destino)
    try:
        with copia:
            fuente.backup(copia)
    finally:
        copia.close()
        fuente.close()


def rotar(carpeta: Path, conservar: int = 30, dias: int = 30, ahora: datetime | None = None) -> list[Path]:
    """Conserva las `conservar` copias más recientes y, además, la última de cada uno de los últimos
    `dias` días (así 40 reinicios en una tarde no borran el respaldo de la semana pasada)."""
    ahora = ahora or datetime.now()
    copias = sorted(carpeta.glob(PATRON))
    quedan = set(copias[-conservar:])
    por_dia: dict[str, Path] = {}
    for c in copias:
        por_dia[c.stem.split("-")[1]] = c  # finanzas-AAAAMMDD-HHMMSS → la última del día
    limite = (ahora - timedelta(days=dias)).strftime("%Y%m%d")
    quedan |= {c for dia, c in por_dia.items() if dia >= limite}
    borradas = [c for c in copias if c not in quedan]
    for c in borradas:
        c.unlink()
    return borradas


def respaldar(db_ruta: Path, carpeta: Path, conservar: int = 30) -> Path | None:
    if not db_ruta.exists():
        return None
    carpeta.mkdir(parents=True, exist_ok=True)
    destino = carpeta / f"finanzas-{datetime.now():%Y%m%d-%H%M%S}.db"
    _copiar(db_ruta, destino)
    rotar(carpeta, conservar)
    return destino


def hay_respaldo_de_hoy(carpeta: Path) -> bool:
    return any(carpeta.glob(f"finanzas-{datetime.now():%Y%m%d}-*.db"))


def listar(carpeta: Path) -> list[dict[str, Any]]:
    salida = []
    for c in sorted(carpeta.glob(PATRON), reverse=True):
        _, dia, hora = c.stem.split("-")
        salida.append(
            {
                "archivo": c.name,
                "fecha": f"{dia[:4]}-{dia[4:6]}-{dia[6:]}T{hora[:2]}:{hora[2:4]}:{hora[4:]}",
                "bytes": c.stat().st_size,
            }
        )
    return salida


def restaurar(copia: Path, db_ruta: Path) -> None:
    """Reemplaza la base por una copia (con la API detenida). Antes guarda la actual al lado."""
    if not copia.exists():
        raise FileNotFoundError(copia)
    integridad = sqlite3.connect(f"file:{copia.as_posix()}?mode=ro", uri=True)
    try:
        if integridad.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ValueError(f"{copia.name} no pasa el chequeo de integridad")
    finally:
        integridad.close()
    if db_ruta.exists():
        _copiar(db_ruta, db_ruta.with_name(f"{db_ruta.stem}-antes-de-restaurar-{datetime.now():%Y%m%d-%H%M%S}.db"))
    for extra in (db_ruta.with_suffix(".db-wal"), db_ruta.with_suffix(".db-shm")):
        extra.unlink(missing_ok=True)
    _copiar(copia, db_ruta)
