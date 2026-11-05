"""Routers de la fase 5: reglas, sugerencias de categoría, recurrentes, calendario, metas, alertas y respaldos."""

from __future__ import annotations

from typing import Annotated, Any, Literal

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from finanzas.api.dependencias import sesion_lectura, unidad_de_trabajo
from finanzas.dominio import reglas as dom_reglas
from finanzas.infra import consultas_automatizacion as auto
from finanzas.infra import consultas_clasificador, respaldos
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import metas, recurrentes, reglas

router = APIRouter(prefix="/api/v1")
Lectura = Annotated[Session, Depends(sesion_lectura)]
Uow = Annotated[UnidadDeTrabajo, Depends(unidad_de_trabajo)]
FECHA = r"^\d{4}-\d{2}-\d{2}$"
FECHA_HORA = r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$"  # el editor de movimientos envía fecha y hora


# ---------- Sugerencias de categoría (RF-CA-05) ----------
@router.get("/sugerencias/clasificar", tags=["sugerencias"])
def clasificar(
    sesion: Lectura, monto: int, descripcion: Annotated[str, Query(max_length=200)] = "", cuenta_id: int = 0
) -> list[dict[str, Any]]:
    """Hasta 3 categorías probables para un movimiento nuevo, la primera es la recomendada."""
    return consultas_clasificador.sugerir(sesion, descripcion, monto, cuenta_id)


@router.get("/sugerencias/precision", tags=["sugerencias"])
def precision(sesion: Lectura) -> dict[str, Any]:
    return consultas_clasificador.precision(sesion)


# ---------- Reglas (RF-CA-04) ----------
class CondicionIn(BaseModel):
    campo: dom_reglas.Campo
    op: dom_reglas.Operador
    valor: str | int
    valor2: int | None = None


class ReglaIn(BaseModel):
    nombre: str = Field(max_length=80)
    prioridad: int = Field(default=100, ge=0, le=1000)
    condiciones: list[CondicionIn] = Field(min_length=1)
    categoria_id: int | None = None
    etiquetas: list[str] = []
    activa: bool = True

    def dominio(self) -> tuple[list[dom_reglas.Condicion], dom_reglas.Acciones]:
        condiciones = [dom_reglas.Condicion(**c.model_dump()) for c in self.condiciones]
        etiquetas = tuple(e.strip().lower() for e in self.etiquetas if e.strip())
        return condiciones, dom_reglas.Acciones(self.categoria_id, etiquetas)


@router.get("/reglas", tags=["reglas"])
def listar_reglas(sesion: Lectura) -> list[dict[str, Any]]:
    return auto.reglas(sesion)


@router.post("/reglas", tags=["reglas"], status_code=201)
def crear_regla(datos: ReglaIn, uow: Uow) -> dict[str, int]:
    with uow:
        condiciones, acciones = datos.dominio()
        return {"id": reglas.crear(uow, datos.nombre, datos.prioridad, condiciones, acciones).id}


@router.put("/reglas/{regla_id}", tags=["reglas"], status_code=204)
def editar_regla(regla_id: int, datos: ReglaIn, uow: Uow) -> None:
    with uow:
        condiciones, acciones = datos.dominio()
        reglas.editar(uow, regla_id, datos.nombre, datos.prioridad, condiciones, acciones, datos.activa)


@router.delete("/reglas/{regla_id}", tags=["reglas"], status_code=204)
def eliminar_regla(regla_id: int, uow: Uow) -> None:
    with uow:
        reglas.eliminar(uow, regla_id)


@router.post("/reglas/probar", tags=["reglas"])
def probar_regla(datos: list[CondicionIn], sesion: Lectura) -> dict[str, Any]:
    """Cuántos movimientos del historial cumplen estas condiciones (sin guardar nada)."""
    condiciones = [dom_reglas.Condicion(**c.model_dump()) for c in datos]
    dom_reglas.validar(tuple(condiciones), dom_reglas.Acciones(etiquetas=("prueba",)))
    return reglas.probar(sesion, condiciones)


# ---------- Recurrentes y calendario (RF-RE) ----------
class RecurrenteIn(BaseModel):
    nombre: str = Field(max_length=120)
    cuenta_id: int
    monto: int = Field(description="Centavos: negativo = pago, positivo = ingreso")
    frecuencia: Literal["semanal", "quincenal", "mensual", "anual"] = "mensual"
    dia: int = Field(ge=1, le=31)
    inicio: str = Field(pattern=FECHA)
    categoria_id: int | None = None
    fin: str | None = Field(default=None, pattern=FECHA)
    es_suscripcion: bool = False
    nota: str = ""
    activo: bool = True
    ancla: Literal["calendario", "pago"] = "calendario"


class PagoIn(BaseModel):
    fecha: str | None = Field(default=None, pattern=FECHA_HORA)
    monto: int | None = None
    fecha_modo: Literal["hoy", "programada"] = Field(
        default="hoy", description="Un vencido se registra con su fecha programada o con la de hoy"
    )


class EstadoRecurrenteIn(BaseModel):
    estado: Literal["activo", "pausado", "cancelado"]


@router.get("/recurrentes", tags=["recurrentes"])
def listar_recurrentes(sesion: Lectura) -> dict[str, Any]:
    return auto.recurrentes(sesion)


@router.get("/recurrentes/detectar", tags=["recurrentes"])
def detectar_recurrentes(sesion: Lectura) -> list[dict[str, Any]]:
    return auto.detectar(sesion)


def _datos(d: RecurrenteIn) -> recurrentes.DatosRecurrente:
    return recurrentes.DatosRecurrente(**d.model_dump(exclude={"activo"}))


@router.post("/recurrentes", tags=["recurrentes"], status_code=201)
def crear_recurrente(datos: RecurrenteIn, uow: Uow) -> dict[str, int]:
    with uow:
        return {"id": recurrentes.crear(uow, _datos(datos)).id}


@router.put("/recurrentes/{recurrente_id}", tags=["recurrentes"], status_code=204)
def editar_recurrente(recurrente_id: int, datos: RecurrenteIn, uow: Uow) -> None:
    with uow:
        recurrentes.editar(uow, recurrente_id, _datos(datos), datos.activo)


@router.delete("/recurrentes/{recurrente_id}", tags=["recurrentes"], status_code=204)
def eliminar_recurrente(recurrente_id: int, uow: Uow) -> None:
    with uow:
        recurrentes.eliminar(uow, recurrente_id)


@router.post("/recurrentes/{recurrente_id}/estado", tags=["recurrentes"], status_code=204)
def estado_recurrente(recurrente_id: int, datos: EstadoRecurrenteIn, uow: Uow) -> None:
    """Pausar (se puede reactivar), cancelar o reactivar; lo programado sin pagar se borra."""
    with uow:
        recurrentes.cambiar_estado(uow, recurrente_id, datos.estado)


@router.post("/programadas/{tx_id}/omitir", tags=["recurrentes"], status_code=204)
def omitir_programada(tx_id: int, uow: Uow) -> None:
    """Salta este pago: no se cobra, no vuelve a programarse y se programa el periodo siguiente."""
    with uow:
        recurrentes.omitir(uow, tx_id)


@router.post("/programadas/{tx_id}/pagar", tags=["recurrentes"], status_code=204)
def pagar_programada(tx_id: int, datos: PagoIn, uow: Uow) -> None:
    """Confirma un pago programado (hoy y por su monto, salvo que se indique otro)."""
    with uow:
        recurrentes.pagar(uow, tx_id, datos.fecha, datos.monto, datos.fecha_modo)


@router.get("/calendario", tags=["recurrentes"])
def ver_calendario(sesion: Lectura, dias: Annotated[int, Query(ge=1, le=120)] = 45) -> dict[str, Any]:
    return auto.calendario(sesion, dias)


# ---------- Metas (RF-ME) ----------
class MetaIn(BaseModel):
    nombre: str = Field(max_length=120)
    tipo: metas.TipoMeta
    objetivo: int | None = Field(default=None, description="Centavos: monto a ahorrar o tope mensual")
    categoria_id: int | None = None
    cuenta_id: int | None = None
    fecha_objetivo: str | None = Field(default=None, pattern=FECHA)
    cuenta_ids: list[int] = []
    categoria_ids: list[int] = []
    activo_ids: list[int] = []


class EstadoMetaIn(BaseModel):
    estado: Literal["activa", "cumplida", "archivada"]


@router.get("/metas", tags=["metas"])
def listar_metas(sesion: Lectura) -> list[dict[str, Any]]:
    return auto.metas(sesion)


@router.post("/metas", tags=["metas"], status_code=201)
def crear_meta(datos: MetaIn, uow: Uow) -> dict[str, int]:
    with uow:
        return {"id": metas.crear(uow, metas.DatosMeta(**datos.model_dump())).id}


@router.put("/metas/{meta_id}", tags=["metas"], status_code=204)
def editar_meta(meta_id: int, datos: MetaIn, uow: Uow) -> None:
    with uow:
        metas.editar(uow, meta_id, metas.DatosMeta(**datos.model_dump()))


@router.delete("/metas/{meta_id}", tags=["metas"], status_code=204)
def eliminar_meta(meta_id: int, uow: Uow) -> None:
    with uow:
        metas.eliminar(uow, meta_id)


@router.patch("/metas/{meta_id}", tags=["metas"], status_code=204)
def cambiar_meta(meta_id: int, datos: EstadoMetaIn, uow: Uow) -> None:
    with uow:
        metas.cambiar_estado(uow, meta_id, datos.estado)


# ---------- Alertas y respaldos ----------
@router.get("/alertas", tags=["alertas"])
def ver_alertas(sesion: Lectura) -> list[dict[str, Any]]:
    return auto.alertas(sesion)


@router.get("/respaldos", tags=["respaldos"])
def listar_respaldos(request: Request) -> list[dict[str, Any]]:
    return respaldos.listar(request.app.state.config.backups_dir / "db")


@router.post("/respaldos", tags=["respaldos"], status_code=201)
def crear_respaldo(request: Request) -> dict[str, Any]:
    config = request.app.state.config
    copia = respaldos.respaldar(config.db_ruta, config.backups_dir / "db")
    return {"archivo": copia.name if copia else None}
