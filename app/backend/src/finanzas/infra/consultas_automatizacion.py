"""Consultas de la fase 5: recurrentes y suscripciones, calendario con saldo proyectado, metas y alertas."""

from __future__ import annotations

import json
from datetime import date, timedelta
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from finanzas.dominio import recurrentes as dom
from finanzas.dominio.clasificador import normalizar
from finanzas.infra import consultas, consultas_prestamos, consultas_presupuesto
from finanzas.infra.modelos import Categoria, CreditoPago, Meta, MetaObjetivo, Recurrente, Regla, Transaccion
from finanzas.infra.repositorios import ruta_categoria
from finanzas.servicios.transacciones import hoy_bogota

_DIAS_VENCIDO_MAX = 60
_MESES = ("ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic")


def _fecha_corta(iso: str) -> str:
    """'2026-11-21' → '21 nov'."""
    d = date.fromisoformat(iso[:10])
    return f"{d.day} {_MESES[d.month - 1]}"  # una programada más vieja que esto se considera abandonada, no vencida


def _hoy() -> date:
    return hoy_bogota()


# ---------- Reglas ----------
def reglas(sesion: Session) -> list[dict[str, Any]]:
    salida = []
    for r in sesion.scalars(select(Regla).order_by(Regla.prioridad, Regla.id)):
        acciones = json.loads(r.acciones)
        categoria = sesion.get(Categoria, acciones["categoria_id"]) if acciones.get("categoria_id") else None
        salida.append(
            {
                "id": r.id,
                "nombre": r.nombre,
                "prioridad": r.prioridad,
                "activa": r.activa,
                "condiciones": json.loads(r.condiciones),
                "categoria_id": acciones.get("categoria_id"),
                "categoria_ruta": ruta_categoria(categoria) if categoria else None,
                "etiquetas": acciones.get("etiquetas", []),
            }
        )
    return salida


# ---------- Recurrentes ----------
def recurrentes(sesion: Session) -> dict[str, Any]:
    hoy = _hoy().isoformat()
    lista = list(
        sesion.scalars(
            select(Recurrente)
            .options(joinedload(Recurrente.cuenta), joinedload(Recurrente.categoria).joinedload(Categoria.padre))
            .order_by(Recurrente.activo.desc(), Recurrente.nombre)
        )
    )
    filas: list[dict[str, Any]] = []
    for r in lista:
        proxima = sesion.scalar(
            select(Transaccion.fecha)
            .where(Transaccion.recurrente_id == r.id, Transaccion.estado == "pendiente", Transaccion.fecha >= hoy)
            .order_by(Transaccion.fecha)
            .limit(1)
        )
        ultimo_pago = sesion.scalar(
            select(Transaccion.fecha)
            .where(Transaccion.recurrente_id == r.id, Transaccion.estado == "confirmada")
            .order_by(Transaccion.fecha.desc())
            .limit(1)
        )
        filas.append(
            {
                "id": r.id,
                "nombre": r.nombre,
                "cuenta_id": r.cuenta_id,
                "cuenta": r.cuenta.nombre,
                "categoria_id": r.categoria_id,
                "categoria_ruta": ruta_categoria(r.categoria) if r.categoria else None,
                "monto": r.monto,
                "frecuencia": r.frecuencia,
                "dia": r.dia,
                "inicio": r.inicio,
                "fin": r.fin,
                "es_suscripcion": r.es_suscripcion,
                "activo": r.activo,
                "estado": "cancelado" if r.cancelado_en else ("activo" if r.activo else "pausado"),
                "ancla": r.ancla,
                "credito_id": r.credito_id,
                "nota": r.nota,
                "costo_mensual": dom.costo_mensual(r.monto, r.frecuencia) if r.monto < 0 else 0,  # type: ignore[arg-type]
                "proxima": proxima[:10] if proxima else None,
                "ultimo_pago": ultimo_pago[:10] if ultimo_pago else None,
            }
        )
    activas = [f for f in filas if f["activo"] and f["monto"] < 0]
    suscripciones = [f for f in activas if f["es_suscripcion"]]
    return {
        "items": filas,
        "gasto_mensual": sum(f["costo_mensual"] for f in activas if f["credito_id"] is None),  # sin cuotas de crédito
        "suscripciones_mensual": sum(f["costo_mensual"] for f in suscripciones),
        "suscripciones_anual": sum(f["costo_mensual"] for f in suscripciones) * 12,
        "num_suscripciones": len(suscripciones),
    }


def detectar(sesion: Session) -> list[dict[str, Any]]:
    """Series del historial que parecen recurrentes y aún no lo están."""
    filas = sesion.execute(
        select(
            Transaccion.fecha,
            Transaccion.descripcion,
            Transaccion.monto,
            Transaccion.cuenta_id,
            Transaccion.categoria_id,
        )
        .join(Categoria, Categoria.id == Transaccion.categoria_id)
        .where(
            Transaccion.estado == "confirmada",
            Categoria.grupo.not_in(("transferencia", "ajuste", "financiacion")),
        )
    ).all()
    pagos = [
        dom.Pago(date.fromisoformat(f.fecha[:10]), f.descripcion, f.monto, f.cuenta_id, f.categoria_id) for f in filas
    ]
    ya = {normalizar(n) for n in sesion.scalars(select(Recurrente.nombre))}
    salida = []
    for d in dom.detectar(pagos, _hoy()):
        if normalizar(d.descripcion) in ya:
            continue
        categoria = sesion.get(Categoria, d.categoria_id) if d.categoria_id else None
        salida.append(
            {
                "descripcion": d.descripcion,
                "frecuencia": d.frecuencia,
                "monto": d.monto,
                "dia": d.dia,
                "cuenta_id": d.cuenta_id,
                "categoria_id": d.categoria_id,
                "categoria_ruta": ruta_categoria(categoria) if categoria else None,
                "grupo": categoria.grupo if categoria else None,
                "veces": d.veces,
                "ultima": d.ultima.isoformat(),
                "proxima": d.proxima.isoformat(),
                "costo_mensual": dom.costo_mensual(d.monto, d.frecuencia),
            }
        )
    return salida


# ---------- Calendario ----------
def calendario(sesion: Session, dias: int = 45) -> dict[str, Any]:
    """Próximos pagos y cobros (programadas, cuotas de préstamos personales) con el saldo proyectado
    de las cuentas líquidas. Las programadas vencidas (hasta 60 días) se listan aparte."""
    hoy = _hoy()
    hasta = hoy + timedelta(days=dias)
    cuentas = consultas.saldos_cuentas(sesion)
    liquidas = {c["id"]: c for c in consultas.en_total(cuentas)}
    eventos: list[dict[str, Any]] = []
    vencidos: list[dict[str, Any]] = []
    pendientes = sesion.scalars(
        select(Transaccion)
        .options(joinedload(Transaccion.cuenta), joinedload(Transaccion.categoria).joinedload(Categoria.padre))
        .where(
            Transaccion.estado == "pendiente",
            Transaccion.fecha >= (hoy - timedelta(days=_DIAS_VENCIDO_MAX)).isoformat(),
            Transaccion.fecha < (hasta + timedelta(days=1)).isoformat(),
        )
        .order_by(Transaccion.fecha, Transaccion.id)
    ).unique()
    for tx in pendientes:
        evento: dict[str, Any] = {
            "tipo": "programada",
            "id": tx.id,
            "fecha": tx.fecha[:10],
            "descripcion": tx.descripcion or (tx.categoria.nombre if tx.categoria else "Programada"),
            "monto": tx.monto,
            "cuenta_id": tx.cuenta_id,
            "cuenta": tx.cuenta.nombre,
            "categoria_ruta": ruta_categoria(tx.categoria) if tx.categoria else None,
            "grupo": tx.categoria.grupo if tx.categoria else None,
            "recurrente_id": tx.recurrente_id,
        }
        evento["dias"] = (date.fromisoformat(evento["fecha"]) - hoy).days
        (vencidos if evento["fecha"] < hoy.isoformat() else eventos).append(evento)
    for p in consultas_prestamos.listar(sesion, "activo"):
        signo = 1 if p["direccion"] == "presto_yo" else -1
        for c in p["cuotas_por_pagar"]:
            if c["fecha"] > hasta.isoformat():
                continue
            evento = {
                "tipo": "prestamo",
                "id": p["id"],
                "fecha": c["fecha"],
                "descripcion": f"{'Cobro a' if signo > 0 else 'Pago a'} {p['persona']} · cuota {c['numero']}",
                "monto": signo * c["monto"],
                "cuenta_id": None,  # se cobra o paga en cualquier cuenta: solo afecta el total
                "cuenta": None,
                "categoria_ruta": None,
                "grupo": "prestamos_personales",
                "recurrente_id": None,
                "dias": (date.fromisoformat(c["fecha"]) - hoy).days,
            }
            (vencidos if c["fecha"] < hoy.isoformat() else eventos).append(evento)
    eventos.sort(key=lambda e: (e["fecha"], e["monto"]))

    saldo = {i: c["saldo"] for i, c in liquidas.items()}
    total = sum(saldo.values())
    minimo = {"saldo": total, "fecha": hoy.isoformat()}
    primer_negativo: dict[str, Any] | None = {"saldo": total, "fecha": hoy.isoformat()} if total < 0 else None
    for e in eventos:
        if e["cuenta_id"] in saldo:
            saldo[e["cuenta_id"]] += e["monto"]
        total += e["monto"]
        e["saldo_total"] = total
        e["saldo_cuenta"] = saldo.get(e["cuenta_id"]) if e["cuenta_id"] is not None else None
        if total < minimo["saldo"]:
            minimo = {"saldo": total, "fecha": e["fecha"]}
        if total < 0 and primer_negativo is None:
            primer_negativo = {"saldo": total, "fecha": e["fecha"]}
    return {
        "desde": hoy.isoformat(),
        "hasta": hasta.isoformat(),
        "saldo_inicial": sum(c["saldo"] for c in liquidas.values()),
        "saldo_final": total,
        "minimo": minimo,
        "primer_negativo": primer_negativo,  # el día en que el saldo total cae bajo cero (lo usan tarjeta y alerta)
        "eventos": eventos,
        "vencidos": sorted(vencidos, key=lambda e: e["fecha"]),
        "por_cuenta": [
            {"id": i, "nombre": liquidas[i]["nombre"], "inicial": liquidas[i]["saldo"], "final": s}
            for i, s in saldo.items()
        ],
    }


# ---------- Metas ----------
def _ritmo_ahorro(sesion: Session, cuentas: list[int], categorias: list[int], hoy: date) -> int:
    """Lo que creció lo ahorrado al mes, en promedio de los últimos 3 meses (centavos)."""
    desde = (hoy - timedelta(days=90)).isoformat()
    if cuentas:
        total = sesion.scalar(
            select(func.coalesce(func.sum(Transaccion.monto), 0)).where(
                Transaccion.estado == "confirmada", Transaccion.cuenta_id.in_(cuentas), Transaccion.fecha >= desde
            )
        )
        return round(int(total or 0) / 3)
    return round(_salidas(sesion, categorias, [], desde) / 3) if categorias else 0


def _ritmo_deuda(sesion: Session, hoy: date) -> int:
    """Capital pagado al mes en los últimos 3 meses (cuotas y abonos)."""
    desde = (hoy - timedelta(days=90)).isoformat()
    total = sesion.scalar(
        select(func.coalesce(func.sum(CreditoPago.capital), 0))
        .join(Transaccion, Transaccion.id == CreditoPago.transaccion_id)
        .where(Transaccion.fecha >= desde)
    )
    return round(int(total or 0) / 3)


_GRUPOS_SALIDA = ("gasto_vida", "servicio_deuda", "apuestas", "ahorro_inversion")


def _con_hijos(ids: list[int]) -> Any:
    return select(Categoria.id).where(Categoria.id.in_(ids) | Categoria.padre_id.in_(ids))


def _salidas(sesion: Session, categorias: list[int], cuentas: list[int], desde: str, hasta: str | None = None) -> int:
    """Salida neta en esas categorías (con subcategorías) o, si no hay categorías, el gasto desde esas cuentas."""
    q = select(func.coalesce(func.sum(Transaccion.monto), 0)).where(
        Transaccion.estado == "confirmada", Transaccion.fecha >= desde
    )
    if hasta:
        q = q.where(Transaccion.fecha < hasta)
    if categorias:
        q = q.where(Transaccion.categoria_id.in_(_con_hijos(categorias)))
    else:
        q = q.join(Categoria, Categoria.id == Transaccion.categoria_id).where(
            Transaccion.cuenta_id.in_(cuentas), Categoria.grupo.in_(_GRUPOS_SALIDA)
        )
    return -int(sesion.scalar(q) or 0)


def _ultima_salida(sesion: Session, categorias: list[int], cuentas: list[int]) -> str | None:
    q = select(Transaccion.fecha).where(Transaccion.estado == "confirmada", Transaccion.monto < 0)
    if categorias:
        q = q.where(Transaccion.categoria_id.in_(_con_hijos(categorias)))
    else:
        q = q.join(Categoria, Categoria.id == Transaccion.categoria_id).where(
            Transaccion.cuenta_id.in_(cuentas), Categoria.grupo.in_(_GRUPOS_SALIDA)
        )
    return sesion.scalar(q.order_by(Transaccion.fecha.desc()).limit(1))


def objetivos(sesion: Session, m: Meta) -> tuple[list[int], list[int]]:
    """Cuentas y categorías que rastrea la meta (con lo antiguo de un solo campo como respaldo)."""
    filas = sesion.scalars(select(MetaObjetivo).where(MetaObjetivo.meta_id == m.id)).all()
    cuentas = [f.cuenta_id for f in filas if f.cuenta_id] or ([m.cuenta_id] if m.cuenta_id else [])
    categorias = [f.categoria_id for f in filas if f.categoria_id] or ([m.categoria_id] if m.categoria_id else [])
    return cuentas, categorias


def deuda_total(sesion: Session) -> int:
    return sum(c["saldo"] for c in consultas.resumen_creditos(sesion))


def metas(sesion: Session) -> list[dict[str, Any]]:
    hoy = _hoy()
    mes = hoy.isoformat()[:7]
    saldos = {c["id"]: c["saldo"] for c in consultas.saldos_cuentas(sesion)}
    salida = []
    for m in sesion.scalars(
        select(Meta)
        .options(joinedload(Meta.categoria).joinedload(Categoria.padre), joinedload(Meta.cuenta))
        .order_by(Meta.id)
    ):
        fila: dict[str, Any] = {
            "id": m.id,
            "nombre": m.nombre,
            "tipo": m.tipo,
            "objetivo": m.objetivo,
            "estado": m.estado,
            "fecha_objetivo": m.fecha_objetivo,
            "categoria_id": m.categoria_id,
            "categoria_ruta": ruta_categoria(m.categoria) if m.categoria else None,
            "cuenta_id": m.cuenta_id,
            "cuenta": m.cuenta.nombre if m.cuenta else None,
            "creado_en": m.creado_en[:10],
            "cumplida_en": m.cumplida_en[:10] if m.cumplida_en else None,
            "dias_restantes": (date.fromisoformat(m.fecha_objetivo) - hoy).days if m.fecha_objetivo else None,
            "fecha_prevista": None,
        }
        cuentas, categorias = objetivos(sesion, m)
        fila["cuenta_ids"], fila["categoria_ids"] = cuentas, categorias
        fila["rastrea"] = [
            *(c["nombre"] for c in consultas.saldos_cuentas(sesion) if c["id"] in cuentas),
            *(" › ".join(ruta_categoria(c)[1:]) for c in (sesion.get(Categoria, i) for i in categorias) if c),
        ]
        if m.tipo == "ahorro":
            # cuentas: lo que hay en ellas · categorías: lo aportado desde que creaste la meta
            actual = (
                sum(saldos.get(i, 0) for i in cuentas)
                if cuentas
                else _salidas(sesion, categorias, [], m.creado_en[:10])
                if categorias
                else 0
            )
            base = (m.base or 0) if cuentas else 0
            # Con signo: negativo si hoy hay menos que al crear la meta (se está retrocediendo).
            avance = (actual - base) / (m.objetivo - base) if m.objetivo and m.objetivo != base else 0.0
            ritmo = _ritmo_ahorro(sesion, cuentas, categorias, hoy)
            fila |= {"actual": actual, "base": base, "progreso": round(avance, 4), "ritmo_mensual": ritmo}
            if ritmo > 0 and m.objetivo and actual < m.objetivo:
                fila["fecha_prevista"] = (hoy + timedelta(days=round((m.objetivo - actual) / ritmo * 30.4))).isoformat()
            if m.fecha_objetivo and m.objetivo:
                meses = max(1, (date.fromisoformat(m.fecha_objetivo) - hoy).days / 30.4)
                fila["aporte_mensual"] = max(0, round((m.objetivo - actual) / meses))
        elif m.tipo == "deuda":
            actual = deuda_total(sesion)
            base = m.base or actual
            ritmo = _ritmo_deuda(sesion, hoy)
            fila |= {
                "actual": actual,
                "base": base,
                "progreso": round(1 - actual / base, 4) if base else 1.0,  # negativo si la deuda creció
                "ritmo_mensual": ritmo,
            }
            if ritmo > 0 and actual > 0:
                fila["fecha_prevista"] = (hoy + timedelta(days=round(actual / ritmo * 30.4))).isoformat()
        else:  # tope_gasto y habito: el gasto del mes contra el tope (hábito: tope 0 y racha)
            gastado = _salidas(sesion, categorias, cuentas, f"{mes}-01", f"{mes}-99") if (categorias or cuentas) else 0
            tope = m.objetivo or 0
            fila |= {
                "actual": max(0, gastado),
                "mes": mes,
                "progreso": (max(0, gastado) / tope) if tope else (1.0 if gastado > 0 else 0.0),
                "excedido": gastado > tope,
            }
            if m.tipo == "habito" and (categorias or cuentas):
                ultima = _ultima_salida(sesion, categorias, cuentas)
                fila["racha_dias"] = (hoy - date.fromisoformat(ultima[:10])).days if ultima else None
                fila["ultima"] = ultima[:10] if ultima else None
        salida.append(fila)
    return salida


# ---------- Alertas ----------
def alertas(sesion: Session) -> list[dict[str, Any]]:
    """Lo que merece atención hoy, de lo más urgente a lo informativo. Nada se oculta ni se juzga."""
    hoy = _hoy()
    salida: list[dict[str, Any]] = []
    cal = calendario(sesion, 7)
    for e in cal["vencidos"]:
        salida.append(
            {
                "nivel": "critica",
                "tipo": "vencido",
                "titulo": f"{e['descripcion']}: vencido el {_fecha_corta(e['fecha'])}",
                "monto": e["monto"],
                "enlace": "/recurrentes" if e["tipo"] == "programada" else "/prestamos",
            }
        )
    proyeccion = calendario(sesion)["primer_negativo"]
    if proyeccion is not None:
        salida.append(
            {
                "nivel": "critica",
                "tipo": "saldo",
                "titulo": f"Con lo programado, tu saldo queda en negativo el {_fecha_corta(proyeccion['fecha'])}",
                "monto": proyeccion["saldo"],
                "enlace": "/recurrentes",
            }
        )
    for e in cal["eventos"]:
        if e["fecha"] <= (hoy + timedelta(days=3)).isoformat() and e["monto"] < 0:
            dias = (date.fromisoformat(e["fecha"]) - hoy).days
            cuando = "hoy" if dias == 0 else "mañana" if dias == 1 else f"en {dias} días"
            salida.append(
                {
                    "nivel": "aviso",
                    "tipo": "pago_proximo",
                    "titulo": f"{e['descripcion']} {cuando}",
                    "monto": e["monto"],
                    "enlace": "/recurrentes",
                }
            )
    pres = consultas_presupuesto.presupuesto_mes(sesion, hoy.isoformat()[:7])
    for f in pres["filas"]:
        if not f["asignado"]:
            continue
        uso = f["gastado"] / f["asignado"]
        if uso >= 0.8:
            nombre = f["nombre"]
            salida.append(
                {
                    "nivel": "critica" if uso >= 1 else "aviso",
                    "tipo": "presupuesto",
                    "titulo": f"{nombre}: usaste el {round(uso * 100)} % del presupuesto",
                    "monto": f["asignado"] - f["gastado"],
                    "enlace": "/presupuesto",
                }
            )
    for m in (x for x in metas(sesion) if x["estado"] == "activa"):
        if m["tipo"] in ("tope_gasto", "habito") and m.get("excedido"):
            salida.append(
                {
                    "nivel": "aviso",
                    "tipo": "meta",
                    "titulo": f"{m['nombre']}: pasaste el tope del mes",
                    "monto": -m["actual"],
                    "enlace": "/metas",
                }
            )
    orden = {"critica": 0, "aviso": 1, "info": 2}
    return sorted(salida, key=lambda a: orden[a["nivel"]])
