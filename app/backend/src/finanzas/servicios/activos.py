"""Activos e inversiones. Aportar o vender mueve dinero entre una cuenta y el activo: no es gasto ni ingreso (va al
grupo Financiación). Un rendimiento pagado a una cuenta sí es ingreso; uno reinvertido solo sube el valor."""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from finanzas.dominio import activos as dom
from finanzas.dominio.errores import Conflicto, ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.dominio.fechas import hoy_bogota
from finanzas.dominio.grupos import Grupo
from finanzas.infra import trm
from finanzas.infra.modelos import Activo, ActivoMovimiento, ActivoValoracion, Transaccion
from finanzas.infra.repositorios import categoria_por_ruta, obtener_cuenta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import transacciones

ENTIDADES = ("activos", "cuentas", "transacciones", "dashboard", "reportes", "metas", "alertas", "calendario")
MONEDAS = ("COP", "USD")


@dataclass
class DatosActivo:
    nombre: str
    clase: str
    fecha_compra: str
    costo: int  # lo que pagaste, en pesos (centavos)
    valor_actual: int | None = None  # en la moneda del activo; si falta, el costo
    moneda: str = "COP"
    cuenta_id: int | None = None  # de dónde salió el dinero; sin cuenta, ya lo tenías antes de usar la app
    tasa_ea: float | None = None
    vencimiento: str | None = None
    nota: str = ""


def _obtener(sesion: Session, activo_id: int) -> Activo:
    a = sesion.get(Activo, activo_id)
    if a is None:
        raise NoEncontrado("Ese activo no existe")
    return a


def _validar_fecha(fecha: str) -> None:
    if fecha > hoy_bogota().isoformat():
        raise ErrorValidacion("La fecha no puede ser futura")


def tasa_de_cambio(sesion: Session, moneda: str) -> float:
    """Pesos por unidad de la moneda del activo, con la TRM oficial más reciente que se conozca."""
    if moneda == "COP":
        return 1.0
    dato = trm.obtener(sesion, hoy_bogota())
    if dato is None:
        raise ErrorValidacion("No hay TRM disponible para valorar en dólares. Revisa la conexión e intenta de nuevo.")
    return float(str(dato["valor"]))


def _ajustar_valor(sesion: Session, activo: Activo, fecha: str, delta_cop: int) -> None:
    """Un aporte o retiro cambia el valor desde esa fecha en adelante, sin borrar las valoraciones que ya hay."""
    delta = round(delta_cop / tasa_de_cambio(sesion, activo.moneda))
    filas = list(
        sesion.scalars(
            select(ActivoValoracion).where(ActivoValoracion.activo_id == activo.id).order_by(ActivoValoracion.fecha)
        )
    )
    previa = next((v for v in reversed(filas) if v.fecha <= fecha), None)
    if previa is None or previa.fecha != fecha:
        sesion.add(
            ActivoValoracion(activo_id=activo.id, fecha=fecha, valor=max(0, (previa.valor if previa else 0) + delta))
        )
    for v in filas:
        if v.fecha >= fecha:
            v.valor = max(0, v.valor + delta)


def _categoria(sesion: Session, tipo: str) -> int:
    if tipo == "rendimiento":
        return categoria_por_ruta(sesion, Grupo.INGRESO, "Rendimientos", None).id
    sub = "Aportes" if tipo == "aporte" else "Retiros y ventas"
    return categoria_por_ruta(sesion, Grupo.FINANCIACION, "Activos", sub).id


_TEXTO = {"aporte": "Aporte a", "retiro": "Retiro de", "rendimiento": "Rendimiento de", "venta": "Venta de"}


def _movimiento(
    uow: UnidadDeTrabajo, a: Activo, tipo: str, monto: int, fecha: str, cuenta_id: int | None, nota: str
) -> ActivoMovimiento:
    tx_id: int | None = None
    if cuenta_id is not None:
        obtener_cuenta(uow.sesion, cuenta_id)
        signo = -1 if tipo == "aporte" else 1
        tx = transacciones.registrar(
            uow,
            transacciones.DatosTransaccion(
                cuenta_id, signo * monto, _categoria(uow.sesion, tipo), fecha, f"{_TEXTO[tipo]} {a.nombre}"
            ),
        )
        tx_id = tx.id
    mov = ActivoMovimiento(activo_id=a.id, tipo=tipo, monto=monto, fecha=fecha, transaccion_id=tx_id, nota=nota)
    uow.sesion.add(mov)
    uow.sesion.flush()
    return mov


def crear(uow: UnidadDeTrabajo, d: DatosActivo) -> Activo:
    if not d.nombre.strip():
        raise ErrorValidacion("El activo necesita un nombre")
    if d.clase not in dom.CLASES:
        raise ErrorValidacion("Clase de activo no válida")
    if d.moneda not in MONEDAS:
        raise ErrorValidacion("La moneda debe ser COP o USD")
    if d.costo < 0 or (d.valor_actual is not None and d.valor_actual < 0):
        raise ErrorValidacion("Los montos no pueden ser negativos")
    if d.cuenta_id is not None and d.costo == 0:
        raise ErrorValidacion("Para sacar el dinero de una cuenta, indica cuánto pagaste")
    _validar_fecha(d.fecha_compra)
    a = Activo(
        nombre=d.nombre.strip(),
        clase=d.clase,
        moneda=d.moneda,
        fecha_compra=d.fecha_compra,
        tasa_ea=d.tasa_ea,
        vencimiento=d.vencimiento,
        estado="activo",
        nota=d.nota.strip(),
        creado_en=transacciones.ahora(),
    )
    uow.sesion.add(a)
    uow.sesion.flush()
    if d.costo:
        _movimiento(uow, a, "aporte", d.costo, d.fecha_compra, d.cuenta_id, "Compra")
    valor = d.valor_actual if d.valor_actual is not None else round(d.costo / tasa_de_cambio(uow.sesion, d.moneda))
    uow.sesion.add(ActivoValoracion(activo_id=a.id, fecha=hoy_bogota().isoformat(), valor=valor))
    if d.fecha_compra != hoy_bogota().isoformat() and d.costo:
        inicial = round(d.costo / tasa_de_cambio(uow.sesion, d.moneda))
        uow.sesion.add(ActivoValoracion(activo_id=a.id, fecha=d.fecha_compra, valor=inicial))
    uow.registrar(DominioCambio(ENTIDADES, "crear", (a.id,)))
    return a


def editar(uow: UnidadDeTrabajo, activo_id: int, cambios: dict[str, object]) -> Activo:
    a = _obtener(uow.sesion, activo_id)
    for campo in ("nombre", "clase", "tasa_ea", "vencimiento", "nota"):
        if campo in cambios:
            setattr(a, campo, cambios[campo])
    if not a.nombre.strip():
        raise ErrorValidacion("El activo necesita un nombre")
    if a.clase not in dom.CLASES:
        raise ErrorValidacion("Clase de activo no válida")
    uow.registrar(DominioCambio(ENTIDADES, "editar", (a.id,)))
    return a


def valorar(uow: UnidadDeTrabajo, activo_id: int, fecha: str, valor: int) -> None:
    """Registra cuánto vale hoy. No mueve dinero: la diferencia es ganancia o pérdida, no ingreso ni gasto."""
    a = _obtener(uow.sesion, activo_id)
    if valor < 0:
        raise ErrorValidacion("El valor no puede ser negativo")
    if a.estado != "activo":
        raise Conflicto("Este activo ya se vendió")
    _validar_fecha(fecha)
    fila = uow.sesion.scalar(
        select(ActivoValoracion).where(ActivoValoracion.activo_id == a.id, ActivoValoracion.fecha == fecha)
    )
    if fila:
        fila.valor = valor
    else:
        uow.sesion.add(ActivoValoracion(activo_id=a.id, fecha=fecha, valor=valor))
    uow.registrar(DominioCambio(ENTIDADES, "valorar", (a.id,)))


def mover(
    uow: UnidadDeTrabajo, activo_id: int, tipo: str, monto: int, fecha: str, cuenta_id: int | None, nota: str = ""
) -> ActivoMovimiento:
    a = _obtener(uow.sesion, activo_id)
    if tipo not in dom.TIPOS_MOVIMIENTO:
        raise ErrorValidacion("Tipo de movimiento no válido")
    if monto <= 0:
        raise ErrorValidacion("El monto debe ser mayor que cero")
    if a.estado != "activo":
        raise Conflicto("Este activo ya se vendió")
    if tipo in ("retiro", "venta") and cuenta_id is None:
        raise ErrorValidacion("Indica a qué cuenta entra el dinero")
    _validar_fecha(fecha)
    mov = _movimiento(uow, a, tipo, monto, fecha, cuenta_id, nota)
    if tipo == "aporte":
        _ajustar_valor(uow.sesion, a, fecha, monto)
    elif tipo == "retiro":
        _ajustar_valor(uow.sesion, a, fecha, -monto)
    elif tipo == "rendimiento" and cuenta_id is None:  # reinvertido: sube el valor, no entra a ninguna cuenta
        _ajustar_valor(uow.sesion, a, fecha, monto)
    elif tipo == "venta":
        a.estado = "vendido"
        uow.sesion.flush()
        fila = uow.sesion.scalar(
            select(ActivoValoracion).where(ActivoValoracion.activo_id == a.id, ActivoValoracion.fecha == fecha)
        )
        if fila:
            fila.valor = 0
        else:
            uow.sesion.add(ActivoValoracion(activo_id=a.id, fecha=fecha, valor=0))
    uow.registrar(DominioCambio(ENTIDADES, "mover", (a.id,)))
    return mov


def eliminar_movimiento(uow: UnidadDeTrabajo, activo_id: int, movimiento_id: int) -> None:
    """Deshace el movimiento: su dinero vuelve a la cuenta y su efecto en el valor se revierte."""
    a = _obtener(uow.sesion, activo_id)
    mov = uow.sesion.get(ActivoMovimiento, movimiento_id)
    if mov is None or mov.activo_id != a.id:
        raise NoEncontrado("Ese movimiento no existe")
    if mov.tipo == "aporte":
        _ajustar_valor(uow.sesion, a, mov.fecha, -mov.monto)
    elif mov.tipo == "retiro" or (mov.tipo == "rendimiento" and mov.transaccion_id is None):
        _ajustar_valor(uow.sesion, a, mov.fecha, mov.monto if mov.tipo == "retiro" else -mov.monto)
    elif mov.tipo == "venta":
        a.estado = "activo"
        uow.sesion.execute(
            delete(ActivoValoracion).where(
                ActivoValoracion.activo_id == a.id, ActivoValoracion.fecha == mov.fecha, ActivoValoracion.valor == 0
            )
        )
    tx_id = mov.transaccion_id
    uow.sesion.delete(mov)
    uow.sesion.flush()
    if tx_id is not None:
        tx = uow.sesion.get(Transaccion, tx_id)
        if tx is not None:
            uow.sesion.delete(tx)
    uow.registrar(DominioCambio(ENTIDADES, "eliminar", (a.id,)))


def eliminar(uow: UnidadDeTrabajo, activo_id: int) -> None:
    """Quita el activo y deshace sus movimientos de dinero, como si nunca se hubiera registrado."""
    a = _obtener(uow.sesion, activo_id)
    ids = [
        i
        for i in uow.sesion.scalars(select(ActivoMovimiento.transaccion_id).where(ActivoMovimiento.activo_id == a.id))
        if i is not None
    ]
    uow.sesion.delete(a)
    uow.sesion.flush()
    for tx_id in ids:
        tx = uow.sesion.get(Transaccion, tx_id)
        if tx is not None:
            uow.sesion.delete(tx)
    uow.registrar(DominioCambio(ENTIDADES, "eliminar", (activo_id,)))
