"""Arranque portátil: la API completa dentro de otra app (Android), sin consola.

`iniciar()` prepara la carpeta de datos, migra solo si hace falta, deja la base usable y sirve la API y el frontend
en 127.0.0.1 desde un hilo. Cada arranque crea un secreto nuevo: la app abre `url_entrada` y el resto de peticiones
lo llevan en una cookie (`api/secreto.py`). El respaldo diario y los recurrentes los hace la tarea de cada hora."""

from __future__ import annotations

import os
import secrets
import socket
import threading
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    import uvicorn

ESPERA_MAXIMA = 30.0


@dataclass
class Arranque:
    puerto: int
    secreto: str = field(repr=False)
    migro: bool
    tiempos: dict[str, float]
    servidor: uvicorn.Server = field(repr=False)
    hilo: threading.Thread = field(repr=False)

    @property
    def base(self) -> str:
        return f"http://127.0.0.1:{self.puerto}"

    @property
    def url_entrada(self) -> str:
        return f"{self.base}/entrar?secreto={self.secreto}"

    def detener(self) -> None:
        self.servidor.should_exit = True
        self.hilo.join(timeout=ESPERA_MAXIMA)


def elegir_puerto(preferido: int = 0) -> int:
    """El preferido si está libre (así el origen, y con él lo guardado en el navegador, no cambia entre arranques);
    si no, uno libre cualquiera."""
    for candidato in (preferido, 0) if preferido else (0,):
        with socket.socket() as s:
            # En Android/Linux, tras cerrar la app el puerto queda unos segundos con conexiones en TIME_WAIT: sin
            # SO_REUSEADDR la prueba fallaba, se elegía otro puerto y el WebView veía un origen nuevo (se perdían el
            # menú, el tema y los filtros guardados). Uvicorn ya escucha con SO_REUSEADDR. En Windows esa opción
            # permite robar un puerto en uso, así que allí no se activa.
            if os.name != "nt":
                s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
            try:
                s.bind(("127.0.0.1", candidato))
            except OSError:
                continue
            return int(s.getsockname()[1])
    raise RuntimeError("No hay puertos libres en 127.0.0.1")


def iniciar(carpeta_datos: str | Path, puerto: int = 0, web_dir: str | Path | None = None) -> Arranque:
    inicio = time.perf_counter()
    tiempos: dict[str, float] = {}

    def marcar(nombre: str) -> None:
        tiempos[nombre] = round(time.perf_counter() - inicio, 2)

    import uvicorn

    from finanzas.config import Config
    from finanzas.infra.db import BaseDatos
    from finanzas.infra.migraciones import actualizar_si_hace_falta
    from finanzas.main import crear_app
    from finanzas.servicios import parametros, sistema

    marcar("importar")
    datos = Path(carpeta_datos)
    datos.mkdir(parents=True, exist_ok=True)
    elegido = elegir_puerto(puerto)
    config = Config(
        db_ruta=datos / "finanzas.db",
        backups_dir=datos / "respaldos",
        agente_dir=datos / "agente",
        host="127.0.0.1",
        puerto=elegido,
        origenes_cors=[f"http://127.0.0.1:{elegido}"],
        hosts_permitidos=["127.0.0.1"],
        secreto=secrets.token_urlsafe(32),
        web_dir=Path(web_dir) if web_dir else None,
    )
    migro = actualizar_si_hace_falta(config.db_ruta)
    marcar("migrar")
    base = BaseDatos(config.db_url)
    with base.fabrica() as sesion:  # una base nueva debe poder usarse sin importar nada
        parametros.asegurar_publicos(sesion)
        sistema.asegurar_categorias(sesion)
        sesion.commit()
    marcar("preparar")

    servidor = uvicorn.Server(
        uvicorn.Config(crear_app(config, base), host="127.0.0.1", port=elegido, log_level="warning", access_log=False)
    )
    hilo = threading.Thread(target=servidor.run, name="caudal-api", daemon=True)
    hilo.start()
    limite = time.perf_counter() + ESPERA_MAXIMA
    while not servidor.started and hilo.is_alive() and time.perf_counter() < limite:
        time.sleep(0.02)
    if not servidor.started:
        servidor.should_exit = True
        raise RuntimeError("La API no arrancó")
    marcar("servir")
    assert config.secreto is not None
    return Arranque(elegido, config.secreto, migro, tiempos, servidor, hilo)
