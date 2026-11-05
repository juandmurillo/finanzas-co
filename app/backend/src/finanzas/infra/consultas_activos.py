"""Lecturas de activos y patrimonio neto. Lo que está en dólares se expresa en pesos con la última TRM guardada."""

from __future__ import annotations

from collections import defaultdict
from datetime import date, timedelta
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session

from finanzas.dominio import activos as dom
from finanzas.dominio.fechas import hoy_bogota
from finanzas.infra.modelos import Activo, ActivoMovimiento, ActivoValoracion, Credito, Parametro, Transaccion

DIAS_SIN_ACTUALIZAR = 90
DIAS_AVISO_VENCIMIENTO = 30


def trm_guardada(sesion: Session) -> float | None:
    """Solo lee: una consulta nunca debe salir a la red."""
    fila = sesion.scalar(
        select(Parametro).where(Parametro.clave == "trm").order_by(Parametro.vigencia_desde.desc()).limit(1)
    )
    return float(fila.valor) if fila else None


def _en_pesos(valor: int, moneda: str, trm: float | None) -> int:
    return valor if moneda == "COP" else round(valor * (trm or 0))


def _valoraciones(sesion: Session) -> dict[int, list[ActivoValoracion]]:
    salida: dict[int, list[ActivoValoracion]] = defaultdict(list)
    for v in sesion.scalars(select(ActivoValoracion).order_by(ActivoValoracion.fecha)):
        salida[v.activo_id].append(v)
    return salida


def _movimientos(sesion: Session) -> dict[int, list[dict[str, Any]]]:
    """El monto de un movimiento enlazado sale de su transacción: si la corriges en Movimientos, aquí también."""
    salida: dict[int, list[dict[str, Any]]] = defaultdict(list)
    filas = sesion.execute(
        select(ActivoMovimiento, Transaccion.monto)
        .outerjoin(Transaccion, Transaccion.id == ActivoMovimiento.transaccion_id)
        .order_by(ActivoMovimiento.fecha, ActivoMovimiento.id)
    )
    for m, monto_tx in filas:
        salida[m.activo_id].append(
            {
                "id": m.id,
                "tipo": m.tipo,
                "fecha": m.fecha,
                "monto": abs(monto_tx) if monto_tx is not None else m.monto,
                "con_cuenta": m.transaccion_id is not None,
                "nota": m.nota,
            }
        )
    return salida


def _flujos(movs: list[dict[str, Any]]) -> tuple[list[tuple[date, int]], int, int]:
    """Flujos para la TIR, total aportado y total recibido en cuentas."""
    flujos: list[tuple[date, int]] = []
    aportado = recibido = 0
    for m in movs:
        dia = date.fromisoformat(m["fecha"])
        if m["tipo"] == "aporte":
            aportado += m["monto"]
            flujos.append((dia, -m["monto"]))
        elif m["con_cuenta"]:  # un rendimiento reinvertido ya está en el valor del activo
            recibido += m["monto"]
            flujos.append((dia, m["monto"]))
    return flujos, aportado, recibido


def listar(sesion: Session, hoy: date | None = None) -> dict[str, Any]:
    hoy = hoy or hoy_bogota()
    trm = trm_guardada(sesion)
    valoraciones = _valoraciones(sesion)
    movimientos = _movimientos(sesion)
    filas: list[dict[str, Any]] = []
    todos_flujos: list[tuple[date, int]] = []
    por_clase: dict[str, int] = defaultdict(int)
    for a in sesion.scalars(select(Activo).order_by(Activo.estado, Activo.nombre)):
        vals = valoraciones.get(a.id, [])
        ultimo = vals[-1] if vals else None
        valor = ultimo.valor if ultimo else 0
        valor_cop = _en_pesos(valor, a.moneda, trm)
        movs = movimientos.get(a.id, [])
        flujos, aportado, recibido = _flujos(movs)
        resultado = dom.Resultado(aportado, recibido, valor_cop)
        terminal = [(hoy, valor_cop)] if valor_cop else []
        todos_flujos += flujos + terminal
        if a.estado == "activo":
            por_clase[a.clase] += valor_cop
        filas.append(
            {
                "id": a.id,
                "nombre": a.nombre,
                "clase": a.clase,
                "clase_nombre": dom.CLASES[a.clase],
                "moneda": a.moneda,
                "estado": a.estado,
                "fecha_compra": a.fecha_compra,
                "tasa_ea": a.tasa_ea,
                "vencimiento": a.vencimiento,
                "dias_para_vencer": (date.fromisoformat(a.vencimiento) - hoy).days if a.vencimiento else None,
                "nota": a.nota,
                "valor": valor,
                "valor_cop": valor_cop,
                "valorado_en": ultimo.fecha if ultimo else None,
                "aportado": aportado,
                "recibido": recibido,
                "ganancia": resultado.ganancia,
                "tir": dom.xirr(flujos + terminal),
                "movimientos": movs,
                "valoraciones": [{"fecha": v.fecha, "valor": v.valor} for v in vals],
            }
        )
    activos_vivos = [f for f in filas if f["estado"] == "activo"]
    total = sum(f["valor_cop"] for f in activos_vivos)
    return {
        "activos": filas,
        "total": total,
        "aportado": sum(f["aportado"] for f in filas),
        "recibido": sum(f["recibido"] for f in filas),
        "ganancia": sum(f["ganancia"] for f in filas),
        "tir": dom.xirr(todos_flujos),
        "trm": trm,
        "asignacion": [
            {"clase": c, "nombre": dom.CLASES[c], "valor": v, "pct": v / total if total else 0.0}
            for c, v in sorted(por_clase.items(), key=lambda kv: -kv[1])
            if v > 0
        ],
    }


def valor_total(sesion: Session) -> int:
    trm = trm_guardada(sesion)
    return sum(
        _en_pesos(vals[-1].valor, a.moneda, trm)
        for a in sesion.scalars(select(Activo).where(Activo.estado == "activo"))
        if (vals := _valoraciones(sesion).get(a.id))
    )


def patrimonio(sesion: Session) -> dict[str, int]:
    """Lo que tienes menos lo que debes: cuentas + por cobrar + activos − créditos − por pagar."""
    from finanzas.infra.consultas import resumen_creditos, saldos_cuentas

    cuentas = saldos_cuentas(sesion)
    disponible = sum(c["saldo"] for c in cuentas if c["tipo"] not in ("credito", "por_cobrar", "por_pagar"))
    por_cobrar = sum(c["saldo"] for c in cuentas if c["tipo"] == "por_cobrar")
    por_pagar = -sum(c["saldo"] for c in cuentas if c["tipo"] == "por_pagar")
    activos = valor_total(sesion)
    deudas = sum(c["saldo"] for c in resumen_creditos(sesion))
    return {
        "cuentas": disponible,
        "por_cobrar": por_cobrar,
        "activos": activos,
        "creditos": deudas,
        "por_pagar": por_pagar,
        "neto": disponible + por_cobrar + activos - deudas - por_pagar,
    }


def _meses(desde: str, hasta: str) -> list[str]:
    a, m = int(desde[:4]), int(desde[5:7])
    salida = []
    while f"{a:04d}-{m:02d}" <= hasta:
        salida.append(f"{a:04d}-{m:02d}")
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return salida


def patrimonio_serie(
    sesion: Session, desde: str | None = None, hasta: str | None = None, escala: str = "mes"
) -> dict[str, Any]:
    """Patrimonio al cierre de cada mes o de cada día con movimientos (`movimiento`: más detalle sin recargar el
    gráfico). La deuda es el saldo después del último pago; el último punto es la foto de hoy, igual que en Inicio."""
    from finanzas.infra.consultas_reportes import reducir_puntos

    actual = patrimonio(sesion)
    largo = 7 if escala == "mes" else 10
    hoy = hoy_bogota().isoformat()[:largo]
    por_clave = {
        k: int(v)
        for k, v in sesion.execute(
            text(
                f"SELECT substr(t.fecha, 1, {largo}), SUM(t.monto) FROM transaccion t "
                "JOIN cuenta c ON c.id = t.cuenta_id "
                "WHERE t.estado = 'confirmada' AND c.tipo != 'credito' GROUP BY 1"
            )
        ).all()
    }
    if not por_clave:
        return {"escala": escala, "puntos": [], "actual": actual}
    inicial = int(
        sesion.execute(text("SELECT COALESCE(SUM(saldo_inicial), 0) FROM cuenta WHERE tipo != 'credito'")).scalar_one()
    )
    trm = trm_guardada(sesion)
    valores = _valoraciones(sesion)
    monedas = {a.id: a.moneda for a in sesion.scalars(select(Activo))}
    pagos = sesion.execute(
        text(
            "SELECT p.credito_id, t.fecha, p.saldo_despues FROM credito_pago p "
            "JOIN transaccion t ON t.id = p.transaccion_id WHERE t.estado = 'confirmada' ORDER BY t.fecha, t.id"
        )
    ).all()
    creditos = list(sesion.scalars(select(Credito)))
    # La deuda empieza cuando entró el dinero: si la fecha del crédito y la del desembolso difieren en un día,
    # el patrimonio no debe caer esa noche para rebotar al siguiente.
    enlazados = [c.desembolso_id for c in creditos if c.desembolso_id]
    fechas_desembolso = {
        i: f for i, f in sesion.execute(select(Transaccion.id, Transaccion.fecha).where(Transaccion.id.in_(enlazados)))
    }
    inicio = {c.id: fechas_desembolso.get(c.desembolso_id or 0, c.fecha_desembolso)[:largo] for c in creditos}
    if escala == "mes":
        claves = _meses(min(por_clave), hoy)
    else:  # también cuentan los días en que cambió la deuda o el valor de un activo
        claves = sorted(
            {
                *por_clave,
                hoy,
                *(f[:largo] for _, f, _ in pagos),
                *inicio.values(),
                *(v.fecha[:largo] for vals in valores.values() for v in vals),
            }
        )
    puntos: list[dict[str, Any]] = []
    acumulado = inicial
    for clave in claves:
        acumulado += por_clave.get(clave, 0)
        en_activos = 0
        for activo_id, vals in valores.items():
            previas = [v for v in vals if v.fecha[:largo] <= clave]
            if previas:
                en_activos += _en_pesos(previas[-1].valor, monedas[activo_id], trm)
        deuda = 0
        for c in creditos:
            if inicio[c.id] > clave:
                continue
            saldos = [saldo for cid, f, saldo in pagos if cid == c.id and f[:largo] <= clave]
            deuda += saldos[-1] if saldos else c.capital_inicial
        neto = actual["neto"] if clave == hoy else acumulado + en_activos - deuda
        mes = clave[:7]
        if (desde is None or mes >= desde) and (hasta is None or mes <= hasta):
            puntos.append({"fecha": clave, "neto": neto, "activos": en_activos, "deuda": deuda})
    if escala == "movimiento":
        puntos = reducir_puntos(puntos, campo="neto")
    return {"escala": escala, "puntos": puntos, "actual": actual}


def alertas(sesion: Session, hoy: date | None = None) -> list[dict[str, Any]]:
    hoy = hoy or hoy_bogota()
    salida: list[dict[str, Any]] = []
    valoraciones = _valoraciones(sesion)
    limite = (hoy - timedelta(days=DIAS_SIN_ACTUALIZAR)).isoformat()
    for a in sesion.scalars(select(Activo).where(Activo.estado == "activo")):
        if a.vencimiento:
            dias = (date.fromisoformat(a.vencimiento) - hoy).days
            if dias <= DIAS_AVISO_VENCIMIENTO:
                cuando = "ya venció" if dias < 0 else "vence hoy" if dias == 0 else f"vence en {dias} días"
                salida.append(
                    {
                        "nivel": "aviso",
                        "tipo": "activo_vence",
                        "titulo": f"{a.nombre} {cuando}",
                        "monto": None,
                        "enlace": "/activos",
                    }
                )
        vals = valoraciones.get(a.id)
        if vals and vals[-1].fecha < limite:
            salida.append(
                {
                    "nivel": "info",
                    "tipo": "activo_sin_valor",
                    "titulo": f"{a.nombre}: valor sin actualizar hace más de {DIAS_SIN_ACTUALIZAR} días",
                    "monto": None,
                    "enlace": "/activos",
                }
            )
    return salida
