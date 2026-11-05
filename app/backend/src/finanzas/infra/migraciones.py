"""Migraciones con Alembic desde código: la CLI y la carga de archivos de otra versión de la app."""

from __future__ import annotations

from pathlib import Path

from alembic import command
from alembic.config import Config as ConfigAlembic
from alembic.script import ScriptDirectory

RAIZ_BACKEND = Path(__file__).resolve().parents[3]


def _config(url: str | None = None) -> ConfigAlembic:
    cfg = ConfigAlembic(str(RAIZ_BACKEND / "alembic.ini"))
    if url:
        cfg.set_main_option("sqlalchemy.url", url)
    cfg.attributes["configurar_logs"] = False
    return cfg


def actualizar(url: str, revision: str = "head") -> None:
    command.upgrade(_config(url), revision)


def revisiones() -> set[str]:
    return {r.revision for r in ScriptDirectory.from_config(_config()).walk_revisions()}


def cabeza() -> str:
    return str(ScriptDirectory.from_config(_config()).get_current_head())
