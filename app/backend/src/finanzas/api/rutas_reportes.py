"""Routers de la fase 4: reportes de análisis y exportación a Excel."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path, Query
from fastapi.responses import Response
from sqlalchemy.orm import Session

from finanzas.api.dependencias import sesion_lectura
from finanzas.dominio.fechas import hoy_bogota
from finanzas.dominio.grupos import Grupo
from finanzas.infra import consultas_kpis
from finanzas.infra import consultas_reportes as rep
from finanzas.infra.exportar_excel import libro

router = APIRouter(prefix="/api/v1", tags=["reportes"])
Lectura = Annotated[Session, Depends(sesion_lectura)]
MES = r"^\d{4}-(0[1-9]|1[0-2])$"
Desde = Annotated[str | None, Query(pattern=MES, description="Mes inicial AAAA-MM (incluido)")]
Hasta = Annotated[str | None, Query(pattern=MES, description="Mes final AAAA-MM (incluido)")]


@router.get("/reportes/mensual")
def reporte_mensual(sesion: Lectura, desde: Desde = None, hasta: Hasta = None) -> dict[str, Any]:
    return rep.mensual(sesion, desde, hasta)


@router.get("/reportes/sankey")
def reporte_sankey(sesion: Lectura, desde: Desde = None, hasta: Hasta = None) -> dict[str, Any]:
    return rep.sankey(sesion, desde, hasta)


@router.get("/reportes/categorias")
def reporte_categorias(
    sesion: Lectura,
    desde: Desde = None,
    hasta: Hasta = None,
    grupo: Grupo = Grupo.GASTO_VIDA,
    conjunto: Literal["gastos", "ingresos"] | None = None,
) -> dict[str, Any]:
    return rep.categorias(sesion, desde, hasta, grupo, conjunto)


@router.get("/reportes/descripciones")
def reporte_descripciones(
    sesion: Lectura,
    desde: Desde = None,
    hasta: Hasta = None,
    grupo: Grupo | None = None,
    limite: Annotated[int, Query(ge=1, le=200)] = 30,
    conjunto: Literal["gastos", "ingresos"] | None = None,
) -> list[dict[str, Any]]:
    return rep.descripciones(sesion, desde, hasta, grupo, limite, conjunto)


@router.get("/reportes/apuestas")
def reporte_apuestas(sesion: Lectura, desde: Desde = None, hasta: Hasta = None) -> dict[str, Any]:
    return rep.apuestas(sesion, desde, hasta)


@router.get("/reportes/valor-neto")
def reporte_valor_neto(
    sesion: Lectura, desde: Desde = None, hasta: Hasta = None, escala: Literal["mes", "dia", "movimiento"] = "mes"
) -> dict[str, Any]:
    """Saldo de las cuentas incluidas en el total, al cierre de cada mes o día."""
    return rep.valor_neto(sesion, desde, hasta, escala)


@router.get("/reportes/calor")
def reporte_calor(sesion: Lectura, desde: Desde = None, hasta: Hasta = None) -> dict[str, Any]:
    """Gasto e ingreso por día (mapa de calor)."""
    return rep.calor(sesion, desde, hasta)


@router.get("/reportes/revision/{mes}")
def reporte_revision(sesion: Lectura, mes: Annotated[str, Path(pattern=MES)]) -> dict[str, Any]:
    return {**rep.revision(sesion, mes), "kpis": consultas_kpis.estrategicos(sesion, mes)}


@router.get("/exportar/excel", response_class=Response)
def exportar_excel(sesion: Lectura, desde: Desde = None, hasta: Hasta = None) -> Response:
    nombre = f"finanzas-{desde or 'inicio'}-a-{hasta or hoy_bogota().isoformat()[:7]}.xlsx"
    return Response(
        libro(sesion, desde, hasta),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f'attachment; filename="{nombre}"'},
    )
