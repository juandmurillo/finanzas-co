import sqlite3
from contextlib import closing
from pathlib import Path

import httpx
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from finanzas.cliente_sync import sincronizar
from finanzas.sincronizacion import crear_receptor, preparar_lote


def test_vinculacion_explicita_y_aislada(cliente: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    cliente.app.state.config.sync_receptor = "https://sync.example"  # type: ignore[union-attr]
    llamadas = []

    def responder(peticion: httpx.Request) -> httpx.Response:
        llamadas.append(peticion.url.path)
        if peticion.url.path == "/v1/sesion":
            return httpx.Response(200, json={"titular": peticion.headers["Authorization"].split()[-1]})
        return httpx.Response(200, json={"cursor": 1} if peticion.method == "POST" else [])

    original = httpx.Client
    monkeypatch.setattr(httpx, "Client", lambda **kw: original(transport=httpx.MockTransport(responder), **kw))
    ruta = "/api/v1/sync/ejecutar"
    headers = {"Authorization": "Bearer persona"}
    assert cliente.post(ruta, headers=headers).json() == {"estado": "sin_vincular"}
    assert llamadas == []
    assert cliente.post(ruta + "?vincular=true", headers=headers).json()["estado"] == "al_dia"
    llamadas.clear()
    assert cliente.post(ruta, headers={"Authorization": "Bearer otra"}).status_code == 403
    assert llamadas == ["/v1/sesion"]


def test_transferencia_de_la_cola_se_recibe_una_vez(cliente: TestClient, tmp_path: Path) -> None:
    cuentas = cliente.get("/api/v1/cuentas").json()
    copia = tmp_path / "segundo.db"
    with (
        closing(sqlite3.connect(cliente.app.state.config.db_ruta)) as origen,
        closing(sqlite3.connect(copia)) as destino,
    ):  # type: ignore[union-attr]
        origen.backup(destino)
    alta = cliente.post(
        "/api/v1/transferencias",
        json={
            "origen_id": cuentas[0]["id"],
            "destino_id": cuentas[1]["id"],
            "monto": 500,
        },
    )
    assert alta.status_code == 201
    with closing(sqlite3.connect(cliente.app.state.config.db_ruta)) as local:  # type: ignore[union-attr]
        libro, clave = local.execute("SELECT libro_id,lote FROM cambio_pendiente ORDER BY secuencia DESC").fetchone()
        cuerpo = preparar_lote(local, libro, clave).model_dump(mode="json")

    def identificar(token: str) -> str:
        if token in ("pc", "android"):
            return "titular"
        if token == "ajeno":
            return "otra-cuenta"
        raise HTTPException(401)

    ruta = tmp_path / "receptor.db"
    pc = TestClient(crear_receptor(ruta, identificar), headers={"Authorization": "Bearer pc"})
    acuse = pc.post("/v1/lotes", json=cuerpo)
    assert acuse.status_code == 200, acuse.text
    telefono = TestClient(crear_receptor(ruta, identificar), headers={"Authorization": "Bearer android"})
    assert telefono.post("/v1/lotes", json=cuerpo).json() == acuse.json()
    consulta = f"/v1/libros/{libro}/lotes"
    assert telefono.get(consulta).json() == [{"cursor": acuse.json()["cursor"], "contenido": cuerpo}]
    assert telefono.get(consulta, params={"desde": acuse.json()["cursor"]}).json() == []
    assert telefono.get(consulta, headers={"Authorization": "Bearer ajeno"}).json() == []
    assert telefono.get(consulta, headers={"Authorization": "Bearer invalido"}).status_code == 401
    assert telefono.post("/v1/lotes", json={**cuerpo, "lote": "f" * 32}).status_code == 409

    with (
        closing(sqlite3.connect(cliente.app.state.config.db_ruta)) as local,
        closing(sqlite3.connect(copia)) as segundo,
    ):  # type: ignore[union-attr]

        def perder_acuse(respuesta: httpx.Response) -> None:
            if respuesta.request.method == "POST":
                raise httpx.ReadError("Confirmación perdida")

        pc.event_hooks["response"].append(perder_acuse)
        with pytest.raises(httpx.ReadError):
            sincronizar(local, pc, libro)
        pc.event_hooks["response"].clear()
        sincronizar(local, pc, libro)
        assert segundo.execute("SELECT count(*) FROM transaccion WHERE transferencia_id IS NOT NULL").fetchone()[0] == 0
        sincronizar(segundo, telefono, libro)
        sincronizar(segundo, telefono, libro)
        consulta_sql = """SELECT a.id_global,a.monto,b.id_global FROM transaccion a
            JOIN transaccion b ON a.transferencia_id=b.id AND b.transferencia_id=a.id ORDER BY a.id_global"""
        pares = segundo.execute(consulta_sql).fetchall()
        assert len(pares) == 2 and pares == local.execute(consulta_sql).fetchall()
        salida = alta.json()[0]
        assert cliente.patch(f"/api/v1/transacciones/{salida['id']}", json={"monto": -700}).status_code == 200
        # Otro dispositivo cambió la nota del mismo movimiento antes de descargar la edición.
        with segundo:
            segundo.execute("UPDATE transaccion SET nota='local' WHERE monto=-500 AND transferencia_id IS NOT NULL")
        sincronizar(local, pc, libro)
        # El choque queda en «Por revisar» sin detener la sincronización ni aplicar media transferencia.
        assert sincronizar(segundo, telefono, libro) == 1
        assert segundo.execute(consulta_sql).fetchall() == pares
