"""Aplicación FastAPI. Arranque: `uv run finanzas servir` (o `python -m finanzas.cli servir`)."""

from __future__ import annotations

import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from finanzas.api.guardia import GuardiaOrigen
from finanzas.api.rutas import router
from finanzas.api.rutas_automatizacion import router as router_automatizacion
from finanzas.api.rutas_extras import router as router_extras
from finanzas.api.rutas_planeacion import router as router_planeacion
from finanzas.api.rutas_reportes import router as router_reportes
from finanzas.api.rutas_sistema import router as router_sistema
from finanzas.config import Config, obtener_config
from finanzas.dominio.errores import ErrorDominio
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.respaldos import hay_respaldo_de_hoy, respaldar
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.recurrentes import programar_todos

log = logging.getLogger("finanzas")


async def tareas_diarias(app: FastAPI, config: Config) -> None:
    """Cada hora: si hoy no hay respaldo, lo hace; y programa las ocurrencias de los recurrentes."""
    while True:
        try:
            carpeta = config.backups_dir / "db"
            if not hay_respaldo_de_hoy(carpeta):
                await asyncio.to_thread(respaldar, config.db_ruta, carpeta)
            with UnidadDeTrabajo(app.state.db.fabrica, app.state.bus) as uow:
                programar_todos(uow)
        except Exception:  # una falla aquí no debe tumbar la API
            log.exception("Falló la tarea diaria")
        await asyncio.sleep(3600)


def crear_app(config: Config | None = None, db: BaseDatos | None = None, bus: BusEventos | None = None) -> FastAPI:
    config = config or obtener_config()

    @asynccontextmanager
    async def ciclo_vida(app: FastAPI) -> AsyncIterator[None]:
        app.state.bus.vincular(asyncio.get_running_loop())
        tarea = asyncio.create_task(tareas_diarias(app, config)) if config.tareas_diarias else None
        yield
        if tarea is not None:
            tarea.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await tarea

    app = FastAPI(title="Finanzas · API local", version="0.1.0", lifespan=ciclo_vida)
    app.state.config = config
    app.state.db = db or BaseDatos(config.db_url)
    app.state.bus = bus or BusEventos()
    app.add_middleware(CORSMiddleware, allow_origins=config.origenes_cors, allow_methods=["*"], allow_headers=["*"])
    app.add_middleware(GuardiaOrigen, origenes=config.origenes_cors, hosts=config.hosts_permitidos)

    @app.exception_handler(ErrorDominio)
    async def error_dominio(_: Request, exc: ErrorDominio) -> JSONResponse:
        """RFC 9457: application/problem+json."""
        return JSONResponse(
            status_code=exc.estado_http,
            content={"type": "about:blank", "title": exc.titulo, "status": exc.estado_http, "detail": str(exc)},
            media_type="application/problem+json",
        )

    @app.get("/api/v1/salud", tags=["sistema"])
    def salud() -> dict[str, str]:
        return {"estado": "ok"}

    app.include_router(router)
    app.include_router(router_planeacion)
    app.include_router(router_reportes)
    app.include_router(router_automatizacion)
    app.include_router(router_extras)
    app.include_router(router_sistema)
    return app
