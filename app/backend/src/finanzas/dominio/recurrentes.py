"""Recurrentes y suscripciones (RF-RE): fechas de cada ocurrencia, costo mensual/anual y detección
automática en el historial (mismo texto, monto ±10 %, cada ~7/15/30/365 días)."""

from __future__ import annotations

import calendar
from collections import defaultdict
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date, timedelta
from statistics import median
from typing import Literal

from finanzas.dominio.clasificador import normalizar

Frecuencia = Literal["semanal", "quincenal", "mensual", "anual"]
VECES_AL_MES: dict[str, float] = {"semanal": 52 / 12, "quincenal": 2, "mensual": 1, "anual": 1 / 12}
_INTERVALOS: tuple[tuple[Frecuencia, int, int], ...] = (
    ("semanal", 6, 8),
    ("quincenal", 13, 17),
    ("mensual", 26, 35),
    ("anual", 350, 380),
)


def _dia_del_mes(anio: int, mes: int, dia: int) -> date:
    return date(anio, mes, min(dia, calendar.monthrange(anio, mes)[1]))


def ocurrencias(
    inicio: date, frecuencia: Frecuencia, dia: int, desde: date, hasta: date, fin: date | None = None
) -> list[date]:
    """Fechas entre `desde` y `hasta` (incluidas). Mensual y anual usan `dia` (el 31 cae en el último día
    del mes); semanal y quincenal avanzan 7 o 15 días desde `inicio`."""
    tope = min(hasta, fin) if fin else hasta
    salida: list[date] = []
    if frecuencia in ("semanal", "quincenal"):
        paso = timedelta(days=7 if frecuencia == "semanal" else 15)
        actual = inicio
        if actual < desde:
            actual += paso * ((desde - actual).days // paso.days)
        while actual <= tope:
            if actual >= desde:
                salida.append(actual)
            actual += paso
        return salida
    anio, mes = inicio.year, inicio.month
    while True:
        actual = _dia_del_mes(anio, mes, dia)
        if actual > tope:
            return salida
        if actual >= max(desde, inicio):
            salida.append(actual)
        if frecuencia == "anual":
            anio += 1
        else:
            anio, mes = (anio + 1, 1) if mes == 12 else (anio, mes + 1)


def costo_mensual(monto: int, frecuencia: Frecuencia) -> int:
    """Equivalente mensual en centavos (positivo para gastos)."""
    return round(abs(monto) * VECES_AL_MES[frecuencia])


@dataclass(frozen=True)
class Pago:
    fecha: date
    descripcion: str
    monto: int
    cuenta_id: int
    categoria_id: int | None


@dataclass(frozen=True)
class Detectado:
    descripcion: str
    frecuencia: Frecuencia
    monto: int  # mediana, con signo
    dia: int
    cuenta_id: int
    categoria_id: int | None
    veces: int
    ultima: date
    proxima: date


def detectar(pagos: Sequence[Pago], hoy: date, minimo: int = 3) -> list[Detectado]:
    """Series del historial que se repiten con intervalo y monto estables y siguen vivas."""
    series: dict[tuple[str, bool], list[Pago]] = defaultdict(list)
    for p in pagos:
        clave = normalizar(p.descripcion)
        if clave:
            series[(clave, p.monto < 0)].append(p)
    salida = []
    for lista in series.values():
        lista = sorted(lista, key=lambda p: p.fecha)
        # un pago por día: los dobles registros del mismo día no son dos ocurrencias
        lista = [p for i, p in enumerate(lista) if i == 0 or p.fecha != lista[i - 1].fecha]
        if len(lista) < minimo:
            continue
        recientes = lista[-6:]
        intervalos = [(b.fecha - a.fecha).days for a, b in zip(recientes, recientes[1:], strict=False)]
        tipico = median(intervalos)
        frecuencia = next((f for f, lo, hi in _INTERVALOS if lo <= tipico <= hi), None)
        if frecuencia is None:
            continue
        lo, hi = next((lo, hi) for f, lo, hi in _INTERVALOS if f == frecuencia)
        if sum(lo <= i <= hi for i in intervalos) < len(intervalos) * 0.6:
            continue
        montos = [abs(p.monto) for p in recientes]
        base = median(montos)
        if any(abs(m - base) > base * 0.1 for m in montos[-3:]):
            continue
        ultima = recientes[-1]
        paso = {"semanal": 7, "quincenal": 15, "mensual": 30, "anual": 365}[frecuencia]
        if (hoy - ultima.fecha).days > paso * 1.6:  # ya no se paga
            continue
        signo = -1 if ultima.monto < 0 else 1
        proxima = (
            _dia_del_mes(*_mes_siguiente(ultima.fecha), ultima.fecha.day)
            if frecuencia == "mensual"
            else ultima.fecha + timedelta(days=paso)
        )
        salida.append(
            Detectado(
                descripcion=ultima.descripcion.strip(),
                frecuencia=frecuencia,
                monto=signo * round(base),
                dia=ultima.fecha.day,
                cuenta_id=ultima.cuenta_id,
                categoria_id=ultima.categoria_id,
                veces=len(lista),
                ultima=ultima.fecha,
                proxima=proxima,
            )
        )
    return sorted(salida, key=lambda d: -costo_mensual(d.monto, d.frecuencia))


def _mes_siguiente(f: date) -> tuple[int, int]:
    return (f.year + 1, 1) if f.month == 12 else (f.year, f.month + 1)
