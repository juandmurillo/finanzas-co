"""Reglas puras de activos: clases, rentabilidad anualizada (TIR) y ganancia. Montos en centavos."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

CLASES: dict[str, str] = {
    "inmueble": "Inmueble",
    "vehiculo": "Vehículo",
    "cdt": "CDT",
    "fondo": "Fondo",
    "acciones": "Acciones o ETF",
    "cripto": "Cripto",
    "cesantias_pension": "Cesantías o pensión",
    "negocio": "Negocio",
    "otro": "Otro",
}
TIPOS_MOVIMIENTO = ("aporte", "retiro", "rendimiento", "venta")
DIAS_MINIMOS_TIR = 30  # anualizar unos pocos días da cifras absurdas
_TASA_MIN, _TASA_MAX = -0.9999, 1000.0


def _valor_presente(flujos: list[tuple[date, int]], tasa: float) -> float:
    inicio = flujos[0][0]
    return float(sum(m / (1 + tasa) ** ((d - inicio).days / 365) for d, m in flujos))


def xirr(flujos: list[tuple[date, int]]) -> float | None:
    """TIR anual de flujos con fecha: lo que sale es negativo y lo que entra, positivo. None si no aplica."""
    ordenados = sorted(flujos, key=lambda f: f[0])
    if not any(m > 0 for _, m in ordenados) or not any(m < 0 for _, m in ordenados):
        return None
    if (ordenados[-1][0] - ordenados[0][0]).days < DIAS_MINIMOS_TIR:
        return None
    bajo, alto = _TASA_MIN, _TASA_MAX
    v_bajo = _valor_presente(ordenados, bajo)
    if v_bajo * _valor_presente(ordenados, alto) > 0:
        return None
    for _ in range(200):
        medio = (bajo + alto) / 2
        v_medio = _valor_presente(ordenados, medio)
        if abs(v_medio) < 0.5 or alto - bajo < 1e-7:
            return round(medio, 4)
        if v_bajo * v_medio <= 0:
            alto = medio
        else:
            bajo, v_bajo = medio, v_medio
    return round((bajo + alto) / 2, 4)


@dataclass(frozen=True)
class Resultado:
    """Comprar o aportar no es gasto: el dinero cambia de forma. La ganancia se calcula aparte."""

    aportado: int
    recibido: int  # retiros, ventas y rendimientos pagados a una cuenta
    valor: int

    @property
    def ganancia(self) -> int:
        return self.valor + self.recibido - self.aportado
