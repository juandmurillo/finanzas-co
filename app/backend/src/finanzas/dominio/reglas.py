"""Motor de reglas (RF-CA-04): SI la descripción, el monto o la cuenta cumplen X ENTONCES asignar
categoría o etiqueta. Se ejecuta al crear e importar cuando el movimiento llega sin categoría.
Todas las condiciones de una regla deben cumplirse; gana la regla de menor prioridad."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

from finanzas.dominio.clasificador import normalizar
from finanzas.dominio.errores import ErrorValidacion

Campo = Literal["descripcion", "monto", "cuenta_id", "tipo"]
Operador = Literal["contiene", "empieza", "igual", "mayor", "menor", "entre"]
OPERADORES_TEXTO = {"contiene", "empieza", "igual"}
OPERADORES_NUMERO = {"igual", "mayor", "menor", "entre"}


@dataclass(frozen=True)
class Condicion:
    campo: Campo
    op: Operador
    valor: str | int
    valor2: int | None = None  # tope de "entre"


@dataclass(frozen=True)
class Acciones:
    categoria_id: int | None = None
    etiquetas: tuple[str, ...] = ()


@dataclass(frozen=True)
class Regla:
    id: int
    nombre: str
    prioridad: int
    condiciones: tuple[Condicion, ...]
    acciones: Acciones
    activa: bool = True


@dataclass(frozen=True)
class Movimiento:
    descripcion: str
    monto: int
    cuenta_id: int


@dataclass
class Resultado:
    categoria_id: int | None = None
    etiquetas: list[str] = field(default_factory=list)
    regla_id: int | None = None


def validar(condiciones: tuple[Condicion, ...], acciones: Acciones) -> None:
    if not condiciones:
        raise ErrorValidacion("La regla necesita al menos una condición")
    if acciones.categoria_id is None and not acciones.etiquetas:
        raise ErrorValidacion("La regla debe asignar una categoría o una etiqueta")
    for c in condiciones:
        if c.campo == "descripcion":
            if c.op not in OPERADORES_TEXTO or not normalizar(str(c.valor)):
                raise ErrorValidacion("La condición de descripción necesita un texto y 'contiene', 'empieza' o 'igual'")
        elif c.campo == "tipo":
            if c.valor not in ("gasto", "ingreso"):
                raise ErrorValidacion("El tipo debe ser 'gasto' o 'ingreso'")
        elif c.op not in OPERADORES_NUMERO or not isinstance(c.valor, int):
            raise ErrorValidacion(f"La condición de {c.campo} necesita un número")
        elif c.op == "entre" and (c.valor2 is None or c.valor2 < c.valor):
            raise ErrorValidacion("'entre' necesita un tope mayor o igual al inicio")


def cumple(c: Condicion, m: Movimiento) -> bool:
    if c.campo == "descripcion":
        texto, buscado = normalizar(m.descripcion), normalizar(str(c.valor))
        if c.op == "contiene":
            return buscado in texto
        if c.op == "empieza":
            return texto.startswith(buscado)
        return texto == buscado
    if c.campo == "tipo":
        return (m.monto < 0) == (c.valor == "gasto")
    actual = abs(m.monto) if c.campo == "monto" else m.cuenta_id  # el monto se compara sin signo
    valor = int(c.valor)
    if c.op == "igual":
        return actual == valor
    if c.op == "mayor":
        return actual > valor
    if c.op == "menor":
        return actual < valor
    return valor <= actual <= (c.valor2 if c.valor2 is not None else valor)


def aplicar(reglas: list[Regla], m: Movimiento) -> Resultado:
    """La primera regla activa (por prioridad, luego id) que cumple define la categoría; las
    etiquetas de todas las reglas que cumplen se suman."""
    resultado = Resultado()
    for regla in sorted((r for r in reglas if r.activa), key=lambda r: (r.prioridad, r.id)):
        if all(cumple(c, m) for c in regla.condiciones):
            if resultado.categoria_id is None and regla.acciones.categoria_id is not None:
                resultado.categoria_id = regla.acciones.categoria_id
                resultado.regla_id = regla.id
            resultado.etiquetas += [e for e in regla.acciones.etiquetas if e not in resultado.etiquetas]
    return resultado
