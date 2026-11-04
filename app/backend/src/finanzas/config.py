"""Configuración (variables de entorno con prefijo FINANZAS_)."""

from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field
from pydantic_settings import BaseSettings, SettingsConfigDict

RAIZ_REPO = Path(__file__).resolve().parents[4]


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="FINANZAS_", env_file=".env", extra="ignore")

    db_ruta: Path = RAIZ_REPO / "data" / "finanzas.db"
    backups_dir: Path = RAIZ_REPO / "data" / "respaldos"
    agente_dir: Path = RAIZ_REPO / "data" / "agente"
    # Archivos propios, fuera del repositorio (opcionales): semillas y reglas de clasificación de Cashew.
    semillas: Path | None = None
    perfil_clasificacion: Path | None = None
    host: str = "127.0.0.1"
    puerto: int = 8000
    origenes_cors: list[str] = ["http://localhost:5173", "http://127.0.0.1:5173"]
    hosts_permitidos: list[str] = ["localhost", "127.0.0.1", "testserver"]
    zona_horaria: str = "America/Bogota"
    # Respaldo diario y programación de recurrentes mientras la API corre (apagado en pruebas).
    tareas_diarias: bool = True
    # Asistente opcional (fase 6): la clave puede ir en app/backend/.env (no versionado) como ANTHROPIC_API_KEY.
    anthropic_api_key: str | None = Field(default=None, validation_alias="ANTHROPIC_API_KEY", repr=False)

    @property
    def db_url(self) -> str:
        return f"sqlite:///{self.db_ruta.as_posix()}"


@lru_cache
def obtener_config() -> Config:
    return Config()
