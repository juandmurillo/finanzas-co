"""Sesión persistente de la cuenta de Caudal y estado local del libro."""

import sqlite3
import sys
from contextlib import closing
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from finanzas.infra.sesion_segura import SesionSegura

CLAVE = "sb-proyecto-auth-token"
SESION = '{"access_token":"token-de-acceso","refresh_token":"token-de-renovacion"}'


def test_la_sesion_sobrevive_al_reinicio_y_no_queda_en_claro(cliente: TestClient) -> None:
    ruta = f"/api/v1/sync/sesion/{CLAVE}"
    assert cliente.get(ruta).json() == {"valor": None}
    assert cliente.put(ruta, json={"valor": SESION}).status_code == 204
    respuesta = cliente.get(ruta)
    assert respuesta.json() == {"valor": SESION}
    assert respuesta.headers["cache-control"] == "no-store"

    archivo = cliente.app.state.config.db_ruta.with_suffix(".sesion")  # type: ignore[attr-defined]
    # Otra instancia (la app reiniciada) lee la misma sesión.
    assert SesionSegura(archivo).obtener(CLAVE) == SESION
    if sys.platform == "win32":
        assert b"token-de-renovacion" not in archivo.read_bytes()

    assert cliente.delete(ruta).status_code == 204
    assert cliente.get(ruta).json() == {"valor": None}
    assert not archivo.exists()


def test_claves_ajenas_y_acceso_remoto_rechazados(cliente: TestClient) -> None:
    assert cliente.put("/api/v1/sync/sesion/..%2Fotra", json={"valor": "x"}).status_code in (404, 422)
    assert cliente.put("/api/v1/sync/sesion/Mayusculas", json={"valor": "x"}).status_code == 422
    cliente.app.state.config.host = "0.0.0.0"  # type: ignore[attr-defined]
    assert cliente.get(f"/api/v1/sync/sesion/{CLAVE}").status_code == 403


def test_archivo_ilegible_obliga_a_volver_a_entrar(tmp_path: Path) -> None:
    archivo = tmp_path / "libro.sesion"
    archivo.write_bytes(b"DPAPI1\nno es de este usuario")
    assert SesionSegura(archivo).obtener(CLAVE) is None
    SesionSegura(archivo).guardar(CLAVE, SESION)
    assert SesionSegura(archivo).obtener(CLAVE) == SESION


def test_en_android_usa_keystore(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    llave = {"vigente": 0x5A}

    class CifradoSesion:
        """Imita la clase Java: XOR con una «llave» que cambia si la app se reinstala."""

        @staticmethod
        def cifrar(datos: bytes) -> list[int]:
            return [b ^ llave["vigente"] for b in datos]

        @staticmethod
        def descifrar(datos: bytes) -> list[int]:
            plano = bytes(b ^ llave["vigente"] for b in datos)
            if not plano.startswith(b"{"):
                raise RuntimeError("javax.crypto.AEADBadTagException")
            return list(plano)

    monkeypatch.setitem(sys.modules, "java", SimpleNamespace(jclass=lambda nombre: CifradoSesion))
    monkeypatch.setattr(sys, "platform", "linux")
    archivo = tmp_path / "libro.sesion"
    sesion = SesionSegura(archivo)
    assert sesion.proteccion == "keystore"
    sesion.guardar(CLAVE, SESION)
    crudo = archivo.read_bytes()
    assert crudo.startswith(b"AKS1\n") and b"token-de-renovacion" not in crudo
    assert SesionSegura(archivo).obtener(CLAVE) == SESION
    llave["vigente"] = 0x33  # app reinstalada: Keystore entrega otra llave
    assert SesionSegura(archivo).obtener(CLAVE) is None


@pytest.mark.parametrize("vinculado", [False, True])
def test_estado_cuenta_lo_que_solo_esta_en_este_equipo(cliente: TestClient, vinculado: bool) -> None:
    cuenta = cliente.get("/api/v1/cuentas").json()[0]["id"]
    db_ruta = cliente.app.state.config.db_ruta  # type: ignore[attr-defined]
    with closing(sqlite3.connect(db_ruta)) as db, db:
        (libro,) = db.execute("SELECT id_global FROM libro").fetchone()
        # Todo lo anterior ya está en el receptor; solo cuentan las capturas siguientes.
        db.execute(
            "INSERT INTO acuse_lote SELECT DISTINCT libro_id, lote, 1, 1 FROM cambio_pendiente WHERE lote IS NOT NULL"
        )
        if vinculado:
            db.execute("INSERT INTO vinculo_sync VALUES (?, 'titular', 'https://sync.example')", (libro,))
    for monto in (-1_000, -2_000):
        assert cliente.post("/api/v1/transacciones", json={"cuenta_id": cuenta, "monto": monto}).status_code == 201
    estado = cliente.get("/api/v1/sync/estado").json()
    assert estado == {
        "vinculado": vinculado,
        "titular": "titular" if vinculado else None,
        "pendientes": 2 if vinculado else 0,
        "por_revisar": 0,
    }
