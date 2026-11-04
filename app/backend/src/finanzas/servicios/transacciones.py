"""Casos de uso de transacciones: registrar, editar, eliminar y transferir.

Toda escritura pasa por aquí y declara qué entidades invalida (ADR-0003).
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy.orm import Session

from finanzas.dominio.errores import ErrorValidacion, NoEncontrado
from finanzas.dominio.eventos import DominioCambio
from finanzas.dominio.fechas import ZONA
from finanzas.dominio.fechas import hoy_bogota as hoy_bogota
from finanzas.dominio.grupos import Grupo
from finanzas.infra.modelos import Auditoria, Categoria, Transaccion
from finanzas.infra.repositorios import categoria_por_ruta, obtener_cuenta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import creditos, reglas

INVALIDA = ("transacciones", "cuentas", "presupuesto", "reportes", "dashboard")


def ahora() -> str:
    return datetime.now(ZONA).isoformat(timespec="seconds")


def normalizar_fecha(fecha: str | None) -> str:
    """Acepta 'YYYY-MM-DD' o ISO; devuelve ISO con zona de Bogotá."""
    if not fecha:
        return ahora()
    try:
        valor = datetime.fromisoformat(fecha)
    except ValueError as exc:
        raise ErrorValidacion(f"Fecha inválida: {fecha}") from exc
    if valor.tzinfo is None:
        valor = valor.replace(tzinfo=ZONA)
    return valor.isoformat(timespec="seconds")


@dataclass
class DatosTransaccion:
    cuenta_id: int
    monto: int
    categoria_id: int | None = None
    fecha: str | None = None
    descripcion: str = ""
    nota: str = ""
    estado: str = "confirmada"
    # "usuario" (eligió o cambió la categoría) | "sugerida" (aceptó la sugerencia) — mide RF-CA-05
    origen_categoria: str = "usuario"
    # Multimoneda: si vino en USD, `monto_original` en centavos de dólar y la TRM usada; `monto` se calcula.
    moneda_original: str | None = None
    monto_original: int | None = None
    trm: float | None = None


def _auditar(sesion: Session, tx: Transaccion, accion: str, antes: dict[str, object] | None) -> None:
    sesion.add(
        Auditoria(
            entidad="transaccion",
            entidad_id=tx.id,
            accion=accion,
            antes=json.dumps(antes, ensure_ascii=False) if antes else None,
            despues=json.dumps(_foto(tx), ensure_ascii=False) if accion != "borrar" else None,
            fecha=ahora(),
        )
    )


def _foto(tx: Transaccion) -> dict[str, object]:
    return {
        "cuenta_id": tx.cuenta_id,
        "fecha": tx.fecha,
        "monto": tx.monto,
        "categoria_id": tx.categoria_id,
        "descripcion": tx.descripcion,
        "nota": tx.nota,
        "estado": tx.estado,
    }


def _validar(sesion: Session, datos: DatosTransaccion) -> None:
    if datos.monto == 0:
        raise ErrorValidacion("El monto no puede ser cero")
    obtener_cuenta(sesion, datos.cuenta_id)
    if datos.categoria_id is not None and sesion.get(Categoria, datos.categoria_id) is None:
        raise NoEncontrado(f"La categoría {datos.categoria_id} no existe")


def convertir_moneda(datos: DatosTransaccion) -> None:
    """USD → COP con la TRM indicada: centavos de dólar × COP por dólar = centavos de peso."""
    if datos.moneda_original in (None, "COP"):
        datos.moneda_original = datos.monto_original = datos.trm = None
        return
    if datos.moneda_original != "USD":
        raise ErrorValidacion("Por ahora solo se aceptan pesos o dólares (USD)")
    if not datos.monto_original or not datos.trm or datos.trm <= 0:
        raise ErrorValidacion("Un movimiento en dólares necesita el monto en USD y la TRM")
    datos.monto = round(datos.monto_original * datos.trm)


def registrar(uow: UnidadDeTrabajo, datos: DatosTransaccion) -> Transaccion:
    """Crea un ingreso (monto > 0) o un gasto (monto < 0)."""
    convertir_moneda(datos)
    _validar(uow.sesion, datos)
    marca = ahora()
    tx = Transaccion(
        cuenta_id=datos.cuenta_id,
        monto=datos.monto,
        categoria_id=datos.categoria_id,
        fecha=normalizar_fecha(datos.fecha),
        descripcion=datos.descripcion.strip(),
        nota=datos.nota.strip(),
        estado=datos.estado,
        origen_categoria=datos.origen_categoria,
        moneda_original=datos.moneda_original,
        monto_original=datos.monto_original,
        trm=datos.trm,
        creado_en=marca,
        actualizado_en=marca,
    )
    uow.sesion.add(tx)
    reglas.aplicar(uow.sesion, tx)
    uow.sesion.flush()
    creditos.sincronizar(uow.sesion, tx)  # pago a un crédito: se liga y recalcula su saldo
    _auditar(uow.sesion, tx, "crear", None)
    uow.registrar(DominioCambio(INVALIDA, "crear", (tx.id,)))
    return tx


def editar(uow: UnidadDeTrabajo, tx_id: int, cambios: dict[str, object]) -> Transaccion:
    tx = uow.sesion.get(Transaccion, tx_id)
    if tx is None:
        raise NoEncontrado(f"La transacción {tx_id} no existe")
    antes = _foto(tx)
    credito_anterior = tx.credito_id
    if "fecha" in cambios:
        cambios["fecha"] = normalizar_fecha(str(cambios["fecha"]))
    for campo, valor in cambios.items():
        setattr(tx, campo, valor)
    _validar(uow.sesion, DatosTransaccion(tx.cuenta_id, tx.monto, tx.categoria_id))
    par = uow.sesion.get(Transaccion, tx.transferencia_id) if tx.transferencia_id is not None else None
    if par is not None:  # una transferencia se mueve entera: monto opuesto, misma fecha y descripción
        if "monto" in cambios:
            par.monto = -tx.monto
        for campo in ("fecha", "descripcion"):
            if campo in cambios:
                setattr(par, campo, getattr(tx, campo))
        if par.cuenta_id == tx.cuenta_id:
            raise ErrorValidacion("El origen y el destino de una transferencia deben ser cuentas distintas")
        par.actualizado_en = ahora()
    tx.actualizado_en = ahora()
    creditos.sincronizar(uow.sesion, tx, credito_anterior)
    _auditar(uow.sesion, tx, "editar", antes)
    uow.registrar(DominioCambio(INVALIDA, "editar", (tx.id,)))
    return tx


def eliminar(uow: UnidadDeTrabajo, tx_id: int) -> None:
    """Borra la transacción; si es una transferencia, también su par."""
    tx = uow.sesion.get(Transaccion, tx_id)
    if tx is None:
        raise NoEncontrado(f"La transacción {tx_id} no existe")
    ids = [tx.id]
    par = uow.sesion.get(Transaccion, tx.transferencia_id) if tx.transferencia_id else None
    for item in (tx, par):
        if item is None:
            continue
        _auditar(uow.sesion, item, "borrar", _foto(item))
        item.transferencia_id = None
    uow.sesion.flush()
    if par is not None:
        ids.append(par.id)
        uow.sesion.delete(par)
    credito_id = tx.credito_id
    uow.sesion.delete(tx)
    if credito_id is not None:  # borrar un pago de crédito devuelve ese capital al saldo
        uow.sesion.flush()
        creditos.recalcular(uow.sesion, credito_id)
    uow.registrar(DominioCambio(INVALIDA, "borrar", tuple(ids)))


def transferir(
    uow: UnidadDeTrabajo,
    origen_id: int,
    destino_id: int,
    monto: int,
    fecha: str | None = None,
    descripcion: str = "Transferencia",
    categoria_id: int | None = None,
) -> tuple[Transaccion, Transaccion]:
    """Par enlazado de montos opuestos: no cuenta como ingreso ni gasto."""
    if monto <= 0:
        raise ErrorValidacion("El monto a transferir debe ser positivo")
    if origen_id == destino_id:
        raise ErrorValidacion("La cuenta de origen y la de destino deben ser distintas")
    if categoria_id is None:
        categoria_id = categoria_por_ruta(uow.sesion, Grupo.TRANSFERENCIA, "Transferencia", "Entre cuentas").id
    fecha_iso = normalizar_fecha(fecha)
    salida = registrar(uow, DatosTransaccion(origen_id, -monto, categoria_id, fecha_iso, descripcion))
    entrada = registrar(uow, DatosTransaccion(destino_id, monto, categoria_id, fecha_iso, descripcion))
    salida.transferencia_id, entrada.transferencia_id = entrada.id, salida.id
    return salida, entrada
