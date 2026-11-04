"""Lectura de préstamos personales con sus saldos, próxima cuota y vencimiento (derivados)."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session, joinedload

from finanzas.dominio.fechas import hoy_bogota
from finanzas.dominio.prestamos import tasa_ea_equivalente
from finanzas.infra.modelos import PrestamoPersonal, Transaccion
from finanzas.infra.prestamos_repo import cuenta_puente, meses_prestamo, saldos


def _a_dict(sesion: Session, p: PrestamoPersonal, hoy: date) -> dict[str, Any]:
    s = saldos(sesion, p)
    abonado = (p.monto - s.capital_pendiente) + s.interes_pagado
    acumulado = 0
    proxima: dict[str, Any] | None = None
    dias_vencido = 0
    por_pagar: list[dict[str, Any]] = []  # cuotas no cubiertas, con lo que falta de cada una
    for c in p.cuotas:
        acumulado += c.capital + c.interes
        if acumulado > abonado:
            por_pagar.append(
                {"numero": c.numero, "fecha": c.fecha, "monto": min(c.capital + c.interes, acumulado - abonado)}
            )
            if proxima is None:
                proxima = {
                    "numero": c.numero,
                    "fecha": c.fecha,
                    "monto": min(c.capital + c.interes, acumulado - abonado),
                }
            if date.fromisoformat(c.fecha) < hoy:
                dias_vencido = max(dias_vencido, (hoy - date.fromisoformat(c.fecha)).days)
    total = p.monto + p.interes_total
    return {
        "id": p.id,
        "persona": p.contraparte.nombre,
        "direccion": p.direccion,
        "origen": p.origen,
        "monto": p.monto,
        "fecha": p.fecha,
        "tipo_interes": p.tipo_interes,
        "tasa_mensual": p.tasa_mensual,
        "interes_total": p.interes_total,
        "plan": p.plan,
        "frecuencia": p.frecuencia,
        "estado": p.estado,
        "nota": p.nota,
        "capital_pendiente": s.capital_pendiente,
        "interes_pendiente": s.interes_pendiente,
        "pendiente": s.pendiente if p.estado == "activo" else 0,
        "abonado": abonado,
        "pagado_pct": round(100 * abonado / total) if total else 0,
        "tasa_ea": tasa_ea_equivalente(p.monto, p.interes_total, meses_prestamo(p)),
        "proxima_cuota": proxima if p.estado == "activo" else None,
        "cuotas_por_pagar": por_pagar if p.estado == "activo" else [],
        "dias_vencido": dias_vencido if p.estado == "activo" else 0,
        "cuotas": [
            {"numero": c.numero, "fecha": c.fecha, "capital": c.capital, "interes": c.interes} for c in p.cuotas
        ],
    }


def listar(sesion: Session, estado: str | None = None) -> list[dict[str, Any]]:
    consulta = select(PrestamoPersonal).options(
        joinedload(PrestamoPersonal.contraparte), joinedload(PrestamoPersonal.cuotas)
    )
    if estado:
        consulta = consulta.where(PrestamoPersonal.estado == estado)
    prestamos = list(sesion.scalars(consulta.order_by(PrestamoPersonal.fecha.desc())).unique())
    hoy = hoy_bogota()
    return [_a_dict(sesion, p, hoy) for p in prestamos]


def detalle(sesion: Session, prestamo_id: int) -> dict[str, Any] | None:
    p = sesion.get(PrestamoPersonal, prestamo_id)
    if p is None:
        return None
    datos = _a_dict(sesion, p, hoy_bogota())
    puente = cuenta_puente(sesion, p.direccion)
    movimientos = sesion.scalars(
        select(Transaccion)
        .options(joinedload(Transaccion.cuenta))
        .where(Transaccion.prestamo_id == p.id, Transaccion.cuenta_id != puente.id)
        .order_by(Transaccion.fecha)
    )
    datos["movimientos"] = [
        {"id": t.id, "fecha": t.fecha, "monto": t.monto, "descripcion": t.descripcion, "cuenta": t.cuenta.nombre}
        for t in movimientos
    ]
    return datos


def resumen(sesion: Session) -> dict[str, Any]:
    activos = listar(sesion, "activo")
    hoy = hoy_bogota().toordinal()
    proximos = [
        p
        for p in activos
        if p["proxima_cuota"] and date.fromisoformat(p["proxima_cuota"]["fecha"]).toordinal() - hoy <= 7
    ]
    return {
        "me_deben": sum(p["pendiente"] for p in activos if p["direccion"] == "presto_yo"),
        "debo": sum(p["pendiente"] for p in activos if p["direccion"] == "me_prestaron"),
        "vencidos": sum(1 for p in activos if p["dias_vencido"] > 0),
        "proximos_7_dias": sum(p["proxima_cuota"]["monto"] for p in proximos),
        "activos": len(activos),
    }
