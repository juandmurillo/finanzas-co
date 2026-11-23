"""Migraciones con Alembic desde código: la CLI, el arranque portátil y la carga de archivos de otra versión.

Alembic se importa solo cuando hace falta migrar: cargarlo cuesta casi medio segundo y, en el teléfono, la base casi
siempre ya está al día."""

from __future__ import annotations

import os
import re
import sqlite3
from contextlib import closing
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from alembic.config import Config as ConfigAlembic

RAIZ_BACKEND = Path(__file__).resolve().parents[3]
# Las revisiones se numeran 0001, 0002…: el archivo con el número mayor es la cabeza. En el APK vienen compiladas.
PATRON_VERSION = re.compile(r"^(\d{4})_\w+\.pyc?$")


def _ruta_ini() -> Path:
    # En Android las migraciones viajan como recursos de la app, no junto al código fuente.
    return Path(os.environ.get("FINANZAS_ALEMBIC_INI") or RAIZ_BACKEND / "alembic.ini")


def _config(url: str | None = None) -> ConfigAlembic:
    from alembic.config import Config as ConfigAlembic

    cfg = ConfigAlembic(str(_ruta_ini()))
    if url:
        cfg.set_main_option("sqlalchemy.url", url)
    cfg.attributes["configurar_logs"] = False
    return cfg


def actualizar(url: str, revision: str = "head") -> None:
    from alembic import command

    command.upgrade(_config(url), revision)


def revisiones() -> set[str]:
    from alembic.script import ScriptDirectory

    return {r.revision for r in ScriptDirectory.from_config(_config()).walk_revisions()}


def cabeza() -> str:
    from alembic.script import ScriptDirectory

    return str(ScriptDirectory.from_config(_config()).get_current_head())


def cabeza_rapida() -> str:
    """La cabeza leída de los nombres de archivo, sin cargar Alembic (una prueba la compara con `cabeza()`)."""
    carpeta = _ruta_ini().parent / "alembic" / "versions"
    numeros = [m.group(1) for p in carpeta.iterdir() if (m := PATRON_VERSION.match(p.name))]
    return max(numeros)


def version_de(ruta_db: Path) -> str | None:
    if not ruta_db.exists():
        return None
    with closing(sqlite3.connect(ruta_db)) as con:
        try:
            fila = con.execute("SELECT version_num FROM alembic_version").fetchone()
        except sqlite3.OperationalError:
            return None
    return str(fila[0]) if fila else None


def actualizar_si_hace_falta(ruta_db: Path) -> bool:
    """Migra solo si la base no está en la cabeza. Devuelve si migró."""
    if version_de(ruta_db) == cabeza_rapida():
        return False
    actualizar(f"sqlite:///{ruta_db.as_posix()}")
    return True
