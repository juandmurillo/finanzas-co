"""Reportes de análisis (fase 4): flujo y Sankey, categorías, descripciones, apuestas y revisión mensual.

Resumen de movimientos: solo movimientos confirmados, los cobros en
reclamo fuera, y los montos de salida en positivo (gastar $10.000 = 10.000 de gasto).
"""

from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from typing import Any, Literal

from sqlalchemy import text
from sqlalchemy.orm import Session

from finanzas.dominio.fechas import hoy_bogota
from finanzas.dominio.grupos import GRUPOS_NEUTROS, NOMBRES_GRUPO, Grupo
from finanzas.infra.consultas import _EN_RECLAMO

# Grupos cuyo total se muestra como salida (positivo = dinero que salió).
_SALIDAS = {Grupo.GASTO_VIDA, Grupo.SERVICIO_DEUDA, Grupo.AHORRO_INVERSION}


# Ingresos y Gastos con todo incluido; se cumple siempre Ingresos − Gastos = flujo operativo. Las apuestas van por
# movimiento (lo apostado a gastos, lo ganado a ingresos) para que los totales sumen igual en cualquier periodo.
Conjunto = Literal["gastos", "ingresos"]


@dataclass(frozen=True)
class Mov:
    fecha: str
    mes: str
    grupo: Grupo
    categoria: str  # nivel 2
    subcategoria: str | None  # nivel 3
    descripcion: str
    monto: int


def _movimientos(sesion: Session, desde: str | None, hasta: str | None) -> list[Mov]:
    filas = sesion.execute(
        text(
            f"""
            SELECT t.fecha, substr(t.fecha, 1, 7) AS mes, t.monto, t.descripcion,
                   COALESCE(c.grupo, CASE WHEN t.monto > 0 THEN 'ingreso' ELSE 'gasto_vida' END) AS grupo,
                   CASE WHEN c.id IS NULL THEN 'Sin categoría' WHEN c.nivel = 3 THEN p.nombre ELSE c.nombre END
                       AS categoria,
                   CASE WHEN c.nivel = 3 THEN c.nombre END AS subcategoria
            FROM transaccion t
            LEFT JOIN categoria c ON c.id = t.categoria_id
            LEFT JOIN categoria p ON p.id = c.padre_id
            WHERE t.estado = 'confirmada' AND NOT {_EN_RECLAMO}
              AND (:desde IS NULL OR substr(t.fecha, 1, 7) >= :desde)
              AND (:hasta IS NULL OR substr(t.fecha, 1, 7) <= :hasta)
            ORDER BY t.fecha
            """
        ),
        {"desde": desde, "hasta": hasta},
    ).mappings()
    return [
        Mov(f["fecha"], f["mes"], Grupo(f["grupo"]), f["categoria"], f["subcategoria"], f["descripcion"], f["monto"])
        for f in filas
    ]


def _meses_entre(desde: str, hasta: str) -> list[str]:
    a, m = int(desde[:4]), int(desde[5:7])
    salida = []
    while f"{a:04d}-{m:02d}" <= hasta:
        salida.append(f"{a:04d}-{m:02d}")
        a, m = (a + 1, 1) if m == 12 else (a, m + 1)
    return salida


def _rango(movs: list[Mov], desde: str | None, hasta: str | None) -> list[str]:
    """Meses del periodo, acotados a los que tienen datos (así lo calcula el libro de referencia)."""
    if not movs:
        return []
    return _meses_entre(max(desde or movs[0].mes, movs[0].mes), min(hasta or movs[-1].mes, movs[-1].mes))


def _valor(m: Mov) -> int:
    """Monto con el signo del reporte: salidas en positivo, ingresos y apuestas (neto) tal cual."""
    return -m.monto if m.grupo in _SALIDAS else m.monto


def _en_conjunto(m: Mov, conjunto: Conjunto) -> bool:
    if m.grupo is Grupo.APUESTAS:
        return m.monto > 0 if conjunto == "ingresos" else m.monto < 0
    return m.grupo is Grupo.INGRESO if conjunto == "ingresos" else m.grupo in _SALIDAS


def _valor_en(m: Mov, conjunto: Conjunto) -> int:
    return m.monto if conjunto == "ingresos" else -m.monto


# ---------- Flujo ----------
def mensual(sesion: Session, desde: str | None = None, hasta: str | None = None) -> dict[str, Any]:
    movs = _movimientos(sesion, desde, hasta)
    meses = _rango(movs, desde, hasta)
    por_mes: dict[str, dict[Grupo, int]] = {m: defaultdict(int) for m in meses}
    conjuntos: dict[str, dict[Conjunto, int]] = {m: {"gastos": 0, "ingresos": 0} for m in meses}
    for m in movs:
        if m.mes in por_mes:
            por_mes[m.mes][m.grupo] += m.monto
            for conjunto in ("gastos", "ingresos"):
                if _en_conjunto(m, conjunto):
                    conjuntos[m.mes][conjunto] += _valor_en(m, conjunto)
    filas: list[dict[str, Any]] = []
    for mes in meses:
        g = por_mes[mes]
        operativo = sum(v for k, v in g.items() if k not in GRUPOS_NEUTROS)
        filas.append(
            {
                "mes": mes,
                "ingresos": g[Grupo.INGRESO],
                "ingresos_total": conjuntos[mes]["ingresos"],
                "gastos_total": conjuntos[mes]["gastos"],
                "gasto_vida": -g[Grupo.GASTO_VIDA],
                "servicio_deuda": -g[Grupo.SERVICIO_DEUDA],
                "apuestas_neto": g[Grupo.APUESTAS],
                "ahorro": -g[Grupo.AHORRO_INVERSION],
                "prestamos_neto": g[Grupo.PRESTAMOS_PERSONALES],
                "financiacion": g[Grupo.FINANCIACION],
                "flujo_operativo": operativo,
                "flujo_neto": operativo + g[Grupo.PRESTAMOS_PERSONALES] + g[Grupo.FINANCIACION],
            }
        )
    claves = [k for k in (filas[0] if filas else {}) if k != "mes"]
    totales = {k: sum(f[k] for f in filas) for k in claves}
    n = len(filas) or 1
    return {
        "meses": filas,
        "totales": totales,
        "promedios": {k: round(v / n) for k, v in totales.items()},
    }


def sankey(sesion: Session, desde: str | None = None, hasta: str | None = None, top: int = 7) -> dict[str, Any]:
    """Fuentes de ingreso → Disponible → grupos de salida → categorías de gasto de vida."""
    movs = _movimientos(sesion, desde, hasta)
    fuentes: dict[str, int] = defaultdict(int)
    salidas: dict[str, int] = defaultdict(int)
    gasto_cat: dict[str, int] = defaultdict(int)
    apuestas = 0
    for m in movs:
        if m.grupo is Grupo.INGRESO:
            fuentes[m.categoria] += m.monto
        elif m.grupo in _SALIDAS:
            salidas[NOMBRES_GRUPO[m.grupo]] += -m.monto
            if m.grupo is Grupo.GASTO_VIDA:
                gasto_cat[m.categoria] += -m.monto
        elif m.grupo is Grupo.APUESTAS:
            apuestas += m.monto
    if apuestas < 0:
        salidas["Apuestas (pérdida)"] = -apuestas
    elif apuestas > 0:
        fuentes["Apuestas (ganancia)"] = apuestas
    entradas, total_salidas = sum(fuentes.values()), sum(salidas.values())
    if total_salidas > entradas:
        fuentes["Déficit (deuda o ahorros)"] = total_salidas - entradas
    elif entradas > total_salidas:
        salidas["Sobrante"] = entradas - total_salidas

    enlaces: list[dict[str, Any]] = [
        {"origen": f, "destino": "Disponible", "valor": v} for f, v in fuentes.items() if v > 0
    ]
    enlaces += [{"origen": "Disponible", "destino": s, "valor": v} for s, v in salidas.items() if v > 0]
    orden = sorted(gasto_cat.items(), key=lambda kv: -kv[1])
    principales, resto = orden[:top], sum(v for _, v in orden[top:])
    nombre_vida = NOMBRES_GRUPO[Grupo.GASTO_VIDA]
    enlaces += [{"origen": nombre_vida, "destino": c, "valor": v} for c, v in principales if v > 0]
    if resto > 0:
        enlaces.append({"origen": nombre_vida, "destino": "Otras categorías", "valor": resto})
    nodos: list[str] = []
    for e in enlaces:
        for n in (e["origen"], e["destino"]):
            if n not in nodos:
                nodos.append(n)
    return {"nodos": nodos, "enlaces": enlaces, "entradas": entradas, "salidas": total_salidas}


# ---------- Categorías ----------
def categorias(
    sesion: Session,
    desde: str | None = None,
    hasta: str | None = None,
    grupo: Grupo = Grupo.GASTO_VIDA,
    conjunto: Conjunto | None = None,
) -> dict[str, Any]:
    """Árbol categoría › subcategoría con total, movimientos, promedio mensual, % y tendencia por mes.
    Con `conjunto`, reúne todos los gastos o todos los ingresos en lugar de un solo grupo."""
    movs = _movimientos(sesion, desde, hasta)
    meses = _rango(movs, desde, hasta)
    n_meses = len(meses) or 1
    del_grupo = [m for m in movs if (_en_conjunto(m, conjunto) if conjunto else m.grupo is grupo)]

    def valor(m: Mov) -> int:
        return _valor_en(m, conjunto) if conjunto else _valor(m)

    total_grupo = sum(valor(m) for m in del_grupo)

    cats: dict[str, dict[str, Any]] = {}
    for m in del_grupo:
        c = cats.setdefault(m.categoria, {"total": 0, "n": 0, "por_mes": defaultdict(int), "subs": {}})
        v = valor(m)
        c["total"] += v
        c["n"] += 1
        c["por_mes"][m.mes] += v
        if m.subcategoria:
            s = c["subs"].setdefault(m.subcategoria, {"total": 0, "n": 0})
            s["total"] += v
            s["n"] += 1

    def pct(v: int, base: int) -> float:
        return v / base if base else 0.0

    filas = []
    for nombre, c in sorted(cats.items(), key=lambda kv: -kv[1]["total"]):
        filas.append(
            {
                "categoria": nombre,
                "total": c["total"],
                "n": c["n"],
                "promedio_mensual": round(c["total"] / n_meses),
                "pct": pct(c["total"], total_grupo),
                "tendencia": [c["por_mes"].get(mes, 0) for mes in meses],
                "subcategorias": [
                    {
                        "subcategoria": s,
                        "total": d["total"],
                        "n": d["n"],
                        "ticket": round(d["total"] / d["n"]),
                        "promedio_mensual": round(d["total"] / n_meses),
                        "pct_categoria": pct(d["total"], c["total"]),
                        "pct_grupo": pct(d["total"], total_grupo),
                    }
                    for s, d in sorted(c["subs"].items(), key=lambda kv: -kv[1]["total"])
                ],
            }
        )
    return {
        "grupo": conjunto or grupo.value,
        "meses": meses,
        "ranking_subcategorias": _ranking(del_grupo, total_grupo, n_meses, valor),
        "total": total_grupo,
        "n": len(del_grupo),
        "promedio_mensual": round(total_grupo / n_meses),
        "categorias": filas,
    }


def _ranking(movs: list[Mov], total_grupo: int, n_meses: int, valor: Callable[[Mov], int]) -> list[dict[str, Any]]:
    """Cada subcategoría como categoría propia, unida por nombre (Celular de Factura y de Móvil
    suman juntas); lo que no tiene subcategoría cuenta con el nombre de su categoría."""
    nombres: dict[str, dict[str, Any]] = {}
    for m in movs:
        d = nombres.setdefault(m.subcategoria or m.categoria, {"total": 0, "n": 0, "madres": defaultdict(int)})
        v = valor(m)
        d["total"] += v
        d["n"] += 1
        d["madres"][m.categoria] += v
    return [
        {
            "subcategoria": nombre,
            "categoria": max(d["madres"].items(), key=lambda kv: kv[1])[0],
            "total": d["total"],
            "n": d["n"],
            "ticket": round(d["total"] / d["n"]),
            "promedio_mensual": round(d["total"] / n_meses),
            "pct": d["total"] / total_grupo if total_grupo else 0.0,
        }
        for nombre, d in sorted(nombres.items(), key=lambda kv: -kv[1]["total"])
    ]


def descripciones(
    sesion: Session,
    desde: str | None = None,
    hasta: str | None = None,
    grupo: Grupo | None = None,
    limite: int = 30,
    conjunto: Conjunto | None = None,
) -> list[dict[str, Any]]:
    """Descripciones que más mueven dinero (por valor absoluto), sin transferencias ni ajustes."""
    agregado: dict[tuple[str, Grupo], dict[str, Any]] = {}
    for m in _movimientos(sesion, desde, hasta):
        if m.grupo in (Grupo.TRANSFERENCIA, Grupo.AJUSTE) or (grupo and m.grupo is not grupo):
            continue
        if conjunto and not _en_conjunto(m, conjunto):
            continue
        clave = ((m.descripcion or "Sin descripción").strip(), m.grupo)
        d = agregado.setdefault(clave, {"total": 0, "n": 0, "categorias": defaultdict(int)})
        d["total"] += _valor_en(m, conjunto) if conjunto else _valor(m)
        d["n"] += 1
        d["categorias"][m.subcategoria or m.categoria] += 1
    filas = [
        {
            "descripcion": desc,
            "grupo": g.value,
            "categoria": max(d["categorias"].items(), key=lambda kv: kv[1])[0],
            "n": d["n"],
            "total": d["total"],
            "ticket": round(d["total"] / d["n"]),
        }
        for (desc, g), d in agregado.items()
    ]
    return sorted(filas, key=lambda f: -abs(f["total"]))[:limite]


# ---------- Apuestas ----------
def apuestas(
    sesion: Session, desde: str | None = None, hasta: str | None = None, hoy: date | None = None
) -> dict[str, Any]:
    movs = [m for m in _movimientos(sesion, desde, hasta) if m.grupo is Grupo.APUESTAS]
    hoy = hoy or hoy_bogota()
    apostado = -sum(m.monto for m in movs if m.monto < 0)
    ganado = sum(m.monto for m in movs if m.monto > 0)
    dias = sorted({date.fromisoformat(m.fecha[:10]) for m in movs if m.monto < 0})
    racha_mayor = 0
    for previo, actual in zip(dias, dias[1:], strict=False):
        racha_mayor = max(racha_mayor, (actual - previo).days - 1)
    racha_actual = (hoy - dias[-1]).days if dias else None
    por_mes: dict[str, dict[str, int]] = defaultdict(lambda: {"apostado": 0, "ganado": 0, "n": 0})
    por_casa: dict[str, dict[str, int]] = defaultdict(lambda: {"apostado": 0, "ganado": 0, "n": 0})
    for m in movs:
        for destino in (por_mes[m.mes], por_casa[m.subcategoria or m.categoria]):
            destino["n"] += 1
            destino["apostado" if m.monto < 0 else "ganado"] += abs(m.monto)
    return {
        "n": len(movs),
        "apostado": apostado,
        "ganado": ganado,
        "neto": ganado - apostado,
        "dias_con_apuesta": len(dias),
        "ultima": dias[-1].isoformat() if dias else None,
        "racha_actual": racha_actual,  # días sin apostar desde la última apuesta
        "racha_mayor": max(racha_mayor, racha_actual or 0),
        "por_mes": [{"mes": k, **v, "neto": v["ganado"] - v["apostado"]} for k, v in sorted(por_mes.items())],
        "por_casa": sorted(
            ({"casa": k, **v, "neto": v["ganado"] - v["apostado"]} for k, v in por_casa.items()),
            key=lambda f: f["neto"],
        ),
    }


# ---------- Revisión mensual ----------
def _mes_anterior(mes: str, n: int = 1) -> str:
    a, m = int(mes[:4]), int(mes[5:7]) - n
    while m < 1:
        a, m = a - 1, m + 12
    return f"{a:04d}-{m:02d}"


def revision(sesion: Session, mes: str, ventana: int = 3) -> dict[str, Any]:
    """Comparativo del mes con el anterior y con el promedio de los `ventana` meses previos, y hallazgos."""
    previos = [_mes_anterior(mes, i) for i in range(ventana, 0, -1)]
    serie = {f["mes"]: f for f in mensual(sesion, previos[0], mes)["meses"]}
    vacio = {k: 0 for k in ("ingresos", "gasto_vida", "servicio_deuda", "apuestas_neto", "flujo_operativo")}
    actual = serie.get(mes, vacio)
    anterior = serie.get(previos[-1], vacio)
    con_datos = [serie[p] for p in previos if p in serie]
    promedio = {k: round(sum(f[k] for f in con_datos) / len(con_datos)) if con_datos else 0 for k in vacio}
    indicadores = [{"clave": k, "actual": actual[k], "anterior": anterior[k], "promedio": promedio[k]} for k in vacio]

    movs = [m for m in _movimientos(sesion, previos[0], mes) if m.grupo is Grupo.GASTO_VIDA]
    por_cat: dict[str, dict[str, int]] = defaultdict(lambda: defaultdict(int))
    for m in movs:
        por_cat[m.categoria][m.mes] += -m.monto
    cambios: list[dict[str, Any]] = []
    for cat, meses in por_cat.items():
        base = round(sum(meses.get(p, 0) for p in previos) / len(previos))
        cambios.append(
            {"categoria": cat, "actual": meses.get(mes, 0), "promedio": base, "diferencia": meses.get(mes, 0) - base}
        )
    cambios.sort(key=lambda c: -c["diferencia"])
    subidas = [c for c in cambios if c["diferencia"] > 0][:3]
    bajadas = sorted((c for c in cambios if c["diferencia"] < 0), key=lambda c: c["diferencia"])[:3]

    del_mes = [m for m in movs if m.mes == mes]
    mayor = max(del_mes, key=lambda m: -m.monto, default=None)
    return {
        "mes": mes,
        "comparado_con": previos,
        "indicadores": indicadores,
        "subidas": subidas,
        "bajadas": bajadas,
        "mayor_gasto": (
            {
                "descripcion": mayor.descripcion,
                "categoria": mayor.categoria,
                "monto": -mayor.monto,
                "fecha": mayor.fecha,
            }
            if mayor
            else None
        ),
        "dias_con_gasto": len({m.fecha[:10] for m in del_mes}),
        "hallazgos": _hallazgos(actual, promedio, subidas, bajadas, previos),
    }


def _pesos(centavos: int) -> str:
    return "$" + f"{abs(centavos) // 100:,}".replace(",", ".")


def _hallazgos(
    actual: dict[str, int],
    promedio: dict[str, int],
    subidas: list[dict[str, Any]],
    bajadas: list[dict[str, Any]],
    previos: list[str],
) -> list[str]:
    """Tres frases en orden de importancia, sin juicios: qué cambió y cuánto."""
    salida = []
    flujo = actual["flujo_operativo"]
    if flujo < 0:
        salida.append(f"Saliste {_pesos(flujo)} más de lo que entró (flujo operativo).")
    else:
        salida.append(f"Te sobraron {_pesos(flujo)} después de todos tus gastos.")
    if subidas:
        s = subidas[0]
        salida.append(
            f"{s['categoria']} subió {_pesos(s['diferencia'])} frente a tu promedio de {len(previos)} meses "
            f"({_pesos(s['actual'])} contra {_pesos(s['promedio'])})."
        )
    elif bajadas:
        b = bajadas[0]
        salida.append(f"{b['categoria']} bajó {_pesos(b['diferencia'])} frente a tu promedio.")
    ingreso, base = actual["ingresos"], promedio["ingresos"]
    if base and ingreso < base * 0.8:
        salida.append(f"Tus ingresos ({_pesos(ingreso)}) quedaron {_pesos(base - ingreso)} por debajo de tu promedio.")
    elif actual["apuestas_neto"] < 0:
        salida.append(f"En apuestas perdiste {_pesos(actual['apuestas_neto'])} este mes.")
    elif base and ingreso > base * 1.2:
        salida.append(f"Tus ingresos ({_pesos(ingreso)}) superaron tu promedio en {_pesos(ingreso - base)}.")
    return salida[:3]


# ---------- Valor neto y mapa de calor (fase 8, punto 1.5) ----------
def reducir_puntos(puntos: list[dict[str, Any]], tope: int = 180, campo: str = "saldo") -> list[dict[str, Any]]:
    """Aligera una serie larga por tramos, sin perder el primero, el último ni los extremos de cada tramo."""
    if len(puntos) <= tope:
        return puntos
    tam = max(2, 2 * len(puntos) // tope + 1)
    elegidos = {0, len(puntos) - 1}
    for inicio in range(0, len(puntos), tam):
        tramo = range(inicio, min(inicio + tam, len(puntos)))
        elegidos.add(min(tramo, key=lambda i: puntos[i][campo]))
        elegidos.add(max(tramo, key=lambda i: puntos[i][campo]))
    return [puntos[i] for i in sorted(elegidos)]


def valor_neto(
    sesion: Session, desde: str | None = None, hasta: str | None = None, escala: str = "mes"
) -> dict[str, Any]:
    """Saldo de las cuentas que suman al total (punto 15) al cierre de cada mes, de cada día o de cada
    día con movimientos (`movimiento`: más detalle sin recargar el gráfico)."""
    from finanzas.infra.consultas import en_total, saldos_cuentas

    cuentas = en_total(saldos_cuentas(sesion))
    ids = [c["id"] for c in cuentas]
    if not ids:
        return {"escala": escala, "puntos": [], "cuentas": []}
    lista = ",".join(str(i) for i in ids)
    inicial = sum(c["saldo_inicial"] for c in cuentas)
    clave = "substr(t.fecha, 1, 7)" if escala == "mes" else "substr(t.fecha, 1, 10)"
    filas = sesion.execute(
        text(
            f"""
            SELECT {clave} AS k, SUM(t.monto) AS total FROM transaccion t
            WHERE t.estado = 'confirmada' AND t.cuenta_id IN ({lista})
            GROUP BY 1 ORDER BY 1
            """
        )
    ).all()
    acumulado, puntos = inicial, []
    por_clave = {k: int(v) for k, v in filas}
    if not por_clave:
        return {"escala": escala, "puntos": [], "cuentas": [c["nombre"] for c in cuentas]}
    hoy = hoy_bogota().isoformat()
    primero = min(por_clave)
    if escala == "movimiento":
        claves = sorted({*por_clave, hoy})
    elif escala == "dia":
        claves = _dias_entre(primero, hoy)
    else:
        claves = _meses_entre(primero, hoy[:7])
    for k in claves:
        acumulado += por_clave.get(k, 0)
        mes = k[:7]
        if (desde is None or mes >= desde) and (hasta is None or mes <= hasta):
            puntos.append({"fecha": k, "saldo": acumulado})
    if escala == "movimiento":
        puntos = reducir_puntos(puntos)
    return {"escala": escala, "puntos": puntos, "cuentas": [c["nombre"] for c in cuentas]}


def _dias_entre(desde: str, hasta: str) -> list[str]:
    from datetime import timedelta

    d, fin, salida = date.fromisoformat(desde[:10]), date.fromisoformat(hasta[:10]), []
    while d <= fin:
        salida.append(d.isoformat())
        d += timedelta(days=1)
    return salida


def calor(sesion: Session, desde: str | None = None, hasta: str | None = None) -> dict[str, Any]:
    """Gastos e ingresos por día, con los mismos totales del resto de la app."""
    dias: dict[str, dict[str, int]] = defaultdict(lambda: {"gasto": 0, "ingreso": 0, "n": 0})
    for m in _movimientos(sesion, desde, hasta):
        if m.grupo in GRUPOS_NEUTROS:
            continue
        d = dias[m.fecha[:10]]
        if _en_conjunto(m, "gastos"):
            d["gasto"] += _valor_en(m, "gastos")
        elif _en_conjunto(m, "ingresos"):
            d["ingreso"] += _valor_en(m, "ingresos")
        d["n"] += 1
    salida: list[dict[str, Any]] = [{"fecha": k, **v} for k, v in sorted(dias.items())]
    return {
        "dias": salida,
        "max_gasto": max((v["gasto"] for v in dias.values()), default=0),
        "max_ingreso": max((v["ingreso"] for v in dias.values()), default=0),
    }
