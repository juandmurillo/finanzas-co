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
