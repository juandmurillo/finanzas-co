"""Puente entre la app de Android y el arranque portátil de Caudal (`finanzas.portatil`).

La actividad llama `iniciar(carpeta)` desde un hilo y recibe un JSON con la URL de entrada (lleva el secreto de este
arranque) y los tiempos. También corre en el computador, para probarlo sin Android: `python arranque.py <carpeta>`."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

# Fijo para que el origen no cambie entre arranques: lo guardado en el WebView (tema, filtros) depende de él.
PUERTO_PREFERIDO = 47613
# Si Android recrea la actividad (rotar, tema) Python sigue vivo: se reutiliza la API que ya corre.
_salida: str | None = None


def _recursos() -> Path:
    import finanzas_recursos  # empaquetado por Gradle: migraciones y frontend compilado

    return Path(finanzas_recursos.__file__).parent


def iniciar(carpeta: str, recursos: str | None = None) -> str:
    global _salida
    if _salida is not None:
        return _salida
    raiz = Path(recursos) if recursos else _recursos()
    os.environ["FINANZAS_ALEMBIC_INI"] = str(raiz / "alembic.ini")
    # Solo en compilaciones del piloto (-PcaudalSyncReceptor): a qué receptor se envían los cambios.
    sync = raiz / "sync.json"
    if sync.exists():
        destino = json.loads(sync.read_text(encoding="utf-8"))
        os.environ["FINANZAS_SYNC_RECEPTOR"] = destino["receptor"]
        if destino.get("apikey"):
            os.environ["FINANZAS_SYNC_APIKEY"] = destino["apikey"]
    from finanzas.portatil import iniciar as iniciar_api

    arranque = iniciar_api(carpeta, puerto=PUERTO_PREFERIDO, web_dir=raiz / "web")
    _salida = json.dumps(
        {
            "url": arranque.url_entrada,
            "puerto": arranque.puerto,
            "migro": arranque.migro,
            "tiempos": arranque.tiempos,
            "python": sys.version.split()[0],
        }
    )
    return _salida


if __name__ == "__main__":
    import shutil
    import tempfile
    import urllib.request

    repo = Path(__file__).resolve().parents[5]
    sys.path.insert(0, str(repo / "app" / "backend" / "src"))
    with tempfile.TemporaryDirectory() as tmp:
        prueba = Path(tmp) / "recursos"
        shutil.copytree(repo / "app" / "backend" / "alembic", prueba / "alembic")
        shutil.copy(repo / "app" / "backend" / "alembic.ini", prueba)
        shutil.copytree(repo / "app" / "frontend" / "dist", prueba / "web")
        resultado = json.loads(iniciar(sys.argv[1], str(prueba)))
        print({k: v for k, v in resultado.items() if k != "url"})
        abridor = urllib.request.build_opener(urllib.request.HTTPCookieProcessor())
        with abridor.open(resultado["url"], timeout=10) as r:
            print("entrar ->", r.status, r.url, len(r.read()), "bytes")
        for ruta in ("/api/v1/salud", "/api/v1/reportes/dashboard"):
            with abridor.open(f"http://127.0.0.1:{resultado['puerto']}{ruta}", timeout=10) as r:
                print(ruta, r.status, len(r.read()), "bytes")
