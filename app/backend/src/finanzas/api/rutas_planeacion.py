"""Routers de la fase 3: presupuesto, créditos (extractos, amortización, simulador) y préstamos personales."""

from __future__ import annotations

from dataclasses import asdict
from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Path, Query
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from finanzas.api.dependencias import sesion_lectura, unidad_de_trabajo
from finanzas.dominio.errores import NoEncontrado
from finanzas.dominio.prestamos import alerta_costo
from finanzas.infra import consultas_creditos, consultas_prestamos, consultas_presupuesto
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import creditos, prestamos, presupuesto

router = APIRouter(prefix="/api/v1")
Lectura = Annotated[Session, Depends(sesion_lectura)]
Uow = Annotated[UnidadDeTrabajo, Depends(unidad_de_trabajo)]
MES = r"^\d{4}-(0[1-9]|1[0-2])$"


# ---------- Presupuesto por grupos (fase 7) ----------
class AsignacionIn(BaseModel):
    asignado: int = Field(ge=0, description="Centavos")


class GrupoIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)
    categoria_ids: list[int] = Field(min_length=1)
    icono: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, max_length=20)
    es_fijo: bool = False


@router.get("/presupuestos-historico", tags=["presupuesto"])
def historico_presupuesto(
    sesion: Lectura,
    desde: Annotated[str, Query(pattern=MES)],
    hasta: Annotated[str, Query(pattern=MES)],
    grupo: int | None = None,
) -> dict[str, Any]:
    """Asignado vs gastado por mes de un presupuesto o de todos."""
    return consultas_presupuesto.historico(sesion, desde, hasta, grupo)


@router.get("/presupuestos/{mes}/acumulado", tags=["presupuesto"])
def acumulado_presupuesto(
    sesion: Lectura, mes: Annotated[str, Path(pattern=MES)], grupo: int | None = None
) -> dict[str, Any]:
    """Gasto acumulado por día del mes y del anterior, con el límite vigente."""
    return consultas_presupuesto.acumulado(sesion, mes, grupo)


@router.get("/presupuestos/{mes}", tags=["presupuesto"])
def ver_presupuesto(sesion: Lectura, mes: Annotated[str, Path(pattern=MES)]) -> dict[str, Any]:
    return consultas_presupuesto.presupuesto_mes(sesion, mes)


@router.post("/presupuestos-grupos", tags=["presupuesto"], status_code=201)
def crear_grupo(datos: GrupoIn, uow: Uow) -> dict[str, int]:
    with uow:
        return {"id": presupuesto.crear_grupo(uow, presupuesto.DatosGrupo(**datos.model_dump())).id}


@router.put("/presupuestos-grupos/{grupo_id}", tags=["presupuesto"], status_code=204)
def editar_grupo(grupo_id: int, datos: GrupoIn, uow: Uow) -> None:
    with uow:
        presupuesto.editar_grupo(uow, grupo_id, presupuesto.DatosGrupo(**datos.model_dump()))


@router.delete("/presupuestos-grupos/{grupo_id}", tags=["presupuesto"], status_code=204)
def eliminar_grupo(grupo_id: int, uow: Uow) -> None:
    with uow:
        presupuesto.eliminar_grupo(uow, grupo_id)


@router.put("/presupuestos/{mes}/grupos/{grupo_id}", tags=["presupuesto"], status_code=204)
def asignar(mes: Annotated[str, Path(pattern=MES)], grupo_id: int, datos: AsignacionIn, uow: Uow) -> None:
    with uow:
        presupuesto.asignar(uow, mes, grupo_id, datos.asignado)


@router.delete("/presupuestos/{mes}/grupos/{grupo_id}", tags=["presupuesto"], status_code=204)
def quitar(mes: Annotated[str, Path(pattern=MES)], grupo_id: int, uow: Uow) -> None:
    with uow:
        presupuesto.quitar(uow, mes, grupo_id)


@router.post("/presupuestos/{mes}/copiar", tags=["presupuesto"])
def copiar(mes: str, desde: Annotated[str, Query(pattern=MES)], uow: Uow) -> dict[str, int]:
    with uow:
        return {"copiadas": presupuesto.copiar(uow, desde, mes)}


# ---------- Créditos ----------
class ExtractoIn(BaseModel):
    fecha_corte: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    saldo: int = Field(ge=0)
    intereses: int = Field(default=0, ge=0)
    abono_capital: int = Field(default=0, ge=0)
    seguros: int = Field(default=0, ge=0)
    cuotas_pendientes: int = Field(default=0, ge=0)


@router.get("/creditos", tags=["creditos"])
def listar_creditos(sesion: Lectura) -> list[dict[str, Any]]:
    return consultas_creditos.creditos_activos(sesion)


@router.get("/creditos/cerrados", tags=["creditos"])
def listar_creditos_cerrados(sesion: Lectura) -> list[dict[str, Any]]:
    return consultas_creditos.creditos_cerrados(sesion)


@router.get("/creditos/simulacion", tags=["creditos"])
def simular_abonos(
    sesion: Lectura,
    abono_extra: Annotated[int, Query(ge=0)] = 0,
    estrategia: Literal["avalancha", "bola_de_nieve"] = "avalancha",
) -> dict[str, Any]:
    return consultas_creditos.simulacion(sesion, abono_extra, estrategia)


@router.get("/creditos/{credito_id}/amortizacion", tags=["creditos"])
def amortizacion(credito_id: int, sesion: Lectura) -> dict[str, Any]:
    datos = consultas_creditos.amortizacion(sesion, credito_id)
    if datos is None:
        raise NoEncontrado(f"El crédito {credito_id} no existe")
    return datos


@router.post("/creditos/{credito_id}/extractos", tags=["creditos"], status_code=201)
def cargar_extracto(credito_id: int, datos: ExtractoIn, uow: Uow) -> dict[str, Any]:
    with uow:
        e = creditos.registrar_extracto(uow, credito_id, creditos.DatosExtracto(**datos.model_dump()))
        return {"credito_id": credito_id, "fecha_corte": e.fecha_corte, "saldo": e.saldo}


@router.get("/parametros/usura", tags=["parametros"])
def usura(sesion: Lectura) -> dict[str, float | None]:
    return {
        "consumo": consultas_creditos.parametro(sesion, "usura_consumo"),
        "consumo_bajo_monto": consultas_creditos.parametro(sesion, "usura_consumo_bajo_monto"),
    }


# ---------- Préstamos personales ----------
class PrestamoIn(BaseModel):
    direccion: Literal["presto_yo", "me_prestaron"]
    persona: str = Field(min_length=1, max_length=80)
    monto: int = Field(gt=0)
    cuenta_id: int
    fecha: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}")
    origen: Literal["amigo", "familia", "companero", "otra_fuente"] = "amigo"
    tipo_interes: Literal["ninguno", "fijo", "simple_mensual"] = "ninguno"
    interes_fijo: int = Field(default=0, ge=0)
    tasa_mensual: float = Field(default=0, ge=0, le=1)
    plan: Literal["fecha_unica", "cuotas", "libre"] = "fecha_unica"
    frecuencia: Literal["diaria", "semanal", "quincenal", "mensual"] = "mensual"
    num_cuotas: int = Field(default=1, ge=1, le=120)
    fecha_limite: str | None = None
    nota: str = ""


class AbonoIn(BaseModel):
    monto: int = Field(gt=0)
    cuenta_id: int
    fecha: str | None = None


@router.get("/prestamos", tags=["prestamos"])
def listar_prestamos(sesion: Lectura, estado: str | None = None) -> list[dict[str, Any]]:
    return consultas_prestamos.listar(sesion, estado)


@router.get("/prestamos/resumen", tags=["prestamos"])
def resumen_prestamos(sesion: Lectura) -> dict[str, Any]:
    return consultas_prestamos.resumen(sesion)


@router.post("/prestamos/simular", tags=["prestamos"])
def simular_prestamo(datos: PrestamoIn, sesion: Lectura) -> dict[str, Any]:
    """Vista previa sin guardar: interés, cuotas, E.A. equivalente y alerta de costo."""
    calculo = prestamos.calcular(prestamos.DatosPrestamo(**datos.model_dump()))
    usura_consumo = consultas_creditos.parametro(sesion, "usura_consumo") or 0.2859
    tasa = datos.tasa_mensual if datos.tipo_interes == "simple_mensual" else 0.0
    alerta = None
    if datos.direccion == "me_prestaron":
        alerta = alerta_costo(
            calculo.tasa_ea, tasa, datos.frecuencia if datos.plan == "cuotas" else "mensual", usura_consumo
        )
    return {
        "interes_total": calculo.interes_total,
        "total": datos.monto + calculo.interes_total,
        "tasa_ea": calculo.tasa_ea,
        "cuotas": [asdict(c) | {"fecha": c.fecha.isoformat(), "total": c.total} for c in calculo.cuotas],
        "alerta": alerta,
    }


@router.get("/prestamos/{prestamo_id}", tags=["prestamos"])
def ver_prestamo(prestamo_id: int, sesion: Lectura) -> dict[str, Any]:
    datos = consultas_prestamos.detalle(sesion, prestamo_id)
    if datos is None:
        raise NoEncontrado(f"El préstamo {prestamo_id} no existe")
    return datos


@router.post("/prestamos", tags=["prestamos"], status_code=201)
def crear_prestamo(datos: PrestamoIn, uow: Uow) -> dict[str, int]:
    with uow:
        p = prestamos.crear(uow, prestamos.DatosPrestamo(**datos.model_dump()))
        return {"id": p.id}


@router.post("/prestamos/{prestamo_id}/abonos", tags=["prestamos"], status_code=201)
def abonar(prestamo_id: int, datos: AbonoIn, uow: Uow) -> dict[str, int]:
    with uow:
        s = prestamos.abonar(uow, prestamo_id, datos.monto, datos.cuenta_id, datos.fecha)
        return {"capital_pendiente": s.capital_pendiente, "interes_pendiente": s.interes_pendiente}


@router.post("/prestamos/{prestamo_id}/condonar", tags=["prestamos"], status_code=204)
def condonar(prestamo_id: int, uow: Uow) -> None:
    with uow:
        prestamos.condonar(uow, prestamo_id)
