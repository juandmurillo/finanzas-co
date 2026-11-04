"""Acceso a datos reutilizable por los servicios (get-or-create y búsquedas)."""

from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.orm import Session

from finanzas.dominio.errores import NoEncontrado
from finanzas.dominio.grupos import NOMBRES_GRUPO, Grupo
from finanzas.infra.modelos import Categoria, Contraparte, Cuenta, Etiqueta

TIPO_CUENTA_POR_NOMBRE = {"efectivo": "efectivo", "ahorro": "ahorro"}


def obtener_cuenta(sesion: Session, cuenta_id: int) -> Cuenta:
    cuenta = sesion.get(Cuenta, cuenta_id)
    if cuenta is None:
        raise NoEncontrado(f"La cuenta {cuenta_id} no existe")
    return cuenta


def cuenta_por_nombre(sesion: Session, nombre: str) -> Cuenta:
    """Busca o crea una cuenta por nombre (importaciones)."""
    cuenta = sesion.scalar(select(Cuenta).where(Cuenta.nombre == nombre))
    if cuenta is None:
        tipo = TIPO_CUENTA_POR_NOMBRE.get(nombre.strip().lower(), "billetera")
        cuenta = Cuenta(nombre=nombre, tipo=tipo, saldo_inicial=0)
        sesion.add(cuenta)
        sesion.flush()
    return cuenta


def _hijo(sesion: Session, padre_id: int | None, nombre: str, nivel: int, grupo: str) -> Categoria:
    filtro = Categoria.padre_id.is_(None) if padre_id is None else Categoria.padre_id == padre_id
    categoria = sesion.scalar(select(Categoria).where(filtro, Categoria.nombre == nombre))
    if categoria is None:
        categoria = Categoria(padre_id=padre_id, nivel=nivel, nombre=nombre, grupo=grupo)
        sesion.add(categoria)
        sesion.flush()
    return categoria


def categoria_por_ruta(sesion: Session, grupo: Grupo, categoria: str, subcategoria: str | None) -> Categoria:
    """Devuelve (creándola si falta) la hoja grupo › categoría › subcategoría."""
    raiz = _hijo(sesion, None, NOMBRES_GRUPO[grupo], 1, grupo.value)
    nivel2 = _hijo(sesion, raiz.id, categoria, 2, grupo.value)
    if not subcategoria or subcategoria == categoria:
        return nivel2
    return _hijo(sesion, nivel2.id, subcategoria, 3, grupo.value)


def contraparte_por_nombre(sesion: Session, nombre: str, tipo: str) -> Contraparte | None:
    if not nombre:
        return None
    existente = sesion.scalar(select(Contraparte).where(Contraparte.nombre == nombre))
    if existente is None:
        existente = Contraparte(nombre=nombre, tipo=tipo)
        sesion.add(existente)
        sesion.flush()
    return existente


def etiqueta_por_nombre(sesion: Session, nombre: str) -> Etiqueta:
    etiqueta = sesion.scalar(select(Etiqueta).where(Etiqueta.nombre == nombre))
    if etiqueta is None:
        etiqueta = Etiqueta(nombre=nombre)
        sesion.add(etiqueta)
        sesion.flush()
    return etiqueta


def ruta_categoria(categoria: Categoria | None) -> list[str]:
    """['Gasto de vida', 'Transporte', 'Moto']"""
    ruta: list[str] = []
    actual = categoria
    while actual is not None:
        ruta.insert(0, actual.nombre)
        actual = actual.padre
    return ruta
