"""Casos de uso de categorías (RF-CA-03, fase 7 D4): crear, editar nombre/ícono/color y eliminar fusionando
con otra para que movimientos, reglas, recurrentes, presupuestos, metas y créditos queden consistentes."""

from __future__ import annotations

import json
from dataclasses import dataclass

from sqlalchemy import func, select, update

from finanzas.dominio.errores import ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.modelos import (
    Categoria,
    Credito,
    Meta,
    MetaObjetivo,
    PresupuestoGrupoCategoria,
    Recurrente,
    Regla,
    Transaccion,
)
from finanzas.infra.uow import UnidadDeTrabajo

INVALIDA = ("categorias", "transacciones", "presupuesto", "reportes", "dashboard", "reglas", "metas")
COLORES = {f"chart-{i}" for i in range(1, 7)}


@dataclass
class DatosCategoria:
    nombre: str
    icono: str | None = None
    color: str | None = None
    es_fijo: bool | None = None


def _validar(d: DatosCategoria) -> None:
    if not d.nombre.strip() or len(d.nombre.strip()) > 80:
        raise ErrorValidacion("El nombre debe tener entre 1 y 80 caracteres")
    if d.color is not None and d.color not in COLORES:
        raise ErrorValidacion("El color debe ser de la paleta (chart-1 … chart-6)")


def _hermana(uow: UnidadDeTrabajo, padre_id: int | None, nombre: str, excepto: int | None = None) -> bool:
    return (
        uow.sesion.scalar(
            select(Categoria.id).where(
                Categoria.padre_id == padre_id, Categoria.nombre == nombre, Categoria.id != (excepto or 0)
            )
        )
        is not None
    )


def crear(uow: UnidadDeTrabajo, padre_id: int, d: DatosCategoria) -> Categoria:
    """Crea una categoría (bajo un grupo, nivel 1) o una subcategoría (bajo una categoría, nivel 2)."""
    _validar(d)
    padre = uow.sesion.get(Categoria, padre_id)
    if padre is None:
        raise NoEncontrado(f"La categoría {padre_id} no existe")
    if padre.nivel == 3:
        raise ErrorValidacion("Una subcategoría no puede tener subcategorías")
    if _hermana(uow, padre.id, d.nombre.strip()):
        raise ErrorValidacion(f"Ya existe «{d.nombre}» ahí")
    c = Categoria(
        padre_id=padre.id,
        nivel=padre.nivel + 1,
        nombre=d.nombre.strip(),
        grupo=padre.grupo,
        es_fijo=bool(d.es_fijo),
        icono=d.icono,
        color=d.color,
    )
    uow.sesion.add(c)
    uow.sesion.flush()
    uow.registrar(DominioCambio(INVALIDA, "crear", (c.id,)))
    return c


def editar(uow: UnidadDeTrabajo, categoria_id: int, d: DatosCategoria) -> Categoria:
    c = uow.sesion.get(Categoria, categoria_id)
    if c is None:
        raise NoEncontrado(f"La categoría {categoria_id} no existe")
    if c.nivel == 1:
        raise ErrorValidacion("Los grupos (ingreso, gasto de vida…) no se editan")
    _validar(d)
    if _hermana(uow, c.padre_id, d.nombre.strip(), c.id):
        raise ErrorValidacion(f"Ya existe «{d.nombre}» ahí")
    c.nombre = d.nombre.strip()
    c.icono = d.icono
    c.color = d.color
    if d.es_fijo is not None:
        c.es_fijo = d.es_fijo
    uow.registrar(DominioCambio(INVALIDA, "editar", (c.id,)))
    return c


def mover(uow: UnidadDeTrabajo, categoria_id: int, padre_id: int) -> Categoria:
    """Cambia la categoría de padre dentro de su grupo (fase 8, D10). Con el grupo como padre queda como
    categoría principal; con una categoría principal, como subcategoría. Solo hay dos niveles: una categoría
    con subcategorías no puede volverse subcategoría. Movimientos, presupuestos y reglas la siguen."""
    c = uow.sesion.get(Categoria, categoria_id)
    padre = uow.sesion.get(Categoria, padre_id)
    if c is None or padre is None:
        raise NoEncontrado("La categoría no existe")
    if c.nivel == 1:
        raise ErrorValidacion("Los grupos no se mueven")
    if padre.grupo != c.grupo:
        raise ErrorValidacion("Solo se puede mover dentro del mismo grupo (gasto con gasto, ingreso con ingreso)")
    if padre.id == c.id or padre.nivel == 3:
        raise ErrorValidacion("Ese no puede ser su padre")
    tiene_hijas = uow.sesion.scalar(select(func.count()).where(Categoria.padre_id == c.id)) or 0
    if padre.nivel == 2 and tiene_hijas:
        raise ErrorValidacion("Tiene subcategorías: muévelas primero para que pueda volverse subcategoría")
    ligada = uow.sesion.scalar(
        select(Credito.id).where((Credito.categoria_id == c.id) | (Credito.categoria_id == c.padre_id)).limit(1)
    )
    if ligada is not None and c.grupo == "servicio_deuda":
        raise ErrorValidacion("Las categorías de un crédito se administran desde Deudas")
    if _hermana(uow, padre.id, c.nombre, c.id):
        raise ErrorValidacion(f"Ya existe «{c.nombre}» en ese lugar")
    c.padre_id = padre.id
    c.nivel = padre.nivel + 1
    uow.registrar(DominioCambio(INVALIDA, "editar", (c.id,)))
    return c


def eliminar(uow: UnidadDeTrabajo, categoria_id: int, destino_id: int) -> int:
    """Elimina la categoría (y sus subcategorías) pasando todo lo que la usaba a `destino`.
    Devuelve cuántos movimientos se reasignaron."""
    s = uow.sesion
    c = s.get(Categoria, categoria_id)
    destino = s.get(Categoria, destino_id)
    if c is None or destino is None:
        raise NoEncontrado("La categoría o el destino no existen")
    if c.nivel == 1:
        raise ErrorValidacion("Los grupos no se eliminan")
    hijos = list(s.scalars(select(Categoria.id).where(Categoria.padre_id == c.id)))
    origen = {c.id, *hijos}
    if destino.id in origen:
        raise ErrorValidacion("El destino no puede ser la misma categoría ni una de sus subcategorías")
    if destino.grupo != c.grupo:
        raise ErrorValidacion("El destino debe ser del mismo grupo (p. ej. gasto con gasto)")
    if destino.nivel == 1:
        raise ErrorValidacion("Elige una categoría o subcategoría, no un grupo")
    if s.scalar(select(Credito.id).where(Credito.categoria_id.in_(origen))) is not None:
        raise ErrorValidacion("Es la categoría de un crédito: no se puede eliminar")

    movidos = s.scalar(select(func.count()).where(Transaccion.categoria_id.in_(origen)))
    s.execute(update(Transaccion).where(Transaccion.categoria_id.in_(origen)).values(categoria_id=destino.id))
    s.execute(update(Recurrente).where(Recurrente.categoria_id.in_(origen)).values(categoria_id=destino.id))
    s.execute(update(Meta).where(Meta.categoria_id.in_(origen)).values(categoria_id=destino.id))
    s.execute(update(MetaObjetivo).where(MetaObjetivo.categoria_id.in_(origen)).values(categoria_id=destino.id))
    destino_en_grupo = s.scalar(
        select(PresupuestoGrupoCategoria).where(PresupuestoGrupoCategoria.categoria_id == destino.id)
    )
    for gc in s.scalars(select(PresupuestoGrupoCategoria).where(PresupuestoGrupoCategoria.categoria_id.in_(origen))):
        if destino_en_grupo is None:  # el grupo hereda el destino; si ya estaba en otro grupo, se quita aquí
            gc.categoria_id = destino.id
            destino_en_grupo = gc
        else:
            s.delete(gc)
    for r in s.scalars(select(Regla)):
        acciones = json.loads(r.acciones)
        if acciones.get("categoria_id") in origen:
            acciones["categoria_id"] = destino.id
            r.acciones = json.dumps(acciones, ensure_ascii=False)
    s.flush()
    for ident in hijos:
        hijo = s.get(Categoria, ident)
        if hijo is not None:
            s.delete(hijo)
    s.flush()
    s.delete(c)
    uow.registrar(DominioCambio(INVALIDA, "fusionar", (categoria_id, destino_id)))
    return int(movidos or 0)
