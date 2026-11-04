"""Instalación y ajustes: estado para la interfaz, primer uso y preferencias de la persona."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from finanzas.api.dependencias import sesion_lectura, unidad_de_trabajo
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import sistema

router = APIRouter(prefix="/api/v1")
Lectura = Annotated[Session, Depends(sesion_lectura)]
Uow = Annotated[UnidadDeTrabajo, Depends(unidad_de_trabajo)]


class PrimerUsoIn(BaseModel):
    nombre: str = Field(default="", max_length=60)
    modo: Literal["vacio", "demo"] = "vacio"


class AjustesIn(BaseModel):
    nombre: str | None = Field(default=None, max_length=60)
    perfil: str | None = Field(default=None, max_length=500)
    modulo_apuestas: Literal["auto", "si", "no"] | None = None


@router.get("/sistema", tags=["sistema"])
def ver_sistema(sesion: Lectura) -> dict[str, Any]:
    return sistema.estado(sesion)


@router.post("/sistema/primer-uso", tags=["sistema"], status_code=204)
def primer_uso(datos: PrimerUsoIn, uow: Uow) -> None:
    with uow:
        sistema.primer_uso(uow, datos.nombre, datos.modo)


@router.patch("/sistema", tags=["sistema"], status_code=204)
def ajustar(datos: AjustesIn, uow: Uow) -> None:
    with uow:
        sistema.configurar(uow, datos.model_dump(exclude_unset=True, exclude_none=True))
