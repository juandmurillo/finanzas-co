"""Clasificación de movimientos de Cashew en grupo › categoría › subcategoría.

(lógica validada contra un análisis de referencia).
Funciones puras: sin I/O ni base de datos.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Any

from finanzas.dominio.grupos import Grupo

CATEGORIAS_UNIFICADAS = {"Préstamo": "Prestamo", "Movil": "Móvil"}
CASAS_APUESTA = (("rusbet", "Rushbet"), ("betplay", "Betplay"), ("rifa", "Rifa"))
ReglasSub = dict[str, list[tuple[tuple[str, ...], str]]]


@dataclass(frozen=True)
class PerfilClasificacion:
    """Lo que depende de cada persona al leer su historial de Cashew. Por defecto es genérico; un archivo propio
    (fuera del repositorio) agrega acreedores, clientes y sus propias reglas."""

    acreedores: tuple[tuple[str, str], ...] = ()  # (clave en la descripción, nombre del crédito)
    clientes: tuple[str, ...] = ()
    claves_reclamo: tuple[str, ...] = ()  # cobros en reclamo: no son gasto de vida mientras se resuelven
    # categoría de Cashew → (categoría de ingreso, subcategoría; vacía = la misma de Cashew)
    fuentes_ingreso: dict[str, tuple[str, str]] = field(default_factory=dict)
    reglas_subcategoria: ReglasSub = field(
        default_factory=lambda: {
            "factura": [
                (("internet", "hogar"), "Internet hogar"),
                (("pospago", "datos", "recarga"), "Celular"),
                (("netflix", "amazon", "spotify", "disney"), "Streaming"),
            ],
            "movil": [(("",), "Celular")],
            "universidad": [(("certificado", "recibo", "matricula"), "Trámites y certificados")],
            "regalo": [(("cumple",), "Cumpleaños")],
            "relaciones sociales": [(("",), "Salidas y celebraciones")],
            "compras": [
                (("monitor", "teclado", "mouse", "celular"), "Tecnología"),
                (("camiseta", "perfume", "ropa", "zapatos"), "Ropa"),
            ],
            "comida": [(("",), "Comida y snacks")],
            "otros": [(("documentos", "papeleo"), "Trámites"), (("barberia",), "Peluquería")],
            "ias": [(("",), "Suscripciones IA")],
        }
    )
    subcategoria_por_defecto: dict[str, str] = field(
        default_factory=lambda: {
            "factura": "Otras facturas",
            "regalo": "Otros regalos",
            "compras": "Hogar y otros",
            "otros": "Varios",
        }
    )


PERFIL_GENERICO = PerfilClasificacion()


@dataclass(frozen=True)
class FilaCashew:
    """Una fila del export de Cashew ya leída (montos en centavos)."""

    cuenta: str
    monto: int
    titulo: str
    nota: str
    categoria: str
    subcategoria: str
    tipo: str


@dataclass(frozen=True)
class Clasificacion:
    grupo: Grupo
    categoria: str
    subcategoria: str
    origen: str  # "cashew" | "descripcion" | "derivada"
    concepto: str = ""
    contraparte: str = ""
    etiquetas: tuple[str, ...] = ()


def normalizar(texto: str) -> str:
    """Minúsculas sin tildes ni espacios sobrantes."""
    plano = unicodedata.normalize("NFKD", texto or "").encode("ascii", "ignore").decode()
    return plano.strip().lower()


def _contiene(texto: str, claves: tuple[str, ...]) -> bool:
    return any(clave in texto for clave in claves)


def clasificar(fila: FilaCashew, perfil: PerfilClasificacion = PERFIL_GENERICO) -> Clasificacion:
    """Clasifica un movimiento de Cashew según el perfil de la persona."""
    cat = normalizar(fila.categoria)
    categoria = CATEGORIAS_UNIFICADAS.get(fila.categoria.strip(), fila.categoria.strip())
    texto = f"{normalizar(fila.titulo)} {normalizar(fila.nota)}"
    sub = fila.subcategoria.strip()
    monto = fila.monto

    if cat.startswith("correccion"):
        if "transfer" in texto:
            return Clasificacion(Grupo.TRANSFERENCIA, "Transferencia", "Entre cuentas", "derivada")
        return Clasificacion(Grupo.AJUSTE, "Ajuste de saldo", "Ajuste", "derivada")

    if cat == "prestamo" and monto > 0 and _contiene(texto, ("registro inicial", "initial record")):
        return Clasificacion(Grupo.FINANCIACION, "Desembolso de crédito", "Desembolso", "derivada")

    es_pago = cat == "prestamo" and monto < 0 and "pago" in texto
    if cat == "intereses" or es_pago:
        concepto = "Intereses" if cat == "intereses" else "Abono a capital"
        acreedor = next((nombre for clave, nombre in perfil.acreedores if clave in texto), "Otro crédito")
        origen = "descripcion" if acreedor != "Otro crédito" else "derivada"
        return Clasificacion(Grupo.SERVICIO_DEUDA, acreedor, concepto, origen, concepto=concepto)

    if cat == "prestamo":
        persona = (fila.titulo or fila.nota or "Sin nombre").strip().title()
        concepto = "Recibido de persona" if monto > 0 else "Entregado a persona"
        return Clasificacion(Grupo.PRESTAMOS_PERSONALES, "Préstamo personal", concepto, "derivada", concepto, persona)

    if cat == "apuesta":
        casa = next((nombre for clave, nombre in CASAS_APUESTA if clave in texto), "Sin detalle")
        concepto = "Ganancia" if monto > 0 else "Pérdida"
        return Clasificacion(Grupo.APUESTAS, "Apuestas", casa, "descripcion", concepto)

    if monto > 0:
        return _clasificar_ingreso(cat, categoria, texto, sub, perfil)

    if cat == "otros" and _contiene(texto, perfil.claves_reclamo):
        return Clasificacion(Grupo.GASTO_VIDA, categoria, "Cobro en reclamo", "descripcion", etiquetas=("reclamo",))
    if sub:
        return Clasificacion(Grupo.GASTO_VIDA, categoria, sub, "cashew")
    for claves, nombre in perfil.reglas_subcategoria.get(cat, []):
        if _contiene(texto, claves):
            return Clasificacion(Grupo.GASTO_VIDA, categoria, nombre, "descripcion")
    return Clasificacion(Grupo.GASTO_VIDA, categoria, perfil.subcategoria_por_defecto.get(cat, categoria), "derivada")


def _clasificar_ingreso(cat: str, categoria: str, texto: str, sub: str, perfil: PerfilClasificacion) -> Clasificacion:
    """Ingresos: trabajo, las fuentes propias del perfil y el resto en «Otros ingresos»."""
    cliente = next((c for c in perfil.clientes if c in texto), "")
    contraparte = cliente.upper() if len(cliente) <= 3 else cliente.title()
    if cat == "trabajo":
        origen = "cashew" if sub else "derivada"
        return Clasificacion(
            Grupo.INGRESO, "Trabajo independiente", sub or "Otros trabajos", origen, contraparte=contraparte
        )
    if cat in perfil.fuentes_ingreso:
        destino, nombre = perfil.fuentes_ingreso[cat]
        return Clasificacion(Grupo.INGRESO, destino, nombre or categoria, "derivada")
    if "devolucion" in texto:
        return Clasificacion(Grupo.INGRESO, "Otros ingresos", "Devoluciones", "descripcion")
    return Clasificacion(Grupo.INGRESO, "Otros ingresos", "Varios", "derivada")


def perfil_desde_dict(d: dict[str, Any]) -> PerfilClasificacion:
    """Construye el perfil desde un archivo JSON propio; lo que falte queda con el valor genérico."""
    base = PerfilClasificacion()
    reglas = d.get("reglas_subcategoria")
    return PerfilClasificacion(
        acreedores=tuple((a, b) for a, b in d.get("acreedores", [])),
        clientes=tuple(d.get("clientes", [])),
        claves_reclamo=tuple(d.get("claves_reclamo", [])),
        fuentes_ingreso={k: (v[0], v[1]) for k, v in d.get("fuentes_ingreso", {}).items()},
        reglas_subcategoria=(
            {k: [(tuple(c), n) for c, n in v] for k, v in reglas.items()} if reglas else base.reglas_subcategoria
        ),
        subcategoria_por_defecto=d.get("subcategoria_por_defecto", base.subcategoria_por_defecto),
    )
