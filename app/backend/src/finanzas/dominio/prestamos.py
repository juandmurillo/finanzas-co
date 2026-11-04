"""Préstamos personales de bajo monto: interés opcional, plan de pagos e imputación de abonos.

Funciones puras con montos en centavos.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from finanzas.dominio.errores import ErrorValidacion

DIAS_POR_FRECUENCIA = {"diaria": 1, "semanal": 7, "quincenal": 15}


@dataclass(frozen=True)
class CuotaPlan:
    numero: int
    fecha: date
    capital: int
    interes: int

    @property
    def total(self) -> int:
        return self.capital + self.interes


def _sumar_meses(fecha: date, meses: int) -> date:
    anio, mes = divmod(fecha.month - 1 + meses, 12)
    anio += fecha.year
    mes += 1
    for dia in (fecha.day, 30, 29, 28):
        try:
            return date(anio, mes, dia)
        except ValueError:
            continue
    raise ValueError("fecha inválida")


def fecha_cuota(inicio: date, frecuencia: str, numero: int) -> date:
    if frecuencia == "mensual":
        return _sumar_meses(inicio, numero)
    return inicio + timedelta(days=DIAS_POR_FRECUENCIA[frecuencia] * numero)


def meses_del_plazo(frecuencia: str, num_cuotas: int) -> float:
    if frecuencia == "mensual":
        return float(num_cuotas)
    return DIAS_POR_FRECUENCIA[frecuencia] * num_cuotas / 30


def interes_total(
    capital: int, tipo: str, *, interes_fijo: int = 0, tasa_mensual: float = 0.0, meses: float = 1
) -> int:
    """ninguno · fijo (monto adicional) · simple_mensual (capital × tasa × meses)."""
    if tipo == "ninguno":
        return 0
    if tipo == "fijo":
        return max(0, interes_fijo)
    if tipo == "simple_mensual":
        return round(capital * tasa_mensual * meses)
    raise ErrorValidacion(f"Tipo de interés desconocido: {tipo}")


def tasa_ea_equivalente(capital: int, interes: int, meses: float) -> float:
    """(1 + interés/capital)^(12/meses) − 1. Sirve para comparar con la usura."""
    if capital <= 0 or interes <= 0 or meses <= 0:
        return 0.0
    return float((1 + interes / capital) ** (12 / meses) - 1)


def plan_de_pagos(
    capital: int,
    interes: int,
    inicio: date,
    plan: str,
    frecuencia: str = "mensual",
    num_cuotas: int = 1,
    fecha_limite: date | None = None,
) -> list[CuotaPlan]:
    """Reparte capital e interés por igual; el residuo del redondeo va a la última cuota."""
    if plan == "libre":
        return []
    if plan == "fecha_unica":
        return [CuotaPlan(1, fecha_limite or fecha_cuota(inicio, "mensual", 1), capital, interes)]
    if num_cuotas < 1:
        raise ErrorValidacion("El número de cuotas debe ser al menos 1")
    base_capital, base_interes = capital // num_cuotas, interes // num_cuotas
    cuotas = []
    for n in range(1, num_cuotas + 1):
        ultima = n == num_cuotas
        cuotas.append(
            CuotaPlan(
                n,
                fecha_cuota(inicio, frecuencia, n),
                capital - base_capital * (num_cuotas - 1) if ultima else base_capital,
                interes - base_interes * (num_cuotas - 1) if ultima else base_interes,
            )
        )
    return cuotas


def imputar_abono(monto: int, interes_pendiente: int, capital_pendiente: int) -> tuple[int, int]:
    """Primero el interés y luego el capital. Devuelve (interés, capital)."""
    if monto <= 0:
        raise ErrorValidacion("El abono debe ser mayor que cero")
    if monto > interes_pendiente + capital_pendiente:
        raise ErrorValidacion("El abono supera lo que queda pendiente")
    a_interes = min(monto, interes_pendiente)
    return a_interes, monto - a_interes


def alerta_costo(tasa_ea: float, tasa_mensual: float, frecuencia: str, usura_consumo: float) -> str | None:
    """Aviso de préstamo caro / gota a gota (solo informativo)."""
    gota_a_gota = frecuencia == "diaria" or tasa_mensual > 0.05
    if not gota_a_gota and tasa_ea <= usura_consumo:
        return None
    ea = f"{tasa_ea * 100:,.0f}".replace(",", ".")
    usura = f"{usura_consumo * 100:.2f}".replace(".", ",")
    texto = f"Este préstamo equivale a {ea} % E.A.; la usura de consumo es {usura} %."
    return texto + (" Tiene forma de gota a gota." if gota_a_gota else "")
