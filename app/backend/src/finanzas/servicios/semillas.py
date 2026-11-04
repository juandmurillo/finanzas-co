"""Caso de uso: sembrar parámetros de Colombia, categorías base y lo que traiga el archivo de semillas. Idempotente."""

from __future__ import annotations

from sqlalchemy import select

from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.modelos import Credito, CreditoExtracto, Cuenta, Parametro
from finanzas.infra.repositorios import cuenta_por_nombre
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.semillas.datos import cargar_semillas
from finanzas.servicios.parametros import asegurar_publicos
from finanzas.servicios.sistema import asegurar_categorias


def sembrar(uow: UnidadDeTrabajo) -> dict[str, int]:
    sesion = uow.sesion
    semillas = cargar_semillas()
    creados = {"cuentas": 0, "parametros": 0, "creditos": 0, "categorias": asegurar_categorias(sesion)}
    for datos in semillas["cuentas"]:
        if sesion.scalar(select(Cuenta).where(Cuenta.nombre == datos["nombre"])) is None:
            sesion.add(Cuenta(**datos, saldo_inicial=0))
            creados["cuentas"] += 1
    sesion.flush()
    for datos in semillas["parametros"]:
        if sesion.get(Parametro, (datos["clave"], datos["vigencia_desde"])) is None:
            sesion.add(Parametro(**datos))
            creados["parametros"] += 1
    creados["parametros"] += asegurar_publicos(sesion)  # UVT y SMMLV verificados (públicos, no personales)
    for datos in semillas["creditos"]:
        if sesion.scalar(select(Credito).where(Credito.nombre == datos["nombre"])) is not None:
            continue
        campos = {k: v for k, v in datos.items() if k not in ("extracto", "cuenta_pago")}
        credito = Credito(**campos, cuenta_pago_id=cuenta_por_nombre(sesion, datos["cuenta_pago"]).id)
        sesion.add(credito)
        sesion.flush()
        sesion.add(CreditoExtracto(credito_id=credito.id, **datos["extracto"]))
        creados["creditos"] += 1
    if any(creados.values()):
        uow.registrar(DominioCambio(("cuentas", "creditos", "parametros"), "sembrar"))
    return creados
