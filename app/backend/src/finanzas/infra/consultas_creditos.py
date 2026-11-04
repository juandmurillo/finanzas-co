"""Lectura de créditos: costo real, amortización desde el último extracto y simulación de abonos."""

from __future__ import annotations

from dataclasses import asdict
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finanzas.dominio.creditos import (
    DeudaSimulada,
    abono_unico,
    amortizar,
    compra_cartera,
    costo_real_ea,
    proximo_pago,
    simular,
)
from finanzas.dominio.fechas import hoy_bogota
from finanzas.dominio.prestamos import fecha_cuota
from finanzas.infra.modelos import Categoria, Credito, CreditoExtracto, CreditoPago, Parametro, Transaccion


def _ultimo_extracto(sesion: Session, credito_id: int) -> CreditoExtracto | None:
    return sesion.scalar(
        select(CreditoExtracto)
        .where(CreditoExtracto.credito_id == credito_id)
        .order_by(CreditoExtracto.fecha_corte.desc())
        .limit(1)
    )


def parametro(sesion: Session, clave: str, en: str | None = None) -> float | None:
    """Valor vigente de un parámetro (UVT, usura…) a una fecha."""
    fila = sesion.scalar(
        select(Parametro)
        .where(Parametro.clave == clave, Parametro.vigencia_desde <= (en or hoy_bogota().isoformat()))
        .order_by(Parametro.vigencia_desde.desc())
        .limit(1)
    )
    return fila.valor if fila else None


def _saldo_actual(sesion: Session, c: Credito) -> tuple[int, str]:
    """Saldo y fecha: el último pago registrado (ya desglosado) o el último extracto, lo más reciente.
    Así un abono a capital se refleja sin esperar el siguiente extracto."""
    ultimo = _ultimo_extracto(sesion, c.id)
    pago = sesion.execute(
        select(CreditoPago.saldo_despues, Transaccion.fecha)
        .join(Transaccion, Transaccion.id == CreditoPago.transaccion_id)
        .where(CreditoPago.credito_id == c.id)
        .order_by(Transaccion.fecha.desc(), Transaccion.id.desc())
        .limit(1)
    ).first()
    if pago is not None and (ultimo is None or pago.fecha[:10] >= ultimo.fecha_corte[:10]):
        return pago.saldo_despues, pago.fecha[:10]
    if ultimo is not None:
        return ultimo.saldo, ultimo.fecha_corte[:10]
    return c.capital_inicial, c.fecha_desembolso[:10]


def _proximo(sesion: Session, c: Credito, saldo: int) -> dict[str, Any] | None:
    pendiente = sesion.execute(
        select(Transaccion.id, Transaccion.fecha, Transaccion.monto)
        .where(Transaccion.credito_id == c.id, Transaccion.estado == "pendiente")
        .order_by(Transaccion.fecha)
        .limit(1)
    ).first()
    if saldo <= 0:
        return None
    reparto = proximo_pago(saldo, c.tasa_ea, abs(pendiente.monto) if pendiente else c.cuota, c.seguro_mensual)
    return {
        "transaccion_id": pendiente.id if pendiente else None,
        "fecha": pendiente.fecha[:10] if pendiente else None,
        **reparto,
    }


def detalle_credito(sesion: Session, c: Credito) -> dict[str, Any]:
    ultimo = _ultimo_extracto(sesion, c.id)
    saldo, fecha_saldo = _saldo_actual(sesion, c)
    desde = date.fromisoformat(fecha_saldo)
    filas = amortizar(saldo, c.tasa_ea, c.cuota, c.seguro_mensual)
    fin = fecha_cuota(desde, "mensual", len(filas)) if filas else desde
    return {
        "id": c.id,
        "nombre": c.nombre,
        "entidad": c.entidad,
        "numero": c.numero,
        "tasa_ea": c.tasa_ea,
        "cuota": c.cuota,
        "seguro_mensual": c.seguro_mensual,
        "dia_pago": c.dia_pago,
        "plazo_meses": c.plazo_meses,
        "capital_inicial": c.capital_inicial,
        "monto_recibido": c.monto_recibido,
        "saldo": saldo,
        "fecha_saldo": desde.isoformat(),
        "cuotas_pagadas": sesion.scalar(
            select(func.count()).where(CreditoPago.credito_id == c.id, CreditoPago.tipo == "cuota")
        )
        or 0,
        "cuotas_pendientes": len(filas) if filas else (ultimo.cuotas_pendientes if ultimo else c.plazo_meses),
        "costo_real_ea": costo_real_ea(c.monto_recibido, c.cuota, c.plazo_meses),
        "avance": round(1 - saldo / c.capital_inicial, 4) if c.capital_inicial else 0.0,
        "proximo_pago": _proximo(sesion, c, saldo),
        "fecha_desembolso": c.fecha_desembolso[:10],
        "cuenta_pago_id": c.cuenta_pago_id,
        "cuenta_desembolso_id": (sesion.get(Transaccion, c.desembolso_id).cuenta_id if c.desembolso_id else None),  # type: ignore[union-attr]
        "categoria_id": c.categoria_id,
        "categoria_abono_id": sesion.scalar(
            select(Categoria.id).where(Categoria.padre_id == c.categoria_id, Categoria.nombre == "Abono a capital")
        )
        if c.categoria_id
        else None,
        "estado": c.estado,
        "intereses_por_pagar": sum(f.interes + f.seguro for f in filas),
        "fecha_fin": fin.isoformat(),
    }


def creditos_cerrados(sesion: Session) -> list[dict[str, Any]]:
    """Historial: créditos pagados (o marcados como pagados), con lo que costaron en total."""
    salida = []
    for c in sesion.scalars(
        select(Credito).where(Credito.estado != "activo").order_by(Credito.fecha_desembolso.desc())
    ):
        pagado = -sum(
            m
            for m in sesion.scalars(
                select(Transaccion.monto).where(Transaccion.credito_id == c.id, Transaccion.estado == "confirmada")
            )
        )
        ultimo = sesion.scalar(
            select(func.max(Transaccion.fecha)).where(
                Transaccion.credito_id == c.id, Transaccion.estado == "confirmada"
            )
        )
        salida.append(
            {
                "id": c.id,
                "nombre": c.nombre,
                "entidad": c.entidad,
                "estado": c.estado,
                "monto_recibido": c.monto_recibido,
                "capital_inicial": c.capital_inicial,
                "total_pagado": pagado,
                "costo": pagado - c.monto_recibido,
                "fecha_desembolso": c.fecha_desembolso[:10],
                "ultimo_pago": ultimo[:10] if ultimo else None,
            }
        )
    return salida


def creditos_activos(sesion: Session) -> list[dict[str, Any]]:
    activos = list(sesion.scalars(select(Credito).where(Credito.estado == "activo").order_by(Credito.tasa_ea.desc())))
    salida = []
    for prioridad, c in enumerate(activos, 1):
        datos = detalle_credito(sesion, c)
        datos["prioridad_avalancha"] = prioridad
        salida.append(datos)
    return salida


def amortizacion(sesion: Session, credito_id: int) -> dict[str, Any] | None:
    c = sesion.get(Credito, credito_id)
    if c is None:
        return None
    datos = detalle_credito(sesion, c)
    desde = date.fromisoformat(datos["fecha_saldo"])
    filas = amortizar(datos["saldo"], c.tasa_ea, c.cuota, c.seguro_mensual)
    datos["tabla"] = [
        {
            "numero": f.numero,
            "fecha": fecha_cuota(desde, "mensual", f.numero).isoformat(),
            "interes": f.interes,
            "seguro": f.seguro,
            "capital": f.capital,
            "saldo": f.saldo,
        }
        for f in filas
    ]
    datos["pagos"] = [
        {
            "transaccion_id": p.transaccion_id,
            "fecha": f[:10],
            "monto": -m,
            "tipo": p.tipo,
            "capital": p.capital,
            "interes": p.interes,
            "seguro": p.seguro,
            "saldo_despues": p.saldo_despues,
        }
        for p, f, m in sesion.execute(
            select(CreditoPago, Transaccion.fecha, Transaccion.monto)
            .join(Transaccion, Transaccion.id == CreditoPago.transaccion_id)
            .where(CreditoPago.credito_id == c.id)
            .order_by(Transaccion.fecha.desc())
        ).all()
    ]
    datos["extractos"] = [
        {
            "fecha_corte": e.fecha_corte,
            "saldo": e.saldo,
            "intereses": e.intereses,
            "abono_capital": e.abono_capital,
            "seguros": e.seguros,
            "cuotas_pendientes": e.cuotas_pendientes,
        }
        for e in sesion.scalars(
            select(CreditoExtracto)
            .where(CreditoExtracto.credito_id == c.id)
            .order_by(CreditoExtracto.fecha_corte.desc())
        )
    ]
    return datos


def simulacion(sesion: Session, abono_extra: int, estrategia: str) -> dict[str, Any]:
    """Compara pagar solo la cuota vs. sumar un abono mensual con la estrategia elegida."""
    deudas = [
        DeudaSimulada(d["id"], d["nombre"], d["saldo"], d["tasa_ea"], d["cuota"], d["seguro_mensual"])
        for d in creditos_activos(sesion)
    ]
    base = simular(deudas, 0, estrategia)
    con_abono = simular(deudas, abono_extra, estrategia)
    hoy = hoy_bogota().replace(day=1)
    return {
        "abono_extra": abono_extra,
        "estrategia": estrategia,
        "meses_base": base.meses,
        "meses_con_abono": con_abono.meses,
        "meses_ahorrados": base.meses - con_abono.meses,
        "costo_base": base.costo_total,
        "costo_con_abono": con_abono.costo_total,
        "ahorro": base.costo_total - con_abono.costo_total,
        "fecha_fin_base": fecha_cuota(hoy, "mensual", base.meses).isoformat()[:7],
        "fecha_fin_con_abono": fecha_cuota(hoy, "mensual", con_abono.meses).isoformat()[:7],
        "orden": [d.nombre for d in sorted(con_abono.deudas, key=lambda d: d.mes_fin)],
        "saldos_base": base.saldos_mensuales,
        "saldos_con_abono": con_abono.saldos_mensuales,
    }


def simular_abono_unico(sesion: Session, credito_id: int, abono: int) -> dict[str, Any] | None:
    c = sesion.get(Credito, credito_id)
    if c is None:
        return None
    d = detalle_credito(sesion, c)
    r = abono_unico(d["saldo"], c.tasa_ea, c.cuota, c.seguro_mensual, min(abono, d["saldo"]))
    return {"credito": c.nombre, "saldo": d["saldo"], "abono": min(abono, d["saldo"]), **asdict(r)}


def simular_compra_cartera(
    sesion: Session,
    tasa_ea: float,
    plazo_meses: int,
    costos_iniciales: int,
    seguro_mensual: int,
    financiar_costos: bool,
    credito_ids: list[int] | None,
) -> dict[str, Any]:
    activos = [d for d in creditos_activos(sesion) if not credito_ids or d["id"] in credito_ids]
    deudas = [
        DeudaSimulada(d["id"], d["nombre"], d["saldo"], d["tasa_ea"], d["cuota"], d["seguro_mensual"]) for d in activos
    ]
    r = compra_cartera(deudas, tasa_ea, plazo_meses, costos_iniciales, seguro_mensual, financiar_costos)
    usura = parametro(sesion, "usura_consumo")
    return {
        **asdict(r),
        "creditos": [d["nombre"] for d in activos],
        "tasa_ea": tasa_ea,
        "usura_consumo": usura,
        "supera_usura": usura is not None and tasa_ea > usura,
    }
