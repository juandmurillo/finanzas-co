"""Herramienta del asistente: una función con nombre, descripción y esquema JSON, sin depender de ningún SDK.

El esquema sale de la firma y la sección «Args:» del docstring. Así el asistente funciona con los proveedores
compatibles con OpenAI aunque el SDK de Anthropic no esté instalado (por ejemplo, en Android)."""

from __future__ import annotations

import inspect
from collections.abc import Callable
from typing import Any, get_type_hints

from pydantic import ConfigDict, Field, create_model


def _descripciones(docstring: str) -> tuple[str, dict[str, str]]:
    resumen, _, bloque = docstring.partition("Args:")
    argumentos: dict[str, str] = {}
    actual: str | None = None
    for linea in bloque.splitlines():
        texto = linea.strip()
        nombre, separador, resto = texto.partition(":")
        if separador and nombre.isidentifier():
            actual = nombre
            argumentos[actual] = resto.strip()
        elif texto and actual:
            argumentos[actual] += f" {texto}"
    return " ".join(resumen.split()), argumentos


class Herramienta:
    def __init__(self, funcion: Callable[..., str]) -> None:
        self.funcion = funcion
        self.name = funcion.__name__
        self.description, descripciones = _descripciones(inspect.getdoc(funcion) or "")
        tipos = get_type_hints(funcion)
        campos: dict[str, Any] = {}
        for nombre, parametro in inspect.signature(funcion).parameters.items():
            defecto = ... if parametro.default is inspect.Parameter.empty else parametro.default
            campos[nombre] = (tipos.get(nombre, str), Field(default=defecto, description=descripciones.get(nombre)))
        self._modelo = create_model(f"{self.name}_args", __config__=ConfigDict(extra="forbid"), **campos)
        self.input_schema: dict[str, Any] = self._modelo.model_json_schema()

    def call(self, argumentos: dict[str, Any]) -> str:
        """Valida lo que mandó el modelo antes de ejecutar; un argumento inválido lanza un error que se le devuelve."""
        return self.funcion(**self._modelo(**argumentos).model_dump())


def herramienta(funcion: Callable[..., str]) -> Herramienta:
    return Herramienta(funcion)
