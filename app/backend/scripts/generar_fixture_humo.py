"""Genera las respuestas de la API con datos demo que usa la prueba de humo del frontend.

Uso: `uv run python scripts/generar_fixture_humo.py`. Solo datos ficticios, en una base temporal."""

from __future__ import annotations

import json
import re
import tempfile
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from finanzas.config import Config
from finanzas.dominio.fechas import hoy_bogota
from finanzas.infra.migraciones import actualizar
from finanzas.main import crear_app

DESTINO = Path(__file__).resolve().parents[2] / "frontend" / "src" / "test" / "api-demo.json"
OMITIR = ("/events", "/exportar", "/datos/", "/respaldos", "/openapi")
MAX_FILAS = 40


def recortar(datos: Any) -> Any:
    """Listas largas a unas pocas filas: la prueba revisa que la pantalla pinte, no que sume."""
    if isinstance(datos, list):
        return [recortar(x) for x in datos[:MAX_FILAS]]
    if isinstance(datos, dict):
        return {k: recortar(v) for k, v in datos.items()}
    return datos


def main() -> None:
    with tempfile.TemporaryDirectory(prefix="finanzas-humo-", ignore_cleanup_errors=True) as carpeta:
        ruta = Path(carpeta) / "demo.db"
        actualizar(f"sqlite:///{ruta.as_posix()}")
        config = Config(db_ruta=ruta, backups_dir=Path(carpeta) / "r", tareas_diarias=False)
        cliente = TestClient(crear_app(config))
        r = cliente.post("/api/v1/sistema/primer-uso", json={"nombre": "Laura", "modo": "demo"})
        r.raise_for_status()
        mes = hoy_bogota().isoformat()[:7]
        salida: dict[str, Any] = {}
        for ruta_api, metodos in cliente.get("/openapi.json").json()["paths"].items():
            if "get" not in metodos or any(o in ruta_api for o in OMITIR):
                continue
            ruta_real = re.sub(r"\{mes\}", mes, ruta_api)
            ruta_real = re.sub(r"\{anio\}", mes[:4], ruta_real)
            ruta_real = re.sub(r"\{[a-z_]+\}", "1", ruta_real)
            consulta = {"mes": mes} if ruta_api.endswith(("/revision", "/presupuesto")) else {}
            respuesta = cliente.get(ruta_real, params=consulta)
            if respuesta.status_code == 200 and "json" in respuesta.headers.get("content-type", ""):
                clave = re.sub(r"\d{4}-\d{2}", "MES", ruta_real.removeprefix("/api/v1"))
                salida[clave] = recortar(respuesta.json())
    DESTINO.parent.mkdir(parents=True, exist_ok=True)
    DESTINO.write_text(json.dumps(salida, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    print(f"{len(salida)} respuestas · {DESTINO.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
