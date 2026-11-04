"""Routers de la API v1 (fase 1: cuentas, transacciones, categorías, importación, reportes, eventos)."""

from __future__ import annotations

import asyncio
import json
from collections.abc import AsyncIterator
from typing import Annotated, Any

from fastapi import APIRouter, Depends, File, Query, Request, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from finanzas.api.dependencias import bus_eventos, sesion_lectura, unidad_de_trabajo
from finanzas.api.esquemas import (
    CategoriaNodo,
    CuentaCambios,
    CuentaIn,
    CuentaOut,
    PaginaTransacciones,
    ResultadoImportacionOut,
    TransaccionCambios,
    TransaccionIn,
    TransaccionOut,
    TransferenciaIn,
)
from finanzas.dominio.errores import Conflicto, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra import consultas
from finanzas.infra.eventos import BusEventos
from finanzas.infra.modelos import Cuenta, Transaccion
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import importacion, transacciones

router = APIRouter(prefix="/api/v1")
Lectura = Annotated[Session, Depends(sesion_lectura)]
Uow = Annotated[UnidadDeTrabajo, Depends(unidad_de_trabajo)]


# ---------- Cuentas ----------
@router.get("/cuentas", response_model=list[CuentaOut], tags=["cuentas"])
def listar_cuentas(sesion: Lectura, todas: bool = False) -> list[dict[str, Any]]:
    """Cuentas de dinero. Con `todas=true` incluye las cuentas puente (por cobrar/pagar) y de crédito."""
    cuentas = consultas.saldos_cuentas(sesion)
    return cuentas if todas else [c for c in cuentas if c["tipo"] not in consultas.TIPOS_NO_LIQUIDOS]


@router.post("/cuentas", response_model=CuentaOut, status_code=201, tags=["cuentas"])
def crear_cuenta(datos: CuentaIn, uow: Uow) -> dict[str, Any]:
    with uow:
        if uow.sesion.query(Cuenta).filter_by(nombre=datos.nombre).first():
            raise Conflicto(f"Ya existe una cuenta llamada {datos.nombre}")
        valores = datos.model_dump()
        if datos.tipo == "inversion" and "incluir_en_total" not in datos.model_fields_set:
            valores["incluir_en_total"] = False  # no es dinero disponible, salvo que se elija
        cuenta = Cuenta(**valores, orden=uow.sesion.query(Cuenta).count())
        uow.sesion.add(cuenta)
        uow.sesion.flush()
        uow.registrar(DominioCambio(("cuentas", "dashboard", "calendario"), "crear", (cuenta.id,)))
        return {
            "id": cuenta.id,
            "nombre": cuenta.nombre,
            "tipo": cuenta.tipo,
            "saldo": cuenta.saldo_inicial,
            "institucion": cuenta.institucion,
            "color": cuenta.color,
            "icono": cuenta.icono,
            "incluir_en_total": cuenta.incluir_en_total,
            "saldo_inicial": cuenta.saldo_inicial,
        }


@router.patch("/cuentas/{cuenta_id}", status_code=204, tags=["cuentas"])
def editar_cuenta(cuenta_id: int, datos: CuentaCambios, uow: Uow) -> None:
    """Nombre, tipo, institución, logo, si suma al total y archivar. El saldo no se edita: se registra un ajuste."""
    with uow:
        cuenta = uow.sesion.get(Cuenta, cuenta_id)
        if cuenta is None:
            raise NoEncontrado(f"La cuenta {cuenta_id} no existe")
        cambios = datos.model_dump(exclude_unset=True)
        nombre = cambios.get("nombre")
        if nombre and uow.sesion.query(Cuenta).filter(Cuenta.nombre == nombre, Cuenta.id != cuenta_id).first():
            raise Conflicto(f"Ya existe una cuenta llamada {nombre}")
        archivada = cambios.pop("archivada", None)
        for campo, valor in cambios.items():
            setattr(cuenta, campo, valor)
        if archivada is not None:
            cuenta.archivado_en = transacciones.ahora() if archivada else None
        uow.registrar(DominioCambio(("cuentas", "dashboard", "calendario"), "editar", (cuenta.id,)))


# ---------- Transacciones ----------
@router.get("/transacciones", response_model=PaginaTransacciones, tags=["transacciones"])
def listar_transacciones(
    sesion: Lectura,
    desde: str | None = None,
    hasta: str | None = None,
    cuenta_id: int | None = None,
    grupo: str | None = None,
    categoria_id: int | None = None,
    texto: str | None = None,
    estado: str | None = None,
    cursor: str | None = None,
    limite: Annotated[int, Query(ge=1, le=500)] = 50,
) -> dict[str, Any]:
    filtro = consultas.FiltroTransacciones(desde, hasta, cuenta_id, grupo, categoria_id, texto, estado, cursor, limite)
    return consultas.listar_transacciones(sesion, filtro)


def _leer(uow: UnidadDeTrabajo, tx_id: int) -> dict[str, Any]:
    tx = uow.sesion.get(Transaccion, tx_id)
    assert tx is not None
    uow.sesion.refresh(tx)
    return consultas.a_dict(tx)


@router.post("/transacciones", response_model=TransaccionOut, status_code=201, tags=["transacciones"])
def crear_transaccion(datos: TransaccionIn, uow: Uow) -> dict[str, Any]:
    with uow:
        tx = transacciones.registrar(uow, transacciones.DatosTransaccion(**datos.model_dump()))
        return _leer(uow, tx.id)


@router.get("/transacciones/{tx_id}", response_model=TransaccionOut, tags=["transacciones"])
def leer_transaccion(tx_id: int, sesion: Lectura) -> dict[str, Any]:
    """Un movimiento con todos sus datos, para abrir el editor desde cualquier vista."""
    tx = sesion.get(Transaccion, tx_id)
    if tx is None:
        raise NoEncontrado(f"La transacción {tx_id} no existe")
    return consultas.a_dict(tx)


@router.patch("/transacciones/{tx_id}", response_model=TransaccionOut, tags=["transacciones"])
def editar_transaccion(tx_id: int, cambios: TransaccionCambios, uow: Uow) -> dict[str, Any]:
    with uow:
        tx = transacciones.editar(uow, tx_id, cambios.model_dump(exclude_unset=True))
        return _leer(uow, tx.id)


@router.delete("/transacciones/{tx_id}", status_code=204, tags=["transacciones"])
def eliminar_transaccion(tx_id: int, uow: Uow) -> None:
    with uow:
        transacciones.eliminar(uow, tx_id)


@router.post("/transferencias", response_model=list[TransaccionOut], status_code=201, tags=["transacciones"])
def crear_transferencia(datos: TransferenciaIn, uow: Uow) -> list[dict[str, Any]]:
    with uow:
        salida, entrada = transacciones.transferir(
            uow, datos.origen_id, datos.destino_id, datos.monto, datos.fecha, datos.descripcion
        )
        uow.sesion.flush()
        return [_leer(uow, salida.id), _leer(uow, entrada.id)]


# ---------- Categorías ----------
@router.get("/categorias", response_model=list[CategoriaNodo], tags=["categorias"])
def listar_categorias(sesion: Lectura) -> list[dict[str, Any]]:
    return consultas.arbol_categorias(sesion)


# ---------- Importación ----------
@router.post("/importar/cashew", response_model=ResultadoImportacionOut, tags=["importar"])
async def importar_cashew(uow: Uow, archivo: Annotated[UploadFile, File()]) -> Any:
    contenido = await archivo.read()

    def _ejecutar() -> importacion.ResultadoImportacion:
        with uow:
            return importacion.importar_cashew(uow, contenido, archivo.filename or "cashew.csv")

    return await asyncio.to_thread(_ejecutar)


@router.get("/sugerencias", tags=["transacciones"])
def sugerir(sesion: Lectura, texto: str = "", limite: Annotated[int, Query(ge=1, le=20)] = 6) -> list[dict[str, Any]]:
    """Autocompletado de la captura rápida: descripción → categoría, cuenta y monto habituales."""
    return consultas.sugerencias(sesion, texto, limite)


@router.get("/sugerencias/categorias", tags=["transacciones"])
def categorias_frecuentes(
    sesion: Lectura, tipo: Annotated[str, Query(pattern="^(gasto|ingreso)$")] = "gasto"
) -> list[dict[str, Any]]:
    return consultas.categorias_frecuentes(sesion, -1 if tipo == "gasto" else 1)


# ---------- Reportes ----------
@router.get("/reportes/dashboard", tags=["reportes"])
def reporte_dashboard(sesion: Lectura) -> dict[str, Any]:
    return consultas.dashboard(sesion)


@router.get("/reportes/flujo", tags=["reportes"])
def reporte_flujo(sesion: Lectura, meses: Annotated[int, Query(ge=1, le=36)] = 6) -> list[dict[str, Any]]:
    return consultas.resumen_mensual(sesion, meses)


# ---------- Eventos (SSE) ----------
@router.get("/events", tags=["eventos"])
async def eventos(request: Request, bus: Annotated[BusEventos, Depends(bus_eventos)]) -> StreamingResponse:
    """Server-Sent Events: cada cambio de dominio llega como `event: cambio`."""

    async def flujo() -> AsyncIterator[str]:
        cola = bus.suscribir()
        try:
            yield "retry: 3000\n\n"
            while not await request.is_disconnected():
                try:
                    evento = await asyncio.wait_for(cola.get(), timeout=15)
                except TimeoutError:
                    yield ": latido\n\n"
                    continue
                yield f"event: cambio\nid: {evento.version}\ndata: {json.dumps(evento.a_dict())}\n\n"
        finally:
            bus.desuscribir(cola)

    return StreamingResponse(flujo(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
