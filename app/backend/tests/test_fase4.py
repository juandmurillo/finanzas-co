"""Fase 4: reportes de análisis (flujo, Sankey, categorías, descripciones, apuestas, revisión) y Excel."""

from io import BytesIO

import pytest
from fastapi.testclient import TestClient
from openpyxl import load_workbook

from finanzas.dominio.grupos import Grupo
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo


@pytest.fixture
def cats(db_sembrada: BaseDatos, bus: BusEventos) -> dict[str, int]:
    """El catálogo real nace del importador; aquí se crean solo las hojas que usan las pruebas."""
    rutas = {
        "Diseño gráfico": (Grupo.INGRESO, "Trabajo independiente", "Diseño gráfico"),
        "Comida": (Grupo.GASTO_VIDA, "Comida", None),
        "Betplay": (Grupo.APUESTAS, "Apuestas", "Betplay"),
    }
    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        return {nombre: categoria_por_ruta(u.sesion, *ruta).id for nombre, ruta in rutas.items()}


def _mov(cliente: TestClient, monto: int, categoria_id: int, fecha: str, descripcion: str = "") -> None:
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")
    cuerpo = {
        "cuenta_id": nequi["id"],
        "monto": monto,
        "categoria_id": categoria_id,
        "fecha": fecha,
        "descripcion": descripcion,
    }
    assert cliente.post("/api/v1/transacciones", json=cuerpo).status_code == 201


def _sembrar_meses(cliente: TestClient, c: dict[str, int]) -> None:
    _mov(cliente, 100_000_000, c["Diseño gráfico"], "2026-08-05", "Logo")
    _mov(cliente, -40_000_000, c["Comida"], "2026-08-10", "Mercado")
    _mov(cliente, 80_000_000, c["Diseño gráfico"], "2026-09-05", "Logo")
    _mov(cliente, -40_000_000, c["Comida"], "2026-09-10", "Mercado")
    _mov(cliente, -2_000_000, c["Betplay"], "2026-09-12", "Partido")
    _mov(cliente, 30_000_000, c["Diseño gráfico"], "2026-10-05", "Logo")
    _mov(cliente, -90_000_000, c["Comida"], "2026-10-10", "Mercado")
    _mov(cliente, -1_000_000, c["Betplay"], "2026-10-02", "Partido")
    _mov(cliente, 3_000_000, c["Betplay"], "2026-10-03", "Premio")


def test_mensual_y_totales(cliente: TestClient, cats: dict[str, int]) -> None:
    _sembrar_meses(cliente, cats)
    r = cliente.get("/api/v1/reportes/mensual", params={"desde": "2026-08", "hasta": "2026-10"}).json()
    assert [m["mes"] for m in r["meses"]] == ["2026-08", "2026-09", "2026-10"]
    octubre = r["meses"][-1]
    assert octubre["ingresos"] == 30_000_000 and octubre["gasto_vida"] == 90_000_000
    assert octubre["apuestas_neto"] == 2_000_000
    assert octubre["flujo_operativo"] == 30_000_000 - 90_000_000 + 2_000_000
    assert r["totales"]["ingresos"] == 210_000_000


def test_sankey_cuadra_entradas_y_salidas(cliente: TestClient, cats: dict[str, int]) -> None:
    _sembrar_meses(cliente, cats)
    s = cliente.get("/api/v1/reportes/sankey", params={"desde": "2026-10", "hasta": "2026-10"}).json()
    entra = sum(e["valor"] for e in s["enlaces"] if e["destino"] == "Disponible")
    sale = sum(e["valor"] for e in s["enlaces"] if e["origen"] == "Disponible")
    assert entra == sale  # el déficit aparece como fuente para que el diagrama cuadre
    assert any(e["origen"].startswith("Déficit") for e in s["enlaces"])


def test_categorias_promedio_y_ranking(cliente: TestClient, cats: dict[str, int]) -> None:
    _sembrar_meses(cliente, cats)
    c = cliente.get("/api/v1/reportes/categorias", params={"desde": "2026-08", "hasta": "2026-10"}).json()
    comida = next(f for f in c["categorias"] if f["categoria"] == "Comida")
    assert comida["total"] == 170_000_000 and comida["n"] == 3
    assert comida["tendencia"] == [40_000_000, 40_000_000, 90_000_000]
    assert comida["promedio_mensual"] == round(170_000_000 / 3)
    assert c["ranking_subcategorias"][0]["total"] == 170_000_000


def test_descripciones_y_apuestas(cliente: TestClient, cats: dict[str, int]) -> None:
    _sembrar_meses(cliente, cats)
    d = cliente.get("/api/v1/reportes/descripciones", params={"grupo": "gasto_vida"}).json()
    assert d[0]["descripcion"] == "Mercado" and d[0]["n"] == 3
    a = cliente.get("/api/v1/reportes/apuestas").json()
    assert a["n"] == 3 and a["apostado"] == 3_000_000 and a["ganado"] == 3_000_000 and a["neto"] == 0
    assert a["dias_con_apuesta"] == 2 and a["racha_mayor"] >= 19  # del 12-sep al 2-oct sin apostar


def test_revision_compara_con_promedio(cliente: TestClient, cats: dict[str, int]) -> None:
    _sembrar_meses(cliente, cats)
    r = cliente.get("/api/v1/reportes/revision/2026-10").json()
    ingresos = next(i for i in r["indicadores"] if i["clave"] == "ingresos")
    assert ingresos["anterior"] == 80_000_000
    assert r["subidas"][0]["categoria"] == "Comida"
    assert len(r["hallazgos"]) == 3 and "más de lo que entró" in r["hallazgos"][0]
    assert r["mayor_gasto"]["monto"] == 90_000_000


def test_exportar_excel(cliente: TestClient, cats: dict[str, int]) -> None:
    _sembrar_meses(cliente, cats)
    r = cliente.get("/api/v1/exportar/excel", params={"desde": "2026-08", "hasta": "2026-10"})
    assert r.status_code == 200 and "attachment" in r.headers["content-disposition"]
    libro = load_workbook(BytesIO(r.content))
    assert {"Mensual", "Categorías", "Subcategorías", "Ingresos", "Descripciones", "Apuestas", "Movimientos"} <= set(
        libro.sheetnames
    )
    mensual = libro["Mensual"]
    assert mensual["A2"].value == "Ingresos" and mensual["B2"].value == 1_000_000  # pesos, no centavos


def test_mes_invalido(cliente: TestClient) -> None:
    assert cliente.get("/api/v1/reportes/mensual", params={"desde": "2026-13"}).status_code == 422
