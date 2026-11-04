"""Routers de la fase 6: abono único y compra de cartera, parámetros de Colombia y TRM, termómetro
de renta y asistente opcional con IA."""

from __future__ import annotations

from datetime import date
from typing import Annotated, Any

from fastapi import APIRouter, Depends, Query, Request
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from finanzas.api.dependencias import sesion_lectura, unidad_de_trabajo
from finanzas.config import obtener_config
from finanzas.dominio.errores import NoEncontrado
from finanzas.dominio.fechas import hoy_bogota
from finanzas.infra import consultas_creditos, consultas_impuestos, respaldos, trm
from finanzas.infra.modelos import Categoria, Parametro
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import asistente, categorias, creditos, parametros

router = APIRouter(prefix="/api/v1")
Lectura = Annotated[Session, Depends(sesion_lectura)]
Uow = Annotated[UnidadDeTrabajo, Depends(unidad_de_trabajo)]
FECHA = r"^\d{4}-\d{2}-\d{2}$"


# ---------- Créditos: abono único y compra de cartera (RF-DE-05) ----------
@router.get("/creditos/{credito_id}/abono-unico", tags=["creditos"])
def abono_unico(credito_id: int, sesion: Lectura, abono: Annotated[int, Query(gt=0)]) -> dict[str, Any]:
    """Compara reducir plazo vs. reducir cuota con un abono a capital hoy."""
    datos = consultas_creditos.simular_abono_unico(sesion, credito_id, abono)
    if datos is None:
        raise NoEncontrado(f"El crédito {credito_id} no existe")
    return datos


class CompraCarteraIn(BaseModel):
    tasa_ea: float = Field(gt=0, lt=3, description="Tasa efectiva anual ofrecida, p. ej. 0.24")
    plazo_meses: int = Field(ge=1, le=120)
    costos_iniciales: int = Field(default=0, ge=0, description="Centavos: estudio de crédito, comisión, etc.")
    seguro_mensual: int = Field(default=0, ge=0, description="Centavos")
    financiar_costos: bool = True
    credito_ids: list[int] | None = None


@router.post("/creditos/compra-cartera", tags=["creditos"])
def compra_cartera(datos: CompraCarteraIn, sesion: Lectura) -> dict[str, Any]:
    """¿Conviene recoger los créditos en uno nuevo? Compara lo que falta pagar, no solo la cuota."""
    return consultas_creditos.simular_compra_cartera(sesion, **datos.model_dump())


# ---------- Parámetros de Colombia (RF-CO-01) y TRM ----------
class ParametroIn(BaseModel):
    clave: str
    vigencia_desde: str = Field(pattern=FECHA)
    valor: float
    fuente: str = Field(max_length=200)


@router.get("/parametros", tags=["parametros"])
def listar_parametros(sesion: Lectura) -> list[dict[str, Any]]:
    filas = sesion.scalars(
        select(Parametro)
        .where(Parametro.clave.in_(parametros.EDITABLES), Parametro.clave != "trm")
        .order_by(Parametro.clave, Parametro.vigencia_desde.desc())
    )
    return [{"clave": p.clave, "vigencia_desde": p.vigencia_desde, "valor": p.valor, "fuente": p.fuente} for p in filas]


@router.put("/parametros", tags=["parametros"], status_code=204)
def guardar_parametro(datos: ParametroIn, uow: Uow) -> None:
    with uow:
        parametros.guardar(uow, datos.clave, datos.vigencia_desde, datos.valor, datos.fuente)


@router.get("/parametros/trm", tags=["parametros"])
def ver_trm(sesion: Lectura, fecha: Annotated[str | None, Query(pattern=FECHA)] = None) -> dict[str, Any]:
    """TRM oficial del día (Superfinanciera). Sin red, la última conocida marcada como aproximada."""
    valor = trm.obtener(sesion, date.fromisoformat(fecha) if fecha else hoy_bogota())
    if valor is None:
        raise NoEncontrado("No hay TRM disponible: sin conexión y sin una guardada. Escríbela a mano.")
    return valor


# ---------- Impuestos (RF-CO-02, RF-CO-03) ----------
@router.get("/impuestos/termometro", tags=["impuestos"])
def termometro(sesion: Lectura, anio: Annotated[int | None, Query(ge=2020, le=2100)] = None) -> dict[str, Any]:
    return consultas_impuestos.termometro(sesion, anio)


# ---------- Asistente con IA (RF-IA-01, opcional) ----------
class ConsentimientoIn(BaseModel):
    activo: bool


class PreguntaIn(BaseModel):
    pregunta: str = Field(min_length=1, max_length=500)


@router.get("/asistente/estado", tags=["asistente"])
def estado_asistente(sesion: Lectura) -> dict[str, Any]:
    return {
        "consentimiento": asistente.consentimiento(sesion),
        "credenciales": asistente.credenciales_disponibles(),
        "modelo": asistente.MODELO,
    }


@router.put("/asistente/consentimiento", tags=["asistente"], status_code=204)
def consentir(datos: ConsentimientoIn, sesion: Lectura) -> None:
    asistente.cambiar_consentimiento(sesion, datos.activo)


@router.post("/asistente/preguntar", tags=["asistente"])
def preguntar(datos: PreguntaIn, sesion: Lectura, request: Request) -> dict[str, Any]:
    ejecutor = getattr(request.app.state, "ejecutor_asistente", None) or asistente.ejecutar
    return asistente.preguntar(sesion, datos.pregunta, ejecutor)


# ---------- Créditos: crear y editar (fase 7) ----------
class CreditoIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=40)
    entidad: str = Field(min_length=1, max_length=60)
    fecha_desembolso: str = Field(pattern=FECHA)
    capital_inicial: int = Field(gt=0, description="Centavos: lo que debes al inicio (con seguros financiados)")
    monto_recibido: int = Field(gt=0, description="Centavos: lo que llegó a tu cuenta")
    tasa_ea: float = Field(gt=0, lt=3)
    plazo_meses: int = Field(ge=1, le=600)
    cuota: int = Field(gt=0, description="Centavos, incluye el seguro")
    dia_pago: int = Field(ge=1, le=31)
    seguro_mensual: int = Field(default=0, ge=0)
    cuenta_pago_id: int | None = None
    numero: str | None = Field(default=None, max_length=40)
    cuenta_desembolso_id: int | None = Field(
        default=None, description="Cuenta donde llegó el dinero: crea o mueve el movimiento de desembolso"
    )


@router.post("/creditos", tags=["creditos"], status_code=201)
def crear_credito(datos: CreditoIn, uow: Uow) -> dict[str, int]:
    """Crea el crédito, su categoría y programa sus cuotas."""
    with uow:
        return {"id": creditos.crear(uow, creditos.DatosCredito(**datos.model_dump())).id}


@router.delete("/creditos/{credito_id}", tags=["creditos"])
def eliminar_credito(credito_id: int, uow: Uow) -> dict[str, int]:
    """Borra el crédito con todos sus movimientos. Antes se hace un respaldo de la base."""
    config = obtener_config()
    respaldos.respaldar(config.db_ruta, config.backups_dir / "db")
    with uow:
        return creditos.eliminar(uow, credito_id)


@router.post("/creditos/{credito_id}/pagado", tags=["creditos"])
def marcar_credito_pagado(credito_id: int, uow: Uow) -> dict[str, int]:
    """Cierra el crédito: conserva los pagos hechos y quita las cuotas programadas."""
    with uow:
        return creditos.marcar_pagado(uow, credito_id)


@router.put("/creditos/{credito_id}", tags=["creditos"], status_code=204)
def editar_credito(credito_id: int, datos: CreditoIn, uow: Uow) -> None:
    with uow:
        creditos.editar(uow, credito_id, creditos.DatosCredito(**datos.model_dump()))


# ---------- Categorías: crear, editar y fusionar (fase 7) ----------
class CategoriaNueva(BaseModel):
    padre_id: int = Field(description="Grupo (nivel 1) para una categoría, o categoría para una subcategoría")
    nombre: str = Field(min_length=1, max_length=80)
    icono: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, max_length=20)


class CategoriaCambios(BaseModel):
    nombre: str | None = Field(default=None, min_length=1, max_length=80)
    icono: str | None = Field(default=None, max_length=40)
    color: str | None = Field(default=None, max_length=20)
    es_fijo: bool | None = None
    padre_id: int | None = Field(
        default=None, description="Nuevo padre: el grupo (queda como categoría) o una categoría (subcategoría)"
    )


@router.post("/categorias", tags=["categorias"], status_code=201)
def crear_categoria(datos: CategoriaNueva, uow: Uow) -> dict[str, int]:
    with uow:
        d = categorias.DatosCategoria(datos.nombre, datos.icono, datos.color)
        return {"id": categorias.crear(uow, datos.padre_id, d).id}


@router.patch("/categorias/{categoria_id}", tags=["categorias"], status_code=204)
def editar_categoria(categoria_id: int, cambios: CategoriaCambios, uow: Uow) -> None:
    """Solo cambia lo que se envía (nombre, ícono, color o si es gasto fijo)."""
    with uow:
        actual = uow.sesion.get(Categoria, categoria_id)
        if actual is None:
            raise NoEncontrado(f"La categoría {categoria_id} no existe")
        enviados = cambios.model_dump(exclude_unset=True)
        d = categorias.DatosCategoria(
            nombre=enviados.get("nombre") or actual.nombre,
            icono=enviados.get("icono", actual.icono),
            color=enviados.get("color", actual.color),
            es_fijo=enviados.get("es_fijo"),
        )
        categorias.editar(uow, categoria_id, d)
        if enviados.get("padre_id") is not None and enviados["padre_id"] != actual.padre_id:
            categorias.mover(uow, categoria_id, enviados["padre_id"])


@router.delete("/categorias/{categoria_id}", tags=["categorias"])
def eliminar_categoria(categoria_id: int, destino: Annotated[int, Query()], uow: Uow) -> dict[str, int]:
    """Elimina la categoría pasando sus movimientos, reglas, presupuestos y metas a `destino`."""
    with uow:
        return {"movidos": categorias.eliminar(uow, categoria_id, destino)}
