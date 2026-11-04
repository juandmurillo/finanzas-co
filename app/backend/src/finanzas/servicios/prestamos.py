"""Casos de uso de préstamos personales (RF-PP): crear, abonar y condonar.

Contabilidad: el capital se mueve como transferencia contra una cuenta puente
("Préstamos por cobrar" / "Préstamos por pagar"), así no es ingreso ni gasto.
Solo el interés (y la condonación) afectan el flujo.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from sqlalchemy.orm import Session

from finanzas.dominio import prestamos as dominio
from finanzas.dominio.errores import Conflicto, ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.dominio.grupos import Grupo
from finanzas.infra.modelos import Categoria, PrestamoCuota, PrestamoPersonal, Transaccion
from finanzas.infra.prestamos_repo import CUENTA_PUENTE, Saldos, cuenta_puente, saldos
from finanzas.infra.repositorios import categoria_por_ruta, contraparte_por_nombre, obtener_cuenta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.transacciones import ahora, normalizar_fecha

INVALIDA = ("prestamos", "transacciones", "cuentas", "reportes", "dashboard")


@dataclass
class DatosPrestamo:
    direccion: str
    persona: str
    monto: int
    cuenta_id: int
    fecha: str
    origen: str = "amigo"
    tipo_interes: str = "ninguno"
    interes_fijo: int = 0
    tasa_mensual: float = 0.0
    plan: str = "fecha_unica"
    frecuencia: str = "mensual"
    num_cuotas: int = 1
    fecha_limite: str | None = None
    nota: str = ""


@dataclass(frozen=True)
class Calculo:
    interes_total: int
    tasa_ea: float
    cuotas: list[dominio.CuotaPlan]
    meses: float


def calcular(d: DatosPrestamo) -> Calculo:
    """Interés, cuotas y E.A. equivalente sin tocar la base (sirve para la vista previa)."""
    if d.monto <= 0:
        raise ErrorValidacion("El monto debe ser mayor que cero")
    inicio = date.fromisoformat(d.fecha[:10])
    limite = date.fromisoformat(d.fecha_limite[:10]) if d.fecha_limite else None
    if d.plan == "cuotas":
        meses = dominio.meses_del_plazo(d.frecuencia, d.num_cuotas)
    elif d.plan == "fecha_unica":
        dias = ((limite or dominio.fecha_cuota(inicio, "mensual", 1)) - inicio).days
        meses = max(dias, 1) / 30
    else:
        meses = 1.0
    interes = dominio.interes_total(
        d.monto, d.tipo_interes, interes_fijo=d.interes_fijo, tasa_mensual=d.tasa_mensual, meses=meses
    )
    cuotas = dominio.plan_de_pagos(d.monto, interes, inicio, d.plan, d.frecuencia, d.num_cuotas, limite)
    return Calculo(interes, dominio.tasa_ea_equivalente(d.monto, interes, meses), cuotas, meses)


def _categoria(sesion: Session, grupo: Grupo, categoria: str, sub: str) -> Categoria:
    return categoria_por_ruta(sesion, grupo, categoria, sub)


def _mov(
    uow: UnidadDeTrabajo,
    cuenta_id: int,
    monto: int,
    categoria: Categoria,
    fecha: str,
    descripcion: str,
    prestamo_id: int,
    contraparte_id: int | None,
) -> Transaccion:
    marca = ahora()
    tx = Transaccion(
        cuenta_id=cuenta_id,
        monto=monto,
        categoria_id=categoria.id,
        fecha=fecha,
        descripcion=descripcion,
        nota="",
        estado="confirmada",
        prestamo_id=prestamo_id,
        contraparte_id=contraparte_id,
        creado_en=marca,
        actualizado_en=marca,
    )
    uow.sesion.add(tx)
    uow.sesion.flush()
    return tx


def _par(
    uow: UnidadDeTrabajo,
    desde: int,
    hacia: int,
    monto: int,
    categoria: Categoria,
    fecha: str,
    descripcion: str,
    prestamo: PrestamoPersonal,
) -> None:
    """Transferencia enlazada (sale de `desde`, entra a `hacia`)."""
    salida = _mov(uow, desde, -monto, categoria, fecha, descripcion, prestamo.id, prestamo.contraparte_id)
    entrada = _mov(uow, hacia, monto, categoria, fecha, descripcion, prestamo.id, prestamo.contraparte_id)
    salida.transferencia_id, entrada.transferencia_id = entrada.id, salida.id


def crear(uow: UnidadDeTrabajo, d: DatosPrestamo) -> PrestamoPersonal:
    if d.direccion not in CUENTA_PUENTE:
        raise ErrorValidacion("La dirección debe ser 'presto_yo' o 'me_prestaron'")
    if not d.persona.strip():
        raise ErrorValidacion("Escribe con quién es el préstamo")
    sesion = uow.sesion
    cuenta = obtener_cuenta(sesion, d.cuenta_id)
    if cuenta.tipo in ("por_cobrar", "por_pagar", "credito"):
        raise ErrorValidacion("Elige una cuenta de dinero (billetera, ahorros, efectivo…)")
    calculo = calcular(d)
    contraparte = contraparte_por_nombre(sesion, d.persona.strip().title(), "persona")
    assert contraparte is not None
    fecha = normalizar_fecha(d.fecha)
    prestamo = PrestamoPersonal(
        contraparte_id=contraparte.id,
        direccion=d.direccion,
        origen=d.origen,
        monto=d.monto,
        fecha=fecha,
        cuenta_id=cuenta.id,
        tipo_interes=d.tipo_interes,
        interes_total=calculo.interes_total,
        tasa_mensual=d.tasa_mensual if d.tipo_interes == "simple_mensual" else None,
        plan=d.plan,
        frecuencia=d.frecuencia if d.plan == "cuotas" else None,
        num_cuotas=len(calculo.cuotas) or None,
        estado="activo",
        nota=d.nota.strip(),
        creado_en=ahora(),
    )
    prestamo.cuotas = [
        PrestamoCuota(numero=c.numero, fecha=c.fecha.isoformat(), capital=c.capital, interes=c.interes)
        for c in calculo.cuotas
    ]
    sesion.add(prestamo)
    sesion.flush()
    puente = cuenta_puente(sesion, d.direccion)
    categoria = _categoria(sesion, Grupo.PRESTAMOS_PERSONALES, "Préstamo personal", "Desembolso")
    persona = contraparte.nombre
    if d.direccion == "presto_yo":
        _par(uow, cuenta.id, puente.id, d.monto, categoria, fecha, f"Préstamo a {persona}", prestamo)
    else:
        _par(uow, puente.id, cuenta.id, d.monto, categoria, fecha, f"Préstamo de {persona}", prestamo)
    uow.registrar(DominioCambio(INVALIDA, "crear", (prestamo.id,)))
    return prestamo


def _activo(uow: UnidadDeTrabajo, prestamo_id: int) -> PrestamoPersonal:
    prestamo = uow.sesion.get(PrestamoPersonal, prestamo_id)
    if prestamo is None:
        raise NoEncontrado(f"El préstamo {prestamo_id} no existe")
    if prestamo.estado != "activo":
        raise Conflicto(f"El préstamo ya está {prestamo.estado}")
    return prestamo


def abonar(uow: UnidadDeTrabajo, prestamo_id: int, monto: int, cuenta_id: int, fecha: str | None = None) -> Saldos:
    """Imputa primero al interés y luego al capital (RF-PP-04)."""
    sesion = uow.sesion
    prestamo = _activo(uow, prestamo_id)
    cuenta = obtener_cuenta(sesion, cuenta_id)
    actual = saldos(sesion, prestamo)
    a_interes, a_capital = dominio.imputar_abono(monto, actual.interes_pendiente, actual.capital_pendiente)
    fecha_iso = normalizar_fecha(fecha)
    puente = cuenta_puente(sesion, prestamo.direccion)
    persona = prestamo.contraparte.nombre
    if a_capital:
        categoria = _categoria(sesion, Grupo.PRESTAMOS_PERSONALES, "Préstamo personal", "Abono a capital")
        if prestamo.direccion == "presto_yo":
            _par(uow, puente.id, cuenta.id, a_capital, categoria, fecha_iso, f"Abono de {persona}", prestamo)
        else:
            _par(uow, cuenta.id, puente.id, a_capital, categoria, fecha_iso, f"Abono a {persona}", prestamo)
    if a_interes:
        if prestamo.direccion == "presto_yo":
            categoria = _categoria(sesion, Grupo.INGRESO, "Otros ingresos", "Intereses préstamos personales")
            _mov(
                uow,
                cuenta.id,
                a_interes,
                categoria,
                fecha_iso,
                f"Intereses de {persona}",
                prestamo.id,
                prestamo.contraparte_id,
            )
        else:
            categoria = _categoria(sesion, Grupo.SERVICIO_DEUDA, "Préstamos personales", "Intereses")
            _mov(
                uow,
                cuenta.id,
                -a_interes,
                categoria,
                fecha_iso,
                f"Intereses a {persona}",
                prestamo.id,
                prestamo.contraparte_id,
            )
    nuevo = saldos(sesion, prestamo)
    if nuevo.pendiente == 0:
        prestamo.estado = "pagado"
    uow.registrar(DominioCambio(INVALIDA, "abonar", (prestamo.id,)))
    return nuevo


def condonar(uow: UnidadDeTrabajo, prestamo_id: int) -> None:
    """Perdonar el saldo: si presté es un regalo (gasto); si me prestaron, un ingreso."""
    sesion = uow.sesion
    prestamo = _activo(uow, prestamo_id)
    capital = saldos(sesion, prestamo).capital_pendiente
    puente = cuenta_puente(sesion, prestamo.direccion)
    persona = prestamo.contraparte.nombre
    fecha = normalizar_fecha(None)
    if capital:
        if prestamo.direccion == "presto_yo":
            categoria = _categoria(sesion, Grupo.GASTO_VIDA, "Regalo", "Préstamo condonado")
            _mov(
                uow, puente.id, -capital, categoria, fecha, f"Condono a {persona}", prestamo.id, prestamo.contraparte_id
            )
        else:
            categoria = _categoria(sesion, Grupo.INGRESO, "Otros ingresos", "Préstamo condonado")
            _mov(
                uow, puente.id, capital, categoria, fecha, f"{persona} me condonó", prestamo.id, prestamo.contraparte_id
            )
    prestamo.estado = "condonado"
    uow.registrar(DominioCambio(INVALIDA, "condonar", (prestamo.id,)))
