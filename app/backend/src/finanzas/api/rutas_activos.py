"""Activos e inversiones, y patrimonio neto."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from finanzas.api.dependencias import sesion_lectura, unidad_de_trabajo
from finanzas.infra import consultas_activos
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import activos

router = APIRouter(prefix="/api/v1", tags=["activos"])
Lectura = Annotated[Session, Depends(sesion_lectura)]
Uow = Annotated[UnidadDeTrabajo, Depends(unidad_de_trabajo)]
FECHA = r"^\d{4}-\d{2}-\d{2}$"
MES = r"^\d{4}-\d{2}$"
TipoMovimiento = Literal["aporte", "retiro", "rendimiento", "venta"]


class ActivoIn(BaseModel):
    nombre: str = Field(max_length=120)
    clase: str
    fecha_compra: str = Field(pattern=FECHA)
    costo: int = Field(default=0, description="Centavos en pesos")
    valor_actual: int | None = Field(default=None, description="Centavos en la moneda del activo")
    moneda: Literal["COP", "USD"] = "COP"
    cuenta_id: int | None = None
    tasa_ea: float | None = Field(default=None, ge=0, le=10)
    vencimiento: str | None = Field(default=None, pattern=FECHA)
    nota: str = Field(default="", max_length=300)


class ActivoCambios(BaseModel):
    nombre: str | None = Field(default=None, max_length=120)
    clase: str | None = None
    tasa_ea: float | None = Field(default=None, ge=0, le=10)
    vencimiento: str | None = Field(default=None, pattern=FECHA)
    nota: str | None = Field(default=None, max_length=300)


class ValoracionIn(BaseModel):
    fecha: str = Field(pattern=FECHA)
    valor: int


class MovimientoIn(BaseModel):
    tipo: TipoMovimiento
    monto: int
    fecha: str = Field(pattern=FECHA)
    cuenta_id: int | None = None
    nota: str = Field(default="", max_length=300)


@router.get("/activos")
def listar(sesion: Lectura) -> dict[str, Any]:
    return consultas_activos.listar(sesion)


@router.post("/activos", status_code=201)
def crear(datos: ActivoIn, uow: Uow) -> dict[str, int]:
    with uow:
        a = activos.crear(uow, activos.DatosActivo(**datos.model_dump()))
        uow.sesion.flush()
        return {"id": a.id}


@router.patch("/activos/{activo_id}", status_code=204)
def editar(activo_id: int, cambios: ActivoCambios, uow: Uow) -> None:
    with uow:
        activos.editar(uow, activo_id, cambios.model_dump(exclude_unset=True))


@router.delete("/activos/{activo_id}", status_code=204)
def eliminar(activo_id: int, uow: Uow) -> None:
    with uow:
        activos.eliminar(uow, activo_id)


@router.post("/activos/{activo_id}/valoraciones", status_code=204)
def valorar(activo_id: int, datos: ValoracionIn, uow: Uow) -> None:
    with uow:
        activos.valorar(uow, activo_id, datos.fecha, datos.valor)


@router.post("/activos/{activo_id}/movimientos", status_code=201)
def mover(activo_id: int, datos: MovimientoIn, uow: Uow) -> dict[str, int]:
    with uow:
        m = activos.mover(uow, activo_id, datos.tipo, datos.monto, datos.fecha, datos.cuenta_id, datos.nota)
        return {"id": m.id}


@router.delete("/activos/{activo_id}/movimientos/{movimiento_id}", status_code=204)
def eliminar_movimiento(activo_id: int, movimiento_id: int, uow: Uow) -> None:
    with uow:
        activos.eliminar_movimiento(uow, activo_id, movimiento_id)


@router.get("/reportes/patrimonio", tags=["reportes"])
def patrimonio(
    sesion: Lectura,
    desde: Annotated[str | None, Query(pattern=MES)] = None,
    hasta: Annotated[str | None, Query(pattern=MES)] = None,
    escala: Literal["mes", "movimiento"] = "mes",
) -> dict[str, Any]:
    return consultas_activos.patrimonio_serie(sesion, desde, hasta, escala)
