"""Fase 8, bloque A: saldo total con las cuentas elegidas, crear y editar cuentas, y fecha de saldo negativo única."""

from datetime import timedelta

from fastapi.testclient import TestClient

from finanzas.dominio.grupos import Grupo
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.transacciones import hoy_bogota


def _total(cliente: TestClient) -> int:
    return int(cliente.get("/api/v1/reportes/dashboard").json()["saldo_total"])


def test_crear_cuenta_y_elegir_si_suma_al_total(cliente: TestClient) -> None:
    antes = _total(cliente)
    r = cliente.post("/api/v1/cuentas", json={"nombre": "Bolsillo", "tipo": "ahorro", "saldo_inicial": 5_000_000})
    assert r.status_code == 201, r.text
    cid = r.json()["id"]
    assert _total(cliente) == antes + 5_000_000
    assert cliente.patch(f"/api/v1/cuentas/{cid}", json={"incluir_en_total": False}).status_code == 204
    assert _total(cliente) == antes  # fuera del total, pero sigue en la lista de cuentas
    cuenta = next(c for c in cliente.get("/api/v1/cuentas").json() if c["id"] == cid)
    assert cuenta["saldo"] == 5_000_000 and cuenta["incluir_en_total"] is False
    assert cliente.patch(f"/api/v1/cuentas/{cid}", json={"nombre": "Nequi"}).status_code == 409


def test_primer_negativo_es_el_mismo_en_calendario_y_alerta(cliente: TestClient) -> None:
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"]
    en5 = hoy_bogota() + timedelta(days=5)
    cuerpo = {"cuenta_id": nequi, "frecuencia": "mensual", "inicio": hoy_bogota().isoformat()}
    cliente.post("/api/v1/recurrentes", json={**cuerpo, "nombre": "Grande", "monto": -900_000_000, "dia": en5.day})
    cal = cliente.get("/api/v1/calendario").json()
    negativos = [e for e in cal["eventos"] if e["saldo_total"] < 0]
    assert negativos and cal["primer_negativo"]["fecha"] == negativos[0]["fecha"]
    assert cal["minimo"]["fecha"] >= cal["primer_negativo"]["fecha"]
    alerta = next(a for a in cliente.get("/api/v1/alertas").json() if a["tipo"] == "saldo")
    dia = int(cal["primer_negativo"]["fecha"][8:])
    assert f"el {dia} " in alerta["titulo"]


def test_editar_transferencia_mueve_su_par_y_leer_por_id(cliente: TestClient) -> None:
    cuentas = {c["nombre"]: c["id"] for c in cliente.get("/api/v1/cuentas").json()}
    cuerpo = {"origen_id": cuentas["Nequi"], "destino_id": cuentas["Daviplata"], "monto": 1_000_000}
    salida, entrada = cliente.post("/api/v1/transferencias", json=cuerpo).json()
    cambios = {"monto": -2_000_000, "fecha": "2026-10-20T14:30", "descripcion": "Mover"}
    assert cliente.patch(f"/api/v1/transacciones/{salida['id']}", json=cambios).status_code == 200
    par = cliente.get(f"/api/v1/transacciones/{entrada['id']}").json()
    assert (par["monto"], par["fecha"][:16], par["descripcion"]) == (2_000_000, "2026-10-20T14:30", "Mover")
    # el origen no puede quedar en la misma cuenta que el destino
    r = cliente.patch(f"/api/v1/transacciones/{salida['id']}", json={"cuenta_id": cuentas["Daviplata"]})
    assert r.status_code == 400
    assert cliente.get("/api/v1/transacciones/999999").status_code == 404


def _nuevo_credito(cliente: TestClient, nombre: str) -> tuple[int, int, int]:
    cuentas = {c["nombre"]: c for c in cliente.get("/api/v1/cuentas").json()}
    billetera = cuentas["Daviplata"]
    cuerpo = {
        "nombre": nombre,
        "entidad": "Banco X",
        "fecha_desembolso": (hoy_bogota() - timedelta(days=40)).isoformat(),
        "capital_inicial": 300_000_000,
        "monto_recibido": 290_000_000,
        "tasa_ea": 0.24,
        "plazo_meses": 24,
        "cuota": 16_000_000,
        "dia_pago": hoy_bogota().day,
        "seguro_mensual": 200_000,
        "cuenta_pago_id": billetera["id"],
        "cuenta_desembolso_id": billetera["id"],
    }
    r = cliente.post("/api/v1/creditos", json=cuerpo)
    assert r.status_code == 201, r.text
    return r.json()["id"], billetera["id"], billetera["saldo"]


def _saldo(cliente: TestClient, cuenta_id: int) -> int:
    return int(next(c for c in cliente.get("/api/v1/cuentas").json() if c["id"] == cuenta_id)["saldo"])


def test_desembolso_y_eliminar_credito_con_todo_lo_suyo(cliente: TestClient) -> None:
    cid, billetera, saldo_antes = _nuevo_credito(cliente, "Moto")
    assert _saldo(cliente, billetera) == saldo_antes + 290_000_000  # llegó el desembolso
    assert sum(m["ingresos"] for m in cliente.get("/api/v1/reportes/flujo").json()) == 0  # y no es ingreso
    detalle = next(c for c in cliente.get("/api/v1/creditos").json() if c["id"] == cid)
    assert detalle["cuenta_desembolso_id"] == billetera
    cliente.post(f"/api/v1/programadas/{detalle['proximo_pago']['transaccion_id']}/pagar", json={})
    r = cliente.delete(f"/api/v1/creditos/{cid}")
    assert r.status_code == 200 and r.json()["movimientos"] >= 3  # desembolso, cuota pagada y programadas
    assert _saldo(cliente, billetera) == saldo_antes
    assert all(c["id"] != cid for c in cliente.get("/api/v1/creditos").json())
    assert all(r["credito_id"] != cid for r in cliente.get("/api/v1/recurrentes").json()["items"])
    nombres = [h["nombre"] for raiz in cliente.get("/api/v1/categorias").json() for h in raiz["hijos"]]
    assert "Moto" not in nombres


def test_marcar_pagado_conserva_lo_pagado_y_quita_programadas(cliente: TestClient) -> None:
    cid, billetera, _ = _nuevo_credito(cliente, "Portátil")
    detalle = next(c for c in cliente.get("/api/v1/creditos").json() if c["id"] == cid)
    cliente.post(f"/api/v1/programadas/{detalle['proximo_pago']['transaccion_id']}/pagar", json={})
    saldo = _saldo(cliente, billetera)
    assert cliente.post(f"/api/v1/creditos/{cid}/pagado").status_code == 200
    assert _saldo(cliente, billetera) == saldo  # lo pagado se conserva
    assert all(c["id"] != cid for c in cliente.get("/api/v1/creditos").json())
    cerrado = next(c for c in cliente.get("/api/v1/creditos/cerrados").json() if c["id"] == cid)
    assert cerrado["estado"] == "pagado" and cerrado["total_pagado"] == 16_000_000
    pendientes = cliente.get("/api/v1/calendario?dias=90").json()["eventos"]
    assert all("Portátil" not in e["descripcion"] for e in pendientes)


def test_presupuesto_hereda_el_monto_y_acumula_por_dia(
    cliente: TestClient, db_sembrada: BaseDatos, bus: BusEventos
) -> None:
    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        cat = categoria_por_ruta(u.sesion, Grupo.GASTO_VIDA, "Comida", None).id
    gid = cliente.post("/api/v1/presupuestos-grupos", json={"nombre": "Prueba", "categoria_ids": [cat]}).json()["id"]
    assert cliente.put(f"/api/v1/presupuestos/2026-09/grupos/{gid}", json={"asignado": 10_000_000}).status_code == 204
    octubre = next(f for f in cliente.get("/api/v1/presupuestos/2026-10").json()["filas"] if f["id"] == gid)
    assert (octubre["asignado"], octubre["heredado"]) == (10_000_000, True)  # rige hasta que se edite
    agosto = next(f for f in cliente.get("/api/v1/presupuestos/2026-08").json()["filas"] if f["id"] == gid)
    assert agosto["tiene_asignacion"] is False
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"]
    for dia in ("03", "10"):
        cuerpo = {"cuenta_id": nequi, "monto": -1_000_000, "categoria_id": cat, "fecha": f"2026-10-{dia}"}
        cliente.post("/api/v1/transacciones", json=cuerpo)
    acum = cliente.get(f"/api/v1/presupuestos/2026-10/acumulado?grupo={gid}").json()
    assert acum["limite"] == 10_000_000 and acum["dias"] == 31
    assert acum["serie"][2]["actual"] == 1_000_000 and acum["serie"][9]["actual"] == 2_000_000


def test_reactivar_conserva_el_periodo_y_saltar_no_lo_reprograma(cliente: TestClient) -> None:
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"]
    hace5 = hoy_bogota() - timedelta(days=5)
    cuerpo = {
        "nombre": "Streaming X",
        "cuenta_id": nequi,
        "monto": -2_000_000,
        "frecuencia": "mensual",
        "dia": hace5.day,
        "inicio": (hace5 - timedelta(days=60)).isoformat(),
        "es_suscripcion": True,
    }
    rid = cliente.post("/api/v1/recurrentes", json=cuerpo).json()["id"]
    cliente.post(f"/api/v1/recurrentes/{rid}/estado", json={"estado": "pausado"})
    cliente.post(f"/api/v1/recurrentes/{rid}/estado", json={"estado": "activo"})
    vencidos = [e for e in cliente.get("/api/v1/calendario").json()["vencidos"] if e["recurrente_id"] == rid]
    assert [e["fecha"] for e in vencidos] == [hace5.isoformat()]  # el periodo en curso vuelve, no salta al siguiente
    assert cliente.post(f"/api/v1/programadas/{vencidos[0]['id']}/omitir").status_code == 204
    cliente.post(f"/api/v1/recurrentes/{rid}/estado", json={"estado": "pausado"})
    cliente.post(f"/api/v1/recurrentes/{rid}/estado", json={"estado": "activo"})
    cal = cliente.get("/api/v1/calendario").json()
    assert not [e for e in cal["vencidos"] if e["recurrente_id"] == rid]  # lo saltado no regresa
    assert [e for e in cal["eventos"] if e["recurrente_id"] == rid]  # y el siguiente sí está programado


def test_cuotas_pagadas_del_credito(cliente: TestClient) -> None:
    cid, _, _ = _nuevo_credito(cliente, "Bici")
    detalle = next(c for c in cliente.get("/api/v1/creditos").json() if c["id"] == cid)
    assert detalle["cuotas_pagadas"] == 0
    cliente.post(f"/api/v1/programadas/{detalle['proximo_pago']['transaccion_id']}/pagar", json={})
    detalle = next(c for c in cliente.get("/api/v1/creditos").json() if c["id"] == cid)
    assert detalle["cuotas_pagadas"] == 1 and detalle["cuotas_pendientes"] > 0


def test_valor_neto_y_mapa_de_calor_cuadran(cliente: TestClient) -> None:
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"]
    hoy = hoy_bogota().isoformat()
    cliente.post("/api/v1/transacciones", json={"cuenta_id": nequi, "monto": -3_000_000, "fecha": hoy})
    total = cliente.get("/api/v1/reportes/dashboard").json()["saldo_total"]
    for escala in ("mes", "dia"):
        puntos = cliente.get(f"/api/v1/reportes/valor-neto?escala={escala}").json()["puntos"]
        assert puntos and puntos[-1]["saldo"] == total  # el último punto es el saldo de hoy
    mes = hoy[:7]
    calor = cliente.get(f"/api/v1/reportes/calor?desde={mes}&hasta={mes}").json()
    flujo = cliente.get(f"/api/v1/reportes/mensual?desde={mes}&hasta={mes}").json()["totales"]
    assert sum(d["ingreso"] for d in calor["dias"]) == flujo.get("ingresos", 0)


def test_meta_cumplida_archivada_eliminada_y_mover_categoria(
    cliente: TestClient, db_sembrada: BaseDatos, bus: BusEventos
) -> None:
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"]
    cuerpo = {
        "nombre": "Viaje",
        "tipo": "ahorro",
        "objetivo": 900_000_000,
        "cuenta_ids": [nequi],
        "fecha_objetivo": "2027-06-30",
    }
    mid = cliente.post("/api/v1/metas", json=cuerpo).json()["id"]
    meta = next(m for m in cliente.get("/api/v1/metas").json() if m["id"] == mid)
    assert meta["progreso"] == 0 and meta["dias_restantes"] > 0
    cliente.post("/api/v1/transacciones", json={"cuenta_id": nequi, "monto": -1_000_000})
    meta = next(m for m in cliente.get("/api/v1/metas").json() if m["id"] == mid)
    assert meta["progreso"] < 0  # retrocede
    cliente.patch(f"/api/v1/metas/{mid}", json={"estado": "cumplida"})
    meta = next(m for m in cliente.get("/api/v1/metas").json() if m["id"] == mid)
    assert meta["cumplida_en"] == hoy_bogota().isoformat()
    cliente.patch(f"/api/v1/metas/{mid}", json={"estado": "archivada"})
    assert next(m for m in cliente.get("/api/v1/metas").json() if m["id"] == mid)["estado"] == "archivada"
    assert cliente.delete(f"/api/v1/metas/{mid}").status_code == 204
    assert all(m["id"] != mid for m in cliente.get("/api/v1/metas").json())

    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        comida = categoria_por_ruta(u.sesion, Grupo.GASTO_VIDA, "Comida", None).id
        snacks = categoria_por_ruta(u.sesion, Grupo.GASTO_VIDA, "Comida", "Snacks").id
        casa = categoria_por_ruta(u.sesion, Grupo.GASTO_VIDA, "Casa", None).id
        raiz = categoria_por_ruta(u.sesion, Grupo.GASTO_VIDA, "Casa", None).padre_id
    assert cliente.patch(f"/api/v1/categorias/{snacks}", json={"padre_id": casa}).status_code == 204  # adopta
    assert cliente.patch(f"/api/v1/categorias/{snacks}", json={"padre_id": raiz}).status_code == 204  # sin padre
    assert cliente.patch(f"/api/v1/categorias/{casa}", json={"padre_id": comida}).status_code == 204  # sin hijas
    r = cliente.patch(f"/api/v1/categorias/{comida}", json={"padre_id": snacks})
    assert r.status_code == 400  # «Snacks» ya es principal pero «Comida» tiene hijas → no baja de nivel


def test_confirmar_programada_con_fecha_y_hora_como_el_editor(cliente: TestClient) -> None:
    nequi = next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"]
    en5 = hoy_bogota() + timedelta(days=5)
    cuerpo = {
        "nombre": "Internet",
        "cuenta_id": nequi,
        "monto": -7_490_000,
        "frecuencia": "mensual",
        "dia": en5.day,
        "inicio": en5.isoformat(),
    }
    rid = cliente.post("/api/v1/recurrentes", json=cuerpo).json()["id"]
    programada = next(e for e in cliente.get("/api/v1/calendario").json()["eventos"] if e["recurrente_id"] == rid)
    fecha = f"{hoy_bogota().isoformat()}T15:45"  # lo que envía <input type="datetime-local">
    r = cliente.post(f"/api/v1/programadas/{programada['id']}/pagar", json={"fecha": fecha, "monto": -7_490_000})
    assert r.status_code == 204, r.text
    pago = cliente.get(f"/api/v1/transacciones/{programada['id']}").json()
    assert pago["estado"] == "confirmada" and pago["fecha"].startswith(fecha)
