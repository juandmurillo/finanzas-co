"""Lectura del CSV exportado por Cashew (sin reglas de negocio)."""

from __future__ import annotations

import csv
import hashlib
import io
from collections import Counter
from dataclasses import dataclass
from datetime import datetime
from zoneinfo import ZoneInfo

from finanzas.dominio.dinero import a_centavos
from finanzas.dominio.errores import ErrorValidacion

ZONA = ZoneInfo("America/Bogota")
COLUMNAS_REQUERIDAS = {"account", "amount", "amount unpaid", "title", "note", "date", "category name", "type"}


@dataclass(frozen=True)
class RegistroCashew:
    cuenta: str
    monto: int | None  # None = programado/pendiente (solo trae "amount unpaid")
    monto_pendiente: int | None
    titulo: str
    nota: str
    fecha: str  # ISO con zona de Bogotá
    categoria: str
    subcategoria: str
    tipo: str
    huella: str


def _fecha(valor: str) -> str:
    try:
        fecha = datetime.strptime(valor.strip()[:19], "%Y-%m-%d %H:%M:%S")
    except ValueError as exc:
        raise ErrorValidacion(f"Fecha de Cashew inválida: {valor!r}") from exc
    return fecha.replace(tzinfo=ZONA).isoformat(timespec="seconds")


def _monto(valor: str) -> int | None:
    return a_centavos(valor) if valor and valor.strip() else None


def leer_cashew(contenido: bytes) -> list[RegistroCashew]:
    """Parsea el CSV. La huella incluye un contador para filas idénticas legítimas."""
    texto = contenido.decode("utf-8-sig")
    lector = csv.DictReader(io.StringIO(texto))
    faltantes = COLUMNAS_REQUERIDAS - set(lector.fieldnames or [])
    if faltantes:
        raise ErrorValidacion(f"El archivo no parece un export de Cashew; faltan columnas: {sorted(faltantes)}")
    vistos: Counter[str] = Counter()
    registros: list[RegistroCashew] = []
    for fila in lector:
        base = "|".join(
            (fila["account"], fila["date"], fila["amount"], fila["amount unpaid"], fila["title"], fila["note"])
        )
        vistos[base] += 1
        huella = hashlib.sha1(f"{base}|{vistos[base]}".encode()).hexdigest()
        registros.append(
            RegistroCashew(
                cuenta=fila["account"].strip(),
                monto=_monto(fila["amount"]),
                monto_pendiente=_monto(fila["amount unpaid"]),
                titulo=(fila["title"] or "").strip(),
                nota=(fila["note"] or "").strip(),
                fecha=_fecha(fila["date"]),
                categoria=(fila["category name"] or "").strip(),
                subcategoria=(fila.get("subcategory name") or "").strip(),
                tipo=(fila["type"] or "").strip(),
                huella=huella,
            )
        )
    return registros


def hash_archivo(contenido: bytes) -> str:
    return hashlib.sha256(contenido).hexdigest()
