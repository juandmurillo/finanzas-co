"""Herramientas de solo lectura que el asistente (RF-IA-01) puede usar. Devuelven agregados en pesos;
nunca números de cuenta, saldos de cuentas individuales, nombres de personas ni datos de contacto.
Solo `buscar_movimientos` devuelve descripciones, y como máximo 15."""

from __future__ import annotations

from datetime import date
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from finanzas.dominio.grupos import Grupo
from finanzas.infra import (
    consultas_automatizacion,
    consultas_creditos,
    consultas_impuestos,
    consultas_kpis,
    consultas_prestamos,
    consultas_presupuesto,
)
from finanzas.infra import consultas_reportes as rep
from finanzas.infra.consultas import _EN_RECLAMO


def _pesos(centavos: int | float) -> int:
    return round(centavos / 100)


def _miles(centavos: int) -> str:
    return f"{_pesos(centavos):,}".replace(",", ".")


def _mes(valor: str | None) -> str | None:
    if not valor:
        return None
    date.fromisoformat(f"{valor[:7]}-01")  # valida AAAA-MM
    return valor[:7]


def resumen_mensual(sesion: Session, desde: str | None, hasta: str | None) -> dict[str, Any]:
    m = rep.mensual(sesion, _mes(desde), _mes(hasta))
    claves = ("ingresos", "gasto_vida", "servicio_deuda", "apuestas_neto", "flujo_operativo")
    return {
        "moneda": "COP",
        "meses": [{"mes": f["mes"], **{k: _pesos(f[k]) for k in claves}} for f in m["meses"]],
        "totales": {k: _pesos(m["totales"].get(k, 0)) for k in claves},
    }


def gasto_por_categoria(sesion: Session, desde: str | None, hasta: str | None, grupo: str) -> dict[str, Any]:
    c = rep.categorias(sesion, _mes(desde), _mes(hasta), Grupo(grupo))
    return {
        "moneda": "COP",
        "grupo": grupo,
        "meses": len(c["meses"]),
        "total": _pesos(c["total"]),
        "categorias": [
            {
                "categoria": f["categoria"],
                "total": _pesos(f["total"]),
                "movimientos": f["n"],
                "subcategorias": {s["subcategoria"]: _pesos(s["total"]) for s in f["subcategorias"][:8]},
            }
            for f in c["categorias"][:15]
        ],
    }


def buscar_movimientos(
    sesion: Session, texto: str, desde: str | None, hasta: str | None, limite: int = 15
) -> dict[str, Any]:
    patron = f"%{texto.strip()}%"
    filas = (
        sesion.execute(
            text(
                f"""
            SELECT substr(t.fecha, 1, 10) AS fecha, t.descripcion, t.monto,
                   CASE WHEN c.nivel = 3 THEN p.nombre || ' › ' || c.nombre ELSE c.nombre END AS categoria
            FROM transaccion t JOIN categoria c ON c.id = t.categoria_id LEFT JOIN categoria p ON p.id = c.padre_id
            WHERE t.estado = 'confirmada' AND NOT {_EN_RECLAMO}
              AND c.grupo NOT IN ('transferencia', 'ajuste')
              AND (t.descripcion LIKE :patron OR c.nombre LIKE :patron OR p.nombre LIKE :patron)
              AND (:desde IS NULL OR substr(t.fecha, 1, 7) >= :desde)
              AND (:hasta IS NULL OR substr(t.fecha, 1, 7) <= :hasta)
            ORDER BY t.fecha DESC
            """
            ),
            {"patron": patron, "desde": _mes(desde), "hasta": _mes(hasta)},
        )
        .mappings()
        .all()
    )
    return {
        "moneda": "COP",
        "coincidencias": len(filas),
        "total": _pesos(sum(f["monto"] for f in filas)),
        "muestra": [
            {
                "fecha": f["fecha"],
                "descripcion": f["descripcion"],
                "monto": _pesos(f["monto"]),
                "categoria": f["categoria"],
            }
            for f in filas[: min(limite, 15)]
        ],
    }


def deudas(sesion: Session) -> dict[str, Any]:
    return {
        "moneda": "COP",
        "creditos": [
            {
                "nombre": d["nombre"],
                "saldo": _pesos(d["saldo"]),
                "tasa_ea": round(d["tasa_ea"], 4),
                "costo_real_ea": round(d["costo_real_ea"], 4),
                "cuota": _pesos(d["cuota"]),
                "fecha_fin": d["fecha_fin"],
            }
            for d in consultas_creditos.creditos_activos(sesion)
        ],
        "usura_consumo": consultas_creditos.parametro(sesion, "usura_consumo"),
    }


def presupuesto(sesion: Session, mes: str) -> dict[str, Any]:
    p = consultas_presupuesto.presupuesto_mes(sesion, _mes(mes) or "")
    return {
        "moneda": "COP",
        "mes": p.get("mes", mes),
        "ingreso_referencia": _pesos(p["ingreso_referencia"]),
        "asignado": _pesos(p["asignado"]),
        "gastado": _pesos(p["gastado"]),
        "filas": [
            {
                "presupuesto": f["nombre"],
                "categorias": [" › ".join(c["ruta"][1:]) for c in f["categorias"]],
                "asignado": _pesos(f["asignado"]),
                "gastado": _pesos(f["gastado"]),
            }
            for f in p["filas"]
        ],
    }


PRESTAMO_PERSONAL = "Cuota de préstamo personal"


def _evento(e: dict[str, Any]) -> dict[str, Any]:
    """Un evento del calendario sin cuenta ni persona (los préstamos personales llevan el nombre en la descripción)."""
    return {
        "fecha": e["fecha"],
        "descripcion": PRESTAMO_PERSONAL if e["tipo"] == "prestamo" else e["descripcion"],
        "monto": _pesos(e["monto"]),
        "dias": e.get("dias"),
    }


def recurrentes(sesion: Session) -> dict[str, Any]:
    r = consultas_automatizacion.recurrentes(sesion)
    return {
        "moneda": "COP",
        "gasto_fijo_mensual_sin_cuotas": _pesos(r["gasto_mensual"]),
        "suscripciones_al_mes": _pesos(r["suscripciones_mensual"]),
        "recurrentes": [
            {
                "nombre": f["nombre"],
                "monto": _pesos(f["monto"]),
                "frecuencia": f["frecuencia"],
                "estado": f["estado"],
                "suscripcion": f["es_suscripcion"],
                "cuota_de_credito": f["credito_id"] is not None,
                "proxima": f["proxima"],
            }
            for f in r["items"]
        ],
    }


def calendario(sesion: Session, dias: int = 45) -> dict[str, Any]:
    c = consultas_automatizacion.calendario(sesion, max(7, min(dias, 90)))
    return {
        "moneda": "COP",
        "hasta": c["hasta"],
        "saldo_liquido_hoy": _pesos(c["saldo_inicial"]),
        "saldo_al_final": _pesos(c["saldo_final"]),
        "saldo_minimo": {"monto": _pesos(c["minimo"]["saldo"]), "fecha": c["minimo"]["fecha"]},
        "vencidos": [_evento(e) for e in c["vencidos"]],
        "proximos": [_evento(e) for e in c["eventos"][:40]],
    }


def metas(sesion: Session) -> dict[str, Any]:
    return {
        "moneda": "COP",
        "metas": [
            {
                "nombre": m["nombre"],
                "tipo": m["tipo"],
                "estado": m["estado"],
                "objetivo": _pesos(m["objetivo"] or 0),
                "actual": _pesos(m.get("actual", 0) or 0),
                "progreso": round(m.get("progreso", 0) or 0, 3),
                "fecha_objetivo": m["fecha_objetivo"],
            }
            for m in consultas_automatizacion.metas(sesion)
            if m["estado"] != "archivada"
        ],
    }


def revision(sesion: Session, mes: str) -> dict[str, Any]:
    mes = _mes(mes) or ""
    r = rep.revision(sesion, mes)
    k = consultas_kpis.estrategicos(sesion, mes)

    def kpi(f: dict[str, Any]) -> dict[str, Any]:
        valor = f["valor"]
        return {
            "nombre": f["nombre"],
            "valor": _pesos(valor) if f["formato"] == "cop" and valor is not None else valor,
            "formato": f["formato"],
            "estado": f.get("estado"),
            "meta": f.get("texto_meta") or f.get("detalle"),
        }

    return {
        "moneda": "COP",
        "mes": mes,
        "hallazgos": r["hallazgos"],
        "indicadores": [
            {"clave": i["clave"], **{c: _pesos(i[c]) for c in ("actual", "anterior", "promedio")}}
            for i in r["indicadores"]
        ],
        "kpis": [kpi(f) for f in k["principales"] + k["secundarios"]],
        "subieron": [{"categoria": c["categoria"], "diferencia": _pesos(c["diferencia"])} for c in r["subidas"]],
    }


def termometro_renta(sesion: Session) -> dict[str, Any]:
    t = consultas_impuestos.termometro(sesion)
    return {
        "anio": t["anio"],
        "uvt": t["uvt"],
        "declara_probable": t["declara_probable"],
        "moneda": "COP",
        "topes": [
            {**f, **{k: _pesos(f[k]) for k in ("valor", "proyectado", "tope") if f.get(k) is not None}}
            for f in t["filas"]
        ],
        "aviso": t["aviso"],
    }


def prestamos_personales(sesion: Session) -> dict[str, Any]:
    """Préstamos con personas, sin nombres: dirección, pendiente, tasa equivalente y próxima cuota."""
    return {
        "moneda": "COP",
        "prestamos": [
            {
                "direccion": "me deben" if p["direccion"] == "presto_yo" else "debo",
                "origen": p["origen"],
                "monto": _pesos(p["monto"]),
                "pendiente": _pesos(p["pendiente"]),
                "tasa_ea_equivalente": p["tasa_ea"],
                "proxima_cuota": p["proxima_cuota"]
                and {**p["proxima_cuota"], "monto": _pesos(p["proxima_cuota"]["monto"])},
                "dias_vencido": p["dias_vencido"],
            }
            for p in consultas_prestamos.listar(sesion, "activo")
        ],
    }


def contexto(sesion: Session, mes: str) -> str:
    """Resumen breve para el `system`: situación de hoy en agregados, sin nombres ni números de cuenta."""
    k = consultas_kpis.estrategicos(sesion, mes)
    lineas = [f"Resumen de {mes} (indicadores frente a su meta):"]
    for f in k["principales"]:
        valor = f["valor"]
        texto = "sin datos" if valor is None else f"{valor:.0%}" if f["formato"] == "pct" else f"{valor:.2f}"
        lineas.append(f"- {f['nombre']}: {texto} ({f['estado']}; {f['texto_meta']})")
    creditos = consultas_creditos.creditos_activos(sesion)
    if creditos:
        lineas.append(
            f"- Deudas: {len(creditos)} créditos, saldo total ${_miles(sum(c['saldo'] for c in creditos))}, "
            f"cuotas ${_miles(sum(c['cuota'] for c in creditos))} al mes; tasas E.A. "
            + ", ".join(f"{c['tasa_ea']:.1%}" for c in creditos)
        )
    for m in metas(sesion)["metas"]:
        lineas.append(f"- Meta «{m['nombre']}» ({m['tipo']}): progreso {m['progreso']:.0%}")
    avisos = [a for a in consultas_automatizacion.alertas(sesion) if a["tipo"] in ("saldo", "presupuesto", "meta")]
    for a in avisos[:5]:
        lineas.append(f"- Alerta: {a['titulo']}")
    return "\n".join(lineas)
