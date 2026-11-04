"""Clasificador aprendido sobre el historial real (RF-CA-05) y su medición."""

from __future__ import annotations

from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, aliased

from finanzas.dominio import clasificador as dom
from finanzas.dominio import reglas as dom_reglas
from finanzas.infra.modelos import Categoria, Transaccion
from finanzas.infra.repositorios import ruta_categoria
from finanzas.servicios import reglas as servicio_reglas

# Los movimientos que no se capturan a mano no enseñan ni se evalúan.
_FUERA = ("transferencia", "ajuste", "financiacion")
# Desde aquí se mide si las sugerencias se aceptan sin editar (inicio de la fase 5).
INICIO_MEDICION = "2026-10-29"
_cache: dict[tuple[int, str], dom.Evaluacion] = {}


def historial(sesion: Session) -> list[dom.Ejemplo]:
    filas = sesion.execute(
        select(Transaccion.descripcion, Transaccion.monto, Transaccion.categoria_id)
        .join(Categoria, Categoria.id == Transaccion.categoria_id)
        .where(Transaccion.estado == "confirmada", Categoria.grupo.not_in(_FUERA))
        .order_by(Transaccion.fecha, Transaccion.id)
    ).all()
    return [dom.Ejemplo(f.descripcion or "", f.monto, f.categoria_id) for f in filas]


def _resolver(sesion: Session) -> dom.Resolver:
    padre = aliased(Categoria)
    filas = sesion.execute(
        select(Categoria.id, Categoria.nombre, padre.nombre).outerjoin(padre, padre.id == Categoria.padre_id)
    ).all()
    por_ruta = {(p or "", n): i for i, n, p in filas}
    hijos_de: dict[str, set[int]] = {}
    for i, n, p in filas:
        hijos_de.setdefault(n, set()).add(i)
        if p:
            hijos_de.setdefault(p, set()).add(i)

    def resolver(categoria: str, sub: str | None, historial: Sequence[dom.Ejemplo]) -> int | None:
        if sub and (ident := por_ruta.get((categoria, sub))) is not None:
            return ident
        if sub:  # se pidió una hoja concreta y no existe
            return None
        candidatos = hijos_de.get(categoria, set())
        usados = Counter(e.categoria_id for e in historial[-400:] if e.categoria_id in candidatos)
        if usados:  # la hoja que más usas de esa categoría
            return usados.most_common(1)[0][0]
        return min(candidatos) if candidatos else None

    return resolver


def sugerir(sesion: Session, descripcion: str, monto: int, cuenta_id: int = 0) -> list[dict[str, Any]]:
    """Tus reglas primero (son explícitas); luego el clasificador aprendido."""
    opciones = dom.sugerir(historial(sesion), descripcion, monto, _resolver(sesion))
    por_regla = dom_reglas.aplicar(
        servicio_reglas.activas(sesion), dom_reglas.Movimiento(descripcion, monto, cuenta_id)
    )
    if por_regla.categoria_id is not None:
        opciones = [dom.Sugerencia(por_regla.categoria_id, "regla", 1.0)] + [
            o for o in opciones if o.categoria_id != por_regla.categoria_id
        ][:2]
    salida = []
    for o in opciones:
        categoria = sesion.get(Categoria, o.categoria_id)
        if categoria is not None:
            salida.append({**asdict(o), "ruta": ruta_categoria(categoria), "grupo": categoria.grupo})
    return salida


def _equivalentes(sesion: Session) -> Any:
    """En servicio de deuda basta acertar el crédito (Intereses y Abono los reparte el pago de cuota)."""
    filas = sesion.execute(select(Categoria.id, Categoria.padre_id, Categoria.nivel, Categoria.grupo)).all()
    credito = {i: (p if n == 3 else i) for i, p, n, g in filas if g == "servicio_deuda"}
    return lambda a, b: a == b or (a in credito and credito.get(a) == credito.get(b))


def precision(sesion: Session) -> dict[str, Any]:
    """Prueba retrospectiva sobre los últimos 200 y aceptación real desde el inicio de la medición."""
    ejemplos = historial(sesion)
    clave = (len(ejemplos), ejemplos[-1].descripcion if ejemplos else "")
    if clave not in _cache:
        _cache.clear()
        _cache[clave] = dom.evaluar(ejemplos, 200, _resolver(sesion), _equivalentes(sesion))
    conteo = dict(
        sesion.execute(
            select(Transaccion.origen_categoria, func.count())
            .where(
                Transaccion.creado_en >= INICIO_MEDICION,
                Transaccion.importacion_id.is_(None),
                Transaccion.origen_categoria.in_(("sugerida", "usuario", "regla")),
            )
            .group_by(Transaccion.origen_categoria)
        ).all()
    )
    aceptadas = conteo.get("sugerida", 0) + conteo.get("regla", 0)
    total = aceptadas + conteo.get("usuario", 0)
    return {
        "retrospectiva": asdict(_cache[clave]),
        "uso_real": {
            "desde": INICIO_MEDICION,
            "movimientos": total,
            "aceptadas": aceptadas,
            "por_regla": conteo.get("regla", 0),
            "tasa": round(aceptadas / total, 3) if total else None,
        },
        "meta": 0.8,
    }
