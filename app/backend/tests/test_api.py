from concurrent.futures import ThreadPoolExecutor
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from finanzas.infra.eventos import BusEventos


def _cuentas(cliente: TestClient) -> dict[str, dict]:  # type: ignore[type-arg]
    return {c["nombre"]: c for c in cliente.get("/api/v1/cuentas").json()}


def test_semillas_crean_cuentas_y_creditos(cliente: TestClient) -> None:
    assert set(_cuentas(cliente)) == {"Nequi", "Daviplata", "Ahorro", "Efectivo"}
    creditos = cliente.get("/api/v1/creditos").json()
    assert [c["nombre"] for c in creditos] == ["Crédito A", "Crédito B"]  # avalancha: mayor tasa primero
    assert sum(c["saldo"] for c in creditos) == 62_000_000


def test_registrar_gasto_actualiza_saldo_y_publica_evento(cliente: TestClient, bus: BusEventos) -> None:
    nequi = _cuentas(cliente)["Nequi"]
    r = cliente.post("/api/v1/transacciones", json={"cuenta_id": nequi["id"], "monto": -900_000, "descripcion": "Moto"})
    assert r.status_code == 201, r.text
    assert _cuentas(cliente)["Nequi"]["saldo"] == nequi["saldo"] - 900_000
    ultimo = bus.historial[-1]
    assert ultimo.accion == "crear" and "dashboard" in ultimo.entidades


def test_transferencia_no_afecta_flujo(cliente: TestClient) -> None:
    c = _cuentas(cliente)
    antes = cliente.get("/api/v1/reportes/flujo").json()
    cuerpo = {"origen_id": c["Nequi"]["id"], "destino_id": c["Daviplata"]["id"], "monto": 5_000_000}
    r = cliente.post("/api/v1/transferencias", json=cuerpo)
    assert r.status_code == 201, r.text
    salida, entrada = r.json()
    assert salida["transferencia_id"] == entrada["id"]
    despues = _cuentas(cliente)
    assert despues["Nequi"]["saldo"] == c["Nequi"]["saldo"] - 5_000_000
    assert despues["Daviplata"]["saldo"] == c["Daviplata"]["saldo"] + 5_000_000
    flujo = cliente.get("/api/v1/reportes/flujo").json()
    assert antes == []
    assert all(m["ingresos"] == 0 and m["gasto_vida"] == 0 and m["flujo_operativo"] == 0 for m in flujo)


@pytest.mark.parametrize("transferencia", [False, True])
def test_reintentos_concurrentes_de_captura(cliente: TestClient, transferencia: bool) -> None:
    cuentas = _cuentas(cliente)
    origen = cuentas["Nequi"]["id"]
    ruta = "/api/v1/transferencias" if transferencia else "/api/v1/transacciones"
    datos = (
        {"origen_id": origen, "destino_id": cuentas["Ahorro"]["id"], "monto": 100}
        if transferencia else {"cuenta_id": origen, "monto": -100}
    )
    headers = {"Idempotency-Key": str(uuid4())}
    with ThreadPoolExecutor(2) as pool:
        respuestas = list(pool.map(lambda _: cliente.post(ruta, json=datos, headers=headers), range(2)))
    assert [r.status_code for r in respuestas] == [201, 201]
    assert respuestas[0].json() == respuestas[1].json()
    assert _cuentas(cliente)["Nequi"]["saldo"] == cuentas["Nequi"]["saldo"] - 100
    assert cliente.post(ruta, json={**datos, "monto": 123}, headers=headers).status_code == 409
    # Un gasto independiente del mismo importe cuenta como otra captura.
    assert cliente.post(ruta, json=datos, headers={"Idempotency-Key": str(uuid4())}).status_code == 201
    assert _cuentas(cliente)["Nequi"]["saldo"] == cuentas["Nequi"]["saldo"] - 200


def test_reserva_se_revierte_si_falla_el_movimiento(cliente: TestClient) -> None:
    headers = {"Idempotency-Key": str(uuid4())}
    datos = {"cuenta_id": _cuentas(cliente)["Nequi"]["id"], "monto": 0}
    ruta = "/api/v1/transacciones"
    assert cliente.post(ruta, json=datos, headers=headers).status_code == 400
    assert cliente.post(ruta, json={**datos, "monto": -100}, headers=headers).status_code == 201


def test_borrar_transferencia_borra_el_par(cliente: TestClient) -> None:
    c = _cuentas(cliente)
    salida, _ = cliente.post(
        "/api/v1/transferencias", json={"origen_id": c["Nequi"]["id"], "destino_id": c["Ahorro"]["id"], "monto": 100}
    ).json()
    assert cliente.delete(f"/api/v1/transacciones/{salida['id']}").status_code == 204
    assert cliente.get("/api/v1/transacciones").json()["items"] == []


def test_monto_cero_es_error_problem_json(cliente: TestClient) -> None:
    nequi = _cuentas(cliente)["Nequi"]
    r = cliente.post("/api/v1/transacciones", json={"cuenta_id": nequi["id"], "monto": 0})
    assert r.status_code == 400
    assert r.headers["content-type"].startswith("application/problem+json")


def test_importar_por_api_y_listar_con_filtros(cliente: TestClient, csv_cashew: bytes) -> None:
    r = cliente.post("/api/v1/importar/cashew", files={"archivo": ("cashew.csv", csv_cashew, "text/csv")})
    assert r.status_code == 200, r.text
    assert r.json()["creadas"] == 18
    pagina = cliente.get("/api/v1/transacciones", params={"grupo": "apuestas", "limite": 500}).json()
    assert len(pagina["items"]) == 2
    dash = cliente.get("/api/v1/reportes/dashboard").json()
    assert dash["saldo_total"] == 261_200_000


def test_sugerencias_y_dashboard_con_datos_importados(cliente: TestClient, csv_cashew: bytes) -> None:
    cliente.post("/api/v1/importar/cashew", files={"archivo": ("cashew.csv", csv_cashew, "text/csv")})
    sug = cliente.get("/api/v1/sugerencias", params={"texto": "internet"}).json()
    assert sug and sug[0]["categoria_ruta"][-1] == "Internet hogar"
    frecuentes = cliente.get("/api/v1/sugerencias/categorias", params={"tipo": "gasto"}).json()
    assert len(frecuentes) >= 2
    dash = cliente.get("/api/v1/reportes/dashboard").json()
    assert dash["mes"] == "2026-02"
    assert sum(c["total"] for c in dash["gasto_categorias"]) == 3_000_000  # gasto de vida sin el cobro en reclamo
    assert dash["proximos_pagos"][0]["estado"] == "pendiente"
    assert dash["mes_actual"]["flujo_operativo"] == 6_000_000  # entró la devolución, salieron dos almuerzos
