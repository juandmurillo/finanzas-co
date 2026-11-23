"""Préstamos personales: prestar más, editar con vista previa del impacto y conservar el historial."""

from __future__ import annotations

from datetime import date
from typing import Any

from fastapi.testclient import TestClient

from finanzas.dominio.prestamos import repartir_entrega

API = "/api/v1/prestamos"


def _cuenta(cliente: TestClient, nombre: str) -> dict[str, Any]:
    return next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == nombre)


def _prestar(cliente: TestClient, **extra: Any) -> tuple[int, dict[str, Any]]:
    nequi = _cuenta(cliente, "Nequi")
    cuerpo = {
        "direccion": "presto_yo",
        "persona": "andrés",
        "monto": 10_000_000,  # $ 100.000 en centavos
        "cuenta_id": nequi["id"],
        "fecha": "2026-10-01",
        "fecha_limite": "2026-12-01",
        **extra,
    }
    r = cliente.post(API, json=cuerpo)
    assert r.status_code == 201, r.text
    return r.json()["id"], nequi


def test_repartir_entrega_entre_cuotas_por_vencer() -> None:
    cuotas = [(date(2026, 10, 1), 100), (date(2026, 11, 1), 100), (date(2026, 12, 1), 100)]
    assert repartir_entrega(cuotas, 51, date(2026, 10, 15)) == [100, 125, 126]
    assert repartir_entrega(cuotas, 10, date(2027, 1, 1)) == [100, 100, 110]  # ninguna por vencer: a la última
    assert repartir_entrega([], 10, date(2026, 1, 1)) == []


def test_prestar_recibir_y_prestar_mas_deja_tres_operaciones(cliente: TestClient) -> None:
    pid, nequi = _prestar(cliente)
    cliente.post(f"{API}/{pid}/abonos", json={"monto": 3_000_000, "cuenta_id": nequi["id"]})
    r = cliente.post(f"{API}/{pid}/entregas", json={"monto": 5_000_000, "cuenta_id": nequi["id"]})
    assert r.status_code == 201, r.text

    p = cliente.get(f"{API}/{pid}").json()
    assert p["pendiente"] == 12_000_000  # $ 120.000 por cobrar
    assert p["monto"] == 15_000_000
    assert [m["tipo"] for m in p["movimientos"]] == ["entrega", "abono", "entrega"]
    assert sum(c["capital"] for c in p["cuotas"]) == p["monto"]
    assert _cuenta(cliente, "Nequi")["saldo"] == nequi["saldo"] - 12_000_000
    # prestar más no es gasto
    assert sum(m.get("gasto_vida", 0) for m in cliente.get("/api/v1/reportes/flujo").json()) == 0


def test_prestar_mas_reactiva_un_prestamo_pagado(cliente: TestClient) -> None:
    pid, nequi = _prestar(cliente)
    cliente.post(f"{API}/{pid}/abonos", json={"monto": 10_000_000, "cuenta_id": nequi["id"]})
    assert cliente.get(f"{API}/{pid}").json()["estado"] == "pagado"
    cliente.post(f"{API}/{pid}/entregas", json={"monto": 2_000_000, "cuenta_id": nequi["id"]})
    p = cliente.get(f"{API}/{pid}").json()
    assert (p["estado"], p["pendiente"]) == ("activo", 2_000_000)


def test_editar_nota_conserva_el_saldo(cliente: TestClient) -> None:
    pid, nequi = _prestar(cliente)
    cliente.post(f"{API}/{pid}/abonos", json={"monto": 3_000_000, "cuenta_id": nequi["id"]})
    antes = cliente.get(f"{API}/{pid}").json()
    r = cliente.patch(f"{API}/{pid}", json={"nota": "Para el arriendo", "persona": "Andrés Felipe"})
    assert r.status_code == 200, r.text
    despues = cliente.get(f"{API}/{pid}").json()
    assert despues["nota"] == "Para el arriendo"
    assert despues["persona"] == "Andrés Felipe"
    assert (despues["pendiente"], despues["movimientos"]) == (antes["pendiente"], antes["movimientos"])


def test_vista_previa_no_guarda_y_editar_capital_recalcula(cliente: TestClient) -> None:
    pid, nequi = _prestar(cliente)
    cliente.post(f"{API}/{pid}/abonos", json={"monto": 3_000_000, "cuenta_id": nequi["id"]})

    previa = cliente.post(f"{API}/{pid}/edicion/vista-previa", json={"monto_inicial": 8_000_000}).json()
    assert (previa["pendiente_antes"], previa["pendiente_despues"]) == (7_000_000, 5_000_000)
    assert cliente.get(f"{API}/{pid}").json()["pendiente"] == 7_000_000  # nada cambió

    r = cliente.patch(f"{API}/{pid}", json={"monto_inicial": 8_000_000})
    assert r.status_code == 200, r.text
    p = cliente.get(f"{API}/{pid}").json()
    assert (p["pendiente"], p["monto"]) == (5_000_000, 8_000_000)
    assert _cuenta(cliente, "Nequi")["saldo"] == nequi["saldo"] - 5_000_000
    assert [m["tipo"] for m in p["movimientos"]] == ["entrega", "abono"]


def test_editar_capital_por_debajo_de_lo_abonado_se_rechaza(cliente: TestClient) -> None:
    pid, nequi = _prestar(cliente)
    cliente.post(f"{API}/{pid}/abonos", json={"monto": 6_000_000, "cuenta_id": nequi["id"]})
    r = cliente.patch(f"{API}/{pid}", json={"monto_inicial": 5_000_000})
    assert r.status_code == 400  # ErrorValidacion
    assert cliente.get(f"{API}/{pid}").json()["pendiente"] == 4_000_000


def test_cambiar_a_cuotas_con_una_ya_pagada_a_medias(cliente: TestClient) -> None:
    pid, nequi = _prestar(cliente, plan="cuotas", frecuencia="mensual", num_cuotas=2, fecha_limite=None)
    cliente.post(f"{API}/{pid}/abonos", json={"monto": 2_000_000, "cuenta_id": nequi["id"]})
    r = cliente.patch(f"{API}/{pid}", json={"num_cuotas": 4})
    assert r.status_code == 200, r.text
    p = cliente.get(f"{API}/{pid}").json()
    assert len(p["cuotas"]) == 4 and p["pendiente"] == 8_000_000
    assert p["proxima_cuota"]["monto"] == 500_000  # la primera de 2.500.000 ya lleva 2.000.000


def test_no_se_puede_bajar_el_interes_de_lo_ya_pagado(cliente: TestClient) -> None:
    pid, nequi = _prestar(cliente, tipo_interes="fijo", interes_fijo=1_000_000)
    cliente.post(f"{API}/{pid}/abonos", json={"monto": 1_000_000, "cuenta_id": nequi["id"]})  # todo a interés
    r = cliente.patch(f"{API}/{pid}", json={"tipo_interes": "ninguno"})
    assert r.status_code == 400  # ErrorValidacion
