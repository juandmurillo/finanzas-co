"""Bloque B: exportar, cargar, restaurar y borrar. Lo que falla no debe tocar la base."""

import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from httpx import Response
from openpyxl import load_workbook

from finanzas.cli import migrar
from finanzas.config import Config
from finanzas.infra.exportar_excel import _texto_seguro
from finanzas.infra.respaldos import listar
from finanzas.main import crear_app


@pytest.fixture
def app(tmp_path: Path) -> TestClient:
    ruta = tmp_path / "nueva.db"
    migrar(f"sqlite:///{ruta.as_posix()}")
    config = Config(db_ruta=ruta, backups_dir=tmp_path / "r", tareas_diarias=False)
    cliente = TestClient(crear_app(config))
    assert cliente.post("/api/v1/sistema/primer-uso", json={"nombre": "Prueba", "modo": "demo"}).status_code == 204
    return cliente


def _saldos(c: TestClient) -> dict[str, int]:
    return {x["nombre"]: x["saldo"] for x in c.get("/api/v1/cuentas").json()}


def _subir(c: TestClient, ruta: str, cuerpo: bytes) -> Response:
    return c.post(f"/api/v1/{ruta}", files={"archivo": ("datos", cuerpo)})


def test_exportar_json_y_volver_a_cargar_deja_lo_mismo(app: TestClient) -> None:
    exportado = app.get("/api/v1/datos/exportar/json")
    assert "attachment" in exportado.headers["content-disposition"]
    antes = _saldos(app)
    n_mov = len(exportado.json()["tablas"]["transaccion"])
    assert app.post("/api/v1/transacciones", json={"cuenta_id": 1, "monto": -5_000_000}).status_code == 201
    assert _saldos(app) != antes

    previa = _subir(app, "datos/vista-previa", exportado.content).json()
    assert next(x for x in previa["entra"] if x["tabla"] == "transaccion")["filas"] == n_mov
    assert _saldos(app) != antes  # la vista previa no cambia nada

    r = _subir(app, "datos/cargar", exportado.content)
    assert r.status_code == 200
    assert r.json()["respaldo"]
    assert _saldos(app) == antes
    restauradas = app.get("/api/v1/datos/exportar/json").json()["tablas"]["transaccion"]
    assert {t["id"]: t["id_global"] for t in restauradas} == {
        t["id"]: t["id_global"] for t in exportado.json()["tablas"]["transaccion"]
    }
    assert app.get("/api/v1/sistema").json()["es_demo"] is True


def test_cargar_copia_sqlite(app: TestClient) -> None:
    copia = app.get("/api/v1/datos/exportar/sqlite").content
    antes = _saldos(app)
    app.post("/api/v1/transacciones", json={"cuenta_id": 1, "monto": -5_000_000})
    assert _subir(app, "datos/cargar", copia).status_code == 200
    assert _saldos(app) == antes


def test_cola_conserva_identidad_tras_editar_borrar_y_restaurar(app: TestClient) -> None:
    def tablas():
        return app.get("/api/v1/datos/exportar/json").json()["tablas"]

    antes = tablas()
    tx = app.post("/api/v1/transacciones", json={"cuenta_id": 1, "monto": -100}).json()
    ruta = f"/api/v1/transacciones/{tx['id']}"
    assert app.patch(ruta, json={"nota": "corregido"}).status_code == 200
    assert app.delete(ruta).status_code == 204
    copia = app.get("/api/v1/datos/exportar/json").content
    cambios = tablas()["cambio_pendiente"][len(antes["cambio_pendiente"]) :]
    movimientos = [c for c in cambios if c["entidad"] == "transaccion"]
    assert [c["accion"] for c in movimientos] == ["crear", "editar", "eliminar"]
    assert len({c["entidad_id"] for c in movimientos}) == 1
    assert len({c["operacion"] for c in movimientos}) == 3
    assert {c["libro_id"] for c in movimientos} == {antes["libro"][0]["id_global"]}
    original = tablas()
    alta, edicion, baja = movimientos
    assert alta["version_base"] is None
    assert edicion["version_base"] == alta["operacion"]
    assert baja["version_base"] == edicion["operacion"]
    nota_borrada = next(
        d for d in original["detalle_cambio"] if d["secuencia"] == baja["secuencia"] and d["campo"] == "nota"
    )
    assert (nota_borrada["antes"], nota_borrada["despues"]) == ("corregido", None)
    assert _subir(app, "datos/cargar", copia).status_code == 200
    assert tablas()["cambio_pendiente"] == original["cambio_pendiente"]
    assert tablas()["detalle_cambio"] == original["detalle_cambio"]


def test_dos_ediciones_desde_la_misma_copia_conservan_ambos_importes(app: TestClient) -> None:
    creada = app.post("/api/v1/transacciones", json={"cuenta_id": 1, "monto": -48000}).json()
    copia = app.get("/api/v1/datos/exportar/json").content
    alta = json.loads(copia)["tablas"]["cambio_pendiente"][-1]
    versiones = []
    for monto in (-52000, -50000):
        assert _subir(app, "datos/cargar", copia).status_code == 200
        assert app.patch(f"/api/v1/transacciones/{creada['id']}", json={"monto": monto}).status_code == 200
        tablas = app.get("/api/v1/datos/exportar/json").json()["tablas"]
        cambio = tablas["cambio_pendiente"][-1]
        assert cambio["version_base"] == alta["operacion"]
        versiones.append(cambio["operacion"])
        importe = next(
            d for d in tablas["detalle_cambio"] if d["secuencia"] == cambio["secuencia"] and d["campo"] == "monto"
        )
        assert (importe["antes"], importe["despues"]) == (-48000, monto)
    assert versiones[0] != versiones[1]


def test_lotes_de_transferencia_y_referencias_globales(app: TestClient) -> None:
    def tablas():
        return app.get("/api/v1/datos/exportar/json").json()["tablas"]

    inicial = tablas()
    cursor = len(inicial["cambio_pendiente"])
    cuentas = {c["id"]: c["id_global"] for c in inicial["cuenta"]}
    origen, destino = list(cuentas)[:2]
    respuesta = app.post("/api/v1/transferencias", json={"origen_id": origen, "destino_id": destino, "monto": 500})
    assert respuesta.status_code == 201
    salida, entrada = respuesta.json()
    creado = tablas()
    cambios = creado["cambio_pendiente"][cursor:]
    (lote,) = {c["lote"] for c in cambios}
    assert lote
    secuencias = {c["secuencia"] for c in cambios if c["entidad"] == "transaccion"}
    detalle = [d for d in creado["detalle_cambio"] if d["secuencia"] in secuencias]
    assert {d["despues_global"] for d in detalle if d["campo"] == "cuenta_id"} == {cuentas[origen], cuentas[destino]}
    pares = {t["id_global"] for t in creado["transaccion"] if t["id"] in (salida["id"], entrada["id"])}
    assert {d["despues_global"] for d in detalle if d["campo"] == "transferencia_id" and d["despues"]} == pares
    ruta = f"/api/v1/transacciones/{salida['id']}"
    assert app.patch(ruta, json={"cuenta_id": destino, "cuenta_par_id": destino}).status_code == 400
    assert tablas()["cambio_pendiente"] == creado["cambio_pendiente"]
    assert app.patch(ruta, json={"cuenta_id": destino, "cuenta_par_id": origen, "monto": -600}).status_code == 200
    editado = tablas()
    (lote_edicion,) = {c["lote"] for c in editado["cambio_pendiente"][len(creado["cambio_pendiente"]) :]}
    assert app.delete(ruta).status_code == 204
    (lote_borrado,) = {c["lote"] for c in tablas()["cambio_pendiente"][len(editado["cambio_pendiente"]) :]}
    assert len({lote, lote_edicion, lote_borrado}) == 3


def test_json_de_una_version_anterior_se_migra(app: TestClient) -> None:
    datos = app.get("/api/v1/datos/exportar/json").json()
    datos["revision"] = "0009"
    for tabla in ("transaccion", "cuenta", "categoria"):
        for fila in datos["tablas"][tabla]:
            del fila["id_global"]
    del datos["tablas"]["libro"], datos["tablas"]["cambio_pendiente"], datos["tablas"]["detalle_cambio"]
    del datos["tablas"]["acuse_lote"]
    del datos["tablas"]["vinculo_sync"]
    for tabla in ("revision_sync", "revision_entidad", "lote_retenido"):
        del datos["tablas"][tabla]
    # La copia de 0009 solo incluye tablas que existían en esa revisión.
    for tabla in ("preferencia", "activo", "activo_valoracion", "activo_movimiento", "recibo_captura"):
        del datos["tablas"][tabla]
    for fila in datos["tablas"]["meta_objetivo"]:
        del fila["activo_id"]
    r = _subir(app, "datos/cargar", json.dumps(datos).encode())
    assert r.status_code == 200
    assert _saldos(app)


@pytest.mark.parametrize(
    "dano",
    [
        lambda d: d.update(formato="otro"),
        lambda d: d.update(revision="no-existe"),
        lambda d: d["tablas"].update(tabla_rara=[]),
        lambda d: d["tablas"]["cuenta"][0].update(columna_rara=1),
        lambda d: d["tablas"]["transaccion"][0].update(cuenta_id=999_999),
    ],
)
def test_un_archivo_invalido_no_toca_la_base(app: TestClient, dano: object) -> None:
    datos = app.get("/api/v1/datos/exportar/json").json()
    dano(datos)  # type: ignore[operator]
    antes = _saldos(app)
    n_respaldos = len(app.get("/api/v1/respaldos").json())
    r = _subir(app, "datos/cargar", json.dumps(datos).encode())
    assert r.status_code == 400
    assert _saldos(app) == antes
    assert len(app.get("/api/v1/respaldos").json()) == n_respaldos


def test_archivos_que_no_son_datos(app: TestClient) -> None:
    assert _subir(app, "datos/cargar", b"hola").status_code == 400
    assert _subir(app, "datos/cargar", b"SQLite format 3\x00roto").status_code == 400


def test_restaurar_respaldo_solo_por_nombre(app: TestClient) -> None:
    antes = _saldos(app)
    archivo = app.post("/api/v1/respaldos").json()["archivo"]
    app.post("/api/v1/transacciones", json={"cuenta_id": 1, "monto": -5_000_000})
    assert app.post("/api/v1/respaldos/..%2F..%2Fsecreto.db/restaurar").status_code in (400, 404)
    assert app.post("/api/v1/respaldos/otro.db/restaurar").status_code == 400
    assert app.post("/api/v1/respaldos/finanzas-20000101-000000.db/restaurar").status_code == 404
    assert app.post(f"/api/v1/respaldos/{archivo}/restaurar").status_code == 200
    assert _saldos(app) == antes


def test_borrar_todo_exige_confirmacion_y_deja_primer_uso(app: TestClient, tmp_path: Path) -> None:
    assert app.post("/api/v1/datos/borrar-todo", json={"confirmacion": "borrar"}).status_code == 400
    assert _saldos(app)
    r = app.post("/api/v1/datos/borrar-todo", json={"confirmacion": "BORRAR"})
    assert r.status_code == 200 and r.json()["respaldo"]
    estado = app.get("/api/v1/sistema").json()
    assert estado["primer_uso"] is True and estado["es_demo"] is False and estado["nombre"] == ""
    assert app.get("/api/v1/categorias").json()  # puede volver a empezar
    assert app.post("/api/v1/sistema/primer-uso", json={"modo": "vacio"}).status_code == 204
    assert listar(tmp_path / "r" / "db")  # el respaldo previo existe


def test_otro_sitio_no_puede_borrar(app: TestClient) -> None:
    r = app.post(
        "/api/v1/datos/borrar-todo", json={"confirmacion": "BORRAR"}, headers={"Origin": "https://malicioso.example"}
    )
    assert r.status_code == 403
    assert _saldos(app)


def test_excel_escapa_formulas(app: TestClient, tmp_path: Path) -> None:
    assert _texto_seguro("=1+1") == "'=1+1"
    assert _texto_seguro("@x") == "'@x" and _texto_seguro("+5") == "'+5" and _texto_seguro("-5") == "'-5"
    assert _texto_seguro("Mercado") == "Mercado" and _texto_seguro(5) == 5
    categoria = app.get("/api/v1/categorias").json()
    assert categoria
    cuerpo = {"cuenta_id": 1, "monto": -1_000_00, "descripcion": '=HYPERLINK("x")'}
    assert app.post("/api/v1/transacciones", json=cuerpo).status_code == 201
    salida = tmp_path / "x.xlsx"
    salida.write_bytes(app.get("/api/v1/exportar/excel").content)
    for hoja in load_workbook(salida).worksheets:
        for fila in hoja.iter_rows(values_only=True):
            assert not any(isinstance(v, str) and v.startswith("=") for v in fila)
