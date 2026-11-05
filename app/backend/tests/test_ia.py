"""Bloque E: proveedores intercambiables. Nunca se llama a una API real: el transporte HTTP es falso."""

import json
from pathlib import Path
from typing import Any

import httpx
import pytest
from fastapi.testclient import TestClient

from finanzas.cli import migrar
from finanzas.config import Config
from finanzas.main import crear_app


@pytest.fixture
def app(tmp_path: Path) -> TestClient:
    ruta = tmp_path / "base.db"
    migrar(f"sqlite:///{ruta.as_posix()}")
    config = Config(db_ruta=ruta, backups_dir=tmp_path / "r", tareas_diarias=False)
    cliente = TestClient(crear_app(config))
    assert cliente.post("/api/v1/sistema/primer-uso", json={"modo": "vacio"}).status_code == 204
    return cliente


def _responder(respuestas: list[dict[str, Any]], vistas: list[dict[str, Any]]) -> httpx.MockTransport:
    pendientes = list(respuestas)

    def manejar(peticion: httpx.Request) -> httpx.Response:
        vistas.append(
            {"url": str(peticion.url), "auth": peticion.headers.get("authorization"), **json.loads(peticion.content)}
        )
        return httpx.Response(200, json={"choices": [pendientes.pop(0)]})

    return httpx.MockTransport(manejar)


def _texto(contenido: str) -> dict[str, Any]:
    return {"message": {"role": "assistant", "content": contenido}, "finish_reason": "stop"}


def _llamada(nombre: str, **argumentos: object) -> dict[str, Any]:
    return {
        "message": {
            "role": "assistant",
            "content": None,
            "tool_calls": [
                {"id": "c1", "type": "function", "function": {"name": nombre, "arguments": json.dumps(argumentos)}}
            ],
        },
        "finish_reason": "tool_calls",
    }


def _activar(c: TestClient, proveedor: str = "gemini", clave: str = "clave-de-prueba") -> None:
    assert c.put("/api/v1/asistente/config", json={"proveedor": proveedor, "clave": clave}).status_code == 204
    assert c.put("/api/v1/asistente/consentimiento", json={"activo": True}).status_code == 204


def _preguntar(c: TestClient, **extra: object) -> dict[str, Any]:
    r = c.post("/api/v1/asistente/preguntar", json={"pregunta": "¿Cómo voy?"} | extra)
    assert r.status_code == 200, r.text
    return r.json()


def test_la_clave_nunca_se_devuelve_ni_viaja_en_las_copias(app: TestClient, tmp_path: Path) -> None:
    _activar(app, clave="SECRETO-123")
    r = app.get("/api/v1/asistente/estado")
    assert "SECRETO-123" not in r.text
    gemini = next(p for p in r.json()["proveedores"] if p["id"] == "gemini")
    assert gemini["tiene_clave"] is True and r.json()["credenciales"] is True
    assert "SECRETO-123" in (tmp_path / "claves_ia.json").read_text(encoding="utf-8")
    assert "SECRETO-123" not in app.get("/api/v1/datos/exportar/json").text
    assert b"SECRETO-123" not in app.get("/api/v1/datos/exportar/sqlite").content
    # Borrar todo también quita las claves.
    app.post("/api/v1/datos/borrar-todo", json={"confirmacion": "BORRAR"})
    assert not (tmp_path / "claves_ia.json").exists()


def test_cambiar_de_proveedor_pide_consentimiento_de_nuevo(app: TestClient) -> None:
    _activar(app)
    assert app.get("/api/v1/asistente/estado").json()["consentimiento"] is not None
    app.put("/api/v1/asistente/config", json={"proveedor": "groq"})
    estado = app.get("/api/v1/asistente/estado").json()
    assert estado["consentimiento"] is None and estado["proveedor"] == "groq"
    assert app.put("/api/v1/asistente/config", json={"proveedor": "inventado"}).status_code == 400


def test_un_consentimiento_anterior_no_se_traslada_a_otro_proveedor(app: TestClient) -> None:
    app.put("/api/v1/asistente/consentimiento", json={"activo": True})  # como antes de existir los proveedores
    assert app.get("/api/v1/asistente/estado").json()["proveedor"] == "anthropic"


def test_compatible_openai_usa_herramientas_y_memoria(app: TestClient) -> None:
    _activar(app, clave="k")
    vistas: list[dict[str, Any]] = []
    app.app.state.transporte_ia = _responder([_llamada("resumen_mensual"), _texto("Vas **bien**.")], vistas)  # type: ignore[attr-defined]
    historial = [{"rol": "yo", "texto": "Hola"}, {"rol": "asistente", "texto": "Hola, ¿qué revisamos?"}]
    r = _preguntar(app, historial=historial)
    assert r["respuesta"] == "Vas **bien**." and r["herramientas"] == ["resumen_mensual"]
    assert r["modelo"] == "gemini-3.1-flash-lite"
    primera = vistas[0]
    assert primera["url"].startswith("https://generativelanguage.googleapis.com/")
    assert primera["auth"] == "Bearer k"
    assert [m["role"] for m in primera["messages"]] == ["system", "user", "assistant", "user"]
    nombres = {t["function"]["name"] for t in primera["tools"]}
    assert {"resumen_mensual", "activos", "proponer_movimiento"} <= nombres
    assert vistas[1]["messages"][-1]["role"] == "tool"


def test_la_ia_solo_propone_y_no_guarda_nada(app: TestClient) -> None:
    _activar(app, clave="k")
    llamada = _llamada(
        "proponer_movimiento", tipo="gasto", monto_pesos=25000, descripcion="Almuerzo", categoria="comida"
    )
    app.app.state.transporte_ia = _responder([llamada, _texto("Te dejé el borrador.")], [])  # type: ignore[attr-defined]
    antes = app.get("/api/v1/transacciones").json()["items"]
    r = _preguntar(app)
    propuesta = r["propuestas"][0]
    assert propuesta["tipo"] == "movimiento" and propuesta["movimiento"] == "gasto"
    assert propuesta["monto"] == 2_500_000 and propuesta["categoria_id"]
    assert app.get("/api/v1/transacciones").json()["items"] == antes  # nada se escribió


def test_herramientas_no_ofrecen_borrar_ni_escribir(app: TestClient) -> None:
    _activar(app, clave="k")
    vistas: list[dict[str, Any]] = []
    app.app.state.transporte_ia = _responder([_texto("ok")], vistas)  # type: ignore[attr-defined]
    _preguntar(app)
    nombres = {t["function"]["name"] for t in vistas[0]["tools"]}
    assert not any(n.startswith(("borrar", "eliminar", "guardar", "crear", "registrar")) for n in nombres)


@pytest.mark.parametrize(
    ("estado", "mensaje"),
    [(401, "clave"), (404, "modelo"), (429, "cupo"), (500, "error")],
)
def test_errores_del_proveedor_se_explican(app: TestClient, estado: int, mensaje: str) -> None:
    _activar(app, clave="k")
    app.app.state.transporte_ia = httpx.MockTransport(lambda _: httpx.Response(estado, json={}))  # type: ignore[attr-defined]
    r = app.post("/api/v1/asistente/preguntar", json={"pregunta": "x"})
    assert r.status_code == 409 and mensaje in r.json()["detail"]
    assert "k" not in r.json()["detail"].split()  # la clave no aparece en el error


def test_ollama_no_exige_clave_y_avisa_si_no_esta(app: TestClient) -> None:
    assert app.put("/api/v1/asistente/config", json={"proveedor": "ollama"}).status_code == 204
    app.put("/api/v1/asistente/consentimiento", json={"activo": True})
    assert app.get("/api/v1/asistente/estado").json()["credenciales"] is True

    def falla(_: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("sin servicio")

    app.app.state.transporte_ia = httpx.MockTransport(falla)  # type: ignore[attr-defined]
    r = app.post("/api/v1/asistente/preguntar", json={"pregunta": "x"})
    assert r.status_code == 409 and "Ollama" in r.json()["detail"]


def test_sin_clave_no_sale_nada(app: TestClient, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("GROQ_API_KEY", raising=False)
    app.put("/api/v1/asistente/config", json={"proveedor": "groq"})
    app.put("/api/v1/asistente/consentimiento", json={"activo": True})
    vistas: list[dict[str, Any]] = []
    app.app.state.transporte_ia = _responder([_texto("no")], vistas)  # type: ignore[attr-defined]
    r = app.post("/api/v1/asistente/preguntar", json={"pregunta": "x"})
    assert r.status_code == 409 and vistas == []


def test_herramienta_activos_sin_nombres(app: TestClient) -> None:
    hoy = "2026-01-15"
    app.post(
        "/api/v1/activos", json={"nombre": "Lote de mi tía", "clase": "inmueble", "fecha_compra": hoy, "costo": 100_00}
    )
    _activar(app, clave="k")
    vistas: list[dict[str, Any]] = []
    app.app.state.transporte_ia = _responder([_llamada("activos"), _texto("ok")], vistas)  # type: ignore[attr-defined]
    _preguntar(app)
    resultado = next(m for m in vistas[1]["messages"] if m["role"] == "tool")["content"]
    assert "Inmueble" in resultado and "tía" not in resultado
    assert "tía" not in vistas[0]["messages"][0]["content"]
