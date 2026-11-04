"""Casos de uso de créditos bancarios: registrar un extracto (la fuente de verdad del saldo)."""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from datetime import date

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from finanzas.dominio.creditos import ExtractoCredito, PagoCredito, desglosar_pagos, tasa_mensual
from finanzas.dominio.errores import ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.dominio.grupos import Grupo
from finanzas.dominio.prestamos import fecha_cuota
from finanzas.infra.modelos import (
    Categoria,
    Credito,
    CreditoExtracto,
    CreditoPago,
    HuellaFusionada,
    MetaObjetivo,
    PresupuestoGrupoCategoria,
    Recurrente,
    Regla,
    Transaccion,
)
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo

INVALIDA = ("creditos", "dashboard", "reportes")


@dataclass
class DatosExtracto:
    fecha_corte: str
    saldo: int
    intereses: int = 0
    abono_capital: int = 0
    seguros: int = 0
    cuotas_pendientes: int = 0
    archivo: str | None = None


def registrar_extracto(uow: UnidadDeTrabajo, credito_id: int, d: DatosExtracto) -> CreditoExtracto:
    """Crea o reemplaza el extracto de esa fecha de corte; la proyección se recalcula desde aquí."""
    credito = uow.sesion.get(Credito, credito_id)
    if credito is None:
        raise NoEncontrado(f"El crédito {credito_id} no existe")
    try:
        date.fromisoformat(d.fecha_corte)
    except ValueError as exc:
        raise ErrorValidacion("La fecha de corte debe ser AAAA-MM-DD") from exc
    if d.saldo < 0 or d.cuotas_pendientes < 0:
        raise ErrorValidacion("El saldo y las cuotas pendientes no pueden ser negativos")
    extracto = uow.sesion.scalar(
        select(CreditoExtracto).where(
            CreditoExtracto.credito_id == credito_id, CreditoExtracto.fecha_corte == d.fecha_corte
        )
    )
    if extracto is None:
        extracto = CreditoExtracto(
            credito_id=credito_id,
            fecha_corte=d.fecha_corte,
            saldo=d.saldo,
            intereses=0,
            abono_capital=0,
            seguros=0,
            cuotas_pendientes=0,
        )
        uow.sesion.add(extracto)
    for campo in ("saldo", "intereses", "abono_capital", "seguros", "cuotas_pendientes", "archivo"):
        setattr(extracto, campo, getattr(d, campo))
    if d.saldo == 0:
        credito.estado = "pagado"
    recalcular(uow.sesion, credito_id)  # el extracto corrige el desglose de la cuota de ese corte
    uow.registrar(DominioCambio(INVALIDA, "extracto", (credito_id,)))
    return extracto


# ---------- Fase 7: pagos ligados al crédito, creación y edición ----------
ABONO = "Abono a capital"


def credito_de_categoria(sesion: Session, categoria_id: int | None) -> Credito | None:
    """El crédito al que pertenece una categoría (la del crédito o una de sus subcategorías)."""
    if categoria_id is None:
        return None
    cat = sesion.get(Categoria, categoria_id)
    if cat is None or cat.grupo != "servicio_deuda":
        return None
    ids = {cat.id} | ({cat.padre_id} if cat.padre_id else set())
    return sesion.scalar(select(Credito).where(Credito.categoria_id.in_(ids)))


def recalcular(sesion: Session, credito_id: int) -> int:
    """Rehace el desglose (capital, interés, seguro) de todos los pagos confirmados del crédito.
    Devuelve el saldo actual."""
    c = sesion.get(Credito, credito_id)
    if c is None:
        return 0
    sesion.flush()
    txs = list(
        sesion.scalars(select(Transaccion).where(Transaccion.credito_id == c.id, Transaccion.estado == "confirmada"))
    )
    pagos = [
        PagoCredito(
            tx.id,
            tx.fecha[:10],
            abs(tx.monto),
            es_abono=bool(tx.categoria and tx.categoria.nombre == ABONO and tx.categoria.padre_id == c.categoria_id),
        )
        for tx in txs
    ]
    extractos = [
        ExtractoCredito(e.fecha_corte[:10], e.saldo, e.intereses, e.abono_capital, e.seguros)
        for e in sesion.scalars(select(CreditoExtracto).where(CreditoExtracto.credito_id == c.id))
    ]
    desgloses, saldo = desglosar_pagos(c.capital_inicial, c.tasa_ea, c.seguro_mensual, pagos, extractos)
    sesion.execute(delete(CreditoPago).where(CreditoPago.credito_id == c.id))
    for d in desgloses:
        sesion.add(
            CreditoPago(
                transaccion_id=d.ref,
                credito_id=c.id,
                tipo=d.tipo,
                capital=d.capital,
                interes=d.interes,
                seguro=d.seguro,
                saldo_despues=d.saldo_despues,
            )
        )
    if saldo <= 0 and pagos:
        c.estado = "pagado"
    return saldo


def sincronizar(sesion: Session, tx: Transaccion, credito_anterior: int | None = None) -> None:
    """Liga (o desliga) un movimiento a su crédito según la categoría y recalcula los afectados."""
    credito = credito_de_categoria(sesion, tx.categoria_id)
    tx.credito_id = credito.id if credito else None
    for ident in {credito_anterior, tx.credito_id} - {None}:
        recalcular(sesion, ident)  # type: ignore[arg-type]


@dataclass
class DatosCredito:
    nombre: str
    entidad: str
    fecha_desembolso: str
    capital_inicial: int
    monto_recibido: int
    tasa_ea: float
    plazo_meses: int
    cuota: int
    dia_pago: int
    seguro_mensual: int = 0
    cuenta_pago_id: int | None = None
    numero: str | None = None
    # Cuenta donde llegó el dinero: se registra el desembolso (no es ingreso, va a financiación).
    cuenta_desembolso_id: int | None = None


def _validar_credito(d: DatosCredito) -> None:
    if not d.nombre.strip() or not d.entidad.strip():
        raise ErrorValidacion("El crédito necesita nombre y entidad")
    if d.capital_inicial <= 0 or d.monto_recibido <= 0 or d.monto_recibido > d.capital_inicial:
        raise ErrorValidacion("El capital debe ser mayor que cero y no menor que lo recibido")
    if not 0 < d.tasa_ea < 3:
        raise ErrorValidacion("La tasa E.A. debe estar entre 0 y 300 %")
    if not 1 <= d.plazo_meses <= 600 or not 1 <= d.dia_pago <= 31:
        raise ErrorValidacion("Revisa el plazo (meses) y el día de pago")
    primer_interes = round(d.capital_inicial * tasa_mensual(d.tasa_ea))
    if d.cuota <= primer_interes + d.seguro_mensual:
        raise ErrorValidacion("La cuota no alcanza a cubrir el interés y el seguro del primer mes")
    try:
        date.fromisoformat(d.fecha_desembolso[:10])
    except ValueError as exc:
        raise ErrorValidacion("La fecha de desembolso debe ser AAAA-MM-DD") from exc


def _programar_cuota(sesion: Session, c: Credito) -> None:
    """Un recurrente mensual por crédito: sus cuotas salen en el calendario y al pagarlas recalculan."""
    from finanzas.servicios import recurrentes  # recurrentes importa transacciones, que importa este módulo

    r = sesion.scalar(select(Recurrente).where(Recurrente.credito_id == c.id))
    desembolso = date.fromisoformat(c.fecha_desembolso[:10])
    datos = recurrentes.DatosRecurrente(
        nombre=f"Cuota {c.nombre}",
        cuenta_id=c.cuenta_pago_id or recurrentes.cuenta_por_defecto(sesion),
        monto=-c.cuota,
        frecuencia="mensual",
        dia=c.dia_pago,
        inicio=fecha_cuota(desembolso, "mensual", 1).isoformat(),
        categoria_id=c.categoria_id,
    )
    if r is None:
        r = Recurrente(creado_en=ahora(), activo=True, credito_id=c.id, ancla="calendario")
        sesion.add(r)
    recurrentes.aplicar_datos(r, datos)
    sesion.flush()
    recurrentes.adoptar_pendientes(sesion, r)
    recurrentes.rehacer_futuras(sesion, r)


def crear(uow: UnidadDeTrabajo, d: DatosCredito) -> Credito:
    _validar_credito(d)
    if uow.sesion.scalar(select(Credito).where(Credito.nombre == d.nombre.strip())) is not None:
        raise ErrorValidacion(f"Ya existe un crédito llamado {d.nombre}")
    categoria = categoria_por_ruta(uow.sesion, Grupo.SERVICIO_DEUDA, d.nombre.strip(), None)
    categoria_por_ruta(uow.sesion, Grupo.SERVICIO_DEUDA, d.nombre.strip(), ABONO)
    datos = asdict(d)
    cuenta_desembolso = datos.pop("cuenta_desembolso_id")
    c = Credito(**datos, categoria_id=categoria.id, estado="activo")
    c.nombre = d.nombre.strip()
    uow.sesion.add(c)
    uow.sesion.flush()
    _sincronizar_desembolso(uow.sesion, c, cuenta_desembolso)
    _programar_cuota(uow.sesion, c)
    uow.registrar(DominioCambio(INVALIDA + ("recurrentes", "transacciones", "categorias"), "crear", (c.id,)))
    return c


def editar(uow: UnidadDeTrabajo, credito_id: int, d: DatosCredito) -> Credito:
    c = uow.sesion.get(Credito, credito_id)
    if c is None:
        raise NoEncontrado(f"El crédito {credito_id} no existe")
    _validar_credito(d)
    nombre_anterior = c.nombre
    datos = asdict(d)
    cuenta_desembolso = datos.pop("cuenta_desembolso_id")
    for campo, valor in datos.items():
        setattr(c, campo, valor.strip() if isinstance(valor, str) and campo in ("nombre", "entidad") else valor)
    _sincronizar_desembolso(uow.sesion, c, cuenta_desembolso)
    cat = uow.sesion.get(Categoria, c.categoria_id) if c.categoria_id else None
    if cat is not None and cat.nombre == nombre_anterior:  # solo si la categoría se llamaba igual que el crédito
        cat.nombre = c.nombre
    recalcular(uow.sesion, c.id)
    _programar_cuota(uow.sesion, c)
    uow.registrar(DominioCambio(INVALIDA + ("recurrentes", "transacciones", "categorias"), "editar", (c.id,)))
    return c


def _sincronizar_desembolso(sesion: Session, c: Credito, cuenta_id: int | None) -> None:
    """Crea o actualiza el desembolso: entra el monto recibido a la cuenta elegida, con fecha del desembolso."""
    tx = sesion.get(Transaccion, c.desembolso_id) if c.desembolso_id else None
    if tx is None and cuenta_id is None:
        return
    categoria = categoria_por_ruta(sesion, Grupo.FINANCIACION, "Desembolso de crédito", "Desembolso")
    if tx is None:
        tx = Transaccion(
            cuenta_id=cuenta_id,
            monto=c.monto_recibido,
            categoria_id=categoria.id,
            fecha=f"{c.fecha_desembolso[:10]}T00:00:00-05:00",
            descripcion=f"Desembolso {c.nombre}",
            estado="confirmada",
            creado_en=ahora(),
            actualizado_en=ahora(),
        )
        sesion.add(tx)
        sesion.flush()
        c.desembolso_id = tx.id
        return
    tx.monto = c.monto_recibido
    tx.fecha = f"{c.fecha_desembolso[:10]}{tx.fecha[10:]}"
    if cuenta_id is not None:
        tx.cuenta_id = cuenta_id
    tx.actualizado_en = ahora()


def _categoria_libre(sesion: Session, categoria_id: int) -> bool:
    """Nadie más usa la categoría: ni movimientos, ni presupuestos, ni metas, ni reglas."""
    ids = [categoria_id, *sesion.scalars(select(Categoria.id).where(Categoria.padre_id == categoria_id))]
    usos = (
        sesion.scalar(select(Transaccion.id).where(Transaccion.categoria_id.in_(ids)).limit(1)),
        sesion.scalar(select(Recurrente.id).where(Recurrente.categoria_id.in_(ids)).limit(1)),
        sesion.scalar(
            select(PresupuestoGrupoCategoria.categoria_id)
            .where(PresupuestoGrupoCategoria.categoria_id.in_(ids))
            .limit(1)
        ),
        sesion.scalar(select(MetaObjetivo.id).where(MetaObjetivo.categoria_id.in_(ids)).limit(1)),
    )
    if any(u is not None for u in usos):
        return False
    return not any(json.loads(r.acciones or "{}").get("categoria_id") in ids for r in sesion.scalars(select(Regla)))


def eliminar(uow: UnidadDeTrabajo, credito_id: int) -> dict[str, int]:
    """Borra el crédito y todo lo suyo: desembolso, cuotas pagadas y programadas, abonos, extractos,
    desglose, su recurrente y su categoría si nadie más la usa (fase 8, D6)."""
    sesion = uow.sesion
    c = sesion.get(Credito, credito_id)
    if c is None:
        raise NoEncontrado(f"El crédito {credito_id} no existe")
    recurrentes_ids = list(sesion.scalars(select(Recurrente.id).where(Recurrente.credito_id == c.id)))
    txs = list(
        sesion.scalars(
            select(Transaccion).where(
                (Transaccion.credito_id == c.id)
                | (Transaccion.id == c.desembolso_id)
                | (Transaccion.recurrente_id.in_(recurrentes_ids) & (Transaccion.estado == "pendiente"))
            )
        )
    )
    ids = [t.id for t in txs]
    c.desembolso_id = None
    sesion.flush()
    sesion.execute(delete(HuellaFusionada).where(HuellaFusionada.transaccion_id.in_(ids)))
    sesion.execute(delete(CreditoPago).where(CreditoPago.credito_id == c.id))
    sesion.execute(delete(CreditoExtracto).where(CreditoExtracto.credito_id == c.id))
    for t in txs:
        sesion.delete(t)
    sesion.execute(delete(Recurrente).where(Recurrente.id.in_(recurrentes_ids)))
    categoria_id = c.categoria_id
    sesion.delete(c)
    sesion.flush()
    if categoria_id is not None and _categoria_libre(sesion, categoria_id):
        sesion.execute(delete(Categoria).where(Categoria.padre_id == categoria_id))
        sesion.execute(delete(Categoria).where(Categoria.id == categoria_id))
    uow.registrar(
        DominioCambio(INVALIDA + ("recurrentes", "transacciones", "categorias", "cuentas"), "borrar", (credito_id,))
    )
    return {"movimientos": len(ids)}


def marcar_pagado(uow: UnidadDeTrabajo, credito_id: int) -> dict[str, int]:
    """Cierra el crédito aunque no llegue al 100 %: conserva lo pagado, quita las cuotas programadas y cancela
    su recurrente. Queda en el historial."""
    sesion = uow.sesion
    c = sesion.get(Credito, credito_id)
    if c is None:
        raise NoEncontrado(f"El crédito {credito_id} no existe")
    pendientes = list(
        sesion.scalars(select(Transaccion).where(Transaccion.credito_id == c.id, Transaccion.estado == "pendiente"))
    )
    for t in pendientes:
        sesion.delete(t)
    for r in sesion.scalars(select(Recurrente).where(Recurrente.credito_id == c.id)):
        r.activo = False
        r.cancelado_en = ahora()
        for t in sesion.scalars(
            select(Transaccion).where(Transaccion.recurrente_id == r.id, Transaccion.estado == "pendiente")
        ):
            sesion.delete(t)
    c.estado = "pagado"
    uow.registrar(DominioCambio(INVALIDA + ("recurrentes", "transacciones", "calendario"), "editar", (c.id,)))
    return {"programadas_quitadas": len(pendientes)}


def ahora() -> str:
    from datetime import datetime
    from zoneinfo import ZoneInfo

    return datetime.now(ZoneInfo("America/Bogota")).isoformat(timespec="seconds")
