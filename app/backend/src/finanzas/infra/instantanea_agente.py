"""Instantánea de solo lectura para un agente de seguimiento: cifras de hoy más lo que cambió desde la
última revisión cerrada, para que cada sesión continúe donde quedó la anterior sin releer el historial.
Reutiliza `herramientas_asistente`: mismas cifras que la app, sin números de cuenta ni nombres de personas."""

from __future__ import annotations

import json
from datetime import date
from pathlib import Path
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from finanzas.infra import consultas, consultas_automatizacion
from finanzas.infra import consultas_reportes as rep
from finanzas.infra import herramientas_asistente as h
from finanzas.infra.consultas import _EN_RECLAMO
from finanzas.servicios.transacciones import ahora, hoy_bogota

BASE = "ultima_instantanea.json"
EN_CURSO = "instantanea_en_curso.json"
MUESTRA_NOVEDADES = 15
DIAS_CALENDARIO = 45
MESES_HISTORIA = 6
# Las alertas de pagos y vencidos pueden traer nombres de personas; esos eventos ya van en `calendario`.
TIPOS_ALERTA = ("saldo", "presupuesto", "meta")


def _pesos(centavos: int) -> int:
    return round(centavos / 100)


def _registro(sesion: Session, mes: str, hoy: date) -> dict[str, Any]:
    fila = (
        sesion.execute(
            text(
                "SELECT MAX(fecha) AS ultimo, SUM(substr(fecha, 1, 7) = :mes) AS del_mes "
                "FROM transaccion WHERE estado = 'confirmada' AND substr(fecha, 1, 10) <= :hoy"
            ),
            {"mes": mes, "hoy": hoy.isoformat()},
        )
        .mappings()
        .one()
    )
    ultimo = fila["ultimo"][:10] if fila["ultimo"] else None
    return {
        "ultimo_movimiento": ultimo,
        "dias_sin_registrar": (hoy - date.fromisoformat(ultimo)).days if ultimo else None,
        "movimientos_del_mes": int(fila["del_mes"] or 0),
    }


def _caja(sesion: Session) -> dict[str, Any]:
    cuentas = consultas.saldos_cuentas(sesion)
    return {
        "saldo_liquido": _pesos(sum(c["saldo"] for c in consultas.en_total(cuentas))),
        "cuentas": [
            {
                "nombre": c["nombre"],
                "tipo": c["tipo"],
                "saldo": _pesos(c["saldo"]),
                "suma_al_total": c["incluir_en_total"],
            }
            for c in cuentas
        ],
    }


def _deudas(sesion: Session) -> dict[str, Any]:
    d = h.deudas(sesion)
    return {
        **d,
        "saldo_total": sum(c["saldo"] for c in d["creditos"]),
        "cuotas_al_mes": sum(c["cuota"] for c in d["creditos"]),
    }


def _movimientos_tocados(sesion: Session, corte: str) -> dict[str, Any]:
    """Movimientos creados o editados después del corte, aunque su fecha sea anterior."""
    filas = (
        sesion.execute(
            text(
                f"""
            SELECT substr(t.fecha, 1, 10) AS fecha, t.descripcion, t.monto,
                   CASE WHEN c.nivel = 3 THEN p.nombre || ' › ' || c.nombre
                        ELSE COALESCE(c.nombre, 'Sin categoría') END AS categoria
            FROM transaccion t LEFT JOIN categoria c ON c.id = t.categoria_id LEFT JOIN categoria p ON p.id = c.padre_id
            WHERE t.estado = 'confirmada' AND t.actualizado_en > :corte AND NOT {_EN_RECLAMO}
              AND COALESCE(c.grupo, '') NOT IN ('transferencia', 'ajuste')
            ORDER BY t.fecha DESC
            """
            ),
            {"corte": corte},
        )
        .mappings()
        .all()
    )
    return {
        "cantidad": len(filas),
        "ingresos": _pesos(sum(f["monto"] for f in filas if f["monto"] > 0)),
        "salidas": _pesos(sum(f["monto"] for f in filas if f["monto"] < 0)),
        "muestra": [
            {
                "fecha": f["fecha"],
                "descripcion": f["descripcion"],
                "monto": _pesos(f["monto"]),
                "categoria": f["categoria"],
            }
            for f in filas[:MUESTRA_NOVEDADES]
        ],
    }


def _cambio(actual: int, previo: int) -> dict[str, int]:
    return {"antes": previo, "ahora": actual, "diferencia": actual - previo}


def _por_nombre(filas: list[dict[str, Any]], campo: str) -> dict[str, Any]:
    return {f["nombre"]: f[campo] for f in filas}


def _novedades(sesion: Session, foto: dict[str, Any], anterior: dict[str, Any] | None) -> dict[str, Any]:
    """Lo que cambió frente a la última revisión cerrada; sin ella, avisa que es la primera."""
    if anterior is None:
        return {"primera_revision": True}
    creditos_antes = _por_nombre(anterior["deudas"]["creditos"], "saldo")
    creditos_ahora = _por_nombre(foto["deudas"]["creditos"], "saldo")
    metas_antes = _por_nombre(anterior["metas"]["metas"], "progreso")
    alertas_antes = {a["titulo"] for a in anterior["alertas"]}
    alertas_ahora = {a["titulo"] for a in foto["alertas"]}
    return {
        "primera_revision": False,
        "desde": anterior["generada"],
        "movimientos": _movimientos_tocados(sesion, anterior["generada"]),
        "saldo_liquido": _cambio(foto["caja"]["saldo_liquido"], anterior["caja"]["saldo_liquido"]),
        "deuda_total": _cambio(foto["deudas"]["saldo_total"], anterior["deudas"]["saldo_total"]),
        "creditos_movidos": {
            nombre: _cambio(creditos_ahora.get(nombre, 0), creditos_antes.get(nombre, 0))
            for nombre in sorted(creditos_antes.keys() | creditos_ahora.keys())
            if creditos_antes.get(nombre, 0) != creditos_ahora.get(nombre, 0)
        },
        "metas_movidas": {
            m["nombre"]: {"antes": metas_antes.get(m["nombre"]), "ahora": m["progreso"]}
            for m in foto["metas"]["metas"]
            if metas_antes.get(m["nombre"]) != m["progreso"]
        },
        "alertas_nuevas": sorted(alertas_ahora - alertas_antes),
        "alertas_resueltas": sorted(alertas_antes - alertas_ahora),
    }


def generar(sesion: Session, anterior: dict[str, Any] | None = None) -> dict[str, Any]:
    """Foto completa en pesos; `novedades` va primero porque es lo único nuevo para quien continúa."""
    hoy = hoy_bogota()
    mes = hoy.isoformat()[:7]
    mes_cerrado = rep._mes_anterior(mes)
    foto: dict[str, Any] = {
        "generada": ahora(),
        "hoy": hoy.isoformat(),
        "mes": mes,
        "registro": _registro(sesion, mes, hoy),
        "caja": _caja(sesion),
        "deudas": _deudas(sesion),
        "prestamos_personales": h.prestamos_personales(sesion),
        "calendario": h.calendario(sesion, DIAS_CALENDARIO),
        "alertas": [
            {"nivel": a["nivel"], "tipo": a["tipo"], "titulo": a["titulo"], "monto": _pesos(a["monto"])}
            for a in consultas_automatizacion.alertas(sesion)
            if a["tipo"] in TIPOS_ALERTA
        ],
        "presupuesto": h.presupuesto(sesion, mes),
        "historia": h.resumen_mensual(sesion, rep._mes_anterior(mes, MESES_HISTORIA), mes),
        "revision_mes_en_curso": h.revision(sesion, mes),
        "revision_mes_cerrado": h.revision(sesion, mes_cerrado),
        "metas": h.metas(sesion),
        "recurrentes": h.recurrentes(sesion),
        "renta": h.termometro_renta(sesion),
    }
    return {"novedades": _novedades(sesion, foto, anterior), **foto}


def _leer(ruta: Path) -> dict[str, Any] | None:
    if not ruta.exists():
        return None
    try:
        datos: dict[str, Any] = json.loads(ruta.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return None  # una base dañada solo hace que la revisión cuente como primera
    return datos


def abrir(sesion: Session, carpeta: Path) -> Path:
    """Escribe la instantánea en curso comparada con la base. La base no cambia hasta `cerrar`."""
    carpeta.mkdir(parents=True, exist_ok=True)
    destino = carpeta / EN_CURSO
    foto = generar(sesion, _leer(carpeta / BASE))
    destino.write_text(json.dumps(foto, ensure_ascii=False, indent=1), encoding="utf-8")
    return destino


def cerrar(carpeta: Path) -> Path | None:
    """La instantánea en curso pasa a ser la base: lo registrado después de abrirla sale como novedad la próxima vez."""
    en_curso = carpeta / EN_CURSO
    if not en_curso.exists():
        return None
    return en_curso.replace(carpeta / BASE)
