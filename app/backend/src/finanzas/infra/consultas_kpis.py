"""KPIs estratégicos de la revisión mensual (fase 7, punto 9): semáforo con meta y tendencia de 6 meses."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finanzas.dominio.grupos import Grupo
from finanzas.infra import consultas, consultas_automatizacion, consultas_presupuesto, consultas_reportes
from finanzas.infra.modelos import CreditoPago, Transaccion

HORMIGA = 2_000_000  # centavos: gastos de menos de $20.000
META_AHORRO = 0.10
META_CARGA_DEUDA = 0.30
META_COLCHON = 3.0


def _estado(valor: float | None, meta: float, mayor_es_mejor: bool = True, margen: float = 0.8) -> str:
    """bien / atencion / alerta respecto a la meta; `margen` define la zona de atención."""
    if valor is None:
        return "sin_datos"
    if mayor_es_mejor:
        return "bien" if valor >= meta else "atencion" if valor >= meta * margen else "alerta"
    return "bien" if valor <= meta else "atencion" if valor <= meta / margen else "alerta"


def _div(a: int, b: int) -> float | None:
    return round(a / b, 4) if b else None


def _costo_financiero(sesion: Session, desde: str, hasta: str) -> dict[str, int]:
    """Intereses + seguros de créditos pagados por mes."""
    mes = func.substr(Transaccion.fecha, 1, 7)
    filas = sesion.execute(
        select(mes, func.sum(CreditoPago.interes + CreditoPago.seguro))
        .join(Transaccion, Transaccion.id == CreditoPago.transaccion_id)
        .where(Transaccion.estado == "confirmada", mes >= desde, mes <= hasta)
        .group_by(mes)
    ).all()
    return {m: int(v or 0) for m, v in filas}


def estrategicos(sesion: Session, mes: str, hoy: date | None = None) -> dict[str, Any]:
    meses = [consultas_reportes._mes_anterior(mes, i) for i in range(5, -1, -1)]
    serie = {f["mes"]: f for f in consultas_reportes.mensual(sesion, meses[0], mes)["meses"]}
    vacio = {"ingresos": 0, "gasto_vida": 0, "servicio_deuda": 0, "flujo_operativo": 0}
    fila = {m: serie.get(m, vacio) for m in meses}
    costo = _costo_financiero(sesion, meses[0], mes)

    movs = consultas_reportes._movimientos(sesion, meses[0], mes)
    hormiga: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    por_dia: dict[str, int] = defaultdict(int)
    for m in movs:
        if m.grupo is not Grupo.GASTO_VIDA or m.monto >= 0:
            continue
        if -m.monto < HORMIGA:
            hormiga[m.mes][0] += -m.monto
            hormiga[m.mes][1] += 1
        if m.mes == mes:
            por_dia[m.fecha[:10]] += -m.monto

    actual = fila[mes]
    ahorro = [_div(fila[m]["flujo_operativo"], fila[m]["ingresos"]) for m in meses]
    carga = [_div(fila[m]["servicio_deuda"], fila[m]["ingresos"]) for m in meses]

    # Colchón: lo líquido de hoy sobre el gasto medio (vida + cuotas) de los 3 meses previos.
    previos = meses[-4:-1]
    gasto_medio = round(sum(fila[m]["gasto_vida"] + fila[m]["servicio_deuda"] for m in previos) / 3)
    liquido = sum(c["saldo"] for c in consultas.en_total(consultas.saldos_cuentas(sesion)))
    colchon = round(liquido / gasto_medio, 2) if gasto_medio else None

    # Cobertura: ingreso del mes sobre los pagos fijos programados (recurrentes activos, incluidas las cuotas).
    rec = consultas_automatizacion.recurrentes(sesion)
    fijos = sum(f["costo_mensual"] for f in rec["items"] if f["activo"] and f["monto"] < 0)
    cobertura = _div(actual["ingresos"], fijos)

    pres = consultas_presupuesto.presupuesto_mes(sesion, mes)
    con_monto = [f for f in pres["filas"] if f["tiene_asignacion"]]
    cumplidos = sum(1 for f in con_monto if f["gastado"] <= f["asignado"])
    apuestas = consultas_reportes.apuestas(sesion, hoy=hoy)
    dia_mayor = max(por_dia.items(), key=lambda kv: kv[1], default=None)

    principales = [
        {
            "clave": "tasa_ahorro",
            "nombre": "Tasa de ahorro",
            "valor": ahorro[-1],
            "formato": "pct",
            "meta": META_AHORRO,
            "texto_meta": "meta ≥ 10 % de lo que entra",
            "estado": _estado(ahorro[-1], META_AHORRO, margen=0),  # en negativo: alerta
            "tendencia": ahorro,
        },
        {
            "clave": "carga_deuda",
            "nombre": "Carga de deuda",
            "valor": carga[-1],
            "formato": "pct",
            "meta": META_CARGA_DEUDA,
            "texto_meta": "cuotas ≤ 30 % del ingreso",
            "estado": _estado(carga[-1], META_CARGA_DEUDA, mayor_es_mejor=False, margen=0.75),
            "tendencia": carga,
        },
        {
            "clave": "cobertura_fijos",
            "nombre": "Cobertura de fijos",
            "valor": cobertura,
            "formato": "veces",
            "meta": 1.5,
            "texto_meta": f"ingreso ÷ {consultas_reportes._pesos(fijos)} de fijos al mes · meta ≥ 1,5×",
            "estado": _estado(cobertura, 1.5, margen=2 / 3),
            "tendencia": [_div(fila[m]["ingresos"], fijos) for m in meses],
        },
        {
            "clave": "meses_colchon",
            "nombre": "Meses de colchón",
            "valor": colchon,
            "formato": "meses",
            "meta": META_COLCHON,
            "texto_meta": "lo líquido ÷ gasto medio · meta ≥ 3 meses",
            "estado": _estado(colchon, META_COLCHON, margen=1 / 3),
            "tendencia": None,
        },
    ]
    secundarios = [
        {
            "clave": "costo_financiero",
            "nombre": "Costo financiero",
            "valor": costo.get(mes, 0),
            "formato": "cop",
            "detalle": "intereses y seguros de créditos pagados este mes",
            "tendencia": [costo.get(m, 0) for m in meses],
        },
        {
            "clave": "gasto_hormiga",
            "nombre": "Gasto hormiga",
            "valor": hormiga[mes][0],
            "formato": "cop",
            "detalle": f"{hormiga[mes][1]} compras de menos de $20.000",
            "tendencia": [hormiga[m][0] for m in meses],
        },
        {
            "clave": "presupuesto_cumplido",
            "nombre": "Presupuesto cumplido",
            "valor": _div(cumplidos, len(con_monto)),
            "formato": "pct",
            "detalle": f"{cumplidos} de {len(con_monto)} presupuestos dentro del monto"
            if con_monto
            else "sin presupuestos asignados este mes",
            "tendencia": None,
        },
        {
            "clave": "dia_mayor_gasto",
            "nombre": "Día de más gasto",
            "valor": dia_mayor[1] if dia_mayor else 0,
            "formato": "cop",
            "detalle": f"el {int(dia_mayor[0][8:])} de este mes" if dia_mayor else "sin gastos este mes",
            "tendencia": None,
        },
        {
            "clave": "racha_sin_apostar",
            "nombre": "Racha sin apostar",
            "valor": apuestas["racha_actual"],
            "formato": "dias",
            "detalle": f"tu mejor racha: {apuestas['racha_mayor']} días"
            if apuestas["racha_actual"] is not None
            else "no hay apuestas registradas",
            "tendencia": None,
        },
    ]
    return {"meses": meses, "principales": principales, "secundarios": secundarios}
