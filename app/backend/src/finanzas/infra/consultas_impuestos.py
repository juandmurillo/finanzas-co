"""Termómetro de renta (RF-CO-02) y seguridad social del independiente (RF-CO-03).

Es una estimación educativa con tus movimientos, no una asesoría tributaria: la obligación real
depende de documentos (certificados, extractos, patrimonio) que la app no conoce por completo."""

from __future__ import annotations

from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from finanzas.infra.consultas import _EN_RECLAMO, saldos_cuentas
from finanzas.infra.consultas_creditos import parametro
from finanzas.servicios.transacciones import hoy_bogota

# Topes del art. 592 del Estatuto Tributario (en UVT del año gravable).
TOPES = {"ingresos": 1_400, "patrimonio": 4_500, "consumos_tarjeta": 1_400, "compras": 1_400, "consignaciones": 1_400}
# Aportes del independiente por prestación de servicios.
IBC_PORCENTAJE = 0.40
SALUD, PENSION, ARL_RIESGO_I = 0.125, 0.16, 0.00522


def _suma(sesion: Session, condicion: str, anio: int) -> int:
    valor = sesion.execute(
        text(
            f"""
            SELECT COALESCE(SUM(t.monto), 0) FROM transaccion t
            JOIN categoria c ON c.id = t.categoria_id
            JOIN cuenta cu ON cu.id = t.cuenta_id
            WHERE t.estado = 'confirmada' AND substr(t.fecha, 1, 4) = :anio AND NOT {_EN_RECLAMO}
              AND {condicion}
            """
        ),
        {"anio": str(anio)},
    ).scalar()
    return int(valor or 0)


def termometro(sesion: Session, anio: int | None = None) -> dict[str, Any]:
    hoy = hoy_bogota()
    anio = anio or hoy.year
    uvt = parametro(sesion, "uvt", f"{anio}-12-31")
    meses = hoy.month if anio == hoy.year else 12
    ingresos = _suma(sesion, "c.grupo = 'ingreso' AND t.monto > 0", anio)
    compras = -_suma(sesion, "c.grupo IN ('gasto_vida', 'apuestas', 'ahorro_inversion') AND t.monto < 0", anio)
    tarjeta = -_suma(sesion, "cu.tipo = 'tarjeta_credito' AND t.monto < 0 AND c.grupo <> 'transferencia'", anio)
    # Lo que te entra de terceros: ingresos, desembolsos y préstamos recibidos (no traslados entre tus cuentas).
    consignaciones = _suma(
        sesion,
        "t.monto > 0 AND c.grupo NOT IN ('transferencia', 'ajuste') AND cu.tipo IN ('ahorro', 'billetera', 'efectivo')",
        anio,
    )
    patrimonio = sum(max(0, c["saldo"]) for c in saldos_cuentas(sesion) if c["tipo"] not in ("credito", "por_pagar"))
    filas: list[dict[str, Any]] = []
    for clave, valor, nombre, proyectable in (
        ("ingresos", ingresos, "Ingresos brutos del año", True),
        ("patrimonio", patrimonio, "Patrimonio bruto (cuentas y lo que te deben)", False),
        ("consumos_tarjeta", tarjeta, "Consumos con tarjeta de crédito", True),
        ("compras", compras, "Compras y consumos totales", True),
        ("consignaciones", consignaciones, "Consignaciones y depósitos", True),
    ):
        tope = round(TOPES[clave] * uvt * 100) if uvt else None  # centavos
        proyectado = round(valor * 12 / meses) if proyectable and meses else valor
        filas.append(
            {
                "clave": clave,
                "nombre": nombre,
                "valor": valor,
                "proyectado": proyectado,
                "tope_uvt": TOPES[clave],
                "tope": tope,
                "pct": valor / tope if tope else None,
                "pct_proyectado": proyectado / tope if tope else None,
            }
        )
    return {
        "anio": anio,
        "uvt": uvt,
        "meses_transcurridos": meses,
        "declara_probable": any(f["pct_proyectado"] and f["pct_proyectado"] >= 1 for f in filas),
        "filas": filas,
        "seguridad_social": seguridad_social(sesion, anio),
        "aviso": "Estimación con tus movimientos registrados. Confirma con certificados y extractos o con un contador.",
    }


def seguridad_social(sesion: Session, anio: int) -> dict[str, Any]:
    """Aportes estimados por mes sobre el trabajo independiente (IBC = 40 % del ingreso, mínimo 1 SMMLV)."""
    smmlv = parametro(sesion, "smmlv", f"{anio}-12-31")
    filas = sesion.execute(
        text(
            """
            SELECT substr(t.fecha, 1, 7) AS mes, SUM(t.monto) AS total FROM transaccion t
            JOIN categoria c ON c.id = t.categoria_id LEFT JOIN categoria p ON p.id = c.padre_id
            WHERE t.estado = 'confirmada' AND substr(t.fecha, 1, 4) = :anio AND c.grupo = 'ingreso' AND t.monto > 0
              AND (c.nombre = 'Trabajo independiente' OR p.nombre = 'Trabajo independiente')
            GROUP BY 1 ORDER BY 1
            """
        ),
        {"anio": str(anio)},
    ).mappings()
    minimo = round(smmlv * 100) if smmlv else None
    meses = []
    for f in filas:
        ingreso = int(f["total"])
        obligado = minimo is not None and ingreso >= minimo
        ibc = min(max(round(ingreso * IBC_PORCENTAJE), minimo or 0), (minimo or 0) * 25) if obligado else 0
        salud, pension, arl = round(ibc * SALUD), round(ibc * PENSION), round(ibc * ARL_RIESGO_I)
        meses.append(
            {
                "mes": f["mes"],
                "ingreso": ingreso,
                "obligado": obligado,
                "ibc": ibc,
                "salud": salud,
                "pension": pension,
                "arl": arl,
                "total": salud + pension + arl,
            }
        )
    return {
        "smmlv": smmlv,
        "porcentajes": {"ibc": IBC_PORCENTAJE, "salud": SALUD, "pension": PENSION, "arl": ARL_RIESGO_I},
        "meses": meses,
        "total_anio": sum(m["total"] for m in meses),
        "nota": "Si un mes tus ingresos como independiente no llegan a 1 SMMLV, ese mes no estás obligado a cotizar.",
    }
