"""Tus datos: exportar en JSON o SQLite, cargar con vista previa, restaurar un respaldo y borrar todo."""

from __future__ import annotations

import json
import tempfile
from datetime import datetime
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Request, Response, UploadFile
from pydantic import BaseModel

from finanzas.api.dependencias import unidad_de_trabajo
from finanzas.dominio.errores import ErrorValidacion
from finanzas.infra import datos as infra_datos
from finanzas.infra import respaldos
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import datos

router = APIRouter(prefix="/api/v1", tags=["datos"])
Uow = Annotated[UnidadDeTrabajo, Depends(unidad_de_trabajo)]


class BorrarIn(BaseModel):
    confirmacion: str


def _nombre(extension: str) -> dict[str, str]:
    return {"Content-Disposition": f'attachment; filename="finanzas-{datetime.now():%Y%m%d-%H%M}.{extension}"'}


async def _leer(archivo: UploadFile) -> bytes:
    contenido = await archivo.read(infra_datos.LIMITE_BYTES + 1)
    if not contenido:
        raise ErrorValidacion("El archivo está vacío")
    return contenido


@router.get("/datos/exportar/json", response_class=Response)
def exportar_json(request: Request) -> Response:
    cuerpo = json.dumps(infra_datos.exportar(request.app.state.config.db_ruta), ensure_ascii=False)
    return Response(cuerpo, media_type="application/json", headers=_nombre("json"))


@router.get("/datos/exportar/sqlite", response_class=Response)
def exportar_sqlite(request: Request) -> Response:
    with tempfile.TemporaryDirectory(prefix="finanzas-exp-", ignore_cleanup_errors=True) as carpeta:
        copia = Path(carpeta) / "copia.db"
        respaldos.copiar(request.app.state.config.db_ruta, copia)
        cuerpo = copia.read_bytes()
    return Response(cuerpo, media_type="application/vnd.sqlite3", headers=_nombre("db"))


@router.post("/datos/vista-previa")
async def vista_previa(request: Request, archivo: Annotated[UploadFile, File()]) -> dict[str, Any]:
    return datos.vista_previa(request.app.state.config, await _leer(archivo))


@router.post("/datos/cargar")
async def cargar(request: Request, archivo: Annotated[UploadFile, File()]) -> dict[str, Any]:
    return datos.cargar(request.app.state.config, request.app.state.bus, await _leer(archivo))


@router.post("/respaldos/{archivo}/restaurar", tags=["respaldos"])
def restaurar(request: Request, archivo: str) -> dict[str, Any]:
    return datos.restaurar_respaldo(request.app.state.config, request.app.state.bus, archivo)


@router.post("/datos/borrar-todo")
def borrar_todo(request: Request, cuerpo: BorrarIn, uow: Uow) -> dict[str, Any]:
    return datos.borrar_todo(request.app.state.config, uow, cuerpo.confirmacion)
