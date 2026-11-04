"""Casos de uso de metas (RF-ME): ahorro en una cuenta, salir de deudas, tope de gasto y hábito."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from sqlalchemy import delete

from finanzas.dominio.errores import ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.consultas_automatizacion import deuda_total
from finanzas.infra.modelos import Categoria, Meta, MetaObjetivo
from finanzas.infra.repositorios import obtener_cuenta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.transacciones import ahora

INVALIDA = ("metas",)
TipoMeta = Literal["ahorro", "deuda", "tope_gasto", "habito"]


@dataclass
class DatosMeta:
    nombre: str
    tipo: TipoMeta
    objetivo: int | None = None
    categoria_id: int | None = None
    cuenta_id: int | None = None
    fecha_objetivo: str | None = None
    cuenta_ids: list[int] = field(default_factory=list)
    categoria_ids: list[int] = field(default_factory=list)


def _normalizar(d: DatosMeta) -> None:
    """Une el campo único antiguo con las listas nuevas."""
    if d.cuenta_id and d.cuenta_id not in d.cuenta_ids:
        d.cuenta_ids.append(d.cuenta_id)
    if d.categoria_id and d.categoria_id not in d.categoria_ids:
        d.categoria_ids.append(d.categoria_id)
    d.cuenta_id = d.cuenta_ids[0] if d.cuenta_ids else None
    d.categoria_id = d.categoria_ids[0] if d.categoria_ids else None


def _validar(uow: UnidadDeTrabajo, d: DatosMeta) -> None:
    _normalizar(d)
    if not d.nombre.strip():
        raise ErrorValidacion("La meta necesita un nombre")
    if d.tipo == "ahorro":
        if not d.objetivo or d.objetivo <= 0 or not (d.cuenta_ids or d.categoria_ids):
            raise ErrorValidacion("Una meta de ahorro necesita un monto y las cuentas o categorías que la llevan")
        for c in d.cuenta_ids:
            obtener_cuenta(uow.sesion, c)
    if d.tipo in ("tope_gasto", "habito"):
        if not (d.categoria_ids or d.cuenta_ids):
            raise ErrorValidacion("Un tope o un hábito necesita las categorías o cuentas que vigila")
        if any(uow.sesion.get(Categoria, c) is None for c in d.categoria_ids):
            raise NoEncontrado("Una de las categorías no existe")
        if d.tipo == "tope_gasto" and (d.objetivo is None or d.objetivo <= 0):
            raise ErrorValidacion("El tope mensual debe ser mayor que cero")
        if d.objetivo is not None and d.objetivo < 0:
            raise ErrorValidacion("El tope no puede ser negativo")


def crear(uow: UnidadDeTrabajo, d: DatosMeta) -> Meta:
    _validar(uow, d)
    m = Meta(
        nombre=d.nombre.strip(),
        tipo=d.tipo,
        objetivo=0 if d.tipo == "habito" and d.objetivo is None else d.objetivo,
        categoria_id=d.categoria_id,
        cuenta_id=d.cuenta_id,
        fecha_objetivo=d.fecha_objetivo,
        # Punto de partida para medir avance (y retroceso): la deuda o lo ahorrado al crear la meta.
        base=deuda_total(uow.sesion) if d.tipo == "deuda" else _ahorrado(uow, d) if d.tipo == "ahorro" else None,
        estado="activa",
        creado_en=ahora(),
    )
    uow.sesion.add(m)
    uow.sesion.flush()
    _guardar_objetivos(uow, m, d)
    uow.registrar(DominioCambio(INVALIDA, "crear", (m.id,)))
    return m


def _ahorrado(uow: UnidadDeTrabajo, d: DatosMeta) -> int:
    from finanzas.infra.consultas import saldos_cuentas

    return sum(c["saldo"] for c in saldos_cuentas(uow.sesion) if c["id"] in d.cuenta_ids) if d.cuenta_ids else 0


def _guardar_objetivos(uow: UnidadDeTrabajo, m: Meta, d: DatosMeta) -> None:
    uow.sesion.execute(delete(MetaObjetivo).where(MetaObjetivo.meta_id == m.id))
    for c in d.cuenta_ids:
        uow.sesion.add(MetaObjetivo(meta_id=m.id, cuenta_id=c))
    for c in d.categoria_ids:
        uow.sesion.add(MetaObjetivo(meta_id=m.id, categoria_id=c))


def editar(uow: UnidadDeTrabajo, meta_id: int, d: DatosMeta) -> Meta:
    m = uow.sesion.get(Meta, meta_id)
    if m is None:
        raise NoEncontrado(f"La meta {meta_id} no existe")
    _validar(uow, d)
    m.nombre = d.nombre.strip()
    m.objetivo = 0 if d.tipo == "habito" and d.objetivo is None else d.objetivo
    m.cuenta_id, m.categoria_id, m.fecha_objetivo = d.cuenta_id, d.categoria_id, d.fecha_objetivo
    _guardar_objetivos(uow, m, d)
    uow.registrar(DominioCambio(INVALIDA, "editar", (m.id,)))
    return m


def cambiar_estado(uow: UnidadDeTrabajo, meta_id: int, estado: Literal["activa", "cumplida", "archivada"]) -> Meta:
    m = uow.sesion.get(Meta, meta_id)
    if m is None:
        raise NoEncontrado(f"La meta {meta_id} no existe")
    if estado == "cumplida" and m.estado != "cumplida":
        m.cumplida_en = ahora()
    elif estado == "activa":
        m.cumplida_en = None
    m.estado = estado
    uow.registrar(DominioCambio(INVALIDA, "editar", (m.id,)))
    return m


def eliminar(uow: UnidadDeTrabajo, meta_id: int) -> None:
    m = uow.sesion.get(Meta, meta_id)
    if m is None:
        raise NoEncontrado(f"La meta {meta_id} no existe")
    uow.sesion.execute(delete(MetaObjetivo).where(MetaObjetivo.meta_id == m.id))
    uow.sesion.delete(m)
    uow.registrar(DominioCambio(INVALIDA, "borrar", (meta_id,)))
