"""Migración de datos (fase 7, D1): los pagos de crédito que Cashew partía en «Intereses» y «Abono a capital»
pasan a ser un solo movimiento por cuota, ligado a su crédito y con el desglose real calculado.

Solo toca los créditos registrados en la sección Deudas; los cerrados quedan en el historial como están.
El dinero no cambia: por mes y por grupo los totales son idénticos antes y después (se verifica)."""

from __future__ import annotations

from collections import defaultdict
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from finanzas.infra.modelos import Categoria, Credito, HuellaFusionada, Transaccion
from finanzas.servicios import creditos
from finanzas.servicios.transacciones import ahora


def _totales(sesion: Session) -> dict[str, int]:
    """Dinero confirmado por mes y grupo (lo programado cambia a propósito: se programan las cuotas)."""
    filas = sesion.execute(text("SELECT mes, grupo, SUM(total) FROM v_movimiento_mensual GROUP BY mes, grupo")).all()
    return {f"{m} {g}": int(t) for m, g, t in filas}


def _categoria_del_credito(sesion: Session, c: Credito) -> Categoria | None:
    if c.categoria_id:
        return sesion.get(Categoria, c.categoria_id)
    candidatas = sesion.scalars(
        select(Categoria).where(Categoria.grupo == "servicio_deuda", Categoria.nivel == 2)
    ).all()
    return next((k for k in candidatas if k.nombre == c.nombre or k.nombre.endswith(f" {c.nombre}")), None)


def unificar(sesion: Session) -> dict[str, Any]:
    """Aplica la unificación en la sesión (sin commit) y devuelve el resumen; quien llama decide si confirma."""
    antes = _totales(sesion)
    resumen: dict[str, Any] = {"creditos": []}
    for c in sesion.scalars(select(Credito).order_by(Credito.id)):
        cat = _categoria_del_credito(sesion, c)
        if cat is None:
            resumen["creditos"].append({"credito": c.nombre, "error": "sin categoría"})
            continue
        c.categoria_id = cat.id
        hijos = {cat.id} | set(sesion.scalars(select(Categoria.id).where(Categoria.padre_id == cat.id)))
        grupos: dict[tuple[str, str], list[Transaccion]] = defaultdict(list)
        for tx in sesion.scalars(
            select(Transaccion).where(Transaccion.categoria_id.in_(hijos)).order_by(Transaccion.fecha, Transaccion.id)
        ):
            grupos[(tx.estado, tx.fecha[:7])].append(tx)
        unidas = borradas = 0
        for (_, _), txs in sorted(grupos.items()):
            principal, resto = txs[0], txs[1:]
            principal.monto = sum(t.monto for t in txs)
            principal.categoria_id = cat.id
            principal.credito_id = c.id
            principal.descripcion = f"Cuota {c.nombre}"
            principal.actualizado_en = ahora()
            for t in resto:
                if t.huella:
                    sesion.add(HuellaFusionada(huella=t.huella, transaccion_id=principal.id))
                sesion.delete(t)
                borradas += 1
            unidas += 1
        sesion.flush()
        creditos._programar_cuota(sesion, c)
        saldo = creditos.recalcular(sesion, c.id)
        resumen["creditos"].append(
            {"credito": c.nombre, "pagos": unidas, "movimientos_unidos": borradas, "saldo": saldo}
        )
    sesion.flush()
    despues = _totales(sesion)
    resumen["totales_iguales"] = antes == despues
    if not resumen["totales_iguales"]:
        resumen["diferencias"] = {
            k: (antes.get(k), despues.get(k)) for k in antes.keys() | despues.keys() if antes.get(k) != despues.get(k)
        }
    return resumen
