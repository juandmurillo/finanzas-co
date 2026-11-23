"""Símbolo y color de cuentas y categorías: qué se acepta guardar.

El símbolo puede ser un ícono del set de Caudal («comida»), un logo empaquetado («/cuentas/x.svg»), un emoji
o una imagen pequeña que sube la persona (data URL PNG, JPEG o WebP; la app la reduce antes de enviarla).
"""

from __future__ import annotations

import re

COLORES = frozenset({*(f"chart-{i}" for i in range(1, 7)), *(f"cat-{i}" for i in range(1, 9))})
MAX_IMAGEN = 200_000  # caracteres del data URL (~150 KB)
_IMAGEN = re.compile(r"^data:image/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$")
_NOMBRE = re.compile(r"^[a-z_]{2,40}$")
_LOGO = re.compile(r"^/[A-Za-z0-9_./-]{1,120}$")


def simbolo_valido(valor: str | None) -> bool:
    if valor is None or valor == "":
        return True
    if valor.startswith("data:"):
        return len(valor) <= MAX_IMAGEN and bool(_IMAGEN.match(valor))
    if valor.startswith("/"):
        return bool(_LOGO.match(valor)) and ".." not in valor
    if _NOMBRE.match(valor):
        return True
    # Emoji (o un par de caracteres): corto y sin letras ni dígitos ASCII.
    return len(valor) <= 16 and not re.search(r"[A-Za-z0-9<>\"'&]", valor)


def color_valido(valor: str | None) -> bool:
    return valor is None or valor in COLORES
