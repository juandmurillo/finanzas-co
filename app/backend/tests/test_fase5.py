"""Fase 5: reglas, clasificador, recurrentes, calendario, metas, alertas y respaldos."""

import sqlite3
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from finanzas.dominio import reglas as R
from finanzas.dominio.clasificador import Ejemplo, evaluar, normalizar, sugerir
from finanzas.dominio.errores import ErrorValidacion
from finanzas.dominio.grupos import Grupo
from finanzas.dominio.recurrentes import Pago, costo_mensual, detectar, ocurrencias
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.respaldos import listar, respaldar, restaurar, rotar
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.transacciones import hoy_bogota


# ---------- Dominio: recurrentes ----------
def test_ocurrencias_mensuales_caen_en_el_ultimo_dia_si_el_mes_es_corto() -> None:
    fechas = ocurrencias(date(2026, 1, 31), "mensual", 31, date(2026, 1, 1), date(2026, 4, 30))
    assert fechas == [date(2026, 1, 31), date(2026, 2, 28), date(2026, 3, 31), date(2026, 4, 30)]


def test_ocurrencias_quincenales_respetan_inicio_y_fin() -> None:
    fechas = ocurrencias(date(2026, 10, 1), "quincenal", 1, date(2026, 10, 20), date(2026, 12, 31), date(2026, 11, 20))
    assert fechas == [date(2026, 10, 31), date(2026, 11, 15)]


def test_costo_mensual_y_anual() -> None:
    assert costo_mensual(-1_200_000, "anual") == 100_000
    assert costo_mensual(-1_000_000, "quincenal") == 2_000_000


def test_detecta_un_pago_mensual_y_descarta_lo_irregular() -> None:
    hoy = date(2026, 10, 29)
    pagos = [Pago(date(2026, m, 5), "Netflix", -2_690_000, 1, 7) for m in range(5, 11)]
    pagos += [Pago(date(2026, 10, d), "Almuerzo", -1_500_000, 1, 8) for d in (1, 3, 20)]
    hallados = detectar(pagos, hoy)
    assert [h.descripcion for h in hallados] == ["Netflix"]
    assert hallados[0].frecuencia == "mensual" and hallados[0].proxima == date(2026, 11, 5)


def test_no_detecta_lo_que_ya_no_se_paga() -> None:
    pagos = [Pago(date(2026, m, 5), "Gym", -6_600_000, 1, 9) for m in range(1, 6)]
    assert detectar(pagos, date(2026, 10, 29)) == []


# ---------- Dominio: reglas ----------
def _regla(i: int, prioridad: int, condiciones: list[R.Condicion], categoria: int | None, etiquetas=()) -> R.Regla:  # type: ignore[no-untyped-def]
    return R.Regla(i, f"r{i}", prioridad, tuple(condiciones), R.Acciones(categoria, tuple(etiquetas)))


def test_regla_por_descripcion_monto_y_prioridad() -> None:
    reglas = [
        _regla(1, 50, [R.Condicion("descripcion", "contiene", "uber")], 10),
        _regla(2, 10, [R.Condicion("descripcion", "contiene", "uber"), R.Condicion("monto", "mayor", 5_000_000)], 11),
        _regla(3, 90, [R.Condicion("tipo", "igual", "gasto")], None, ["revisar"]),
    ]
    caro = R.aplicar(reglas, R.Movimiento("Úber al aeropuerto", -6_000_000, 1))
    barato = R.aplicar(reglas, R.Movimiento("UBER", -1_200_000, 1))
    assert (caro.categoria_id, caro.regla_id, caro.etiquetas) == (11, 2, ["revisar"])
    assert barato.categoria_id == 10
    assert R.aplicar(reglas, R.Movimiento("Sueldo", 100, 1)).categoria_id is None


def test_validacion_de_reglas() -> None:
    with pytest.raises(ErrorValidacion):
        R.validar((), R.Acciones(1))
    with pytest.raises(ErrorValidacion):
        R.validar((R.Condicion("monto", "contiene", "x"),), R.Acciones(1))
    with pytest.raises(ErrorValidacion):
        R.validar((R.Condicion("descripcion", "contiene", "x"),), R.Acciones())


# ---------- Dominio: clasificador ----------
def test_normalizar_conserva_digitos() -> None:
    assert normalizar("Pago Banco 2!") == "pago banco 2" != normalizar("Pago Banco")


def test_sugiere_por_historial_por_palabras_y_por_diccionario() -> None:
    hist = [
        Ejemplo("Almuerzo", -1, 1),
        Ejemplo("Almuerzo", -1, 1),
        Ejemplo("Almuerzo", -1, 2),
        Ejemplo("Uber casa", -1, 3),
    ]
    assert sugerir(hist, "almuerzo", -5)[0].categoria_id == 2  # la más reciente manda
    assert sugerir(hist, "Uber al centro", -5)[0].via == "palabras"
    resolver = lambda cat, sub, h: 99 if cat == "Factura" else None  # noqa: E731
    netflix = sugerir(hist, "Netflix", -5, resolver)[0]
    assert (netflix.categoria_id, netflix.via) == (99, "diccionario")
    assert sugerir(hist, "", -100)[0].via == "frecuencia"
    assert sugerir(hist, "", 100) == []  # sin ingresos en el historial no hay qué sugerir


def test_evaluar_predice_solo_con_el_pasado() -> None:
    hist = [Ejemplo("Spotify", -1, 5)] * 5 + [Ejemplo("Nuevo", -1, 6)]
    e = evaluar(hist, ultimos=5)
    assert e.casos == 5 and e.acierto == 0.8  # 4 Spotify acertados; "Nuevo" no tenía historial


# ---------- API ----------
def _nequi(cliente: TestClient) -> int:
    return int(next(c for c in cliente.get("/api/v1/cuentas").json() if c["nombre"] == "Nequi")["id"])


@pytest.fixture
def cats(db_sembrada: BaseDatos, bus: BusEventos) -> dict[str, int]:
    rutas = {
        "Uber": (Grupo.GASTO_VIDA, "Transporte", "Uber"),
        "Streaming": (Grupo.GASTO_VIDA, "Factura", "Streaming"),
        "Apuestas": (Grupo.APUESTAS, "Apuestas", "Betplay"),
        "Comida": (Grupo.GASTO_VIDA, "Comida", None),
    }
    with UnidadDeTrabajo(db_sembrada.fabrica, bus) as u:
        ids = {n: categoria_por_ruta(u.sesion, *r).id for n, r in rutas.items()}
        ids["ApuestasPadre"] = categoria_por_ruta(u.sesion, Grupo.APUESTAS, "Apuestas", None).id
        return ids


def test_regla_categoriza_al_crear_y_se_puede_probar(cliente: TestClient, cats: dict[str, int]) -> None:
    regla = {
        "nombre": "Uber",
        "condiciones": [{"campo": "descripcion", "op": "contiene", "valor": "uber"}],
        "categoria_id": cats["Uber"],
        "etiquetas": ["Transporte app"],
    }
    assert cliente.post("/api/v1/reglas", json=regla).status_code == 201
    tx = cliente.post(
        "/api/v1/transacciones", json={"cuenta_id": _nequi(cliente), "monto": -1_500_000, "descripcion": "Uber norte"}
    )
    cuerpo = tx.json()
    assert cuerpo["categoria_id"] == cats["Uber"] and cuerpo["etiquetas"] == ["transporte app"]
    sug = cliente.get("/api/v1/sugerencias/clasificar", params={"descripcion": "uber sur", "monto": -9}).json()
    assert (sug[0]["categoria_id"], sug[0]["via"]) == (cats["Uber"], "regla")
    prueba = cliente.post("/api/v1/reglas/probar", json=regla["condiciones"]).json()
    assert prueba["total"] == 1
    assert cliente.get("/api/v1/reglas").json()[0]["categoria_ruta"][-1] == "Uber"
    malo = {**regla, "condiciones": [{"campo": "monto", "op": "contiene", "valor": "x"}]}
    assert cliente.post("/api/v1/reglas", json=malo).status_code == 400


def test_clasificar_y_medir_aceptacion(cliente: TestClient, cats: dict[str, int]) -> None:
    nequi = _nequi(cliente)
    for _ in range(2):
        cliente.post(
            "/api/v1/transacciones",
            json={"cuenta_id": nequi, "monto": -1_010_000, "descripcion": "Spotify", "categoria_id": cats["Streaming"]},
        )
    sug = cliente.get("/api/v1/sugerencias/clasificar", params={"descripcion": "spotify", "monto": -1_010_000}).json()
    assert sug[0]["categoria_id"] == cats["Streaming"] and sug[0]["via"] == "historial"
    cliente.post(
        "/api/v1/transacciones",
        json={
            "cuenta_id": nequi,
            "monto": -1_010_000,
            "descripcion": "Spotify",
            "categoria_id": cats["Streaming"],
            "origen_categoria": "sugerida",
        },
    )
    uso = cliente.get("/api/v1/sugerencias/precision").json()["uso_real"]
    assert uso["aceptadas"] == 1 and uso["movimientos"] == 3


def test_recurrente_programa_y_al_pagar_mueve_el_saldo(cliente: TestClient, cats: dict[str, int]) -> None:
    nequi = _nequi(cliente)
    hoy = hoy_bogota()
    cuerpo = {
        "nombre": "Netflix",
        "cuenta_id": nequi,
        "monto": -2_690_000,
        "frecuencia": "mensual",
        "dia": hoy.day,
        "inicio": hoy.isoformat(),
        "categoria_id": cats["Streaming"],
        "es_suscripcion": True,
    }
    r = cliente.post("/api/v1/recurrentes", json=cuerpo)
    assert r.status_code == 201, r.text
    lista = cliente.get("/api/v1/recurrentes").json()
    assert lista["suscripciones_anual"] == 2_690_000 * 12 and lista["items"][0]["proxima"] == hoy.isoformat()
    cal = cliente.get("/api/v1/calendario", params={"dias": 45}).json()
    netflix = [e for e in cal["eventos"] if e["descripcion"] == "Netflix"]
    assert len(netflix) == 2  # hoy y el mes siguiente
    assert cal["saldo_final"] == cal["saldo_inicial"] - 2 * 2_690_000
    saldo_antes = next(c["saldo"] for c in cliente.get("/api/v1/cuentas").json() if c["id"] == nequi)
    assert cliente.post(f"/api/v1/programadas/{netflix[0]['id']}/pagar", json={}).status_code == 204
    saldo_despues = next(c["saldo"] for c in cliente.get("/api/v1/cuentas").json() if c["id"] == nequi)
    assert saldo_despues == saldo_antes - 2_690_000
    # editar rehace las programadas futuras sin duplicar
    rid = r.json()["id"]
    assert cliente.put(f"/api/v1/recurrentes/{rid}", json={**cuerpo, "monto": -2_990_000}).status_code == 204
    futuras = [e for e in cliente.get("/api/v1/calendario").json()["eventos"] if e["recurrente_id"] == rid]
    assert [e["monto"] for e in futuras] == [-2_990_000]
    assert cliente.post(f"/api/v1/programadas/{netflix[0]['id']}/pagar", json={}).status_code == 400


def test_metas_ahorro_tope_y_habito(cliente: TestClient, cats: dict[str, int]) -> None:
    nequi = _nequi(cliente)
    ahorro = {"nombre": "Fondo", "tipo": "ahorro", "objetivo": 100_000_000, "cuenta_id": nequi}
    assert cliente.post("/api/v1/metas", json=ahorro).status_code == 201
    tope = {"nombre": "Comida", "tipo": "tope_gasto", "objetivo": 5_000_000, "categoria_id": cats["Comida"]}
    assert cliente.post("/api/v1/metas", json=tope).status_code == 201
    habito = {"nombre": "Cero apuestas", "tipo": "habito", "categoria_id": cats["ApuestasPadre"]}
    assert cliente.post("/api/v1/metas", json=habito).status_code == 201
    assert cliente.post("/api/v1/metas", json={"nombre": "x", "tipo": "ahorro"}).status_code == 400
    hace3 = (hoy_bogota() - timedelta(days=3)).isoformat()
    cliente.post(
        "/api/v1/transacciones", json={"cuenta_id": nequi, "monto": -6_000_000, "categoria_id": cats["Comida"]}
    )
    if hace3[:7] == hoy_bogota().isoformat()[:7]:
        cliente.post(
            "/api/v1/transacciones",
            json={"cuenta_id": nequi, "monto": -1_000_000, "categoria_id": cats["Apuestas"], "fecha": hace3},
        )
    metas = {m["nombre"]: m for m in cliente.get("/api/v1/metas").json()}
    assert metas["Comida"]["excedido"] and metas["Comida"]["actual"] == 6_000_000
    assert metas["Fondo"]["progreso"] < 0  # se gastó de la cuenta después de crearla: retrocede (fase 8, 11.2)
    if hace3[:7] == hoy_bogota().isoformat()[:7]:
        assert metas["Cero apuestas"]["racha_dias"] == 3 and metas["Cero apuestas"]["excedido"]
    alertas = cliente.get("/api/v1/alertas").json()
    assert any(a["tipo"] == "meta" and "Comida" in a["titulo"] for a in alertas)


def test_alerta_de_presupuesto_al_80(cliente: TestClient, cats: dict[str, int]) -> None:
    mes = hoy_bogota().isoformat()[:7]
    gid = cliente.post(
        "/api/v1/presupuestos-grupos", json={"nombre": "Comida", "categoria_ids": [cats["Comida"]]}
    ).json()["id"]
    cliente.put(f"/api/v1/presupuestos/{mes}/grupos/{gid}", json={"asignado": 10_000_000})
    cliente.post(
        "/api/v1/transacciones",
        json={"cuenta_id": _nequi(cliente), "monto": -8_500_000, "categoria_id": cats["Comida"]},
    )
    alerta = next(a for a in cliente.get("/api/v1/alertas").json() if a["tipo"] == "presupuesto")
    assert alerta["nivel"] == "aviso" and "85 %" in alerta["titulo"]


def test_respaldo_por_api_y_restauracion(cliente: TestClient, tmp_path: Path) -> None:
    r = cliente.post("/api/v1/respaldos")
    assert r.status_code == 201
    assert cliente.get("/api/v1/respaldos").json()[0]["archivo"] == r.json()["archivo"]


def test_restaurar_y_rotar(tmp_path: Path) -> None:
    base = tmp_path / "f.db"
    con = sqlite3.connect(base)
    con.execute("CREATE TABLE t (x)")
    con.execute("INSERT INTO t VALUES (1)")
    con.commit()
    con.close()
    carpeta = tmp_path / "Backups"
    copia = respaldar(base, carpeta)
    assert copia is not None and listar(carpeta)[0]["archivo"] == copia.name
    con = sqlite3.connect(base)
    con.execute("DELETE FROM t")
    con.commit()
    con.close()
    restaurar(copia, base)
    assert sqlite3.connect(base).execute("SELECT count(*) FROM t").fetchone()[0] == 1
    assert list(tmp_path.glob("f-antes-de-restaurar-*.db"))
    for i in range(40):  # 40 reinicios en un día y uno viejo: quedan 30 + el del día viejo
        (carpeta / f"finanzas-20261029-{i:06d}.db").write_bytes(b"")
    (carpeta / "finanzas-20261020-120000.db").write_bytes(b"")
    from datetime import datetime

    rotar(carpeta, 30, 30, datetime(2026, 10, 29, 23))
    nombres = {c.name for c in carpeta.glob("finanzas-*.db")}
    assert "finanzas-20261020-120000.db" in nombres and len(nombres) == 31
