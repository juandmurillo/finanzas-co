"""Exportación a Excel (RF-RP / fase 4): un libro con hojas de resumen, movimientos y categorías."""

from __future__ import annotations

from collections.abc import Sequence
from io import BytesIO
from typing import Any

from openpyxl import Workbook
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.worksheet import Worksheet
from sqlalchemy import text
from sqlalchemy.orm import Session

from finanzas.dominio.grupos import NOMBRES_GRUPO, Grupo
from finanzas.infra import consultas_activos
from finanzas.infra import consultas_reportes as rep

_COP = '"$" #,##0;[Red]-"$" #,##0'
_PCT = "0.0%"
_ENCABEZADO = PatternFill("solid", fgColor="1E4D3B")


def _texto_seguro(valor: Any) -> Any:
    """Una descripción que empiece por = + - @ se ejecutaría como fórmula al abrir el libro."""
    return f"'{valor}" if isinstance(valor, str) and valor[:1] in ("=", "+", "-", "@") else valor


def _hoja(
    libro: Workbook, titulo: str, columnas: Sequence[tuple[str, str | None]], filas: list[list[Any]]
) -> Worksheet:
    """`columnas` = [(nombre, formato)]. Los montos llegan en centavos y se escriben en pesos."""
    hoja: Worksheet = libro.create_sheet(titulo)
    hoja.append([c for c, _ in columnas])
    for celda in hoja[1]:
        celda.font = Font(bold=True, color="FFFFFF")
        celda.fill = _ENCABEZADO
    for fila in filas:
        hoja.append(
            [
                v / 100 if fmt == _COP and isinstance(v, int) else _texto_seguro(v)
                for v, (_, fmt) in zip(fila, columnas, strict=True)
            ]
        )
    for i, (nombre, fmt) in enumerate(columnas, 1):
        letra = get_column_letter(i)
        hoja.column_dimensions[letra].width = max(12, min(48, len(nombre) + 4))
        if fmt:
            for celda in hoja[letra][1:]:
                celda.number_format = fmt
    hoja.freeze_panes = "A2"
    return hoja


def libro(sesion: Session, desde: str | None = None, hasta: str | None = None) -> bytes:
    wb = Workbook()
    if wb.active is not None:
        wb.remove(wb.active)

    m = rep.mensual(sesion, desde, hasta)
    conceptos = [
        ("Ingresos", "ingresos"),
        ("Gasto de vida", "gasto_vida"),
        ("Servicio de deuda", "servicio_deuda"),
        ("Apuestas (neto)", "apuestas_neto"),
        ("Ahorro e inversión", "ahorro"),
        ("Préstamos personales (neto)", "prestamos_neto"),
        ("Desembolsos de crédito", "financiacion"),
        ("Flujo operativo", "flujo_operativo"),
        ("Flujo neto total", "flujo_neto"),
    ]
    _hoja(
        wb,
        "Mensual",
        [("Concepto", None)] + [(f["mes"], _COP) for f in m["meses"]] + [("Total", _COP), ("Promedio/mes", _COP)],
        [[t] + [f[k] for f in m["meses"]] + [m["totales"].get(k, 0), m["promedios"].get(k, 0)] for t, k in conceptos],
    )

    for grupo, titulo in ((Grupo.GASTO_VIDA, "Categorías"), (Grupo.INGRESO, "Ingresos")):
        c = rep.categorias(sesion, desde, hasta, grupo)
        _hoja(
            wb,
            titulo,
            [
                ("Categoría", None),
                ("Total", _COP),
                ("Movimientos", None),
                ("Promedio mensual", _COP),
                ("% del total", _PCT),
            ],
            [[f["categoria"], f["total"], f["n"], f["promedio_mensual"], f["pct"]] for f in c["categorias"]]
            + [[f"Total {NOMBRES_GRUPO[grupo].lower()}", c["total"], c["n"], c["promedio_mensual"], None]],
        )
        if grupo is Grupo.GASTO_VIDA:
            _hoja(
                wb,
                "Subcategorías",
                [
                    ("Subcategoría", None),
                    ("Categoría madre", None),
                    ("Total", _COP),
                    ("Movimientos", None),
                    ("Ticket promedio", _COP),
                    ("Promedio mensual", _COP),
                    ("% del gasto", _PCT),
                ],
                [
                    [
                        s["subcategoria"],
                        s["categoria"],
                        s["total"],
                        s["n"],
                        s["ticket"],
                        s["promedio_mensual"],
                        s["pct"],
                    ]
                    for s in c["ranking_subcategorias"]
                ],
            )

    _hoja(
        wb,
        "Descripciones",
        [
            ("Descripción", None),
            ("Grupo", None),
            ("Categoría", None),
            ("Movimientos", None),
            ("Total", _COP),
            ("Ticket", _COP),
        ],
        [
            [d["descripcion"], NOMBRES_GRUPO[Grupo(d["grupo"])], d["categoria"], d["n"], d["total"], d["ticket"]]
            for d in rep.descripciones(sesion, desde, hasta, limite=80)
        ],
    )

    a = rep.apuestas(sesion, desde, hasta)
    _hoja(
        wb,
        "Apuestas",
        [("Mes", None), ("Apuestas", None), ("Apostado", _COP), ("Ganado", _COP), ("Neto", _COP)],
        [[f["mes"], f["n"], f["apostado"], f["ganado"], f["neto"]] for f in a["por_mes"]]
        + [["Total", a["n"], a["apostado"], a["ganado"], a["neto"]]],
    )

    movimientos = sesion.execute(
        text(
            """
            SELECT substr(t.fecha, 1, 10) AS fecha, cu.nombre AS cuenta, t.monto, c.grupo,
                   CASE WHEN c.nivel = 3 THEN p.nombre ELSE c.nombre END AS categoria,
                   CASE WHEN c.nivel = 3 THEN c.nombre END AS subcategoria, t.descripcion, t.nota
            FROM transaccion t
            JOIN cuenta cu ON cu.id = t.cuenta_id
            LEFT JOIN categoria c ON c.id = t.categoria_id
            LEFT JOIN categoria p ON p.id = c.padre_id
            WHERE t.estado = 'confirmada'
              AND (:desde IS NULL OR substr(t.fecha, 1, 7) >= :desde)
              AND (:hasta IS NULL OR substr(t.fecha, 1, 7) <= :hasta)
            ORDER BY t.fecha, t.id
            """
        ),
        {"desde": desde, "hasta": hasta},
    ).mappings()
    _hoja(
        wb,
        "Movimientos",
        [
            ("Fecha", None),
            ("Cuenta", None),
            ("Monto", _COP),
            ("Grupo", None),
            ("Categoría", None),
            ("Subcategoría", None),
            ("Descripción", None),
            ("Nota", None),
        ],
        [
            [
                f["fecha"],
                f["cuenta"],
                f["monto"],
                NOMBRES_GRUPO[Grupo(f["grupo"])] if f["grupo"] else "",
                f["categoria"],
                f["subcategoria"],
                f["descripcion"],
                f["nota"],
            ]
            for f in movimientos
        ],
    )

    inversiones = consultas_activos.listar(sesion)["activos"]
    if inversiones:
        _hoja(
            wb,
            "Activos",
            [
                ("Activo", None),
                ("Clase", None),
                ("Estado", None),
                ("Moneda", None),
                ("Valor (COP)", _COP),
                ("Aportado", _COP),
                ("Recibido", _COP),
                ("Ganancia", _COP),
            ],
            [
                [
                    a["nombre"],
                    a["clase_nombre"],
                    a["estado"],
                    a["moneda"],
                    a["valor_cop"],
                    a["aportado"],
                    a["recibido"],
                    a["ganancia"],
                ]
                for a in inversiones
            ],
        )

    salida = BytesIO()
    wb.save(salida)
    return salida.getvalue()
