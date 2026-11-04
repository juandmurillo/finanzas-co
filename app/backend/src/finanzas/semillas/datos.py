"""Datos semilla: cuentas, parámetros de Colombia y créditos.

Un archivo propio con otras semillas se indica con `FINANZAS_SEMILLAS` y nunca se versiona.
Si no existe, o si FINANZAS_SEMILLAS apunta a otro archivo, se usa ese archivo; el ejemplo
versionado (`ejemplo.json`) tiene cifras ficticias con la misma estructura.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from finanzas.config import obtener_config

BASE = Path(__file__).with_name("base.json")


def ruta_semillas() -> Path:
    """Parámetros públicos por defecto; `FINANZAS_SEMILLAS` apunta a un archivo propio fuera del repositorio."""
    return obtener_config().semillas or BASE


def cargar_semillas() -> dict[str, list[dict[str, Any]]]:
    datos: dict[str, list[dict[str, Any]]] = json.loads(ruta_semillas().read_text(encoding="utf-8"))
    return datos
