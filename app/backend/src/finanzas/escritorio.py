"""Caudal de escritorio: una ventana nativa (WebView2 en Windows) sobre la API portátil.

- Los datos viven en `%LOCALAPPDATA%\\Caudal\\datos` (o `CAUDAL_DATOS`), fuera de la carpeta de instalación:
  actualizar o desinstalar no los toca.
- La interfaz compilada, las migraciones y la configuración opcional de sincronización (`sync.json`)
  viajan dentro del paquete (PyInstaller); en desarrollo se toman del repositorio.
- Una sola instancia por base: abrir Caudal dos veces sobre los mismos datos los pondría en riesgo.
- Al cerrar la ventana se detiene la API (cierre limpio de la base).
"""

from __future__ import annotations

import json
import logging
import os
import sys
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import IO, Any

# Puerto fijo: el origen no cambia entre arranques y la ventana conserva tema, filtros y menú.
PUERTO_PREFERIDO = 47614
log = logging.getLogger("caudal.escritorio")


def recursos() -> Path:
    """Carpeta con `web/`, `alembic.ini`, `alembic/` y, si existe, `sync.json`."""
    empaquetado = getattr(sys, "_MEIPASS", None)
    if empaquetado:
        return Path(empaquetado)
    return Path(__file__).resolve().parents[3]  # app/: el repositorio en desarrollo


def _web(raiz: Path) -> Path:
    for candidata in (raiz / "web", raiz / "frontend" / "dist"):
        if (candidata / "index.html").exists():
            return candidata
    raise FileNotFoundError("Falta la interfaz compilada (npm run build en app/frontend)")


def carpeta_datos() -> Path:
    if propia := os.environ.get("CAUDAL_DATOS"):
        return Path(propia)
    base = os.environ.get("LOCALAPPDATA") or str(Path.home() / ".local" / "share")
    return Path(base) / "Caudal" / "datos"


def configurar(raiz: Path) -> None:
    """Variables que la API lee al arrancar: migraciones empaquetadas y receptor de sincronización."""
    if (raiz / "alembic.ini").exists() and getattr(sys, "_MEIPASS", None):
        os.environ["FINANZAS_ALEMBIC_INI"] = str(raiz / "alembic.ini")
    sync = raiz / "sync.json"
    if sync.exists():
        destino = json.loads(sync.read_text(encoding="utf-8"))
        os.environ.setdefault("FINANZAS_SYNC_RECEPTOR", destino["receptor"])
        if destino.get("apikey"):
            os.environ.setdefault("FINANZAS_SYNC_APIKEY", destino["apikey"])


class YaAbierto(RuntimeError):
    pass


@contextmanager
def instancia_unica(datos: Path) -> Iterator[None]:
    """Candado del sistema sobre un archivo de la carpeta de datos; se libera solo si el proceso muere."""
    datos.mkdir(parents=True, exist_ok=True)
    archivo: IO[Any] = open(datos / ".caudal-abierto", "a+b")  # noqa: SIM115 — vive mientras dure la app
    try:
        try:
            if sys.platform == "win32":
                import msvcrt

                msvcrt.locking(archivo.fileno(), msvcrt.LK_NBLCK, 1)
            else:
                import fcntl

                fcntl.flock(archivo.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
        except OSError as exc:
            raise YaAbierto("Caudal ya está abierto con estos datos") from exc
        yield
    finally:
        archivo.close()


def _avisar(mensaje: str) -> None:
    """Sin consola: un cuadro del sistema en Windows, el registro en los demás."""
    log.error(mensaje)
    if sys.platform == "win32":
        import ctypes

        ctypes.windll.user32.MessageBoxW(None, mensaje, "Caudal", 0x10)


def main() -> int:
    datos = carpeta_datos()
    datos.mkdir(parents=True, exist_ok=True)
    logging.basicConfig(
        filename=datos / "escritorio.log",
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    raiz = recursos()
    configurar(raiz)
    try:
        with instancia_unica(datos):
            # Solo en el entorno de escritorio (app/escritorio/.venv), no en el del backend.
            import webview  # type: ignore[import-not-found,unused-ignore]

            from finanzas.portatil import iniciar

            arranque = iniciar(datos, puerto=PUERTO_PREFERIDO, web_dir=_web(raiz))
            log.info("API en %s · migró %s · tiempos %s", arranque.base, arranque.migro, arranque.tiempos)
            try:
                webview.settings["ALLOW_DOWNLOADS"] = True
                webview.create_window(
                    "Caudal", arranque.url_entrada, width=1280, height=840, min_size=(380, 600), text_select=True
                )
                # Perfil persistente: lo guardado por la interfaz (tema, filtros) sobrevive al cierre.
                webview.start(private_mode=False, storage_path=str(datos / "ventana"))
            finally:
                arranque.detener()
                log.info("Cierre limpio")
    except YaAbierto as exc:
        _avisar(f"{exc}. Revisa la barra de tareas.")
        return 1
    except Exception as exc:  # noqa: BLE001 — sin consola, el error debe verse y quedar registrado
        log.exception("Caudal no pudo arrancar")
        _avisar(f"Caudal no pudo arrancar: {exc}\n\nDetalle en {datos / 'escritorio.log'}")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
