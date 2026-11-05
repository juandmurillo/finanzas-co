"""Fase 9: instalación nueva usable, datos demo, módulos opcionales y guardia de origen."""

from datetime import date
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from finanzas.cli import migrar
from finanzas.config import Config
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.main import crear_app
from finanzas.servicios import demo


@pytest.fixture
def nueva(tmp_path: Path) -> TestClient:
    """Una instalación recién migrada, sin nada sembrado."""
    ruta = tmp_path / "nueva.db"
    migrar(f"sqlite:///{ruta.as_posix()}")
    config = Config(db_ruta=ruta, backups_dir=tmp_path / "r", tareas_diarias=False)
    return TestClient(crear_app(config))


def test_primer_uso_vacio_deja_la_app_lista(nueva: TestClient) -> None:
    assert nueva.get("/api/v1/sistema").json()["primer_uso"] is True
    assert nueva.post("/api/v1/sistema/primer-uso", json={"nombre": "Ana", "modo": "vacio"}).status_code == 204
    estado = nueva.get("/api/v1/sistema").json()
    assert (estado["primer_uso"], estado["nombre"], estado["es_demo"]) == (False, "Ana", False)
    assert len(nueva.get("/api/v1/cuentas").json()) == 2
    grupos = {r["grupo"]: r["hijos"] for r in nueva.get("/api/v1/categorias").json()}
    assert grupos["gasto_vida"] and grupos["ingreso"]  # se puede registrar sin importar nada
    assert nueva.post("/api/v1/sistema/primer-uso", json={"modo": "vacio"}).status_code == 409


def test_demo_es_coherente_y_sin_apuestas(nueva: TestClient) -> None:
    assert nueva.post("/api/v1/sistema/primer-uso", json={"nombre": "", "modo": "demo"}).status_code == 204
    estado = nueva.get("/api/v1/sistema").json()
    assert estado["es_demo"] is True and estado["modulos"]["apuestas"] is False
    creditos = nueva.get("/api/v1/creditos").json()
    assert len(creditos) == 2 and all(c["cuotas_pagadas"] > 0 and c["proximo_pago"] for c in creditos)
    meses = nueva.get("/api/v1/reportes/mensual").json()["meses"]
    assert len(meses) == 18 and all(m["ingresos"] > 0 for m in meses[:-1])  # el mes en curso puede ir sin nómina
    assert nueva.get("/api/v1/reportes/dashboard").json()["saldo_total"] > 0
    assert nueva.get("/api/v1/calendario").json()["eventos"]
    assert len(nueva.get("/api/v1/metas").json()) == 3


def test_demo_es_reproducible(tmp_path: Path) -> None:
    def huella(nombre: str) -> list[tuple[str, int]]:
        url = f"sqlite:///{(tmp_path / nombre).as_posix()}"
        migrar(url)
        db = BaseDatos(url)
        with UnidadDeTrabajo(db.fabrica, BusEventos()) as u:
            demo.generar(u, hoy=date(2026, 11, 4))
        with db.fabrica() as s:
            from finanzas.infra.modelos import Transaccion

            return sorted((t.fecha, t.monto) for t in s.query(Transaccion))

    assert huella("a.db") == huella("b.db")


def test_apuestas_se_muestran_si_se_usan_o_se_eligen(cliente: TestClient) -> None:
    assert cliente.get("/api/v1/sistema").json()["modulos"]["apuestas"] is False
    assert cliente.patch("/api/v1/sistema", json={"modulo_apuestas": "si"}).status_code == 204
    assert cliente.get("/api/v1/sistema").json()["modulos"]["apuestas"] is True


def test_guardia_rechaza_otros_sitios(cliente: TestClient) -> None:
    ajeno = {"Origin": "https://sitio-malo.example"}
    assert cliente.post("/api/v1/respaldos", headers=ajeno).status_code == 403
    assert cliente.get("/api/v1/salud", headers=ajeno).status_code == 200  # leer no cambia nada; CORS lo protege
    assert cliente.get("/api/v1/salud", headers={"Host": "sitio-malo.example"}).status_code == 403  # DNS rebinding
    propio = {"Origin": "http://localhost:5173"}
    assert cliente.patch("/api/v1/sistema", json={"nombre": "Ana"}, headers=propio).status_code == 204


def test_cuenta_de_inversion_no_suma_por_defecto(cliente: TestClient) -> None:
    antes = cliente.get("/api/v1/reportes/dashboard").json()["saldo_total"]
    cliente.post("/api/v1/cuentas", json={"nombre": "Fondo", "tipo": "inversion", "saldo_inicial": 5_000_000})
    assert cliente.get("/api/v1/reportes/dashboard").json()["saldo_total"] == antes


def test_movimiento_sin_categoria_aparece_en_reportes(cliente: TestClient) -> None:
    cuenta = cliente.get("/api/v1/cuentas").json()[0]["id"]
    cliente.post("/api/v1/transacciones", json={"cuenta_id": cuenta, "monto": -1_000_000, "fecha": "2026-05-05"})
    reporte = cliente.get("/api/v1/reportes/mensual", params={"desde": "2026-05", "hasta": "2026-05"}).json()
    assert reporte["totales"]["gasto_vida"] == 1_000_000


def test_valor_neto_por_movimiento_aligera_sin_perder_extremos() -> None:
    from finanzas.infra.consultas_reportes import reducir_puntos

    puntos = [{"fecha": f"p{i}", "saldo": i % 97} for i in range(1000)]
    puntos[500]["saldo"] = 10_000
    puntos[700]["saldo"] = -10_000
    reducidos = reducir_puntos(puntos)
    assert len(reducidos) <= 190
    assert reducidos[0] == puntos[0] and reducidos[-1] == puntos[-1]
    assert {10_000, -10_000} <= {p["saldo"] for p in reducidos}
    assert reducir_puntos(puntos[:50]) == puntos[:50]


def test_ingresos_y_gastos_incluyen_todo_y_cuadran_en_toda_la_app(
    cliente: TestClient, db_sembrada: BaseDatos, bus: BusEventos
) -> None:
    from finanzas.dominio.fechas import hoy_bogota
    from finanzas.dominio.grupos import Grupo
    from finanzas.infra.repositorios import categoria_por_ruta

    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        ids = {
            g: categoria_por_ruta(u.sesion, g, nombre, None).id
            for g, nombre in (
                (Grupo.INGRESO, "Otros ingresos"),
                (Grupo.GASTO_VIDA, "Comida"),
                (Grupo.SERVICIO_DEUDA, "Crédito de prueba"),
                (Grupo.APUESTAS, "Apuestas de prueba"),
                (Grupo.AHORRO_INVERSION, "Inversión de prueba"),
            )
        }
    cuenta = cliente.get("/api/v1/cuentas").json()[0]["id"]
    hoy = hoy_bogota().isoformat()
    for grupo, monto in (
        (Grupo.INGRESO, 90_000_00),
        (Grupo.GASTO_VIDA, -11_000_00),
        (Grupo.SERVICIO_DEUDA, -12_000_00),
        (Grupo.AHORRO_INVERSION, -13_000_00),
        (Grupo.APUESTAS, -14_000_00),  # lo apostado es gasto
        (Grupo.APUESTAS, 5_000_00),  # lo ganado es ingreso
    ):
        cuerpo = {"cuenta_id": cuenta, "monto": monto, "categoria_id": ids[grupo], "fecha": hoy}
        assert cliente.post("/api/v1/transacciones", json=cuerpo).status_code == 201

    mes = hoy[:7]
    periodo = f"desde={mes}&hasta={mes}"
    fila = cliente.get(f"/api/v1/reportes/mensual?{periodo}").json()["meses"][0]
    assert fila["ingresos_total"] == 95_000_00 and fila["gastos_total"] == 50_000_00
    assert fila["ingresos_total"] - fila["gastos_total"] == fila["flujo_operativo"]
    tablero = cliente.get("/api/v1/reportes/dashboard").json()["mes_actual"]
    assert (tablero["ingresos_total"], tablero["gastos_total"]) == (95_000_00, 50_000_00)
    for conjunto, total, n_categorias in (("gastos", 50_000_00, 4), ("ingresos", 95_000_00, 2)):
        r = cliente.get(f"/api/v1/reportes/categorias?{periodo}&conjunto={conjunto}").json()
        assert r["total"] == total and sum(c["total"] for c in r["categorias"]) == total
        assert len(r["categorias"]) == n_categorias
    dias = cliente.get(f"/api/v1/reportes/calor?{periodo}").json()["dias"]
    assert sum(d["gasto"] for d in dias) == 50_000_00 and sum(d["ingreso"] for d in dias) == 95_000_00
