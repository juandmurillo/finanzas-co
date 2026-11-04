"""Caso de uso: importar el export de Cashew (RF-IO-01).

- Deduplica por huella: reimportar el mismo archivo (o uno más nuevo) no duplica.
- Empareja las transferencias entre cuentas ("Corrección de equilibrio" con "Saldo transferido").
- Filas sin monto confirmado: los programados entran como 'pendiente'; los préstamos sin pagar
  (lent/borrowed) se omiten porque el usuario confirmó que están cancelados (28-oct-2026).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from functools import lru_cache
from pathlib import Path

from sqlalchemy import select

from finanzas.config import obtener_config
from finanzas.dominio.clasificacion import (
    PERFIL_GENERICO,
    FilaCashew,
    PerfilClasificacion,
    clasificar,
    perfil_desde_dict,
)
from finanzas.dominio.eventos import DominioCambio
from finanzas.dominio.grupos import Grupo
from finanzas.infra.lector_cashew import RegistroCashew, hash_archivo, leer_cashew
from finanzas.infra.modelos import HuellaFusionada, Importacion, Transaccion
from finanzas.infra.repositorios import (
    categoria_por_ruta,
    contraparte_por_nombre,
    cuenta_por_nombre,
    etiqueta_por_nombre,
)
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.transacciones import ahora

TIPOS_PROGRAMADOS = {"subscription", "repetitive", "upcoming"}
VENTANA_TRANSFERENCIA_SEG = 120
INVALIDA = ("transacciones", "cuentas", "categorias", "presupuesto", "reportes", "dashboard")


@dataclass
class ResultadoImportacion:
    filas_leidas: int = 0
    creadas: int = 0
    pendientes: int = 0
    duplicadas: int = 0
    omitidas: int = 0
    transferencias_emparejadas: int = 0
    archivo_repetido: bool = False
    avisos: list[str] = field(default_factory=list)


@lru_cache(maxsize=1)
def _perfil_de(ruta: Path | None) -> PerfilClasificacion:
    return perfil_desde_dict(json.loads(ruta.read_text(encoding="utf-8"))) if ruta else PERFIL_GENERICO


def perfil_activo() -> PerfilClasificacion:
    """El perfil genérico, o el archivo propio que indique `FINANZAS_PERFIL_CLASIFICACION`."""
    return _perfil_de(obtener_config().perfil_clasificacion)


def importar_cashew(uow: UnidadDeTrabajo, contenido: bytes, nombre_archivo: str) -> ResultadoImportacion:
    sesion = uow.sesion
    resultado = ResultadoImportacion()
    huella_archivo = hash_archivo(contenido)
    if sesion.scalar(select(Importacion).where(Importacion.hash_archivo == huella_archivo)):
        resultado.archivo_repetido = True
        return resultado

    registros = leer_cashew(contenido)
    resultado.filas_leidas = len(registros)
    existentes = set(sesion.scalars(select(Transaccion.huella).where(Transaccion.huella.is_not(None))))
    existentes |= set(sesion.scalars(select(HuellaFusionada.huella)))  # pagos unidos (fase 7) no reaparecen
    importacion = Importacion(
        origen="cashew",
        archivo=nombre_archivo,
        hash_archivo=huella_archivo,
        filas_leidas=len(registros),
        filas_creadas=0,
        duplicadas=0,
        creado_en=ahora(),
    )
    sesion.add(importacion)
    sesion.flush()

    transferencias: list[Transaccion] = []
    for registro in registros:
        if registro.huella in existentes:
            resultado.duplicadas += 1
            continue
        tx = _crear(uow, registro, importacion.id, resultado)
        if tx is None:
            continue
        existentes.add(registro.huella)
        if tx.categoria is not None and tx.categoria.grupo == Grupo.TRANSFERENCIA.value:
            transferencias.append(tx)

    sesion.flush()
    resultado.transferencias_emparejadas = _emparejar(transferencias)
    importacion.filas_creadas = resultado.creadas + resultado.pendientes
    importacion.duplicadas = resultado.duplicadas
    uow.registrar(DominioCambio(INVALIDA, "importar", (importacion.id,)))
    return resultado


def _crear(
    uow: UnidadDeTrabajo, registro: RegistroCashew, importacion_id: int, resultado: ResultadoImportacion
) -> Transaccion | None:
    sesion = uow.sesion
    estado = "confirmada"
    monto = registro.monto
    if monto is None:
        if registro.tipo in TIPOS_PROGRAMADOS and registro.monto_pendiente:
            estado, monto = "pendiente", registro.monto_pendiente
        else:
            resultado.omitidas += 1
            return None
    if monto == 0:
        resultado.omitidas += 1
        return None

    fila = FilaCashew(
        cuenta=registro.cuenta,
        monto=monto,
        titulo=registro.titulo,
        nota=registro.nota,
        categoria=registro.categoria,
        subcategoria=registro.subcategoria,
        tipo=registro.tipo,
    )
    clase = clasificar(fila, perfil_activo())
    cuenta = cuenta_por_nombre(sesion, registro.cuenta)
    categoria = categoria_por_ruta(sesion, clase.grupo, clase.categoria, clase.subcategoria)
    tipo_contraparte = "persona" if clase.grupo == Grupo.PRESTAMOS_PERSONALES else "cliente"
    contraparte = contraparte_por_nombre(sesion, clase.contraparte, tipo_contraparte)
    marca = ahora()
    tx = Transaccion(
        cuenta_id=cuenta.id,
        fecha=registro.fecha,
        monto=monto,
        categoria_id=categoria.id,
        descripcion=registro.titulo or registro.nota,
        nota=registro.nota if registro.titulo else "",
        contraparte_id=contraparte.id if contraparte else None,
        estado=estado,
        importacion_id=importacion_id,
        huella=registro.huella,
        origen_categoria=clase.origen,
        creado_en=marca,
        actualizado_en=marca,
    )
    tx.categoria = categoria
    tx.etiquetas = [etiqueta_por_nombre(sesion, nombre) for nombre in clase.etiquetas]
    sesion.add(tx)
    if estado == "pendiente":
        resultado.pendientes += 1
    else:
        resultado.creadas += 1
    return tx


def _emparejar(transferencias: list[Transaccion]) -> int:
    """Une salida y entrada del mismo monto, en cuentas distintas y con ≤ 2 minutos de diferencia."""
    salidas = [t for t in transferencias if t.monto < 0]
    entradas = [t for t in transferencias if t.monto > 0]
    usados: set[int] = set()
    pares = 0
    for salida in salidas:
        t_salida = datetime.fromisoformat(salida.fecha)
        candidata = None
        mejor = VENTANA_TRANSFERENCIA_SEG + 1.0
        for entrada in entradas:
            if entrada.id in usados or entrada.cuenta_id == salida.cuenta_id or entrada.monto != -salida.monto:
                continue
            diferencia = abs((datetime.fromisoformat(entrada.fecha) - t_salida).total_seconds())
            if diferencia < mejor:
                candidata, mejor = entrada, diferencia
        if candidata is not None:
            usados.add(candidata.id)
            salida.transferencia_id, candidata.transferencia_id = candidata.id, salida.id
            pares += 1
    return pares
