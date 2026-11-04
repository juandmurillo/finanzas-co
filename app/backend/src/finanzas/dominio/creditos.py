"""Créditos: amortización desde el último extracto, costo real y simulador de abonos.

Funciones puras con montos en centavos (int).
"""

from __future__ import annotations

from dataclasses import dataclass, field


def tasa_mensual(tasa_ea: float) -> float:
    """i = (1 + EA)^(1/12) − 1."""
    return float((1 + tasa_ea) ** (1 / 12) - 1)


def tasa_por_periodo(monto: int, cuota: int, periodos: int) -> float:
    """TIR mensual (RATE) que iguala el valor presente de las cuotas al monto. Bisección."""
    if monto <= 0 or cuota <= 0 or periodos <= 0 or cuota * periodos <= monto:
        return 0.0
    bajo, alto = 0.0, 1.0
    for _ in range(200):
        medio = (bajo + alto) / 2
        valor = cuota * (1 - (1 + medio) ** -periodos) / medio
        bajo, alto = (medio, alto) if valor > monto else (bajo, medio)
    return (bajo + alto) / 2


def costo_real_ea(monto_recibido: int, cuota: int, plazo: int) -> float:
    """Costo efectivo anual sobre lo que llegó a la cuenta (incluye descuentos y seguro)."""
    return float((1 + tasa_por_periodo(monto_recibido, cuota, plazo)) ** 12 - 1)


@dataclass(frozen=True)
class CuotaProyectada:
    numero: int
    interes: int
    seguro: int
    capital: int
    saldo: int


def amortizar(saldo: int, tasa_ea: float, cuota: int, seguro: int, max_cuotas: int = 600) -> list[CuotaProyectada]:
    """Proyección cuota a cuota: interés = saldo × i; capital = cuota − seguro − interés."""
    i = tasa_mensual(tasa_ea)
    filas: list[CuotaProyectada] = []
    while saldo > 0 and len(filas) < max_cuotas:
        interes = round(saldo * i)
        capital = min(saldo, cuota - seguro - interes)
        if capital <= 0:
            break  # la cuota no alcanza ni para el interés: la deuda no baja
        saldo -= capital
        filas.append(CuotaProyectada(len(filas) + 1, interes, seguro, capital, saldo))
    return filas


@dataclass
class DeudaSimulada:
    id: int
    nombre: str
    saldo: int
    tasa_ea: float
    cuota: int
    seguro: int
    mes_fin: int = 0
    costo: int = 0  # intereses + seguros pagados en la simulación


@dataclass
class ResultadoSimulacion:
    meses: int
    costo_total: int
    deudas: list[DeudaSimulada] = field(default_factory=list)
    saldos_mensuales: list[int] = field(default_factory=list)


def simular(deudas: list[DeudaSimulada], abono_extra: int = 0, estrategia: str = "avalancha") -> ResultadoSimulacion:
    """Mes a mes: cada deuda paga su cuota; el extra y las cuotas liberadas van a la prioritaria.

    avalancha = mayor tasa primero · bola_de_nieve = menor saldo primero.
    """
    estado = [DeudaSimulada(d.id, d.nombre, d.saldo, d.tasa_ea, d.cuota, d.seguro) for d in deudas]
    resultado = ResultadoSimulacion(0, 0, estado, [sum(d.saldo for d in estado)])
    mes = 0
    while any(d.saldo > 0 for d in estado) and mes < 600:
        mes += 1
        sobrante = abono_extra
        for d in estado:
            if d.saldo <= 0:
                sobrante += d.cuota  # la cuota de una deuda pagada se suma al abono
                continue
            interes = round(d.saldo * tasa_mensual(d.tasa_ea))
            d.costo += interes + d.seguro
            d.saldo -= min(d.saldo, max(0, d.cuota - d.seguro - interes))
            if d.saldo <= 0:
                d.mes_fin = mes
        orden = sorted(
            (d for d in estado if d.saldo > 0),
            key=(lambda d: -d.tasa_ea) if estrategia == "avalancha" else (lambda d: d.saldo),
        )
        for d in orden:
            if sobrante <= 0:
                break
            abono = min(d.saldo, sobrante)
            d.saldo -= abono
            sobrante -= abono
            if d.saldo <= 0:
                d.mes_fin = mes
        resultado.saldos_mensuales.append(sum(max(0, d.saldo) for d in estado))
    resultado.meses = mes
    resultado.costo_total = sum(d.costo for d in estado)
    return resultado


# ---------- Fase 6: abono único y compra de cartera ----------
def cuota_fija(saldo: int, tasa_ea: float, meses: int, seguro: int = 0) -> int:
    """Cuota francesa (capital + interés) más el seguro mensual."""
    if meses <= 0:
        return saldo + seguro
    i = tasa_mensual(tasa_ea)
    base = saldo / meses if i == 0 else saldo * i / (1 - (1 + i) ** -meses)
    return round(base) + seguro


def _costo(filas: list[CuotaProyectada]) -> int:
    return sum(f.interes + f.seguro for f in filas)


@dataclass(frozen=True)
class OpcionAbono:
    modo: str  # "plazo" | "cuota"
    cuota: int
    meses: int
    intereses_y_seguros: int
    ahorro: int  # frente a no abonar


@dataclass(frozen=True)
class ResultadoAbono:
    sin_abono: OpcionAbono
    reducir_plazo: OpcionAbono
    reducir_cuota: OpcionAbono


def abono_unico(saldo: int, tasa_ea: float, cuota: int, seguro: int, abono: int) -> ResultadoAbono:
    """Un abono a capital hoy: o se mantiene la cuota y se acaba antes (plazo), o se mantiene la fecha
    de fin y baja la cuota. Reducir plazo siempre ahorra más intereses."""
    actual = amortizar(saldo, tasa_ea, cuota, seguro)
    base = OpcionAbono("ninguno", cuota, len(actual), _costo(actual), 0)
    restante = max(0, saldo - abono)
    plazo = amortizar(restante, tasa_ea, cuota, seguro)
    nueva_cuota = cuota_fija(restante, tasa_ea, len(actual), seguro) if restante else 0
    con_cuota = amortizar(restante, tasa_ea, nueva_cuota, seguro) if restante else []
    return ResultadoAbono(
        base,
        OpcionAbono("plazo", cuota, len(plazo), _costo(plazo), base.intereses_y_seguros - _costo(plazo)),
        OpcionAbono(
            "cuota", nueva_cuota, len(con_cuota), _costo(con_cuota), base.intereses_y_seguros - _costo(con_cuota)
        ),
    )


@dataclass(frozen=True)
class CompraCartera:
    monto_nuevo: int  # saldos que se recogen + costos financiados
    cuota_actual: int  # suma de las cuotas de los créditos que se recogen
    cuota_nueva: int
    meses_actual: int
    meses_nuevo: int
    pagos_restantes_actual: int  # lo que falta pagar si no se hace nada
    pagos_total_nuevo: int  # cuotas del crédito nuevo + costos pagados de contado
    diferencia: int  # positivo = la compra de cartera ahorra dinero
    costo_real_ea_nuevo: float
    conviene: bool


def compra_cartera(
    deudas: list[DeudaSimulada],
    tasa_ea: float,
    plazo_meses: int,
    costos_iniciales: int = 0,
    seguro_mensual: int = 0,
    financiar_costos: bool = True,
) -> CompraCartera:
    """Recoge las deudas en un crédito nuevo. Compara el total que falta pagar (no solo la cuota:
    alargar el plazo baja la cuota y puede salir más caro)."""
    saldo = sum(d.saldo for d in deudas)
    actual = simular(deudas)
    pagos_actual = saldo + actual.costo_total
    monto = saldo + (costos_iniciales if financiar_costos else 0)
    cuota = cuota_fija(monto, tasa_ea, plazo_meses, seguro_mensual)
    filas = amortizar(monto, tasa_ea, cuota, seguro_mensual)
    pagos_nuevo = sum(f.interes + f.seguro + f.capital for f in filas) + (0 if financiar_costos else costos_iniciales)
    # costo real: sobre lo que de verdad se recibe (los saldos), con todo lo que se paga
    real = costo_real_ea(saldo - (0 if financiar_costos else costos_iniciales), cuota, len(filas))
    return CompraCartera(
        monto_nuevo=monto,
        cuota_actual=sum(d.cuota for d in deudas),
        cuota_nueva=cuota,
        meses_actual=actual.meses,
        meses_nuevo=len(filas),
        pagos_restantes_actual=pagos_actual,
        pagos_total_nuevo=pagos_nuevo,
        diferencia=pagos_actual - pagos_nuevo,
        costo_real_ea_nuevo=real,
        conviene=pagos_nuevo < pagos_actual,
    )


# ---------- Fase 7: pagos reales desglosados ----------
@dataclass(frozen=True)
class PagoCredito:
    ref: int  # id de la transacción
    fecha: str  # AAAA-MM-DD
    monto: int  # positivo
    es_abono: bool = False  # abono extra: va todo a capital


@dataclass(frozen=True)
class ExtractoCredito:
    fecha_corte: str
    saldo: int
    intereses: int
    abono_capital: int
    seguros: int


@dataclass(frozen=True)
class Desglose:
    ref: int
    tipo: str  # "cuota" | "abono"
    capital: int
    interes: int
    seguro: int
    saldo_despues: int


def _dias(a: str, b: str) -> int:
    from datetime import date

    return abs((date.fromisoformat(a[:10]) - date.fromisoformat(b[:10])).days)


def desglosar_pagos(
    capital_inicial: int,
    tasa_ea: float,
    seguro_mensual: int,
    pagos: list[PagoCredito],
    extractos: list[ExtractoCredito],
    ventana_dias: int = 12,
) -> tuple[list[Desglose], int]:
    """Recorre los pagos en orden desde el capital inicial: cada cuota paga interés del mes (saldo × i),
    seguro y el resto a capital; un abono extra va todo a capital. Cuando una cuota cae cerca de la fecha
    de corte de un extracto, manda el extracto: su interés y seguro, y el saldo queda en el del banco."""
    i = tasa_mensual(tasa_ea)
    saldo = capital_inicial
    por_usar = sorted(extractos, key=lambda e: e.fecha_corte)
    salida: list[Desglose] = []
    for p in sorted(pagos, key=lambda p: (p.fecha, p.ref)):
        if p.es_abono:
            capital = min(saldo, p.monto)
            saldo -= capital
            salida.append(Desglose(p.ref, "abono", capital, 0, 0, saldo))
            continue
        extracto = next((e for e in por_usar if _dias(e.fecha_corte, p.fecha) <= ventana_dias), None)
        if extracto is not None:
            por_usar.remove(extracto)
            interes, seguro = extracto.intereses, extracto.seguros
            capital = max(0, p.monto - interes - seguro)
            saldo = extracto.saldo
        else:
            interes = min(p.monto, round(saldo * i))
            seguro = min(seguro_mensual, p.monto - interes)
            capital = min(saldo, p.monto - interes - seguro)
            saldo -= capital
        salida.append(Desglose(p.ref, "cuota", capital, interes, seguro, saldo))
    # un extracto sin pago cercano (p. ej. llegó antes de registrar el pago) igual fija el saldo
    for e in por_usar:
        if not salida or e.fecha_corte >= max(p.fecha for p in pagos):
            saldo = e.saldo
    return salida, saldo


def proximo_pago(saldo: int, tasa_ea: float, cuota: int, seguro: int) -> dict[str, int]:
    """Cómo se reparte la próxima cuota con el saldo de hoy."""
    interes = round(saldo * tasa_mensual(tasa_ea))
    capital = max(0, min(saldo, cuota - seguro - interes))
    return {"total": min(cuota, capital + interes + seguro), "capital": capital, "interes": interes, "seguro": seguro}
