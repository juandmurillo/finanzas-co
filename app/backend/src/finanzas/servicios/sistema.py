"""Instalación y ajustes de la persona: primer uso, nombre, perfil y módulos opcionales."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Literal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from finanzas.dominio.errores import Conflicto
from finanzas.dominio.eventos import DominioCambio
from finanzas.dominio.grupos import Grupo
from finanzas.infra.modelos import Categoria, Cuenta, Preferencia, Transaccion
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo

CATEGORIAS_BASE = Path(__file__).parents[1] / "semillas" / "categorias_base.json"
CUENTAS_INICIALES = (("Efectivo", "efectivo"), ("Cuenta de ahorros", "ahorro"))
ModoApuestas = Literal["auto", "si", "no"]


def leer(sesion: Session, clave: str, defecto: str = "") -> str:
    fila = sesion.get(Preferencia, clave)
    return fila.valor if fila else defecto


def guardar(sesion: Session, clave: str, valor: str) -> None:
    fila = sesion.get(Preferencia, clave)
    if fila:
        fila.valor = valor
    else:
        sesion.add(Preferencia(clave=clave, valor=valor))


def asegurar_categorias(sesion: Session) -> int:
    """Una base nueva arranca con un árbol de categorías utilizable. Nunca toca una que ya tenga."""
    if sesion.scalar(select(func.count()).select_from(Categoria)):
        return 0
    arbol: dict[str, Any] = json.loads(CATEGORIAS_BASE.read_text(encoding="utf-8"))
    creadas = 0
    for grupo, categorias in arbol.items():
        if grupo.startswith("_"):
            continue
        for categoria, subcategorias in categorias.items():
            categoria_por_ruta(sesion, Grupo(grupo), categoria, None)
            creadas += 1
            for sub in subcategorias:
                categoria_por_ruta(sesion, Grupo(grupo), categoria, sub)
                creadas += 1
    return creadas


def apuestas_visibles(sesion: Session) -> bool:
    """Las secciones de apuestas solo aparecen si hay apuestas registradas, salvo que la persona elija otra cosa."""
    modo = leer(sesion, "modulo_apuestas", "auto")
    if modo != "auto":
        return modo == "si"
    hay = sesion.scalar(
        select(Transaccion.id)
        .join(Categoria, Categoria.id == Transaccion.categoria_id)
        .where(Categoria.grupo == "apuestas")
        .limit(1)
    )
    return hay is not None


def estado(sesion: Session) -> dict[str, Any]:
    return {
        "primer_uso": not sesion.scalar(select(func.count()).select_from(Cuenta)),
        "nombre": leer(sesion, "nombre"),
        "perfil": leer(sesion, "perfil"),
        "es_demo": leer(sesion, "es_demo") == "1",
        "modulo_apuestas": leer(sesion, "modulo_apuestas", "auto"),
        "modulos": {"apuestas": apuestas_visibles(sesion)},
    }


def configurar(uow: UnidadDeTrabajo, cambios: dict[str, str]) -> None:
    for clave, valor in cambios.items():
        guardar(uow.sesion, clave, valor.strip())
    uow.registrar(DominioCambio(("sistema",), "editar"))


def primer_uso(uow: UnidadDeTrabajo, nombre: str, modo: Literal["vacio", "demo"]) -> None:
    """Deja lista una instalación nueva: con cuentas iniciales para empezar, o con los datos de demostración."""
    sesion = uow.sesion
    if sesion.scalar(select(func.count()).select_from(Cuenta)):
        raise Conflicto("Esta instalación ya tiene datos")
    asegurar_categorias(sesion)
    guardar(sesion, "nombre", nombre.strip())
    if modo == "demo":
        from finanzas.servicios import demo  # demo usa los demás servicios

        demo.generar(uow)
        return
    for orden, (cuenta, tipo) in enumerate(CUENTAS_INICIALES):
        sesion.add(Cuenta(nombre=cuenta, tipo=tipo, saldo_inicial=0, orden=orden))
    uow.registrar(DominioCambio(("sistema", "cuentas", "categorias", "dashboard"), "crear"))
