"""Consultas de solo lectura (CQRS ligero): devuelven diccionarios listos para los DTO."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta
from typing import Any

from sqlalchemy import Select, and_, func, or_, select, text
from sqlalchemy.orm import Session, joinedload

from finanzas.dominio.fechas import hoy_bogota
from finanzas.dominio.grupos import GRUPOS_NEUTROS, Grupo
from finanzas.infra.modelos import Categoria, Credito, CreditoExtracto, Transaccion
from finanzas.infra.repositorios import ruta_categoria

TIPOS_NO_LIQUIDOS = ("credito", "por_cobrar", "por_pagar")


def saldos_cuentas(sesion: Session) -> list[dict[str, Any]]:
    filas = sesion.execute(
        text(
            "SELECT v.cuenta_id, v.nombre, v.tipo, v.saldo, c.institucion, c.color, c.icono, c.orden, "
            "c.incluir_en_total, c.saldo_inicial "
            "FROM v_saldo_cuenta v JOIN cuenta c ON c.id = v.cuenta_id "
            "WHERE c.archivado_en IS NULL ORDER BY c.orden, c.nombre"
        )
    ).mappings()
    return [
        {
            "id": f["cuenta_id"],
            "nombre": f["nombre"],
            "tipo": f["tipo"],
            "saldo": int(f["saldo"]),
            "institucion": f["institucion"],
            "color": f["color"],
            "icono": f["icono"],
            "incluir_en_total": bool(f["incluir_en_total"]),
            "saldo_inicial": int(f["saldo_inicial"]),
        }
        for f in filas
    ]


def en_total(cuentas: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Cuentas líquidas que el usuario incluye en su saldo total (punto 15 de la fase 8)."""
    return [c for c in cuentas if c["tipo"] not in TIPOS_NO_LIQUIDOS and c["incluir_en_total"]]


@dataclass
class FiltroTransacciones:
    desde: str | None = None
    hasta: str | None = None
    cuenta_id: int | None = None
    grupo: str | None = None
    categoria_id: int | None = None
    texto: str | None = None
    estado: str | None = None
    cursor: str | None = None
    limite: int = 50


def _aplicar_filtros(consulta: Select[Any], f: FiltroTransacciones) -> Select[Any]:
    if f.desde:
        consulta = consulta.where(Transaccion.fecha >= f.desde)
    if f.hasta:
        dia_siguiente = (date.fromisoformat(f.hasta[:10]) + timedelta(days=1)).isoformat()
        consulta = consulta.where(Transaccion.fecha < dia_siguiente)
    if f.cuenta_id:
        consulta = consulta.where(Transaccion.cuenta_id == f.cuenta_id)
    if f.estado:
        consulta = consulta.where(Transaccion.estado == f.estado)
    if f.grupo:
        consulta = consulta.join(Categoria, Categoria.id == Transaccion.categoria_id).where(Categoria.grupo == f.grupo)
    if f.categoria_id:
        hijos = select(Categoria.id).where(or_(Categoria.id == f.categoria_id, Categoria.padre_id == f.categoria_id))
        consulta = consulta.where(Transaccion.categoria_id.in_(hijos))
    if f.texto:
        patron = f"%{f.texto.strip()}%"
        consulta = consulta.where(or_(Transaccion.descripcion.ilike(patron), Transaccion.nota.ilike(patron)))
    if f.cursor:
        fecha, _, ident = f.cursor.rpartition("|")
        consulta = consulta.where(
            or_(Transaccion.fecha < fecha, and_(Transaccion.fecha == fecha, Transaccion.id < int(ident)))
        )
    return consulta


def a_dict(tx: Transaccion) -> dict[str, Any]:
    ruta = ruta_categoria(tx.categoria)
    return {
        "id": tx.id,
        "cuenta_id": tx.cuenta_id,
        "cuenta": tx.cuenta.nombre,
        "fecha": tx.fecha,
        "monto": tx.monto,
        "categoria_id": tx.categoria_id,
        "grupo": tx.categoria.grupo if tx.categoria else None,
        "categoria_ruta": ruta,
        "descripcion": tx.descripcion,
        "nota": tx.nota,
        "estado": tx.estado,
        "contraparte": tx.contraparte.nombre if tx.contraparte else None,
        "transferencia_id": tx.transferencia_id,
        "credito_id": tx.credito_id,
        "prestamo_id": tx.prestamo_id,
        "recurrente_id": tx.recurrente_id,
        "etiquetas": [e.nombre for e in tx.etiquetas],
        "moneda_original": tx.moneda_original,
        "monto_original": tx.monto_original,
        "trm": tx.trm,
    }


def listar_transacciones(sesion: Session, f: FiltroTransacciones) -> dict[str, Any]:
    consulta = select(Transaccion).options(
        joinedload(Transaccion.cuenta),
        joinedload(Transaccion.categoria).joinedload(Categoria.padre),
        joinedload(Transaccion.contraparte),
    )
    consulta = _aplicar_filtros(consulta, f).order_by(Transaccion.fecha.desc(), Transaccion.id.desc())
    filas = list(sesion.scalars(consulta.limit(f.limite + 1)).unique())
    siguiente = None
    if len(filas) > f.limite:
        filas = filas[: f.limite]
        siguiente = f"{filas[-1].fecha}|{filas[-1].id}"
    return {"items": [a_dict(tx) for tx in filas], "siguiente": siguiente}


def arbol_categorias(sesion: Session) -> list[dict[str, Any]]:
    todas = list(sesion.scalars(select(Categoria).where(Categoria.archivado_en.is_(None)).order_by(Categoria.nombre)))
    por_padre: dict[int | None, list[Categoria]] = {}
    for cat in todas:
        por_padre.setdefault(cat.padre_id, []).append(cat)

    def nodo(cat: Categoria) -> dict[str, Any]:
        return {
            "id": cat.id,
            "nombre": cat.nombre,
            "nivel": cat.nivel,
            "grupo": cat.grupo,
            "es_fijo": cat.es_fijo,
            "icono": cat.icono,
            "color": cat.color,
            "hijos": [nodo(h) for h in por_padre.get(cat.id, [])],
        }

    orden = {g.value: i for i, g in enumerate(Grupo)}
    raices = sorted(por_padre.get(None, []), key=lambda c: orden.get(c.grupo, 99))
    return [nodo(r) for r in raices]


def resumen_mensual(sesion: Session, meses: int = 6) -> list[dict[str, Any]]:
    """Ingresos, gasto de vida, cuotas, apuestas y flujo operativo por mes."""
    filas = sesion.execute(
        text(
            "SELECT mes, grupo, SUM(total) AS total FROM v_movimiento_mensual GROUP BY mes, grupo "
            "UNION ALL "  # los cobros en reclamo no cuentan como gasto mientras se resuelven
            "SELECT substr(t.fecha, 1, 7), c.grupo, -SUM(t.monto) FROM transaccion t "
            f"JOIN categoria c ON c.id = t.categoria_id WHERE t.estado = 'confirmada' AND {_EN_RECLAMO} "
            "GROUP BY 1, 2 "
            "UNION ALL "  # lo que aún no tiene categoría también cuenta, igual que en los reportes
            "SELECT substr(fecha, 1, 7), CASE WHEN monto > 0 THEN 'ingreso' ELSE 'gasto_vida' END, SUM(monto) "
            "FROM transaccion WHERE estado = 'confirmada' AND categoria_id IS NULL GROUP BY 1, 2"
        )
    ).mappings()
    por_mes: dict[str, dict[str, int]] = {}
    for f in filas:
        grupos = por_mes.setdefault(f["mes"], {})
        grupos[f["grupo"]] = grupos.get(f["grupo"], 0) + int(f["total"])
    # Apuestas por movimiento: lo apostado cuenta en gastos y lo ganado en ingresos.
    apuestas = {
        f["mes"]: (int(f["ganado"]), int(f["apostado"]))
        for f in sesion.execute(
            text(
                "SELECT substr(t.fecha, 1, 7) AS mes, "
                "SUM(CASE WHEN t.monto > 0 THEN t.monto ELSE 0 END) AS ganado, "
                "SUM(CASE WHEN t.monto < 0 THEN -t.monto ELSE 0 END) AS apostado "
                "FROM transaccion t JOIN categoria c ON c.id = t.categoria_id "
                f"WHERE t.estado = 'confirmada' AND c.grupo = 'apuestas' AND NOT {_EN_RECLAMO} GROUP BY 1"
            )
        ).mappings()
    }
    resultado = []
    for mes in sorted(por_mes)[-meses:]:
        g = por_mes[mes]
        operativo = sum(v for k, v in g.items() if Grupo(k) not in GRUPOS_NEUTROS)
        ganado, apostado = apuestas.get(mes, (0, 0))
        resultado.append(
            {
                "mes": mes,
                "ingresos": g.get(Grupo.INGRESO.value, 0),
                "ingresos_total": g.get(Grupo.INGRESO.value, 0) + ganado,
                "gastos_total": apostado
                - g.get(Grupo.GASTO_VIDA.value, 0)
                - g.get(Grupo.SERVICIO_DEUDA.value, 0)
                - g.get(Grupo.AHORRO_INVERSION.value, 0),
                "gasto_vida": -g.get(Grupo.GASTO_VIDA.value, 0),
                "servicio_deuda": -g.get(Grupo.SERVICIO_DEUDA.value, 0),
                "apuestas_neto": g.get(Grupo.APUESTAS.value, 0),
                "flujo_operativo": operativo,
            }
        )
    return resultado


def resumen_creditos(sesion: Session) -> list[dict[str, Any]]:
    from finanzas.infra.consultas_creditos import _saldo_actual

    activos = select(Credito).where(Credito.estado == "activo").order_by(Credito.tasa_ea.desc())
    creditos = list(sesion.scalars(activos))
    salida = []
    for prioridad, c in enumerate(creditos, 1):
        ultimo = sesion.scalar(
            select(CreditoExtracto)
            .where(CreditoExtracto.credito_id == c.id)
            .order_by(CreditoExtracto.fecha_corte.desc())
        )
        saldo, fecha_saldo = _saldo_actual(sesion, c)
        salida.append(
            {
                "id": c.id,
                "nombre": c.nombre,
                "entidad": c.entidad,
                "numero": c.numero,
                "tasa_ea": c.tasa_ea,
                "cuota": c.cuota,
                "seguro_mensual": c.seguro_mensual,
                "dia_pago": c.dia_pago,
                # El último pago o extracto, lo más reciente: la misma cifra que muestra Deudas.
                "saldo": saldo,
                "fecha_saldo": fecha_saldo,
                "cuotas_pendientes": ultimo.cuotas_pendientes if ultimo else c.plazo_meses,
                "prioridad_avalancha": prioridad,
            }
        )
    return salida


def mes_referencia(sesion: Session) -> str:
    """Último mes con movimientos confirmados (YYYY-MM)."""
    ultimo = sesion.scalar(
        select(Transaccion.fecha).where(Transaccion.estado == "confirmada").order_by(Transaccion.fecha.desc()).limit(1)
    )
    return ultimo[:7] if ultimo else hoy_bogota().isoformat()[:7]


_EN_RECLAMO = (
    "t.id IN (SELECT te.transaccion_id FROM transaccion_etiqueta te "
    "JOIN etiqueta e ON e.id = te.etiqueta_id WHERE e.nombre = 'reclamo')"
)


def gasto_por_categoria(sesion: Session, mes: str) -> list[dict[str, Any]]:
    """Gasto de vida del mes por categoría (nivel 2). Excluye cobros en reclamo."""
    filas = sesion.execute(
        text(
            f"""
            SELECT CASE WHEN c.nivel = 3 THEN p.nombre ELSE c.nombre END AS categoria,
                   -SUM(t.monto) AS total, COUNT(*) AS n
            FROM transaccion t
            JOIN categoria c ON c.id = t.categoria_id
            LEFT JOIN categoria p ON p.id = c.padre_id
            WHERE t.estado = 'confirmada' AND c.grupo = 'gasto_vida' AND substr(t.fecha, 1, 7) = :mes
              AND NOT {_EN_RECLAMO}
            GROUP BY 1 ORDER BY total DESC
            """
        ),
        {"mes": mes},
    ).mappings()
    return [{"categoria": f["categoria"], "total": int(f["total"]), "n": int(f["n"])} for f in filas]


def proximos_pagos(sesion: Session, limite: int = 8) -> list[dict[str, Any]]:
    consulta = (
        select(Transaccion)
        .options(joinedload(Transaccion.cuenta), joinedload(Transaccion.categoria).joinedload(Categoria.padre))
        .where(Transaccion.estado == "pendiente", Transaccion.fecha >= hoy_bogota().isoformat())
        .order_by(Transaccion.fecha.asc(), Transaccion.id.asc())
        .limit(limite)
    )
    hoy = hoy_bogota()
    return [
        {**a_dict(tx), "dias": (date.fromisoformat(tx.fecha[:10]) - hoy).days}
        for tx in sesion.scalars(consulta).unique()
    ]


def cuotas_proximas(sesion: Session, dias: int = 30) -> int:
    """Total de pagos de deuda programados en los próximos N días (centavos, positivo)."""
    hoy = hoy_bogota()
    total = sesion.scalar(
        select(func.coalesce(func.sum(Transaccion.monto), 0))
        .join(Categoria, Categoria.id == Transaccion.categoria_id)
        .where(
            Transaccion.estado == "pendiente",
            Categoria.grupo == "servicio_deuda",
            Transaccion.fecha >= hoy.isoformat(),
            Transaccion.fecha < (hoy + timedelta(days=dias + 1)).isoformat(),
        )
    )
    return -int(total or 0)


def sugerencias(sesion: Session, texto: str, limite: int = 6) -> list[dict[str, Any]]:
    """Descripciones previas que coinciden con lo escrito, con su categoría, cuenta y monto habituales."""
    patron = texto.strip().lower()
    if not patron:
        return []
    consulta = (
        select(Transaccion)
        .options(joinedload(Transaccion.categoria).joinedload(Categoria.padre), joinedload(Transaccion.cuenta))
        .where(
            Transaccion.estado == "confirmada",
            Transaccion.descripcion != "",
            or_(Transaccion.descripcion.ilike(f"{patron}%"), Transaccion.descripcion.ilike(f"% {patron}%")),
        )
        .order_by(Transaccion.fecha.desc())
        .limit(400)
    )
    grupos: dict[str, dict[str, Any]] = {}
    for tx in sesion.scalars(consulta).unique():
        clave = tx.descripcion.strip().lower()
        if clave not in grupos:  # la más reciente define categoría, cuenta y monto
            grupos[clave] = {
                "descripcion": tx.descripcion.strip(),
                "veces": 0,
                "monto": tx.monto,
                "cuenta_id": tx.cuenta_id,
                "cuenta": tx.cuenta.nombre,
                "categoria_id": tx.categoria_id,
                "categoria_ruta": ruta_categoria(tx.categoria),
            }
        grupos[clave]["veces"] += 1
    return sorted(grupos.values(), key=lambda g: (-g["veces"], g["descripcion"]))[:limite]


def categorias_frecuentes(sesion: Session, signo: int, limite: int = 8) -> list[dict[str, Any]]:
    """Categorías más usadas en los últimos 90 días para gastos (signo -1) o ingresos (+1)."""
    desde = (date.fromisoformat(mes_referencia(sesion) + "-01") - timedelta(days=90)).isoformat()
    filtro_signo = Transaccion.monto < 0 if signo < 0 else Transaccion.monto > 0
    filas = sesion.execute(
        select(Transaccion.categoria_id, func.count().label("n"))
        .join(Categoria, Categoria.id == Transaccion.categoria_id)
        .where(
            Transaccion.estado == "confirmada",
            Transaccion.fecha >= desde,
            filtro_signo,
            Categoria.grupo.not_in(["transferencia", "ajuste", "financiacion"]),
        )
        .group_by(Transaccion.categoria_id)
        .order_by(func.count().desc())
        .limit(limite)
    ).all()
    salida = []
    for categoria_id, n in filas:
        categoria = sesion.get(Categoria, categoria_id)
        salida.append({"categoria_id": categoria_id, "ruta": ruta_categoria(categoria), "veces": int(n)})
    return salida


def dashboard(sesion: Session) -> dict[str, Any]:
    from finanzas.infra.consultas_activos import patrimonio

    cuentas = saldos_cuentas(sesion)
    creditos = resumen_creditos(sesion)
    mes = mes_referencia(sesion)
    flujo = resumen_mensual(sesion)
    return {
        "mes": mes,
        "saldo_total": sum(c["saldo"] for c in en_total(cuentas)),
        "cuentas": [c for c in cuentas if c["tipo"] not in TIPOS_NO_LIQUIDOS],
        "deuda_total": sum(c["saldo"] for c in creditos),
        "cuotas_mes": sum(c["cuota"] for c in creditos),
        "creditos": creditos,
        "flujo": flujo,
        "mes_actual": next((m for m in flujo if m["mes"] == mes), None),
        "gasto_categorias": gasto_por_categoria(sesion, mes),
        "proximos_pagos": proximos_pagos(sesion),
        "cuotas_proximas": cuotas_proximas(sesion),
        "patrimonio": patrimonio(sesion),
    }
