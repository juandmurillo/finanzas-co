"""Color e ícono sugeridos para cada categoría, según su nombre y grupo.

La persona los puede cambiar después en Categorías › Administrar; estos valores solo llenan los vacíos para que
cada categoría tenga el mismo color e ícono en todas las pantallas y gráficas, sin importar el tema.
Las subcategorías heredan el color de su categoría (solo reciben ícono propio si su nombre lo sugiere).
"""

from __future__ import annotations

import re
import unicodedata

# (patrón en el nombre, ícono, color preferido)
_REGLAS: list[tuple[str, str, str]] = [
    (r"casa|hogar|arriendo|vivienda", "inicio", "cat-1"),
    (r"comida|mercado|restaurante|snack|domicilio|almuerzo", "comida", "cat-2"),
    (r"transporte|moto|uber|taxi|gasolina|bus|transmilenio", "ruta", "cat-7"),
    (r"movil|celular|telefon|plan de datos", "telefono", "cat-3"),
    (r"internet|wifi", "wifi", "cat-1"),
    (r"factura|servicio|recibo|luz|agua|gas", "documento", "cat-4"),
    (r"salud fisica|gym|gimnasio|futbol|natacion|deporte", "balon", "cat-6"),
    (r"salud|medic|farmacia|droga|odonto|eps", "escudo", "cat-8"),
    (r"social|relacion|pareja|amigo|celebrac|salida", "corazon", "cat-5"),
    (r"regalo|cumple", "regalo", "cat-5"),
    (r"compra|ropa|tecnolog|hogar y otros", "bolsa", "cat-2"),
    (r"universidad|educa|curso|estudio|colegio|libro", "documento", "cat-7"),
    (r"\bias?\b|inteligencia|suscrip|streaming|nube", "recurrentes", "cat-7"),
    (r"inversion|ahorro|cdt|fondo", "activos", "cat-6"),
    (r"peluquer|belleza|cuidado personal", "paleta", "cat-5"),
    (r"padre|madre|familia|hijo|herman", "persona", "cat-3"),
    (r"trabajo|freelance|independiente|honorario|salario|nomina", "cuentas", "cat-1"),
    (r"monitor|clase|tutor", "documento", "cat-3"),
    (r"credito|tarjeta|cuota|deuda", "deudas", "cat-8"),
    (r"apuesta|casino|loteria", "dado", "cat-8"),
    (r"prestamo", "persona", "cat-4"),
    (r"transferencia", "movimientos", "cat-1"),
    (r"ajuste", "ajustes", "cat-4"),
    (r"desembolso", "entra", "cat-3"),
]

# Ícono y color por grupo cuando el nombre no dice nada.
_GRUPO: dict[str, tuple[str, str]] = {
    "ingreso": ("entra", "cat-3"),
    "apuestas": ("dado", "cat-8"),
    "servicio_deuda": ("deudas", "cat-8"),
    "financiacion": ("deudas", "cat-4"),
    "prestamos_personales": ("persona", "cat-4"),
    "transferencia": ("movimientos", "cat-1"),
    "ajuste": ("ajustes", "cat-4"),
    "ahorro_inversion": ("activos", "cat-6"),
}

COLORES = [f"cat-{i}" for i in range(1, 9)]


def _normal(texto: str) -> str:
    sin_tildes = unicodedata.normalize("NFKD", texto).encode("ascii", "ignore").decode()
    return sin_tildes.lower()


def sugerir(nombre: str, grupo: str) -> tuple[str | None, str | None]:
    """(ícono, color) sugeridos por el nombre; (None, None) si el nombre no los sugiere."""
    texto = _normal(nombre)
    for patron, icono, color in _REGLAS:
        if re.search(patron, texto):
            return icono, color
    return None, None


def estilo_categoria(nombre: str, grupo: str, usados: set[str]) -> tuple[str, str]:
    """Ícono y color para una categoría (nivel 2). Evita repetir colores del mismo grupo mientras haya libres."""
    icono, color = sugerir(nombre, grupo)
    icono_g, color_g = _GRUPO.get(grupo, ("categorias", "cat-1"))
    icono = icono or icono_g
    color = color or color_g
    if color in usados:
        libres = [c for c in COLORES if c not in usados]
        if libres:
            color = libres[0]
    return icono, color


def estilo_nueva(nombre: str, grupo: str, nivel: int, colores_hermanas: set[str]) -> tuple[str | None, str | None]:
    """(ícono, color) para una categoría que se crea sin estilo. Nivel 2: ícono y color; nivel 3: solo un
    ícono si el nombre lo sugiere (el color se hereda de la categoría)."""
    if nivel == 2:
        return estilo_categoria(nombre, grupo, colores_hermanas)
    if nivel == 3:
        return sugerir(nombre, grupo)[0], None
    return None, None
