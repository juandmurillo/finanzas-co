"""Fase 6: abono único y compra de cartera, parámetros y TRM, termómetro de renta, multimoneda y asistente.

El asistente se prueba con un ejecutor falso: las pruebas nunca llaman a la API de Claude."""

from datetime import date
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from finanzas.dominio.creditos import DeudaSimulada, abono_unico, compra_cartera, cuota_fija
from finanzas.dominio.grupos import Grupo
from finanzas.infra import herramientas_asistente as h
from finanzas.infra import trm
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo


# ---------- Dominio: créditos ----------
def test_cuota_fija_francesa() -> None:
    # 1.000.000 a 12 meses al 0 % → 83.333; con interés la cuota sube
    assert cuota_fija(100_000_000, 0.0, 12) == 8_333_333
    assert cuota_fija(100_000_000, 0.268, 12) > 8_333_333


def test_abono_unico_reducir_plazo_ahorra_mas_que_reducir_cuota() -> None:
    r = abono_unico(160_000_000, 0.5, 11_000_000, 300_000, 30_000_000)
    assert r.reducir_plazo.meses < r.sin_abono.meses
    assert r.reducir_cuota.cuota < r.sin_abono.cuota and r.reducir_cuota.meses <= r.sin_abono.meses
    assert r.reducir_plazo.ahorro > r.reducir_cuota.ahorro > 0


def test_compra_de_cartera_compara_el_total_no_la_cuota() -> None:
    deudas = [DeudaSimulada(1, "A", 152_500_000, 0.60, 12_500_000, 400_000)]
    barata = compra_cartera(deudas, 0.24, 18)
    assert barata.conviene and barata.diferencia > 0
    # cuota más baja pero a 72 meses y con costos: puede salir más cara
    larga = compra_cartera(deudas, 0.45, 72, costos_iniciales=5_000_000, seguro_mensual=300_000)
    assert larga.cuota_nueva < larga.cuota_actual and not larga.conviene


# ---------- TRM ----------
def test_trm_se_guarda_y_sin_red_usa_la_ultima(db_sembrada: BaseDatos) -> None:
    llamadas: list[str] = []

    def falsa(url: str) -> list[dict[str, str]]:
        llamadas.append(url)
        return [{"valor": "3162.35", "vigenciadesde": "2026-10-29T00:00:00.000"}]

    def sin_red(url: str) -> list[dict[str, str]]:
        raise OSError("sin red")

    with db_sembrada.fabrica() as s:
        primera = trm.obtener(s, date(2026, 10, 29), falsa)
        assert primera is not None and primera["valor"] == 3162.35 and not primera["aproximada"]
        assert trm.obtener(s, date(2026, 10, 29), sin_red)["valor"] == 3162.35  # type: ignore[index]
        siguiente = trm.obtener(s, date(2026, 10, 30), sin_red)
        assert siguiente is not None and siguiente["aproximada"]
    assert len(llamadas) == 1


# ---------- API ----------
def _nequi(cliente: TestClient) -> int:
    return int(next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"])


@pytest.fixture
def trabajo(db_sembrada: BaseDatos, bus: BusEventos) -> int:
    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        return categoria_por_ruta(u.sesion, Grupo.INGRESO, "Trabajo independiente", "Desarrollo web").id


def test_ingreso_en_dolares_se_convierte_con_la_trm(cliente: TestClient, trabajo: int) -> None:
    r = cliente.post(
        "/api/v1/transacciones",
        json={
            "cuenta_id": _nequi(cliente),
            "monto": 1,  # se ignora: manda el monto en USD × TRM
            "moneda_original": "USD",
            "monto_original": 15_050,  # US$ 150,50
            "trm": 3162.35,
            "categoria_id": trabajo,
            "descripcion": "Cliente USA",
        },
    )
    assert r.status_code == 201, r.text
    tx = r.json()
    assert tx["monto"] == round(15_050 * 3162.35) and tx["moneda_original"] == "USD"
    sin_trm = {"cuenta_id": _nequi(cliente), "monto": 1, "moneda_original": "USD", "monto_original": 100}
    assert cliente.post("/api/v1/transacciones", json=sin_trm).status_code == 400


def test_termometro_y_seguridad_social(cliente: TestClient, trabajo: int) -> None:
    anio = date.today().year
    cliente.post(
        "/api/v1/transacciones",
        json={"cuenta_id": _nequi(cliente), "monto": 500_000_000, "categoria_id": trabajo, "fecha": f"{anio}-01-15"},
    )
    t = cliente.get("/api/v1/impuestos/termometro", params={"anio": anio}).json()
    ingresos = next(f for f in t["filas"] if f["clave"] == "ingresos")
    assert t["uvt"] == 52_374 and ingresos["tope"] == 1_400 * 52_374 * 100
    assert ingresos["valor"] == 500_000_000
    ss = t["seguridad_social"]
    enero = ss["meses"][0]
    assert enero["obligado"] and enero["ibc"] == 200_000_000  # 40 % de 5.000.000
    assert enero["salud"] == 25_000_000 and enero["pension"] == 32_000_000


def test_parametros_editables_con_fuente(cliente: TestClient) -> None:
    claves = {(p["clave"], p["vigencia_desde"]) for p in cliente.get("/api/v1/parametros").json()}
    assert ("smmlv", "2026-01-01") in claves and ("uvt", "2025-01-01") in claves
    nuevo = {"clave": "usura_consumo", "vigencia_desde": "2026-11-01", "valor": 0.28, "fuente": "Superfinanciera"}
    assert cliente.put("/api/v1/parametros", json=nuevo).status_code == 204
    assert cliente.put("/api/v1/parametros", json={**nuevo, "fuente": " "}).status_code == 400
    assert cliente.put("/api/v1/parametros", json={**nuevo, "clave": "inventado"}).status_code == 400


def test_abono_unico_y_compra_de_cartera_por_api(cliente: TestClient) -> None:
    credito = cliente.get("/api/v1/creditos").json()[0]
    r = cliente.get(f"/api/v1/creditos/{credito['id']}/abono-unico", params={"abono": 5_000_000}).json()
    assert r["reducir_plazo"]["meses"] <= r["sin_abono"]["meses"]
    cc = cliente.post("/api/v1/creditos/compra-cartera", json={"tasa_ea": 0.9, "plazo_meses": 12}).json()
    assert cc["supera_usura"] and len(cc["creditos"]) >= 1


def test_asistente_exige_consentimiento(cliente: TestClient) -> None:
    preguntas: list[str] = []

    def falso(sesion: Session, pregunta: str) -> dict[str, Any]:
        preguntas.append(pregunta)
        return {"respuesta": "Gastaste $ 0.", "herramientas": ["resumen_mensual"], "modelo": "x", "fin": "end_turn"}

    cliente.app.state.ejecutor_asistente = falso  # type: ignore[attr-defined]
    assert cliente.post("/api/v1/asistente/preguntar", json={"pregunta": "¿Cuánto gasté?"}).status_code == 409
    assert preguntas == []  # sin consentimiento no sale nada
    assert cliente.put("/api/v1/asistente/consentimiento", json={"activo": True}).status_code == 204
    assert cliente.get("/api/v1/asistente/estado").json()["consentimiento"] is not None
    r = cliente.post("/api/v1/asistente/preguntar", json={"pregunta": "¿Cuánto gasté?"})
    assert r.status_code == 200 and r.json()["respuesta"] == "Gastaste $ 0."
    cliente.put("/api/v1/asistente/consentimiento", json={"activo": False})
    assert cliente.post("/api/v1/asistente/preguntar", json={"pregunta": "otra"}).status_code == 409


def test_herramientas_del_asistente_no_exponen_numeros_de_credito(db_sembrada: BaseDatos) -> None:
    with db_sembrada.fabrica() as s:
        deudas = h.deudas(s)
        texto = str(deudas) + str(h.resumen_mensual(s, None, None)) + str(h.buscar_movimientos(s, "a", None, None))
    assert "0000-1" not in texto  # el número del crédito de ejemplo
    assert all("numero" not in c for c in deudas["creditos"])
