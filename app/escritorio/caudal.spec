# Receta de PyInstaller para Caudal de escritorio (Windows). La usa construir.ps1.
# Carpeta (onedir) y sin consola: arranca más rápido que un único .exe que se descomprime cada vez.
import os
from pathlib import Path

from PyInstaller.utils.hooks import collect_data_files, collect_submodules

ESCRITORIO = Path(SPECPATH)
BACKEND = ESCRITORIO.parent / "backend"
WEB = Path(os.environ["CAUDAL_WEB"])
SYNC = os.environ.get("CAUDAL_SYNC_JSON")

datos = [
    (str(BACKEND / "alembic.ini"), "."),
    (str(BACKEND / "alembic"), "alembic"),
    (str(WEB), "web"),
    *collect_data_files("tzdata"),
    # Archivos que el paquete lee en tiempo de ejecución (semillas de categorías y parámetros).
    *collect_data_files("finanzas"),
]
if SYNC:
    datos.append((SYNC, "."))

ocultos = (
    collect_submodules("finanzas")
    + collect_submodules("uvicorn")
    + collect_submodules("alembic")
    + ["sqlalchemy.dialects.sqlite"]
)

a = Analysis(
    [str(ESCRITORIO / "caudal.py")],
    pathex=[str(BACKEND / "src")],
    datas=datos,
    hiddenimports=ocultos,
    excludes=["tkinter", "pytest", "hypothesis", "mypy", "ruff"],
)
pyz = PYZ(a.pure)
exe = EXE(
    pyz,
    a.scripts,
    [],
    exclude_binaries=True,
    name="Caudal",
    console=False,
    icon=str(ESCRITORIO / "caudal.ico") if (ESCRITORIO / "caudal.ico").exists() else None,
)
coleccion = COLLECT(exe, a.binaries, a.datas, name="Caudal")
