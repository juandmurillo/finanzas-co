"""Acceso a datos de préstamos personales: cuentas puente y saldos derivados."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy import select
from sqlalchemy.orm import Session

from finanzas.dominio.prestamos import meses_del_plazo
from finanzas.infra.modelos import Cuenta, PrestamoPersonal, Transaccion

CUENTA_PUENTE = {
    "presto_yo": ("Préstamos por cobrar", "por_cobrar"),
    "me_prestaron": ("Préstamos por pagar", "por_pagar"),
}


def cuenta_puente(sesion: Session, direccion: str) -> Cuenta:
    nombre, tipo = CUENTA_PUENTE[direccion]
    cuenta = sesion.scalar(select(Cuenta).where(Cuenta.nombre == nombre))
    if cuenta is None:
        cuenta = Cuenta(nombre=nombre, tipo=tipo, saldo_inicial=0, orden=90)
        sesion.add(cuenta)
        sesion.flush()
    return cuenta


@dataclass(frozen=True)
class Saldos:
    capital_pendiente: int
    interes_pagado: int
    interes_pendiente: int

    @property
    def pendiente(self) -> int:
        return self.capital_pendiente + self.interes_pendiente


def saldos(sesion: Session, prestamo: PrestamoPersonal) -> Saldos:
    """Capital pendiente = saldo de la cuenta puente para este préstamo; interés = pactado − pagado."""
    puente = cuenta_puente(sesion, prestamo.direccion)
    movimientos = list(sesion.scalars(select(Transaccion).where(Transaccion.prestamo_id == prestamo.id)))
    en_puente = sum(t.monto for t in movimientos if t.cuenta_id == puente.id)
    capital = en_puente if prestamo.direccion == "presto_yo" else -en_puente
    interes_pagado = sum(
        abs(t.monto)
        for t in movimientos
        if t.cuenta_id != puente.id and t.transferencia_id is None  # solo los intereses quedan sin par
    )
    pendiente_interes = 0 if prestamo.estado == "condonado" else max(0, prestamo.interes_total - interes_pagado)
    return Saldos(max(0, capital), interes_pagado, pendiente_interes)


def meses_prestamo(p: PrestamoPersonal) -> float:
    """Plazo en meses para la E.A. equivalente."""
    if p.plan == "cuotas" and p.frecuencia and p.cuotas:
        return meses_del_plazo(p.frecuencia, len(p.cuotas))
    if p.cuotas:
        dias = (date.fromisoformat(p.cuotas[-1].fecha) - date.fromisoformat(p.fecha[:10])).days
        return max(dias, 1) / 30
    return 1.0
