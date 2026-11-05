"""Bloque D: aportar no es gasto, la ganancia se calcula aparte y el patrimonio cuadra."""

from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from finanzas.cli import migrar
from finanzas.config import Config
from finanzas.dominio.activos import Resultado, xirr
from finanzas.dominio.fechas import hoy_bogota
from finanzas.main import crear_app


@pytest.fixture
def app(tmp_path: Path) -> TestClient:
    ruta = tmp_path / "base.db"
    migrar(f"sqlite:///{ruta.as_posix()}")
    config = Config(db_ruta=ruta, backups_dir=tmp_path / "r", tareas_diarias=False)
    cliente = TestClient(crear_app(config))
    assert cliente.post("/api/v1/sistema/primer-uso", json={"modo": "vacio"}).status_code == 204
    return cliente


def _cuenta(c: TestClient, nombre: str = "Cuenta de ahorros") -> dict:
    return next(x for x in c.get("/api/v1/cuentas").json() if x["nombre"] == nombre)


def _dar_saldo(c: TestClient, monto: int) -> None:
    cuerpo = {"cuenta_id": _cuenta(c)["id"], "monto": monto}
    assert c.post("/api/v1/transacciones", json=cuerpo).status_code == 201


def _crear(c: TestClient, **extra: object) -> int:
    hace = (hoy_bogota() - timedelta(days=200)).isoformat()
    cuerpo = {"nombre": "CDT", "clase": "cdt", "fecha_compra": hace, "costo": 1_000_000_00} | extra
    r = c.post("/api/v1/activos", json=cuerpo)
    assert r.status_code == 201, r.text
    return r.json()["id"]


def _mes(c: TestClient) -> dict:
    return c.get("/api/v1/reportes/dashboard").json()


def test_xirr() -> None:
    assert xirr([(date(2025, 1, 1), -1000), (date(2026, 1, 1), 1100)]) == pytest.approx(0.10, abs=0.001)
    assert xirr([(date(2025, 1, 1), -1000), (date(2026, 1, 1), 900)]) == pytest.approx(-0.10, abs=0.001)
    assert xirr([(date(2025, 1, 1), -1000)]) is None  # sin entradas
    assert xirr([(date(2025, 1, 1), -1000), (date(2025, 1, 10), 1100)]) is None  # muy poco tiempo
    assert Resultado(aportado=1000, recibido=200, valor=900).ganancia == 100


def test_aportar_no_es_gasto_pero_sale_de_la_cuenta(app: TestClient) -> None:
    _dar_saldo(app, 3_000_000_00)
    cuenta = _cuenta(app)["id"]
    antes = _mes(app)["mes_actual"]
    activo = _crear(app, costo=0)
    hoy = hoy_bogota().isoformat()
    r = app.post(
        f"/api/v1/activos/{activo}/movimientos",
        json={"tipo": "aporte", "monto": 1_000_000_00, "fecha": hoy, "cuenta_id": cuenta},
    )
    assert r.status_code == 201
    assert _cuenta(app)["saldo"] == 2_000_000_00
    despues = _mes(app)["mes_actual"]
    assert despues["gastos_total"] == antes["gastos_total"] and despues["ingresos_total"] == antes["ingresos_total"]
    lista = app.get("/api/v1/activos").json()
    assert lista["total"] == 1_000_000_00 and lista["aportado"] == 1_000_000_00 and lista["ganancia"] == 0


def test_rendimiento_y_venta(app: TestClient) -> None:
    _dar_saldo(app, 1_000_000_00)
    cuenta = _cuenta(app)["id"]
    activo = _crear(app, cuenta_id=cuenta)
    hoy = hoy_bogota().isoformat()
    assert _cuenta(app)["saldo"] == 0

    # Un rendimiento pagado a una cuenta es ingreso; uno reinvertido solo sube el valor.
    app.post(
        f"/api/v1/activos/{activo}/movimientos",
        json={"tipo": "rendimiento", "monto": 50_000_00, "fecha": hoy, "cuenta_id": cuenta},
    )
    assert _mes(app)["mes_actual"]["ingresos_total"] == 1_050_000_00
    app.post(f"/api/v1/activos/{activo}/movimientos", json={"tipo": "rendimiento", "monto": 20_000_00, "fecha": hoy})
    a = app.get("/api/v1/activos").json()["activos"][0]
    assert a["valor_cop"] == 1_020_000_00 and a["ganancia"] == 70_000_00

    # Actualizar el valor no mueve dinero.
    assert (
        app.post(f"/api/v1/activos/{activo}/valoraciones", json={"fecha": hoy, "valor": 1_100_000_00}).status_code
        == 204
    )
    assert _cuenta(app)["saldo"] == 50_000_00
    assert app.get("/api/v1/activos").json()["activos"][0]["ganancia"] == 150_000_00

    # Vender devuelve el dinero sin contar como ingreso y la ganancia queda aparte.
    r = app.post(
        f"/api/v1/activos/{activo}/movimientos",
        json={"tipo": "venta", "monto": 1_200_000_00, "fecha": hoy, "cuenta_id": cuenta},
    )
    assert r.status_code == 201
    assert _cuenta(app)["saldo"] == 1_250_000_00
    assert _mes(app)["mes_actual"]["ingresos_total"] == 1_050_000_00
    lista = app.get("/api/v1/activos").json()
    a = lista["activos"][0]
    assert a["estado"] == "vendido" and a["valor_cop"] == 0 and a["ganancia"] == 250_000_00
    assert lista["total"] == 0
    assert app.post(f"/api/v1/activos/{activo}/valoraciones", json={"fecha": hoy, "valor": 1}).status_code == 409


def test_deshacer_y_eliminar_devuelven_el_dinero(app: TestClient) -> None:
    _dar_saldo(app, 1_000_000_00)
    cuenta = _cuenta(app)["id"]
    activo = _crear(app, cuenta_id=cuenta)
    hoy = hoy_bogota().isoformat()
    m = app.post(
        f"/api/v1/activos/{activo}/movimientos",
        json={"tipo": "retiro", "monto": 100_000_00, "fecha": hoy, "cuenta_id": cuenta},
    ).json()["id"]
    assert _cuenta(app)["saldo"] == 100_000_00
    assert app.get("/api/v1/activos").json()["total"] == 900_000_00
    assert app.delete(f"/api/v1/activos/{activo}/movimientos/{m}").status_code == 204
    assert _cuenta(app)["saldo"] == 0
    assert app.get("/api/v1/activos").json()["total"] == 1_000_000_00
    assert app.delete(f"/api/v1/activos/{activo}").status_code == 204
    assert _cuenta(app)["saldo"] == 1_000_000_00
    assert app.get("/api/v1/activos").json()["activos"] == []


def test_borrar_la_transaccion_borra_el_movimiento(app: TestClient) -> None:
    _dar_saldo(app, 1_000_000_00)
    activo = _crear(app, cuenta_id=_cuenta(app)["id"])
    txs = app.get("/api/v1/transacciones?limite=10").json()["items"]
    aporte = next(t for t in txs if t["descripcion"].startswith("Aporte a"))
    assert app.delete(f"/api/v1/transacciones/{aporte['id']}").status_code in (200, 204)
    a = next(x for x in app.get("/api/v1/activos").json()["activos"] if x["id"] == activo)
    assert a["movimientos"] == [] and a["aportado"] == 0


def test_patrimonio_neto_cuadra(app: TestClient) -> None:
    _dar_saldo(app, 500_000_00)
    _crear(app, costo=2_000_000_00)  # ya lo tenías: no sale de ninguna cuenta
    p = _mes(app)["patrimonio"]
    assert p["cuentas"] == 500_000_00 and p["activos"] == 2_000_000_00
    assert p["neto"] == 2_500_000_00
    serie = app.get("/api/v1/reportes/patrimonio").json()
    assert serie["puntos"][-1]["neto"] == p["neto"]
    renta = app.get("/api/v1/impuestos/termometro").json()
    fila = next(t for t in renta["filas"] if t["clave"] == "patrimonio")
    assert fila["valor"] == 2_500_000_00  # L4: el patrimonio bruto incluye los activos


def test_validaciones(app: TestClient) -> None:
    hoy = hoy_bogota().isoformat()
    manana = (hoy_bogota() + timedelta(days=1)).isoformat()
    base = {"nombre": "X", "clase": "cdt", "fecha_compra": hoy}
    assert app.post("/api/v1/activos", json=base | {"clase": "nada"}).status_code == 400
    assert app.post("/api/v1/activos", json=base | {"nombre": " "}).status_code == 400
    assert app.post("/api/v1/activos", json=base | {"fecha_compra": manana}).status_code == 400
    activo = _crear(app, costo=0)
    assert (
        app.post(f"/api/v1/activos/{activo}/movimientos", json={"tipo": "venta", "monto": 1, "fecha": hoy}).status_code
        == 400
    )
    assert (
        app.post(f"/api/v1/activos/{activo}/movimientos", json={"tipo": "aporte", "monto": 0, "fecha": hoy}).status_code
        == 400
    )


def test_alertas_de_vencimiento_y_valor_viejo(app: TestClient) -> None:
    vence = (hoy_bogota() + timedelta(days=10)).isoformat()
    _crear(app, vencimiento=vence, nombre="CDT corto")
    alertas = app.get("/api/v1/alertas").json()
    assert any(a["tipo"] == "activo_vence" and "10 días" in a["titulo"] for a in alertas)


def test_meta_de_ahorro_rastrea_activos(app: TestClient) -> None:
    activo = _crear(app, costo=1_000_000_00)
    r = app.post(
        "/api/v1/metas",
        json={"nombre": "Inversiones", "tipo": "ahorro", "objetivo": 2_000_000_00, "activo_ids": [activo]},
    )
    assert r.status_code == 201, r.text
    m = app.get("/api/v1/metas").json()[0]
    assert m["activo_ids"] == [activo] and m["actual"] == 1_000_000_00 and "CDT" in m["rastrea"]


def test_exportar_y_cargar_incluye_activos(app: TestClient) -> None:
    _crear(app)
    copia = app.get("/api/v1/datos/exportar/json")
    assert copia.json()["tablas"]["activo"]
    app.delete(f"/api/v1/activos/{app.get('/api/v1/activos').json()['activos'][0]['id']}")
    assert app.post("/api/v1/datos/cargar", files={"archivo": ("d.json", copia.content)}).status_code == 200
    assert len(app.get("/api/v1/activos").json()["activos"]) == 1


def test_patrimonio_por_movimiento_sigue_la_regla_del_saldo(app: TestClient) -> None:
    _dar_saldo(app, 500_000_00)
    cuenta = _cuenta(app)["id"]
    hoy = hoy_bogota()
    fechas = [(hoy - timedelta(days=d)).isoformat() for d in (90, 45, 45, 10)]
    for f in fechas:
        cuerpo = {"cuenta_id": cuenta, "monto": -1_000_00, "fecha": f}
        assert app.post("/api/v1/transacciones", json=cuerpo).status_code == 201
    r = app.get("/api/v1/reportes/patrimonio?escala=movimiento").json()
    puntos = [p["fecha"] for p in r["puntos"]]
    # Un punto por día con movimientos (dos el mismo día cuentan una vez), más el de hoy.
    assert puntos == sorted({*fechas, hoy.isoformat()})
    assert r["puntos"][-1]["neto"] == _mes(app)["patrimonio"]["neto"]
    # El mes sigue disponible para quien lo pida.
    meses = app.get("/api/v1/reportes/patrimonio").json()["puntos"]
    assert all(len(p["fecha"]) == 7 for p in meses)
    assert app.get("/api/v1/reportes/patrimonio?escala=otra").status_code == 422


def test_la_deuda_empieza_cuando_entra_el_dinero(app: TestClient, tmp_path: Path) -> None:
    """Si la fecha del crédito y la del desembolso difieren, el patrimonio no cae un día para rebotar al siguiente."""
    hoy = hoy_bogota()
    fecha_credito = (hoy - timedelta(days=11)).isoformat()
    entro = (hoy - timedelta(days=10)).isoformat()
    cuenta = _cuenta(app)["id"]
    r = app.post(
        "/api/v1/creditos",
        json={
            "nombre": "Prueba",
            "entidad": "Banco",
            "fecha_desembolso": fecha_credito,
            "capital_inicial": 1_000_000_00,
            "monto_recibido": 1_000_000_00,
            "tasa_ea": 0.2,
            "plazo_meses": 12,
            "cuota": 100_000_00,
            "dia_pago": 28,
            "cuenta_pago_id": cuenta,
            "cuenta_desembolso_id": cuenta,
        },
    )
    assert r.status_code == 201, r.text
    desembolso = next(t for t in app.get("/api/v1/transacciones?limite=50").json()["items"] if t["monto"] > 0)
    assert app.patch(f"/api/v1/transacciones/{desembolso['id']}", json={"fecha": entro}).status_code == 200
    puntos = {p["fecha"]: p for p in app.get("/api/v1/reportes/patrimonio?escala=movimiento").json()["puntos"]}
    assert puntos[entro]["deuda"] == 1_000_000_00 and puntos[entro]["neto"] == 0
    assert fecha_credito not in puntos or puntos[fecha_credito]["deuda"] == 0


def test_inicio_y_deudas_muestran_la_misma_deuda_tras_pagar(tmp_path: Path) -> None:
    """Sin extractos, un pago registrado también baja la deuda de Inicio y del patrimonio."""
    ruta = tmp_path / "demo.db"
    migrar(f"sqlite:///{ruta.as_posix()}")
    config = Config(db_ruta=ruta, backups_dir=tmp_path / "r", tareas_diarias=False)
    c = TestClient(crear_app(config))
    assert c.post("/api/v1/sistema/primer-uso", json={"modo": "demo"}).status_code == 204
    creditos = c.get("/api/v1/creditos").json()
    tablero = c.get("/api/v1/reportes/dashboard").json()
    assert tablero["deuda_total"] == sum(x["saldo"] for x in creditos)
    assert tablero["patrimonio"]["creditos"] == tablero["deuda_total"]
    assert tablero["deuda_total"] < sum(x["capital_inicial"] for x in creditos)  # ya lleva pagos
