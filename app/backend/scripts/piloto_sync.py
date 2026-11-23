"""Piloto de sincronización con Supabase real: un receptor y dos equipos locales («pc» y «tel»).

Todo vive en data/piloto/ (fuera de git): las dos copias del libro, la base del receptor y
supabase.env con la URL del proyecto y la clave publicable (nunca la secreta).

    python scripts/piloto_sync.py preparar          # copias iguales del libro demo
    python scripts/piloto_sync.py construir         # frontend con las claves del piloto
    python scripts/piloto_sync.py receptor          # :8090, receptor local (solo pruebas sin Supabase)
    python scripts/piloto_sync.py api pc|tel        # :8031 / :8032, cada una sirve la interfaz

Cada API sirve el frontend compilado (como el modo portátil), así bastan tres procesos.
.claude/launch.json trae una configuración por proceso («piloto-…»).
"""

import os
import sqlite3
import subprocess
import sys
from contextlib import closing
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
CARPETA = RAIZ / "data" / "piloto"
ENTORNO = CARPETA / "supabase.env"
PUERTO_RECEPTOR = 8090
EQUIPOS = {"pc": 8031, "tel": 8032}
WEB = CARPETA / "web"
PLANTILLA = """# Proyecto de Supabase para el piloto. Solo la clave publicable (sb_publishable_…), nunca la secreta.
SUPABASE_URL=https://TU-PROYECTO.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_
"""


def _supabase() -> dict[str, str]:
    if not ENTORNO.exists():
        CARPETA.mkdir(parents=True, exist_ok=True)
        ENTORNO.write_text(PLANTILLA, encoding="utf-8")
    valores = {}
    for linea in ENTORNO.read_text(encoding="utf-8").splitlines():
        if "=" in linea and not linea.lstrip().startswith("#"):
            clave, valor = linea.split("=", 1)
            valores[clave.strip()] = valor.strip()
    url, publicable = valores.get("SUPABASE_URL", ""), valores.get("SUPABASE_PUBLISHABLE_KEY", "")
    if not url.startswith("https://") or "TU-PROYECTO" in url or len(publicable) <= len("sb_publishable_"):
        sys.exit(f"Completa {ENTORNO} con la URL y la clave publicable del proyecto de Supabase.")
    if not publicable.startswith("sb_publishable_"):
        sys.exit("SUPABASE_PUBLISHABLE_KEY debe ser la clave publicable (sb_publishable_…), no la secreta.")
    return {"SUPABASE_URL": url.rstrip("/"), "SUPABASE_PUBLISHABLE_KEY": publicable}


def preparar() -> None:
    from finanzas.cli import migrar

    origen = RAIZ / "data" / "demo" / "finanzas.db"
    if not origen.exists():
        sys.exit("Falta data/demo/finanzas.db: créala con `finanzas demo` y FINANZAS_DB_RUTA=data/demo/finanzas.db.")
    CARPETA.mkdir(parents=True, exist_ok=True)
    # Las sesiones (.sesion) se conservan: son de la cuenta, no del libro.
    for nombre in ("pc.db", "tel.db", "receptor.db"):
        for sufijo in ("", "-wal", "-shm"):
            (CARPETA / f"{nombre}{sufijo}").unlink(missing_ok=True)
    pc, tel = CARPETA / "pc.db", CARPETA / "tel.db"
    solo_lectura = f"file:{origen.as_posix()}?mode=ro"
    with closing(sqlite3.connect(solo_lectura, uri=True)) as o, closing(sqlite3.connect(pc)) as d:
        o.backup(d)
    migrar(f"sqlite:///{pc.as_posix()}")
    # Copia con la API de respaldo de SQLite: copiar el archivo dejaría fuera lo que sigue en el WAL.
    with closing(sqlite3.connect(pc)) as o, closing(sqlite3.connect(tel)) as d:
        o.backup(d)
    with closing(sqlite3.connect(pc)) as a, closing(sqlite3.connect(tel)) as b:
        (libro,) = a.execute("SELECT id_global FROM libro").fetchone()
        if b.execute("SELECT id_global FROM libro").fetchone() != (libro,):
            sys.exit("Las dos copias no quedaron iguales")
    print(f"Copias listas en {CARPETA} · libro {libro[:8]}…")
    if not ENTORNO.exists():
        ENTORNO.write_text(PLANTILLA, encoding="utf-8")
        print(f"Completa {ENTORNO} con los datos del proyecto de Supabase.")


def receptor() -> None:
    import uvicorn

    os.environ.update(_supabase(), CAUDAL_SYNC_DB=str(CARPETA / "receptor.db"))
    uvicorn.run("finanzas.sincronizacion:desde_entorno", factory=True, host="127.0.0.1", port=PUERTO_RECEPTOR)


def api(equipo: str) -> None:
    import uvicorn

    puerto = EQUIPOS[equipo]
    supabase = _supabase()
    if not (WEB / "index.html").exists():
        sys.exit("Falta la interfaz del piloto: corre `piloto_sync.py construir` primero.")
    os.environ.update(
        FINANZAS_DB_RUTA=str(CARPETA / f"{equipo}.db"),
        FINANZAS_BACKUPS_DIR=str(CARPETA / f"respaldos-{equipo}"),
        FINANZAS_AGENTE_DIR=str(CARPETA / f"agente-{equipo}"),
        FINANZAS_SEMILLAS=str(CARPETA / "sin-semillas.json"),
        FINANZAS_PERFIL_CLASIFICACION=str(CARPETA / "sin-perfil.json"),
        FINANZAS_TAREAS_DIARIAS="false",
        FINANZAS_PUERTO=str(puerto),
        # El receptor vive en el proyecto de Supabase (app/backend/supabase/receptor.sql).
        FINANZAS_SYNC_RECEPTOR=f"supabase+{supabase['SUPABASE_URL']}",
        FINANZAS_SYNC_APIKEY=supabase["SUPABASE_PUBLISHABLE_KEY"],
        # La interfaz llega desde el mismo origen que la API.
        FINANZAS_ORIGENES_CORS=f'["http://localhost:{puerto}","http://127.0.0.1:{puerto}"]',
        FINANZAS_WEB_DIR=str(WEB),
    )
    uvicorn.run("finanzas.main:crear_app", factory=True, host="127.0.0.1", port=puerto)


def construir() -> None:
    supabase = _supabase()
    entorno = {
        **os.environ,
        "VITE_SUPABASE_URL": supabase["SUPABASE_URL"],
        "VITE_SUPABASE_PUBLISHABLE_KEY": supabase["SUPABASE_PUBLISHABLE_KEY"],
        "NODE_OPTIONS": "--use-system-ca",
    }
    npm = "npm.cmd" if os.name == "nt" else "npm"
    comando = [npm, "run", "build", "--", "--outDir", str(WEB), "--emptyOutDir"]
    sys.exit(subprocess.call(comando, cwd=RAIZ / "app" / "frontend", env=entorno))


if __name__ == "__main__":
    match sys.argv[1:]:
        case ["preparar"]:
            preparar()
        case ["receptor"]:
            receptor()
        case ["api", equipo] if equipo in EQUIPOS:
            api(equipo)
        case ["construir"]:
            construir()
        case _:
            sys.exit(__doc__)
