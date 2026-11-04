"""Clasificador aprendido (RF-CA-05): sugiere la categoría de un movimiento nuevo.

Orden, de lo más fiable a lo menos (medido contra el historial real, ver `evaluar`):
1. Misma descripción ya usada → la categoría más reciente/usada para ella (acierta ~85 %).
2. Palabras de la descripción vistas antes → votación ponderada por rareza (tf-idf).
3. Diccionario general de comercios y conceptos colombianos.
4. Frecuencia reciente para el mismo signo (y el mismo monto exacto, que pesa más).
Funciones puras: el historial llega como lista y la resolución de nombres como diccionario.
"""

from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter, defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass

_PALABRAS_VACIAS = frozenset({"de", "la", "el", "en", "y", "a", "con", "para", "por", "del", "los", "las", "un", "una"})

# (claves, (categoría, subcategoría | None)). Las claves se buscan como inicio de palabra.
DICCIONARIO: tuple[tuple[tuple[str, ...], tuple[str, str | None]], ...] = (
    (
        ("netflix", "spotify", "prime video", "amazon prime", "paramount", "disney", "hbo", "crunchyroll"),
        ("Factura", "Streaming"),
    ),
    (("claude", "chatgpt", "openai", "gemini", "copilot", "midjourney", "cursor"), ("IAs", "Suscripciones IA")),
    (("claro", "tigo", "movistar", "wom", "pospago", "recarga", "plan de datos"), ("Factura", "Celular")),
    (("internet",), ("Factura", "Internet hogar")),
    (("betplay", "rushbet", "rusbet", "wplay", "codere", "bet365", "apuesta", "rifa"), ("Apuestas", None)),
    (
        (
            "uber",
            "didi",
            "indriver",
            "cabify",
            "taxi",
            "transmilenio",
            "sitp",
            "gasolina",
            "peaje",
            "soat",
            "tecnomecanica",
            "parqueadero",
        ),
        ("Transporte", None),
    ),
    (
        (
            "almuerzo",
            "desayuno",
            "cena",
            "mercado",
            "rappi",
            "kfc",
            "mcdonald",
            "hamburguesa",
            "pizza",
            "empanada",
            "helado",
            "cafe",
            "gaseosa",
            "snack",
            "onces",
            "frutas",
        ),
        ("Comida", "Comida y snacks"),
    ),
    (
        (
            "shein",
            "temu",
            "camiseta",
            "camisa",
            "pantalon",
            "zapatos",
            "tenis",
            "chanclas",
            "ropa",
            "sudadera",
            "pijama",
            "medias",
        ),
        ("Compras", "Ropa"),
    ),
    (("monitor", "teclado", "mouse", "audifonos", "cargador", "usb", "memoria"), ("Compras", "Tecnología")),
    (("aseo", "jabon", "shampoo", "detergente", "pilas", "bombillo"), ("Compras", "Hogar y otros")),
    (("barberia", "peluqueria", "corte de pelo"), ("Otros", "Peluquería")),
    (("libreta", "documentos", "papeleo", "notaria", "fotocopias"), ("Otros", "Trámites")),
    (("cumple", "regalo"), ("Regalo", None)),
    (("gym", "gimnasio", "futbol", "cancha", "natacion", "piscina"), ("Salud física", None)),
    (("drogueria", "farmacia", "medicamento", "medico", "odontologo"), ("Salud", None)),
    (("matricula", "semestre", "universidad"), ("Universidad", None)),
    (("devolucion", "reembolso"), ("Otros ingresos", "Devoluciones")),
)


def normalizar(texto: str) -> str:
    """Minúsculas, sin tildes ni signos; conserva los dígitos ("Pago cuota 2" ≠ "Pago cuota 3")."""
    plano = unicodedata.normalize("NFKD", (texto or "").lower())
    plano = "".join(c for c in plano if not unicodedata.combining(c))
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]", " ", plano)).strip()


def palabras(texto: str) -> list[str]:
    return [p for p in normalizar(texto).split() if (len(p) >= 3 or p.isdigit()) and p not in _PALABRAS_VACIAS]


@dataclass(frozen=True)
class Ejemplo:
    """Un movimiento ya categorizado del historial, en orden cronológico."""

    descripcion: str
    monto: int
    categoria_id: int


@dataclass(frozen=True)
class Sugerencia:
    categoria_id: int
    via: str  # "historial" | "palabras" | "diccionario" | "frecuencia"
    confianza: float  # 0..1, proporción de votos de la primera opción


# Resuelve (categoría, subcategoría | None) del diccionario a un id del catálogo del usuario.
Resolver = Callable[[str, str | None, Sequence[Ejemplo]], int | None]


def _ranking(votos: dict[int, float], via: str, limite: int) -> list[Sugerencia]:
    total = sum(votos.values()) or 1
    mejores = sorted(votos.items(), key=lambda kv: -kv[1])[:limite]
    return [Sugerencia(c, via, round(v / total, 2)) for c, v in mejores]


def sugerir(
    historial: Sequence[Ejemplo], descripcion: str, monto: int, resolver: Resolver | None = None, limite: int = 3
) -> list[Sugerencia]:
    signo = monto > 0
    mismos = [e for e in historial if (e.monto > 0) == signo]
    clave = normalizar(descripcion)
    if clave:
        votos: dict[int, float] = defaultdict(float)
        iguales = [e for e in mismos if normalizar(e.descripcion) == clave]
        for edad, e in enumerate(reversed(iguales[-8:])):  # la más reciente pesa más
            votos[e.categoria_id] += 0.6**edad
        if votos:
            return _ranking(votos, "historial", limite)

        buscadas = set(palabras(descripcion))
        frecuencia: Counter[str] = Counter()
        por_palabra: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
        n = len(mismos) or 1
        for i, e in enumerate(mismos):
            for p in set(palabras(e.descripcion)) & buscadas:
                frecuencia[p] += 1
                por_palabra[p][e.categoria_id] += 1 + i / n
        for p in buscadas:
            for cat_id, k in por_palabra[p].items():
                votos[cat_id] += k / frecuencia[p] * math.log(1 + n / frecuencia[p])
        if votos:
            return _ranking(votos, "palabras", limite)

        if resolver is not None:
            texto = f" {clave} "
            for claves, (categoria, sub) in DICCIONARIO:
                clave_hallada = next((k for k in claves if f" {k}" in texto), None)
                if clave_hallada is None:
                    continue
                # "uber" → Transporte › Uber si existe esa subcategoría; si no, la sugerida o la más usada
                ident = resolver(categoria, sub or clave_hallada.title(), mismos) or resolver(categoria, None, mismos)
                if ident is not None:
                    return [Sugerencia(ident, "diccionario", 0.5)]

    frecuentes: dict[int, float] = defaultdict(float)
    for e in mismos[-120:]:
        frecuentes[e.categoria_id] += 3 if e.monto == monto else 1
    return _ranking(frecuentes, "frecuencia", limite)


@dataclass(frozen=True)
class Evaluacion:
    casos: int
    acierto: float  # la primera sugerencia es la categoría final
    acierto_top3: float
    con_descripcion: int
    acierto_con_descripcion: float
    acierto_top3_con_descripcion: float


def evaluar(
    historial: Sequence[Ejemplo],
    ultimos: int = 200,
    resolver: Resolver | None = None,
    equivalentes: Callable[[int, int], bool] | None = None,
) -> Evaluacion:
    """Prueba retrospectiva: predice cada uno de los últimos N solo con lo anterior a él."""
    igual = equivalentes or (lambda a, b: a == b)
    casos = aciertos = top3 = cd = cd_aciertos = cd_top3 = 0
    for i in range(max(0, len(historial) - ultimos), len(historial)):
        e = historial[i]
        opciones = sugerir(historial[:i], e.descripcion, e.monto, resolver)
        primero = bool(opciones) and igual(opciones[0].categoria_id, e.categoria_id)
        alguna = any(igual(o.categoria_id, e.categoria_id) for o in opciones)
        casos += 1
        aciertos += primero
        top3 += alguna
        if normalizar(e.descripcion):
            cd += 1
            cd_aciertos += primero
            cd_top3 += alguna

    def tasa(a: int, b: int) -> float:
        return round(a / b, 3) if b else 0.0

    return Evaluacion(casos, tasa(aciertos, casos), tasa(top3, casos), cd, tasa(cd_aciertos, cd), tasa(cd_top3, cd))
