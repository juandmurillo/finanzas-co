"""Fase 7, bloque A: pagos de crédito unificados con desglose, crear/editar crédito y recurrentes con estado y ancla."""

from datetime import timedelta

from fastapi.testclient import TestClient
from sqlalchemy import select

from finanzas.dominio.creditos import ExtractoCredito, PagoCredito, desglosar_pagos
from finanzas.dominio.grupos import Grupo
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.modelos import Transaccion
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.transacciones import hoy_bogota
from finanzas.servicios.unificar_creditos import unificar


def test_desglose_usa_el_extracto_y_el_abono_va_a_capital() -> None:
    pagos = [PagoCredito(1, "2026-07-11", 12_500_000), PagoCredito(2, "2026-08-11", 12_500_000)]
    ex = [ExtractoCredito("2026-08-11", 165_000_000, 7_000_000, 4_600_000, 400_000)]
    d, saldo = desglosar_pagos(170_000_000, 0.60, 400_000, pagos, ex)
    assert d[0].capital + d[0].interes + d[0].seguro == 12_500_000
    assert (d[1].interes, d[1].seguro, saldo) == (7_000_000, 400_000, 165_000_000)  # manda el extracto
    d2, saldo2 = desglosar_pagos(
        170_000_000, 0.60, 400_000, [*pagos, PagoCredito(3, "2026-08-20", 1_000_000, True)], ex
    )
    assert d2[-1].tipo == "abono" and d2[-1].capital == 1_000_000 and saldo2 == 164_000_000


def _credito(cliente: TestClient) -> dict:  # type: ignore[type-arg]
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")
    cuerpo = {
        "nombre": "Moto",
        "entidad": "Banco X",
        "fecha_desembolso": (hoy_bogota() - timedelta(days=40)).isoformat(),
        "capital_inicial": 300_000_000,
        "monto_recibido": 290_000_000,
        "tasa_ea": 0.24,
        "plazo_meses": 24,
        "cuota": 16_000_000,
        "dia_pago": hoy_bogota().day,
        "seguro_mensual": 200_000,
        "cuenta_pago_id": nequi["id"],
    }
    assert cliente.post("/api/v1/creditos", json={**cuerpo, "cuota": 1_000}).status_code == 400  # no cubre interés
    r = cliente.post("/api/v1/creditos", json=cuerpo)
    assert r.status_code == 201, r.text
    return {**cuerpo, "id": r.json()["id"]}


def test_crear_credito_pagar_cuota_y_abonar_recalcula(cliente: TestClient) -> None:
    c = _credito(cliente)
    detalle = next(d for d in cliente.get("/api/v1/creditos").json() if d["id"] == c["id"])
    prox = detalle["proximo_pago"]
    assert prox["transaccion_id"] and prox["capital"] + prox["interes"] + prox["seguro"] == prox["total"]
    # pagar la cuota programada liga el pago y baja el saldo
    assert cliente.post(f"/api/v1/programadas/{prox['transaccion_id']}/pagar", json={}).status_code == 204
    tras_cuota = next(d for d in cliente.get("/api/v1/creditos").json() if d["id"] == c["id"])
    assert tras_cuota["saldo"] == c["capital_inicial"] - prox["capital"] and tras_cuota["avance"] > 0
    # un abono extra en la subcategoría «Abono a capital» va todo a capital
    arbol = cliente.get("/api/v1/categorias").json()
    deuda = next(n for n in arbol if n["grupo"] == "servicio_deuda")
    abono = next(
        s for k in deuda["hijos"] if k["nombre"] == "Moto" for s in k["hijos"] if s["nombre"] == "Abono a capital"
    )
    cliente.post(
        "/api/v1/transacciones",
        json={
            "cuenta_id": c["cuenta_pago_id"],
            "monto": -5_000_000,
            "categoria_id": abono["id"],
            "descripcion": "Abono",
        },
    )
    tras_abono = cliente.get(f"/api/v1/creditos/{c['id']}/amortizacion").json()
    assert tras_abono["saldo"] == tras_cuota["saldo"] - 5_000_000
    assert tras_abono["pagos"][0]["tipo"] == "abono"
    assert cliente.put(f"/api/v1/creditos/{c['id']}", json={**c, "cuota": 16_500_000}).status_code == 204


def test_unificar_une_intereses_y_abono_sin_cambiar_totales(db_sembrada: BaseDatos, bus: BusEventos) -> None:
    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        interes = categoria_por_ruta(u.sesion, Grupo.SERVICIO_DEUDA, "Crédito A", "Intereses").id
        capital = categoria_por_ruta(u.sesion, Grupo.SERVICIO_DEUDA, "Crédito A", "Abono a capital").id
        cuenta = u.sesion.scalar(select(Transaccion.cuenta_id).limit(1)) or 1
        for cat, monto in ((interes, -3_000_000), (capital, -6_500_000)):
            u.sesion.add(
                Transaccion(
                    cuenta_id=cuenta,
                    fecha="2026-10-10T10:00:00-05:00",
                    monto=monto,
                    categoria_id=cat,
                    descripcion="Pago A",
                    nota="",
                    estado="confirmada",
                    creado_en="x",
                    actualizado_en="x",
                )
            )
    with db_sembrada.fabrica() as s:
        resumen = unificar(s)
        s.commit()
    assert resumen["totales_iguales"]
    with db_sembrada.fabrica() as s:
        pagos = s.scalars(
            select(Transaccion).where(Transaccion.descripcion == "Cuota Crédito A", Transaccion.estado == "confirmada")
        ).all()
        assert len(pagos) == 1 and pagos[0].monto == -9_500_000 and pagos[0].credito_id is not None


def test_recurrente_pausa_ancla_pago_y_fecha_programada(cliente: TestClient) -> None:
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"]
    hace10 = (hoy_bogota() - timedelta(days=10)).isoformat()
    cuerpo = {
        "nombre": "Gym",
        "cuenta_id": nequi,
        "monto": -6_600_000,
        "frecuencia": "mensual",
        "dia": 1,
        "inicio": hace10,
        "ancla": "pago",
        "es_suscripcion": True,
    }
    rid = cliente.post("/api/v1/recurrentes", json=cuerpo).json()["id"]
    cal = cliente.get("/api/v1/calendario").json()
    vencido = next(e for e in cal["vencidos"] if e["recurrente_id"] == rid)
    assert vencido["fecha"] == hace10 and vencido["dias"] == -10
    # pagar con la fecha programada conserva la fecha; el siguiente periodo nace 30 días después
    cliente.post(f"/api/v1/programadas/{vencido['id']}/pagar", json={"fecha_modo": "programada"})
    siguiente = next(e for e in cliente.get("/api/v1/calendario").json()["eventos"] if e["recurrente_id"] == rid)
    assert siguiente["fecha"] == (hoy_bogota() + timedelta(days=20)).isoformat()
    # pausar borra lo programado; reactivar lo vuelve a programar
    assert cliente.post(f"/api/v1/recurrentes/{rid}/estado", json={"estado": "pausado"}).status_code == 204
    assert not [e for e in cliente.get("/api/v1/calendario").json()["eventos"] if e["recurrente_id"] == rid]
    item = next(r for r in cliente.get("/api/v1/recurrentes").json()["items"] if r["id"] == rid)
    assert item["estado"] == "pausado" and item["ancla"] == "pago"


# ---------- Bloque D ----------
def _hojas(db: BaseDatos, bus: BusEventos) -> dict[str, int]:
    with UnidadDeTrabajo(db.fabrica, bus) as u:
        rutas = {
            "aporte": (Grupo.GASTO_VIDA, "Casa", "Aporte al hogar"),
            "internet": (Grupo.GASTO_VIDA, "Factura", "Internet hogar"),
            "amazon": (Grupo.GASTO_VIDA, "Factura", "Streaming"),
            "comida": (Grupo.GASTO_VIDA, "Comida", None),
            "snacks": (Grupo.GASTO_VIDA, "Comida", "Snacks"),
        }
        return {k: categoria_por_ruta(u.sesion, *r).id for k, r in rutas.items()}


def _gasto(
    cliente: TestClient, categoria_id: int, monto: int, fecha: str = "2026-11-05", cuenta: str = "Nequi"
) -> None:
    cid = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == cuenta)["id"]
    cuerpo = {"cuenta_id": cid, "monto": -monto, "categoria_id": categoria_id, "fecha": fecha}
    assert cliente.post("/api/v1/transacciones", json=cuerpo).status_code == 201


def test_presupuesto_de_varias_categorias_e_historico(
    cliente: TestClient, db_sembrada: BaseDatos, bus: BusEventos
) -> None:
    h = _hojas(db_sembrada, bus)
    casa = {"nombre": "Casa", "categoria_ids": [h["aporte"], h["internet"], h["amazon"]], "es_fijo": True}
    gid = cliente.post("/api/v1/presupuestos-grupos", json=casa).json()["id"]
    otro = {"nombre": "Repetido", "categoria_ids": [h["internet"]]}
    assert cliente.post("/api/v1/presupuestos-grupos", json=otro).status_code == 400  # ya está en «Casa»
    cliente.put(f"/api/v1/presupuestos/2026-11/grupos/{gid}", json={"asignado": 60_000_000})
    for k, v in (("aporte", 50_000_000), ("internet", 7_490_000), ("amazon", 2_500_000)):
        _gasto(cliente, h[k], v)
    fila = next(f for f in cliente.get("/api/v1/presupuestos/2026-11").json()["filas"] if f["id"] == gid)
    assert fila["gastado"] == 59_990_000 and len(fila["categorias"]) == 3
    hist = cliente.get("/api/v1/presupuestos-historico", params={"desde": "2026-10", "hasta": "2026-11"}).json()
    nov = next(m for m in hist["meses"] if m["mes"] == "2026-11")
    assert nov["grupos"]["Casa"] == {"asignado": 60_000_000, "gastado": 59_990_000}


def test_fusionar_categoria_reasigna_todo(cliente: TestClient, db_sembrada: BaseDatos, bus: BusEventos) -> None:
    h = _hojas(db_sembrada, bus)
    _gasto(cliente, h["snacks"], 1_000_000)
    regla = {
        "nombre": "Snacks",
        "condiciones": [{"campo": "descripcion", "op": "contiene", "valor": "papas"}],
        "categoria_id": h["snacks"],
    }
    cliente.post("/api/v1/reglas", json=regla)
    gid = cliente.post("/api/v1/presupuestos-grupos", json={"nombre": "Snacks", "categoria_ids": [h["snacks"]]}).json()[
        "id"
    ]
    r = cliente.delete(f"/api/v1/categorias/{h['snacks']}", params={"destino": h["amazon"]})
    assert r.status_code == 200 and r.json()["movidos"] == 1
    assert cliente.get("/api/v1/reglas").json()[0]["categoria_id"] == h["amazon"]
    fila = next(f for f in cliente.get("/api/v1/presupuestos/2026-11").json()["filas"] if f["id"] == gid)
    assert [c["id"] for c in fila["categorias"]] == [h["amazon"]]
    assert cliente.delete(f"/api/v1/categorias/{h['comida']}", params={"destino": h["comida"]}).status_code == 400
    assert (
        cliente.patch(f"/api/v1/categorias/{h['amazon']}", json={"icono": "wifi", "color": "chart-2"}).status_code
        == 204
    )
    assert cliente.patch(f"/api/v1/categorias/{h['amazon']}", json={"color": "rojo"}).status_code == 400


def test_meta_por_varias_cuentas_y_categorias(cliente: TestClient, db_sembrada: BaseDatos, bus: BusEventos) -> None:
    h = _hojas(db_sembrada, bus)
    cuentas = {c["nombre"]: c for c in cliente.get("/api/v1/cuentas").json()}
    ahorro = {
        "nombre": "Fondo",
        "tipo": "ahorro",
        "objetivo": 100_000_000,
        "cuenta_ids": [cuentas["Nequi"]["id"], cuentas["Ahorro"]["id"]],
    }
    assert cliente.post("/api/v1/metas", json=ahorro).status_code == 201
    mes = hoy_bogota().isoformat()
    tope = {
        "nombre": "Casa",
        "tipo": "tope_gasto",
        "objetivo": 5_000_000,
        "categoria_ids": [h["internet"], h["amazon"]],
    }
    assert cliente.post("/api/v1/metas", json=tope).status_code == 201
    _gasto(cliente, h["internet"], 3_000_000, mes)
    _gasto(cliente, h["amazon"], 2_500_000, mes)
    metas = {m["nombre"]: m for m in cliente.get("/api/v1/metas").json()}
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["saldo"]
    ahorro_saldo = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Ahorro")["saldo"]
    assert metas["Fondo"]["actual"] == nequi + ahorro_saldo and len(metas["Fondo"]["rastrea"]) == 2
    assert metas["Casa"]["actual"] == 5_500_000 and metas["Casa"]["excedido"]


def test_asistente_contexto_y_herramientas_sin_nombres_ni_numeros(cliente: TestClient, db_sembrada: BaseDatos) -> None:
    from finanzas.infra import herramientas_asistente as h
    from finanzas.servicios.asistente import sistema

    c = _credito(cliente)
    cliente.put(f"/api/v1/creditos/{c['id']}", json={**{k: v for k, v in c.items() if k != "id"}, "numero": "9999-77"})
    nequi = next(x for x in cliente.get("/api/v1/cuentas").json() if x["nombre"] == "Nequi")
    hoy = hoy_bogota().isoformat()
    prestamo = {"direccion": "me_prestaron", "persona": "Zacarías", "monto": 5_000_000, "cuenta_id": nequi["id"]}
    assert cliente.post("/api/v1/prestamos", json={**prestamo, "fecha": hoy, "plan": "fecha_unica"}).status_code == 201
    with db_sembrada.fabrica() as s:
        texto = sistema(s, hoy) + str(
            [
                h.recurrentes(s),
                h.calendario(s, 90),
                h.metas(s),
                h.revision(s, hoy[:7]),
                h.termometro_renta(s),
                h.prestamos_personales(s),
                h.deudas(s),
            ]
        )
    assert "analista experto" in texto and "Carga de deuda" in texto  # rol + resumen
    assert "Zacar" not in texto and "9999-77" not in texto
    assert "préstamo personal" in texto  # la cuota del préstamo aparece, sin la persona
