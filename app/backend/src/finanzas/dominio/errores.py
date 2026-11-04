"""Excepciones del dominio. La API las traduce a application/problem+json."""


class ErrorDominio(Exception):
    """Base de los errores de negocio."""

    estado_http = 400
    titulo = "Error de dominio"


class ErrorValidacion(ErrorDominio):
    titulo = "Datos inválidos"


class NoEncontrado(ErrorDominio):
    estado_http = 404
    titulo = "No encontrado"


class Conflicto(ErrorDominio):
    estado_http = 409
    titulo = "Conflicto"
