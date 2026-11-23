"""El adaptador hacia Supabase: mismas rutas que el receptor local, traducidas a funciones RPC.

Un PostgREST falso responde las funciones de `supabase/receptor.sql` apoyándose en el receptor local,
así los flujos completos (unir, sincronizar, choques) pasan por la traducción de ida y vuelta.
"""

import base64
import json
import sqlite3
from contextlib import closing
from pathlib import Path

import httpx
import pytest
from fastapi.testclient import TestClient

from finanzas import union_libros
from finanzas.cli import migrar
from finanzas.cliente_sync import sincronizar
from finanzas.receptor_supabase import TransporteSupabase, cliente_receptor, receptor_valido
from finanzas.sincronizacion import crear_receptor

ORIGEN = "https://proyecto.supabase.co"
APIKEY = "sb_publishable_prueba"


def _postgrest(receptor: TestClient, llamadas: list[str]) -> httpx.MockTransport:
    def responder(peticion: httpx.Request) -> httpx.Response:
        assert peticion.headers["apikey"] == APIKEY
        funcion = peticion.url.path.rsplit("/", 1)[-1]
        llamadas.append(funcion)
        args = json.loads(peticion.content or b"{}")
        auth = {"Authorization": peticion.headers["authorization"]}
        if funcion == "caudal_sesion":
            r = receptor.get("/v1/sesion", headers=auth)
        elif funcion == "caudal_cuenta":
            r = receptor.get("/v1/cuenta", headers=auth)
        elif funcion == "caudal_recibir_lote":
            r = receptor.post("/v1/lotes", json=args["p_lote"], headers=auth)
        elif funcion == "caudal_lotes":
            r = receptor.get(f"/v1/libros/{args['p_libro']}/lotes", params={"desde": args["p_desde"]}, headers=auth)
        elif funcion == "caudal_guardar_instantanea":
            r = receptor.put(
                f"/v1/libros/{args['p_libro']}/instantanea",
                params={"cursor": args["p_cursor"], "principal": str(args["p_principal"]).lower()},
                content=base64.b64decode(args["p_contenido"]),
                headers={**auth, "X-Caudal-Resumen": json.dumps(args["p_resumen"])},
            )
            if r.status_code == 204:
                return httpx.Response(200, json={"guardada": True})
        elif funcion == "caudal_leer_instantanea":
            r = receptor.get(f"/v1/libros/{args['p_libro']}/instantanea", headers=auth)
            if r.status_code == 404:
                return httpx.Response(200, content=b"null")  # PostgREST responde null, no un cuerpo vacío
            contenido = base64.b64encode(r.content).decode()
            return httpx.Response(200, json={"cursor": int(r.headers["x-caudal-cursor"]), "contenido": contenido})
        else:
            return httpx.Response(404, json={"message": "función desconocida"})
        if r.is_success:
            return httpx.Response(200, json=r.json())
        # Como PostgREST con SQLSTATE PTxyz: el detalle va en «message».
        detalle = r.json()["detail"]
        mensaje = json.dumps(detalle) if isinstance(detalle, dict) else detalle
        return httpx.Response(r.status_code, json={"code": f"PT{r.status_code}", "message": mensaje})

    return httpx.MockTransport(responder)


@pytest.fixture
def llamadas() -> list[str]:
    return []


@pytest.fixture
def remoto(tmp_path: Path, llamadas: list[str]) -> httpx.Client:
    receptor = TestClient(crear_receptor(tmp_path / "receptor.db", lambda _t: "titular"))
    transporte = TransporteSupabase(ORIGEN, APIKEY, transporte=_postgrest(receptor, llamadas))
    return httpx.Client(
        base_url="https://receptor.caudal", headers={"Authorization": "Bearer jwt"}, transport=transporte
    )


def test_validacion_de_receptores() -> None:
    assert receptor_valido("supabase+https://proyecto.supabase.co")
    assert not receptor_valido("supabase+http://proyecto.supabase.co")
    assert receptor_valido("http://127.0.0.1:8090") and not receptor_valido("http://10.0.2.2:8090")
    with pytest.raises(ValueError, match="clave publicable"):
        cliente_receptor("supabase+https://proyecto.supabase.co", "jwt")


def test_unir_y_sincronizar_a_traves_de_supabase(
    cliente: TestClient, tmp_path: Path, remoto: httpx.Client, llamadas: list[str]
) -> None:
    pc = cliente.app.state.config.db_ruta  # type: ignore[attr-defined]
    cuenta = cliente.get("/api/v1/cuentas").json()[0]["id"]
    assert cliente.post(
        "/api/v1/transacciones", json={"cuenta_id": cuenta, "monto": -900, "descripcion": "Pan"}
    ).is_success
    assert union_libros.situacion(pc, remoto)["caso"] == "nuevo"
    union_libros.aplicar(pc, tmp_path / "r-pc", remoto, "titular", "supabase+" + ORIGEN, "subir")

    otro = tmp_path / "otro.db"
    migrar(f"sqlite:///{otro.as_posix()}")
    assert union_libros.situacion(otro, remoto)["caso"] == "descargar"
    union_libros.aplicar(otro, tmp_path / "r-otro", remoto, "titular", "supabase+" + ORIGEN, "cuenta")
    consulta = "SELECT descripcion, monto FROM transaccion ORDER BY id_global"
    with closing(sqlite3.connect(pc)) as a, closing(sqlite3.connect(otro)) as b:
        assert a.execute(consulta).fetchall() == b.execute(consulta).fetchall()
        (libro,) = a.execute("SELECT id_global FROM libro").fetchone()

    # Un cambio del PC llega al otro equipo por las funciones de Supabase.
    assert cliente.post(
        "/api/v1/transacciones", json={"cuenta_id": cuenta, "monto": -300, "descripcion": "Café"}
    ).is_success
    with closing(sqlite3.connect(pc)) as a, closing(sqlite3.connect(otro)) as b:
        sincronizar(a, remoto, libro)
        sincronizar(b, remoto, libro)
        assert a.execute(consulta).fetchall() == b.execute(consulta).fetchall()
    assert {"caudal_recibir_lote", "caudal_lotes", "caudal_guardar_instantanea", "caudal_leer_instantanea"} <= set(
        llamadas
    )


def test_errores_de_postgrest_llegan_como_los_del_receptor(remoto: httpx.Client) -> None:
    lote = {
        "libro": "a" * 32,
        "lote": "b" * 32,
        "cambios": [
            {"operacion": "c" * 32, "entidad": "cuenta", "entidad_id": "d" * 32, "accion": "crear",
             "version_base": None, "campos": {"nombre": [None, "Caja"]}}
        ],
    }  # fmt: skip
    assert remoto.post("/v1/lotes", json=lote).json() == {"cursor": 1}
    # Recrear la misma entidad es un choque: PT409 con detalle JSON.
    otro = {**lote, "lote": "e" * 32, "cambios": [{**lote["cambios"][0], "operacion": "f" * 32}]}
    rechazo = remoto.post("/v1/lotes", json=otro)
    assert rechazo.status_code == 409 and rechazo.json() == {"detail": {"conflicto": ["d" * 32]}}
    # Sin instantánea: 404 como el receptor local.
    assert remoto.get(f"/v1/libros/{'a' * 32}/instantanea").status_code == 404
    assert remoto.get("/v1/desconocida").status_code == 404
