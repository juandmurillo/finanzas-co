"""Arranque portátil (fase 10, Android): secreto por arranque, frontend del mismo origen y punto de entrada."""

from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from collections.abc import Iterator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from finanzas.config import Config
from finanzas.infra import migraciones
from finanzas.infra.db import BaseDatos
from finanzas.main import crear_app
from finanzas.portatil import elegir_puerto, iniciar

SECRETO = "s3creto-de-prueba"  # gitleaks:allow (valor ficticio de prueba)


@pytest.fixture
def web(tmp_path: Path) -> Path:
    carpeta = tmp_path / "web"
    (carpeta / "assets").mkdir(parents=True)
    (carpeta / "index.html").write_text("<!doctype html><title>Caudal</title>", encoding="utf-8")
    (carpeta / "assets" / "app-abc123.js").write_text("console.log(1)", encoding="utf-8")
    (tmp_path / "fuera.txt").write_text("no", encoding="utf-8")
    return carpeta


@pytest.fixture
def protegido(db: BaseDatos, tmp_path: Path, web: Path) -> Iterator[TestClient]:
    config = Config(db_ruta=tmp_path / "prueba.db", tareas_diarias=False, secreto=SECRETO, web_dir=web)
    with TestClient(crear_app(config, db), base_url="http://127.0.0.1") as c:
        yield c


def test_sin_secreto_se_rechaza_todo(protegido: TestClient) -> None:
    for ruta in ("/api/v1/salud", "/api/v1/cuentas", "/", "/assets/app-abc123.js"):
        r = protegido.get(ruta)
        assert r.status_code == 401, ruta
    assert protegido.get("/api/v1/salud", headers={"X-Caudal-Secreto": "otro"}).status_code == 401
    assert protegido.get("/api/v1/salud", headers={"Cookie": "caudal_sesion=otro"}).status_code == 401


def test_la_cabecera_con_el_secreto_abre_la_api(protegido: TestClient) -> None:
    r = protegido.get("/api/v1/salud", headers={"X-Caudal-Secreto": SECRETO})
    assert r.status_code == 200 and r.json() == {"estado": "ok"}


def test_entrar_deja_la_cookie_y_lleva_al_inicio(protegido: TestClient) -> None:
    assert protegido.get("/entrar?secreto=malo", follow_redirects=False).status_code == 401
    r = protegido.get(f"/entrar?secreto={SECRETO}", follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"] == "/"
    galleta = r.headers["set-cookie"]
    assert "HttpOnly" in galleta and "SameSite=Strict" in galleta
    # El cliente guarda la cookie: desde aquí todo funciona sin cabecera, como en el WebView.
    assert protegido.get("/api/v1/cuentas").status_code == 200
    assert "Caudal" in protegido.get("/").text


def test_el_frontend_sale_del_mismo_origen(protegido: TestClient) -> None:
    h = {"X-Caudal-Secreto": SECRETO}
    recurso = protegido.get("/assets/app-abc123.js", headers=h)
    assert recurso.status_code == 200 and "immutable" in recurso.headers["cache-control"]
    # Las rutas del cliente devuelven index.html; lo de la API que no existe sigue siendo un 404 en JSON.
    assert "Caudal" in protegido.get("/deudas/3", headers=h).text
    api = protegido.get("/api/v1/no-existe", headers=h)
    assert api.status_code == 404 and api.headers["content-type"].startswith("application/problem+json")
    # Nada fuera de la carpeta del frontend.
    assert "Caudal" in protegido.get("/../fuera.txt", headers=h).text
    assert "Caudal" in protegido.get("/%2e%2e/fuera.txt", headers=h).text


def test_sin_secreto_configurado_la_api_de_escritorio_no_cambia(cliente: TestClient) -> None:
    assert cliente.get("/api/v1/salud").status_code == 200
    assert cliente.get("/").status_code == 404  # sin web_dir no sirve el frontend


def test_la_cabeza_rapida_coincide_con_alembic() -> None:
    assert migraciones.cabeza_rapida() == migraciones.cabeza()


def test_elegir_puerto_usa_el_preferido_o_uno_libre() -> None:
    libre = elegir_puerto()
    assert elegir_puerto(libre) == libre
    with socket.socket() as ocupado:
        ocupado.bind(("127.0.0.1", 0))
        ocupado.listen()
        puerto = ocupado.getsockname()[1]
        assert elegir_puerto(puerto) != puerto


def _pedir(url: str, secreto: str | None = None) -> tuple[int, bytes]:
    peticion = urllib.request.Request(url, headers={"X-Caudal-Secreto": secreto} if secreto else {})
    try:
        with urllib.request.urlopen(peticion, timeout=10) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def test_iniciar_migra_una_vez_y_sirve(tmp_path: Path, web: Path) -> None:
    primero = iniciar(tmp_path / "datos", web_dir=web)
    try:
        assert primero.migro
        assert set(primero.tiempos) == {"importar", "migrar", "preparar", "servir"}
        assert _pedir(f"{primero.base}/api/v1/salud")[0] == 401
        estado, cuerpo = _pedir(f"{primero.base}/api/v1/categorias", primero.secreto)
        assert estado == 200 and json.loads(cuerpo)  # la base nueva ya trae categorías
        assert b"Caudal" in _pedir(f"{primero.base}/", primero.secreto)[1]
        assert primero.secreto not in repr(primero)
    finally:
        primero.detener()
    segundo = iniciar(tmp_path / "datos", puerto=primero.puerto)
    try:
        assert not segundo.migro  # la base ya está al día: no se carga Alembic
        assert segundo.secreto != primero.secreto
        assert _pedir(f"{segundo.base}/api/v1/salud", primero.secreto)[0] == 401
    finally:
        segundo.detener()
