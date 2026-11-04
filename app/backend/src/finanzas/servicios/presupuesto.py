"""Casos de uso del presupuesto por grupos (fase 7, D3): un grupo reúne varias categorías con un solo monto
mensual (p. ej. «Hogar» = arriendo + servicios + internet). Una categoría pertenece a un solo grupo."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import date

from sqlalchemy import delete, select

from finanzas.dominio.errores import ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.modelos import (
    Categoria,
    PresupuestoGrupo,
    PresupuestoGrupoCategoria,
    PresupuestoGrupoMes,
)
from finanzas.infra.uow import UnidadDeTrabajo

INVALIDA = ("presupuesto", "dashboard")
GRUPOS_PRESUPUESTABLES = ("gasto_vida", "servicio_deuda", "apuestas", "ahorro_inversion")


def _validar_mes(mes: str) -> None:
    try:
        date.fromisoformat(f"{mes}-01")
    except ValueError as exc:
        raise ErrorValidacion("El mes debe ser AAAA-MM") from exc


@dataclass
class DatosGrupo:
    nombre: str
    categoria_ids: list[int] = field(default_factory=list)
    icono: str | None = None
    color: str | None = None
    es_fijo: bool = False


def _validar_grupo(uow: UnidadDeTrabajo, d: DatosGrupo, grupo_id: int | None) -> None:
    if not d.nombre.strip():
        raise ErrorValidacion("El presupuesto necesita un nombre")
    if not d.categoria_ids:
        raise ErrorValidacion("Elige al menos una categoría")
    for cid in d.categoria_ids:
        cat = uow.sesion.get(Categoria, cid)
        if cat is None or cat.nivel == 1 or cat.grupo not in GRUPOS_PRESUPUESTABLES:
            raise ErrorValidacion("Solo se presupuestan categorías de gasto, deudas, apuestas o ahorro")
        otro = uow.sesion.scalar(
            select(PresupuestoGrupo.nombre)
            .join(PresupuestoGrupoCategoria, PresupuestoGrupoCategoria.grupo_id == PresupuestoGrupo.id)
            .where(PresupuestoGrupoCategoria.categoria_id == cid, PresupuestoGrupo.id != (grupo_id or 0))
        )
        if otro is not None:
            raise ErrorValidacion(f"«{cat.nombre}» ya está en el presupuesto «{otro}»")
    ids = set(d.categoria_ids)
    for cid in ids:  # una subcategoría y su categoría madre juntas contarían doble
        cat = uow.sesion.get(Categoria, cid)
        if cat is not None and cat.padre_id in ids:
            raise ErrorValidacion(f"«{cat.nombre}» ya está incluida en su categoría madre")


def _aplicar(g: PresupuestoGrupo, d: DatosGrupo) -> None:
    g.nombre = d.nombre.strip()
    g.icono = d.icono
    g.color = d.color
    g.es_fijo = d.es_fijo
    g.categorias = [PresupuestoGrupoCategoria(categoria_id=c) for c in dict.fromkeys(d.categoria_ids)]


def crear_grupo(uow: UnidadDeTrabajo, d: DatosGrupo) -> PresupuestoGrupo:
    _validar_grupo(uow, d, None)
    if uow.sesion.scalar(select(PresupuestoGrupo).where(PresupuestoGrupo.nombre == d.nombre.strip())):
        raise ErrorValidacion(f"Ya existe un presupuesto llamado {d.nombre}")
    g = PresupuestoGrupo(orden=0)
    _aplicar(g, d)
    uow.sesion.add(g)
    uow.sesion.flush()
    uow.registrar(DominioCambio(INVALIDA, "crear", (g.id,)))
    return g


def editar_grupo(uow: UnidadDeTrabajo, grupo_id: int, d: DatosGrupo) -> PresupuestoGrupo:
    g = uow.sesion.get(PresupuestoGrupo, grupo_id)
    if g is None:
        raise NoEncontrado(f"El presupuesto {grupo_id} no existe")
    _validar_grupo(uow, d, grupo_id)
    uow.sesion.execute(delete(PresupuestoGrupoCategoria).where(PresupuestoGrupoCategoria.grupo_id == g.id))
    uow.sesion.flush()
    uow.sesion.expire(g, ["categorias"])
    _aplicar(g, d)
    uow.registrar(DominioCambio(INVALIDA, "editar", (g.id,)))
    return g


def eliminar_grupo(uow: UnidadDeTrabajo, grupo_id: int) -> None:
    g = uow.sesion.get(PresupuestoGrupo, grupo_id)
    if g is None:
        raise NoEncontrado(f"El presupuesto {grupo_id} no existe")
    uow.sesion.delete(g)
    uow.registrar(DominioCambio(INVALIDA, "borrar", (grupo_id,)))


def asignar(uow: UnidadDeTrabajo, mes: str, grupo_id: int, asignado: int) -> PresupuestoGrupoMes:
    _validar_mes(mes)
    if asignado < 0:
        raise ErrorValidacion("El monto asignado no puede ser negativo")
    if uow.sesion.get(PresupuestoGrupo, grupo_id) is None:
        raise NoEncontrado(f"El presupuesto {grupo_id} no existe")
    fila = uow.sesion.get(PresupuestoGrupoMes, (grupo_id, mes))
    if fila is None:
        fila = PresupuestoGrupoMes(grupo_id=grupo_id, mes=mes, asignado=asignado)
        uow.sesion.add(fila)
    fila.asignado = asignado
    uow.registrar(DominioCambio(INVALIDA, "asignar", (grupo_id,)))
    return fila


def quitar(uow: UnidadDeTrabajo, mes: str, grupo_id: int) -> None:
    fila = uow.sesion.get(PresupuestoGrupoMes, (grupo_id, mes))
    if fila is not None:
        uow.sesion.delete(fila)
        uow.registrar(DominioCambio(INVALIDA, "quitar", (grupo_id,)))


def copiar(uow: UnidadDeTrabajo, origen: str, destino: str) -> int:
    """Copia las asignaciones de un mes a otro sin pisar las que ya existen."""
    _validar_mes(origen)
    _validar_mes(destino)
    n = 0
    for f in uow.sesion.scalars(select(PresupuestoGrupoMes).where(PresupuestoGrupoMes.mes == origen)):
        if uow.sesion.get(PresupuestoGrupoMes, (f.grupo_id, destino)) is None:
            uow.sesion.add(PresupuestoGrupoMes(grupo_id=f.grupo_id, mes=destino, asignado=f.asignado))
            n += 1
    if n:
        uow.registrar(DominioCambio(INVALIDA, "copiar"))
    return n
