"""Fase 3: préstamos personales, presupuesto y créditos (reglas de la skill app-dominio-finanzas)."""

from datetime import date

from fastapi.testclient import TestClient

from finanzas.dominio.creditos import DeudaSimulada, amortizar, costo_real_ea, simular
from finanzas.dominio.grupos import Grupo
from finanzas.dominio.prestamos import imputar_abono, interes_total, plan_de_pagos, tasa_ea_equivalente
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo


# ---------- Dominio ----------
def test_interes_simple_100k_al_1_por_ciento_en_3_cuotas() -> None:
    interes = interes_total(10_000_000, "simple_mensual", tasa_mensual=0.01, meses=3)
    assert interes == 300_000
    cuotas = plan_de_pagos(10_000_000, interes, date(2026, 10, 1), "cuotas", "mensual", 3)
    assert [c.fecha.isoformat() for c in cuotas] == ["2026-11-01", "2026-12-01", "2027-01-01"]
    assert sum(c.capital for c in cuotas) == 10_000_000 and sum(c.interes for c in cuotas) == 300_000


def test_residuo_de_redondeo_va_en_la_ultima_cuota() -> None:
    cuotas = plan_de_pagos(10_000_000, 0, date(2026, 10, 1), "cuotas", "quincenal", 3)
    assert [c.capital for c in cuotas] == [3_333_333, 3_333_333, 3_333_334]


def test_abono_paga_primero_interes() -> None:
    assert imputar_abono(500_000, 300_000, 10_000_000) == (300_000, 200_000)


def test_gota_a_gota_equivale_a_791_por_ciento() -> None:
    assert round(tasa_ea_equivalente(100, 20, 1) * 100) == 792  # 20 % mensual


def test_amortizacion_y_costo_real_de_un_credito_de_bajo_monto() -> None:
    filas = amortizar(150_000_000, 0.55, 11_000_000, 400_000)
    assert filas[-1].saldo == 0 and 15 <= len(filas) <= 30
    assert costo_real_ea(150_000_000, 11_000_000, 24) > 0.55  # con descuento inicial cuesta más que la tasa


def test_avalancha_termina_antes_que_solo_cuota() -> None:
    deudas = [
        DeudaSimulada(1, "A", 150_000_000, 0.60, 11_000_000, 400_000),
        DeudaSimulada(2, "B", 170_000_000, 0.65, 13_000_000, 400_000),
    ]
    base, extra = simular(deudas), simular(deudas, 5_000_000)
    assert extra.meses < base.meses and extra.costo_total < base.costo_total


# ---------- API ----------
def _cuenta(cliente: TestClient, nombre: str) -> dict:  # type: ignore[type-arg]
    return next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == nombre)


def _flujo_gasto(cliente: TestClient) -> int:
    return sum(m["gasto_vida"] for m in cliente.get("/api/v1/reportes/flujo").json())


def test_prestar_no_es_gasto_y_el_abono_no_es_ingreso(cliente: TestClient) -> None:
    nequi = _cuenta(cliente, "Nequi")
    cuerpo = {
        "direccion": "presto_yo",
        "persona": "andrés",
        "monto": 5_000_000,
        "cuenta_id": nequi["id"],
        "fecha": "2026-10-01",
        "plan": "cuotas",
        "frecuencia": "quincenal",
        "num_cuotas": 2,
    }
    r = cliente.post("/api/v1/prestamos", json=cuerpo)
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    assert _cuenta(cliente, "Nequi")["saldo"] == nequi["saldo"] - 5_000_000
    assert _flujo_gasto(cliente) == 0  # prestar no es gasto de vida
    assert all(c["nombre"] != "Préstamos por cobrar" for c in cliente.get("/api/v1/cuentas").json())

    cliente.post(f"/api/v1/prestamos/{pid}/abonos", json={"monto": 2_500_000, "cuenta_id": nequi["id"]})
    flujo = cliente.get("/api/v1/reportes/flujo").json()
    assert sum(m["ingresos"] for m in flujo) == 0  # el abono de capital no es ingreso
    p = cliente.get(f"/api/v1/prestamos/{pid}").json()
    assert (p["pendiente"], p["pagado_pct"], p["persona"]) == (2_500_000, 50, "Andrés")
    resumen = cliente.get("/api/v1/prestamos/resumen").json()
    assert resumen["me_deben"] == 2_500_000

    cliente.post(f"/api/v1/prestamos/{pid}/abonos", json={"monto": 2_500_000, "cuenta_id": nequi["id"]})
    assert cliente.get(f"/api/v1/prestamos/{pid}").json()["estado"] == "pagado"
    assert _cuenta(cliente, "Nequi")["saldo"] == nequi["saldo"]


def test_me_prestaron_con_interes_y_condono(cliente: TestClient) -> None:
    nequi = _cuenta(cliente, "Nequi")
    cuerpo = {
        "direccion": "me_prestaron",
        "persona": "Tío David",
        "origen": "familia",
        "monto": 20_000_000,
        "cuenta_id": nequi["id"],
        "fecha": "2026-10-25",
        "tipo_interes": "simple_mensual",
        "tasa_mensual": 0.01,
        "plan": "cuotas",
        "frecuencia": "mensual",
        "num_cuotas": 3,
    }
    previa = cliente.post("/api/v1/prestamos/simular", json=cuerpo).json()
    assert previa["interes_total"] == 600_000 and previa["alerta"] is None
    pid = cliente.post("/api/v1/prestamos", json=cuerpo).json()["id"]
    cliente.post(f"/api/v1/prestamos/{pid}/abonos", json={"monto": 1_000_000, "cuenta_id": nequi["id"]})
    p = cliente.get(f"/api/v1/prestamos/{pid}").json()
    assert (p["interes_pendiente"], p["capital_pendiente"]) == (0, 19_600_000)
    # el interés pagado sí es gasto (servicio de deuda)
    assert sum(m["servicio_deuda"] for m in cliente.get("/api/v1/reportes/flujo").json()) == 600_000
    assert cliente.post(f"/api/v1/prestamos/{pid}/condonar").status_code == 204
    flujo = cliente.get("/api/v1/reportes/flujo").json()
    assert sum(m["ingresos"] for m in flujo) == 19_600_000  # me condonaron: ingreso


def test_alerta_gota_a_gota(cliente: TestClient) -> None:
    nequi = _cuenta(cliente, "Nequi")
    cuerpo = {
        "direccion": "me_prestaron",
        "persona": "Prestadiario",
        "origen": "otra_fuente",
        "monto": 30_000_000,
        "cuenta_id": nequi["id"],
        "fecha": "2026-10-01",
        "tipo_interes": "simple_mensual",
        "tasa_mensual": 0.2,
        "plan": "cuotas",
        "frecuencia": "diaria",
        "num_cuotas": 30,
    }
    previa = cliente.post("/api/v1/prestamos/simular", json=cuerpo).json()
    assert previa["interes_total"] == 6_000_000 and "gota a gota" in previa["alerta"]


def test_presupuesto_asigna_gastado_y_copia(cliente: TestClient, db_sembrada: BaseDatos, bus: BusEventos) -> None:
    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        moto = categoria_por_ruta(u.sesion, Grupo.GASTO_VIDA, "Transporte", "Moto")
        ids = (moto.id, moto.padre_id)
        sueldo = categoria_por_ruta(u.sesion, Grupo.INGRESO, "Trabajo independiente", "Diseño gráfico").id
    moto_id, transporte_id = ids
    nequi = _cuenta(cliente, "Nequi")
    cliente.post(
        "/api/v1/transacciones",
        json={
            "cuenta_id": nequi["id"],
            "monto": -900_000,
            "fecha": "2026-11-03",
            "categoria_id": moto_id,
            "descripcion": "Moto",
        },
    )
    gid = cliente.post(
        "/api/v1/presupuestos-grupos", json={"nombre": "Transporte", "categoria_ids": [transporte_id]}
    ).json()["id"]
    assert cliente.put(f"/api/v1/presupuestos/2026-11/grupos/{gid}", json={"asignado": 7_710_000}).status_code == 204
    r = cliente.get("/api/v1/presupuestos/2026-11").json()
    fila = r["filas"][0]
    assert (fila["gastado"], fila["disponible"], fila["pct"]) == (900_000, 6_810_000, 12)  # suma su subcategoría
    assert r["sin_presupuesto"] == []
    fijo = {"nombre": "Transporte", "categoria_ids": [transporte_id], "es_fijo": True}
    assert cliente.put(f"/api/v1/presupuestos-grupos/{gid}", json=fijo).status_code == 204
    assert cliente.get("/api/v1/presupuestos/2026-11").json()["asignado_fijo"] == 7_710_000
    assert cliente.post("/api/v1/presupuestos/2026-12/copiar", params={"desde": "2026-11"}).json() == {"copiadas": 1}
    ingreso = {"nombre": "Sueldo", "categoria_ids": [sueldo]}
    assert cliente.post("/api/v1/presupuestos-grupos", json=ingreso).status_code == 400
    assert cliente.get("/api/v1/presupuestos/2026-13").status_code == 422


def test_extracto_actualiza_saldo_y_simulador(cliente: TestClient) -> None:
    creditos = cliente.get("/api/v1/creditos").json()
    a = creditos[0]
    r = cliente.post(
        f"/api/v1/creditos/{a['id']}/extractos",
        json={"fecha_corte": "2026-11-10", "saldo": 20_000_000, "cuotas_pendientes": 2},
    )
    assert r.status_code == 201
    a2 = next(c for c in cliente.get("/api/v1/creditos").json() if c["id"] == a["id"])
    assert a2["saldo"] == 20_000_000 and a2["fecha_saldo"] == "2026-11-10"
    tabla = cliente.get(f"/api/v1/creditos/{a['id']}/amortizacion").json()["tabla"]
    assert tabla[-1]["saldo"] == 0
    sim = cliente.get("/api/v1/creditos/simulacion", params={"abono_extra": 2_000_000}).json()
    assert sim["meses_con_abono"] <= sim["meses_base"] and sim["ahorro"] >= 0
