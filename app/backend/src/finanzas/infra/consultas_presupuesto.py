"""Lectura del presupuesto por grupos: asignado (guardado) vs gastado (calculado de las transacciones)."""

from __future__ import annotations

import calendar
from collections import defaultdict
from datetime import date
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.orm import Session, selectinload

from finanzas.dominio.fechas import hoy_bogota
from finanzas.infra.consultas import resumen_mensual
from finanzas.infra.modelos import Categoria, PresupuestoGrupo, PresupuestoGrupoMes
from finanzas.infra.repositorios import ruta_categoria

_EXCLUYE_RECLAMO = (
    "t.id NOT IN (SELECT te.transaccion_id FROM transaccion_etiqueta te "
    "JOIN etiqueta e ON e.id = te.etiqueta_id WHERE e.nombre = 'reclamo')"
)


def _gastado(sesion: Session, desde: str, hasta: str) -> dict[tuple[str, int], int]:
    """Gastado por (mes, categoría hoja) y también acumulado en su categoría madre (centavos, positivo)."""
    filas = sesion.execute(
        text(
            f"""
            SELECT substr(t.fecha, 1, 7) AS mes, t.categoria_id, c.padre_id, c.nivel, -SUM(t.monto) AS total
            FROM transaccion t JOIN categoria c ON c.id = t.categoria_id
            WHERE t.estado = 'confirmada' AND substr(t.fecha, 1, 7) BETWEEN :desde AND :hasta AND {_EXCLUYE_RECLAMO}
              AND c.grupo IN ('gasto_vida', 'servicio_deuda', 'apuestas', 'ahorro_inversion')
            GROUP BY 1, 2
            """
        ),
        {"desde": desde, "hasta": hasta},
    ).mappings()
    gastado: dict[tuple[str, int], int] = defaultdict(int)
    for f in filas:
        total = int(f["total"])
        gastado[(f["mes"], f["categoria_id"])] += total
        if f["nivel"] == 3 and f["padre_id"] is not None:  # la categoría madre incluye sus subcategorías
            gastado[(f["mes"], f["padre_id"])] += total
    return gastado


def ingreso_referencia(sesion: Session, mes: str, meses: int = 6) -> int:
    """Mínimo de ingresos de los últimos N meses anteriores al presupuestado (ingresos irregulares)."""
    anteriores = [m for m in resumen_mensual(sesion, 60) if m["mes"] < mes][-meses:]
    return min((m["ingresos"] for m in anteriores), default=0)


def _vigentes(sesion: Session, hasta: str) -> dict[int, list[tuple[str, int]]]:
    """Asignaciones por grupo ordenadas por mes (hasta `hasta`): el monto se fija al crear o editar el
    presupuesto y rige desde ese mes hasta que vuelva a cambiar (fase 8, punto 8.1)."""
    por_grupo: dict[int, list[tuple[str, int]]] = defaultdict(list)
    for f in sesion.scalars(
        select(PresupuestoGrupoMes).where(PresupuestoGrupoMes.mes <= hasta).order_by(PresupuestoGrupoMes.mes)
    ):
        por_grupo[f.grupo_id].append((f.mes, f.asignado))
    return por_grupo


def _monto_en(asignaciones: list[tuple[str, int]], mes: str) -> tuple[int, str] | None:
    """Monto vigente en `mes`: el de ese mes o el último anterior. None si aún no tenía monto."""
    vigente = None
    for m, monto in asignaciones:
        if m <= mes:
            vigente = (monto, m)
    return vigente


def ritmo_mes(mes: str, hoy: date | None = None) -> float:
    """Parte del mes ya transcurrida: la línea base para comparar lo gastado (1 = mes cerrado)."""
    hoy = hoy or hoy_bogota()
    actual = hoy.isoformat()[:7]
    if mes < actual:
        return 1.0
    if mes > actual:
        return 0.0
    return round(hoy.day / calendar.monthrange(hoy.year, hoy.month)[1], 4)


def _grupos(sesion: Session) -> list[PresupuestoGrupo]:
    return list(
        sesion.scalars(
            select(PresupuestoGrupo)
            .options(selectinload(PresupuestoGrupo.categorias))
            .order_by(PresupuestoGrupo.nombre)
        )
    )


def presupuesto_mes(sesion: Session, mes: str) -> dict[str, Any]:
    gastado = _gastado(sesion, mes, mes)
    vigentes = _vigentes(sesion, mes)
    asignaciones: dict[int, int] = {}
    heredados: set[int] = set()
    for gid, lista in vigentes.items():
        vigente = _monto_en(lista, mes)
        if vigente is not None:
            asignaciones[gid] = vigente[0]
            if vigente[1] != mes:
                heredados.add(gid)
    filas: list[dict[str, Any]] = []
    cubiertas: set[int] = set()
    for g in _grupos(sesion):
        categorias: list[dict[str, Any]] = []
        for gc in g.categorias:
            cat = sesion.get(Categoria, gc.categoria_id)
            if cat is not None:
                categorias.append({"id": cat.id, "ruta": ruta_categoria(cat)})
                cubiertas.add(cat.id)
                cubiertas.update(sesion.scalars(select(Categoria.id).where(Categoria.padre_id == cat.id)))
        usado = sum(gastado.get((mes, int(c["id"])), 0) for c in categorias)
        asignado = asignaciones.get(g.id, 0)
        filas.append(
            {
                "id": g.id,
                "nombre": g.nombre,
                "icono": g.icono,
                "color": g.color,
                "es_fijo": g.es_fijo,
                "categorias": categorias,
                "asignado": asignado,
                "tiene_asignacion": g.id in asignaciones,
                "heredado": g.id in heredados,
                "gastado": usado,
                "disponible": asignado - usado,
                "pct": round(100 * usado / asignado) if asignado else (100 if usado > 0 else 0),
            }
        )
    filas.sort(key=lambda f: (not f["es_fijo"], not f["tiene_asignacion"], -f["asignado"], f["nombre"]))
    sin_presupuesto: list[dict[str, Any]] = []
    for (m, categoria_id), total in sorted(gastado.items(), key=lambda kv: -kv[1]):
        cat = sesion.get(Categoria, categoria_id)
        if cat is None or total <= 0 or categoria_id in cubiertas:
            continue
        if cat.nivel == 3 and (cat.padre_id in cubiertas or (m, cat.padre_id) in gastado):
            continue  # se muestra dentro de su categoría madre
        sin_presupuesto.append({"categoria_id": categoria_id, "ruta": ruta_categoria(cat), "gastado": total})
    con_monto = [f for f in filas if f["tiene_asignacion"]]
    asignado_total = sum(f["asignado"] for f in con_monto)
    referencia = ingreso_referencia(sesion, mes)
    return {
        "mes": mes,
        "ritmo": ritmo_mes(mes),
        "ingreso_referencia": referencia,
        "asignado": asignado_total,
        "asignado_fijo": sum(f["asignado"] for f in con_monto if f["es_fijo"]),
        "gastado": sum(f["gastado"] for f in con_monto),
        "por_asignar": referencia - asignado_total,
        "filas": filas,
        "sin_presupuesto": sin_presupuesto[:10],
    }


def historico(sesion: Session, desde: str, hasta: str, grupo_id: int | None = None) -> dict[str, Any]:
    """Asignado vs gastado por mes, de un presupuesto o de todos juntos."""
    grupos = [g for g in _grupos(sesion) if grupo_id is None or g.id == grupo_id]
    gastado = _gastado(sesion, desde, hasta)
    meses = sorted({m for m, _ in gastado} | {f.mes for f in sesion.scalars(select(PresupuestoGrupoMes))})
    meses = [m for m in meses if desde <= m <= hasta]
    vigentes = _vigentes(sesion, hasta)
    meses = sorted(set(meses) | {m for m in _meses(desde, hasta) if any(_monto_en(v, m) for v in vigentes.values())})
    asign: dict[tuple[str, int], int] = {}
    for gid, lista in vigentes.items():
        for m in meses:
            vigente = _monto_en(lista, m)
            if vigente is not None:
                asign[(m, gid)] = vigente[0]
    serie = []
    for mes in meses:
        fila: dict[str, Any] = {"mes": mes, "asignado": 0, "gastado": 0, "grupos": {}}
        for g in grupos:
            usado = sum(gastado.get((mes, gc.categoria_id), 0) for gc in g.categorias)  # la madre ya suma sus hijas
            a = asign.get((mes, g.id), 0)
            fila["grupos"][g.nombre] = {"asignado": a, "gastado": usado}
            fila["asignado"] += a
            fila["gastado"] += usado
        serie.append(fila)
    return {"grupos": [{"id": g.id, "nombre": g.nombre} for g in grupos], "meses": serie}


def _meses(desde: str, hasta: str) -> list[str]:
    salida, a, m = [], int(desde[:4]), int(desde[5:7])
    while f"{a:04d}-{m:02d}" <= hasta:
        salida.append(f"{a:04d}-{m:02d}")
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return salida


def acumulado(sesion: Session, mes: str, grupo_id: int | None = None) -> dict[str, Any]:
    """Gasto acumulado día a día del mes y del mes anterior en un presupuesto (o en todos), con el monto
    vigente: sirve para ver si vas por encima o por debajo del ritmo ideal."""
    grupos = [g for g in _grupos(sesion) if grupo_id is None or g.id == grupo_id]
    ids: set[int] = set()
    for g in grupos:
        for gc in g.categorias:
            ids.add(gc.categoria_id)
            ids.update(sesion.scalars(select(Categoria.id).where(Categoria.padre_id == gc.categoria_id)))
    anterior = _meses_antes(mes)
    vigentes = _vigentes(sesion, mes)
    limite = sum((_monto_en(vigentes.get(g.id, []), mes) or (0, ""))[0] for g in grupos)
    por_dia: dict[str, dict[int, int]] = {mes: defaultdict(int), anterior: defaultdict(int)}
    if ids:
        filas = sesion.execute(
            text(
                f"""
                SELECT substr(t.fecha, 1, 7) AS mes, CAST(substr(t.fecha, 9, 2) AS INTEGER) AS dia,
                       -SUM(t.monto) AS total
                FROM transaccion t
                WHERE t.estado = 'confirmada' AND substr(t.fecha, 1, 7) IN (:mes, :anterior) AND {_EXCLUYE_RECLAMO}
                  AND t.categoria_id IN ({",".join(str(i) for i in sorted(ids))})
                GROUP BY 1, 2
                """
            ),
            {"mes": mes, "anterior": anterior},
        ).mappings()
        for f in filas:
            por_dia[f["mes"]][int(f["dia"])] += int(f["total"])
    a, m = int(mes[:4]), int(mes[5:7])
    dias_mes = calendar.monthrange(a, m)[1]
    hoy = hoy_bogota()
    hasta_dia = hoy.day if mes == hoy.isoformat()[:7] else (dias_mes if mes < hoy.isoformat()[:7] else 0)
    serie, actual, previo = [], 0, 0
    for d in range(1, dias_mes + 1):
        actual += por_dia[mes].get(d, 0)
        previo += por_dia[anterior].get(d, 0)
        serie.append({"dia": d, "actual": actual if d <= hasta_dia else None, "anterior": previo})
    return {"mes": mes, "anterior": anterior, "limite": limite, "dias": dias_mes, "serie": serie}


def _meses_antes(mes: str) -> str:
    a, m = int(mes[:4]), int(mes[5:7]) - 1
    return f"{a - 1:04d}-12" if m == 0 else f"{a:04d}-{m:02d}"
