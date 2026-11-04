"""Grupos (nivel 1 de la jerarquía de categorías)."""

from enum import StrEnum


class Grupo(StrEnum):
    INGRESO = "ingreso"
    GASTO_VIDA = "gasto_vida"
    SERVICIO_DEUDA = "servicio_deuda"
    APUESTAS = "apuestas"
    AHORRO_INVERSION = "ahorro_inversion"
    PRESTAMOS_PERSONALES = "prestamos_personales"
    FINANCIACION = "financiacion"
    TRANSFERENCIA = "transferencia"
    AJUSTE = "ajuste"


NOMBRES_GRUPO: dict[Grupo, str] = {
    Grupo.INGRESO: "Ingreso",
    Grupo.GASTO_VIDA: "Gasto de vida",
    Grupo.SERVICIO_DEUDA: "Servicio de deuda",
    Grupo.APUESTAS: "Apuestas",
    Grupo.AHORRO_INVERSION: "Ahorro e inversión",
    Grupo.PRESTAMOS_PERSONALES: "Préstamos personales",
    Grupo.FINANCIACION: "Financiación",
    Grupo.TRANSFERENCIA: "Transferencia",
    Grupo.AJUSTE: "Ajuste",
}

# Grupos que no cuentan como ingreso ni gasto en el flujo operativo.
GRUPOS_NEUTROS = frozenset({Grupo.TRANSFERENCIA, Grupo.AJUSTE, Grupo.FINANCIACION, Grupo.PRESTAMOS_PERSONALES})
