"""Casos de uso de recurrentes (RF-RE): crear, editar, pausar y programar sus ocurrencias como
transacciones pendientes, que aparecen en el calendario y se confirman al pagar."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, timedelta

from sqlalchemy import select
from sqlalchemy.orm import Session

from finanzas.dominio import recurrentes as dom
from finanzas.dominio.clasificador import normalizar
from finanzas.dominio.errores import ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.modelos import Categoria, Recurrente, RecurrenteOmision, Transaccion
from finanzas.infra.repositorios import obtener_cuenta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import creditos
from finanzas.servicios.transacciones import ahora, hoy_bogota, normalizar_fecha

INVALIDA = ("recurrentes", "transacciones", "dashboard")
HORIZONTE_DIAS = 60


@dataclass
class DatosRecurrente:
    nombre: str
    cuenta_id: int
    monto: int
    frecuencia: dom.Frecuencia
    dia: int
    inicio: str
    categoria_id: int | None = None
    fin: str | None = None
    es_suscripcion: bool = False
    nota: str = ""
    ancla: str = "calendario"  # "pago": el periodo empieza al pagar


def _validar(sesion: Session, d: DatosRecurrente) -> None:
    if not d.nombre.strip():
        raise ErrorValidacion("El recurrente necesita un nombre")
    if d.monto == 0:
        raise ErrorValidacion("El monto no puede ser cero")
    if not 1 <= d.dia <= 31:
        raise ErrorValidacion("El día debe estar entre 1 y 31")
    obtener_cuenta(sesion, d.cuenta_id)
    if d.categoria_id is not None and sesion.get(Categoria, d.categoria_id) is None:
        raise NoEncontrado(f"La categoría {d.categoria_id} no existe")
    if d.fin and d.fin < d.inicio:
        raise ErrorValidacion("La fecha de fin no puede ser anterior al inicio")


def cuenta_por_defecto(sesion: Session) -> int:
    """La primera cuenta líquida (para cuotas de créditos sin cuenta de pago)."""
    from finanzas.infra.modelos import Cuenta

    ident = sesion.scalar(
        select(Cuenta.id).where(Cuenta.tipo.in_(("billetera", "ahorro", "efectivo"))).order_by(Cuenta.orden)
    )
    if ident is None:
        raise ErrorValidacion("No hay una cuenta para programar el pago")
    return int(ident)


def aplicar_datos(r: Recurrente, d: DatosRecurrente) -> None:
    _aplicar(r, d)


def rehacer_futuras(sesion: Session, r: Recurrente) -> None:
    """Borra las programadas futuras y las vuelve a programar con los datos actuales."""
    for tx in _pendientes_futuras(sesion, r.id):
        sesion.delete(tx)
    sesion.flush()
    programar(sesion, r)


def _aplicar(r: Recurrente, d: DatosRecurrente) -> None:
    r.nombre = d.nombre.strip()
    r.cuenta_id = d.cuenta_id
    r.categoria_id = d.categoria_id
    r.monto = d.monto
    r.frecuencia = d.frecuencia
    r.dia = d.dia
    r.inicio = d.inicio[:10]
    r.fin = d.fin[:10] if d.fin else None
    r.es_suscripcion = d.es_suscripcion
    r.nota = d.nota
    r.ancla = d.ancla if d.ancla in ("calendario", "pago") else "calendario"


def _pendientes_futuras(sesion: Session, recurrente_id: int) -> list[Transaccion]:
    return list(
        sesion.scalars(
            select(Transaccion).where(
                Transaccion.recurrente_id == recurrente_id,
                Transaccion.estado == "pendiente",
                Transaccion.fecha >= hoy_bogota().isoformat(),
            )
        )
    )


def adoptar_pendientes(sesion: Session, r: Recurrente) -> int:
    """Liga al recurrente las programadas que ya existían con la misma descripción (p. ej. de Cashew),
    para no duplicarlas en el calendario."""
    clave = normalizar(r.nombre)
    sueltas = sesion.scalars(
        select(Transaccion).where(Transaccion.estado == "pendiente", Transaccion.recurrente_id.is_(None))
    )
    n = 0
    for tx in sueltas:
        if normalizar(tx.descripcion) == clave and (tx.monto < 0) == (r.monto < 0):
            tx.recurrente_id = r.id
            n += 1
    return n


def programar(sesion: Session, r: Recurrente, hoy: date | None = None, dias: int = HORIZONTE_DIAS) -> int:
    """Crea las ocurrencias pendientes de los próximos `dias` que aún no existan (idempotente)."""
    if not r.activo:
        return 0
    hoy = hoy or hoy_bogota()
    if r.ancla == "pago":
        return _programar_desde_pago(sesion, r)
    fechas = dom.ocurrencias(
        date.fromisoformat(r.inicio),
        r.frecuencia,  # type: ignore[arg-type]
        r.dia,
        hoy,
        hoy + timedelta(days=dias),
        date.fromisoformat(r.fin) if r.fin else None,
    )
    existentes = [
        date.fromisoformat(f[:10])
        for f in sesion.scalars(select(Transaccion.fecha).where(Transaccion.recurrente_id == r.id))
    ] + _omitidas(sesion, r.id)
    tolerancia = 3 if r.frecuencia == "semanal" else 6  # un pago adelantado o atrasado cuenta como esa ocurrencia
    creadas = 0
    marca = ahora()
    for fecha in fechas:
        if any(abs((fecha - e).days) <= tolerancia for e in existentes):
            continue
        sesion.add(
            Transaccion(
                cuenta_id=r.cuenta_id,
                monto=r.monto,
                categoria_id=r.categoria_id,
                fecha=normalizar_fecha(fecha.isoformat()),
                descripcion=r.nombre,
                nota="",
                estado="pendiente",
                recurrente_id=r.id,
                credito_id=r.credito_id,
                origen_categoria="recurrente",
                creado_en=marca,
                actualizado_en=marca,
            )
        )
        creadas += 1
    return creadas


def _omitidas(sesion: Session, recurrente_id: int) -> list[date]:
    return [
        date.fromisoformat(f)
        for f in sesion.scalars(select(RecurrenteOmision.fecha).where(RecurrenteOmision.recurrente_id == recurrente_id))
    ]


def programar_periodo_actual(sesion: Session, r: Recurrente, hoy: date | None = None) -> int:
    """Al reactivar o cambiar la fecha de cobro: el cobro del periodo en curso (aunque su fecha ya pasó) vuelve
    como programado, para pagarlo o saltarlo; así no se pasa directo al periodo siguiente."""
    if not r.activo or r.ancla == "pago":
        return programar(sesion, r, hoy)
    hoy = hoy or hoy_bogota()
    paso = PASO_DIAS[r.frecuencia]
    periodo = dom.ocurrencias(
        date.fromisoformat(r.inicio),
        r.frecuencia,  # type: ignore[arg-type]
        r.dia,
        hoy - timedelta(days=paso - 1),
        hoy,
        date.fromisoformat(r.fin) if r.fin else None,
    )
    creadas = 0
    if periodo:
        actual = periodo[-1]
        cubiertas = [
            date.fromisoformat(f[:10])
            for f in sesion.scalars(select(Transaccion.fecha).where(Transaccion.recurrente_id == r.id))
        ] + _omitidas(sesion, r.id)
        if not any(abs((actual - e).days) <= 6 for e in cubiertas):
            marca = ahora()
            sesion.add(
                Transaccion(
                    cuenta_id=r.cuenta_id,
                    monto=r.monto,
                    categoria_id=r.categoria_id,
                    fecha=normalizar_fecha(actual.isoformat()),
                    descripcion=r.nombre,
                    nota="",
                    estado="pendiente",
                    recurrente_id=r.id,
                    credito_id=r.credito_id,
                    origen_categoria="recurrente",
                    creado_en=marca,
                    actualizado_en=marca,
                )
            )
            sesion.flush()
            creadas = 1
    return creadas + programar(sesion, r, hoy)


def omitir(uow: UnidadDeTrabajo, tx_id: int) -> None:
    """Salta un pago programado de un recurrente: no se cobra ni vuelve a aparecer; se programa el siguiente."""
    tx = uow.sesion.get(Transaccion, tx_id)
    if tx is None or tx.estado != "pendiente":
        raise NoEncontrado("Ese pago programado no existe")
    r = uow.sesion.get(Recurrente, tx.recurrente_id) if tx.recurrente_id else None
    if r is not None:
        fecha = tx.fecha[:10]
        if uow.sesion.get(RecurrenteOmision, (r.id, fecha)) is None:
            uow.sesion.add(RecurrenteOmision(recurrente_id=r.id, fecha=fecha, creado_en=ahora()))
    uow.sesion.delete(tx)
    uow.sesion.flush()
    if r is not None:
        programar(uow.sesion, r)
    uow.registrar(DominioCambio(INVALIDA, "omitir", (tx_id,)))


def programar_todos(uow: UnidadDeTrabajo, hoy: date | None = None) -> int:
    total = sum(programar(uow.sesion, r, hoy) for r in uow.sesion.scalars(select(Recurrente)))
    if total:
        uow.registrar(DominioCambio(INVALIDA, "programar", ()))
    return total


def crear(uow: UnidadDeTrabajo, d: DatosRecurrente) -> Recurrente:
    _validar(uow.sesion, d)
    r = Recurrente(creado_en=ahora(), activo=True)
    _aplicar(r, d)
    uow.sesion.add(r)
    uow.sesion.flush()
    adoptar_pendientes(uow.sesion, r)
    uow.sesion.flush()
    programar(uow.sesion, r)
    uow.registrar(DominioCambio(INVALIDA, "crear", (r.id,)))
    return r


def editar(uow: UnidadDeTrabajo, recurrente_id: int, d: DatosRecurrente, activo: bool) -> Recurrente:
    r = uow.sesion.get(Recurrente, recurrente_id)
    if r is None:
        raise NoEncontrado(f"El recurrente {recurrente_id} no existe")
    _validar(uow.sesion, d)
    cambio_fecha = d.inicio[:10] != r.inicio or d.dia != r.dia
    _aplicar(r, d)
    r.activo = activo
    # Las programadas se rehacen con los datos nuevos (las pagadas no se tocan). Si cambió la fecha de cobro,
    # también sale la programada vencida: el periodo en curso se recalcula con la fecha nueva.
    pendientes = (
        list(
            uow.sesion.scalars(
                select(Transaccion).where(Transaccion.recurrente_id == r.id, Transaccion.estado == "pendiente")
            )
        )
        if cambio_fecha
        else _pendientes_futuras(uow.sesion, r.id)
    )
    for tx in pendientes:
        uow.sesion.delete(tx)
    uow.sesion.flush()
    if cambio_fecha:
        programar_periodo_actual(uow.sesion, r)
    else:
        programar(uow.sesion, r)
    uow.registrar(DominioCambio(INVALIDA, "editar", (r.id,)))
    return r


def eliminar(uow: UnidadDeTrabajo, recurrente_id: int) -> None:
    """Borra el recurrente y sus programadas futuras; el historial pagado queda (sin enlace)."""
    r = uow.sesion.get(Recurrente, recurrente_id)
    if r is None:
        raise NoEncontrado(f"El recurrente {recurrente_id} no existe")
    for tx in _pendientes_futuras(uow.sesion, r.id):
        uow.sesion.delete(tx)
    uow.sesion.delete(r)
    uow.registrar(DominioCambio(INVALIDA, "borrar", (recurrente_id,)))


def pagar(
    uow: UnidadDeTrabajo,
    tx_id: int,
    fecha: str | None = None,
    monto: int | None = None,
    fecha_modo: str = "hoy",
) -> Transaccion:
    """Confirma una programada: pasa a 'confirmada' con la fecha (hoy por defecto) y el monto real."""
    tx = uow.sesion.get(Transaccion, tx_id)
    if tx is None:
        raise NoEncontrado(f"La transacción {tx_id} no existe")
    if tx.estado != "pendiente":
        raise ErrorValidacion("Ese movimiento ya estaba confirmado")
    tx.estado = "confirmada"
    if fecha or fecha_modo != "programada":  # "programada": se conserva la fecha que tenía
        tx.fecha = normalizar_fecha(fecha or hoy_bogota().isoformat())
    if monto:
        tx.monto = monto
    tx.actualizado_en = ahora()
    if tx.credito_id is not None:  # cuota de un crédito: recalcula su desglose y saldo
        creditos.recalcular(uow.sesion, tx.credito_id)
    r = uow.sesion.get(Recurrente, tx.recurrente_id) if tx.recurrente_id else None
    if r is not None:  # con ancla «pago», el siguiente periodo nace de este pago
        uow.sesion.flush()
        programar(uow.sesion, r)
    eventos = INVALIDA + ("cuentas", "presupuesto", "reportes") + (("creditos",) if tx.credito_id else ())
    uow.registrar(DominioCambio(eventos, "pagar", (tx.id,)))
    return tx


PASO_DIAS = {"semanal": 7, "quincenal": 15, "mensual": 30, "anual": 365}


def _programar_desde_pago(sesion: Session, r: Recurrente) -> int:
    """Suscripciones que se renuevan al pagar (gimnasio, streaming): el siguiente periodo empieza el día del pago."""
    pendiente = sesion.scalar(
        select(Transaccion.id).where(Transaccion.recurrente_id == r.id, Transaccion.estado == "pendiente").limit(1)
    )
    if pendiente is not None:
        return 0
    ultimo_pago = sesion.scalar(
        select(Transaccion.fecha)
        .where(Transaccion.recurrente_id == r.id, Transaccion.estado == "confirmada")
        .order_by(Transaccion.fecha.desc())
        .limit(1)
    )
    # Un periodo saltado cuenta como pagado para calcular el siguiente.
    marcas = [date.fromisoformat(ultimo_pago[:10])] if ultimo_pago else []
    marcas += _omitidas(sesion, r.id)
    inicio = date.fromisoformat(r.inicio)
    siguiente = max(marcas) + timedelta(days=PASO_DIAS[r.frecuencia]) if marcas else inicio
    siguiente = max(siguiente, inicio)  # una fecha de cobro elegida al editar manda sobre el cálculo
    if r.fin and siguiente > date.fromisoformat(r.fin):
        return 0
    marca = ahora()
    sesion.add(
        Transaccion(
            cuenta_id=r.cuenta_id,
            monto=r.monto,
            categoria_id=r.categoria_id,
            fecha=normalizar_fecha(siguiente.isoformat()),
            descripcion=r.nombre,
            nota="",
            estado="pendiente",
            recurrente_id=r.id,
            credito_id=r.credito_id,
            origen_categoria="recurrente",
            creado_en=marca,
            actualizado_en=marca,
        )
    )
    return 1


def cambiar_estado(uow: UnidadDeTrabajo, recurrente_id: int, estado: str) -> Recurrente:
    """activo · pausado (se puede reactivar) · cancelado. Pausar o cancelar borra lo programado sin pagar,
    incluso lo vencido: si no se cobra, no debe quedar como deuda en el calendario."""
    r = uow.sesion.get(Recurrente, recurrente_id)
    if r is None:
        raise NoEncontrado(f"El recurrente {recurrente_id} no existe")
    if estado not in ("activo", "pausado", "cancelado"):
        raise ErrorValidacion("Estado inválido")
    reactivado = estado == "activo" and not r.activo
    r.activo = estado == "activo"
    r.cancelado_en = ahora() if estado == "cancelado" else None
    if not r.activo:
        for tx in uow.sesion.scalars(
            select(Transaccion).where(Transaccion.recurrente_id == r.id, Transaccion.estado == "pendiente")
        ):
            uow.sesion.delete(tx)
    uow.sesion.flush()
    if reactivado:
        programar_periodo_actual(uow.sesion, r)
    else:
        programar(uow.sesion, r)
    uow.registrar(DominioCambio(INVALIDA, estado, (r.id,)))
    return r
