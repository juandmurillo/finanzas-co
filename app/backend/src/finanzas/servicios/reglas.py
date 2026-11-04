"""Casos de uso de reglas de categorización (RF-CA-04) y su aplicación al registrar movimientos."""

from __future__ import annotations

import json
from dataclasses import asdict
from datetime import datetime
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import Session

from finanzas.dominio import reglas as dom
from finanzas.dominio.errores import NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.modelos import Categoria, Regla, Transaccion
from finanzas.infra.repositorios import etiqueta_por_nombre
from finanzas.infra.uow import UnidadDeTrabajo

INVALIDA = ("reglas",)


def ahora() -> str:
    return datetime.now(ZoneInfo("America/Bogota")).isoformat(timespec="seconds")


def a_dominio(r: Regla) -> dom.Regla:
    condiciones = tuple(dom.Condicion(**c) for c in json.loads(r.condiciones))
    acciones = json.loads(r.acciones)
    return dom.Regla(
        r.id,
        r.nombre,
        r.prioridad,
        condiciones,
        dom.Acciones(acciones.get("categoria_id"), tuple(acciones.get("etiquetas", ()))),
        r.activa,
    )


def activas(sesion: Session) -> list[dom.Regla]:
    return [a_dominio(r) for r in sesion.scalars(select(Regla).where(Regla.activa.is_(True)))]


def _guardar(
    sesion: Session, r: Regla, nombre: str, prioridad: int, condiciones: list[dom.Condicion], acciones: dom.Acciones
) -> None:
    dom.validar(tuple(condiciones), acciones)
    if acciones.categoria_id is not None and sesion.get(Categoria, acciones.categoria_id) is None:
        raise NoEncontrado(f"La categoría {acciones.categoria_id} no existe")
    r.nombre = nombre.strip() or "Regla sin nombre"
    r.prioridad = prioridad
    r.condiciones = json.dumps([asdict(c) for c in condiciones], ensure_ascii=False)
    r.acciones = json.dumps(
        {"categoria_id": acciones.categoria_id, "etiquetas": list(acciones.etiquetas)}, ensure_ascii=False
    )


def crear(
    uow: UnidadDeTrabajo, nombre: str, prioridad: int, condiciones: list[dom.Condicion], acciones: dom.Acciones
) -> Regla:
    r = Regla(creado_en=ahora(), activa=True)
    _guardar(uow.sesion, r, nombre, prioridad, condiciones, acciones)
    uow.sesion.add(r)
    uow.sesion.flush()
    uow.registrar(DominioCambio(INVALIDA, "crear", (r.id,)))
    return r


def editar(
    uow: UnidadDeTrabajo,
    regla_id: int,
    nombre: str,
    prioridad: int,
    condiciones: list[dom.Condicion],
    acciones: dom.Acciones,
    activa: bool,
) -> Regla:
    r = uow.sesion.get(Regla, regla_id)
    if r is None:
        raise NoEncontrado(f"La regla {regla_id} no existe")
    _guardar(uow.sesion, r, nombre, prioridad, condiciones, acciones)
    r.activa = activa
    uow.registrar(DominioCambio(INVALIDA, "editar", (r.id,)))
    return r


def eliminar(uow: UnidadDeTrabajo, regla_id: int) -> None:
    r = uow.sesion.get(Regla, regla_id)
    if r is None:
        raise NoEncontrado(f"La regla {regla_id} no existe")
    uow.sesion.delete(r)
    uow.registrar(DominioCambio(INVALIDA, "borrar", (regla_id,)))


def aplicar(sesion: Session, tx: Transaccion) -> None:
    """Al crear: si el movimiento no trae categoría, la primera regla que cumple la pone; las
    etiquetas de las reglas se agregan siempre."""
    resultado = dom.aplicar(activas(sesion), dom.Movimiento(tx.descripcion, tx.monto, tx.cuenta_id))
    if tx.categoria_id is None and resultado.categoria_id is not None:
        tx.categoria_id = resultado.categoria_id
        tx.origen_categoria = "regla"
    for nombre in resultado.etiquetas:
        etiqueta = etiqueta_por_nombre(sesion, nombre)
        if etiqueta not in tx.etiquetas:
            tx.etiquetas.append(etiqueta)


def probar(sesion: Session, condiciones: list[dom.Condicion], limite: int = 8) -> dict[str, object]:
    """Cuántos movimientos confirmados del historial cumplirían la regla, con una muestra."""
    regla = dom.Regla(0, "", 0, tuple(condiciones), dom.Acciones(etiquetas=("prueba",)))
    filas = sesion.execute(
        select(Transaccion.id, Transaccion.fecha, Transaccion.descripcion, Transaccion.monto, Transaccion.cuenta_id)
        .where(Transaccion.estado == "confirmada")
        .order_by(Transaccion.fecha.desc())
    ).all()
    coinciden = [
        f for f in filas if dom.aplicar([regla], dom.Movimiento(f.descripcion, f.monto, f.cuenta_id)).etiquetas
    ]
    return {
        "total": len(coinciden),
        "muestra": [
            {"id": f.id, "fecha": f.fecha, "descripcion": f.descripcion, "monto": f.monto} for f in coinciden[:limite]
        ],
    }
