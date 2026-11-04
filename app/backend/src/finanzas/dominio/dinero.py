"""Dinero como entero en centavos (ADR-0002). Nunca se usa float para montos."""

from __future__ import annotations

from decimal import ROUND_HALF_EVEN, Decimal, InvalidOperation

from finanzas.dominio.errores import ErrorValidacion

CENTAVOS_POR_PESO = 100


def a_centavos(valor: str | int | float | Decimal) -> int:
    """Convierte pesos (texto, número o Decimal) a centavos con redondeo bancario."""
    try:
        pesos = Decimal(str(valor).strip())
    except InvalidOperation as exc:
        raise ErrorValidacion(f"Monto inválido: {valor!r}") from exc
    return int((pesos * CENTAVOS_POR_PESO).quantize(Decimal("1"), rounding=ROUND_HALF_EVEN))


def a_pesos(centavos: int) -> Decimal:
    """Centavos a pesos exactos."""
    return Decimal(centavos) / CENTAVOS_POR_PESO


def formato_cop(centavos: int, *, decimales: bool = False, signo: bool = False) -> str:
    """Formato es-CO: `$ 1.234.567` (punto de miles, coma decimal)."""
    pesos = a_pesos(abs(centavos))
    entero = int(pesos)
    texto = f"{entero:,}".replace(",", ".")
    if decimales:
        texto += "," + f"{abs(centavos) % CENTAVOS_POR_PESO:02d}"
    prefijo = ""
    if centavos < 0:
        prefijo = "- "
    elif signo and centavos > 0:
        prefijo = "+ "
    return f"{prefijo}$ {texto}"
