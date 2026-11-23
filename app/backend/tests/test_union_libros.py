"""Unir un equipo al libro de la cuenta: subir, descargar, reemplazar y combinar."""

import sqlite3
from collections.abc import Iterator
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from finanzas import union_libros
from finanzas.cli import migrar
from finanzas.cliente_sync import sincronizar
from finanzas.config import Config
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.main import crear_app
from finanzas.sincronizacion import crear_receptor

TITULAR = "titular"
RECEPTOR = "http://127.0.0.1:8090"


@dataclass
class Equipo:
    app: TestClient
    ruta: Path
    respaldos: Path
    remoto: TestClient

    def sql(self, consulta: str, *args: object) -> list[tuple]:
        with closing(sqlite3.connect(self.ruta)) as db:
            return db.execute(consulta, args).fetchall()

    def libro(self) -> str:
        return self.sql("SELECT id_global FROM libro")[0][0]

    def situacion(self) -> dict:
        return union_libros.situacion(self.ruta, self.remoto)

    def unir(self, decision: union_libros.Decision) -> dict:
        return union_libros.aplicar(self.ruta, self.respaldos, self.remoto, TITULAR, RECEPTOR, decision)

    def sync(self) -> int:
        with closing(sqlite3.connect(self.ruta)) as db:
            return sincronizar(db, self.remoto, self.libro())

    def gasto(self, descripcion: str, monto: int, cuenta: int | None = None) -> None:
        cuenta = cuenta or self.app.get("/api/v1/cuentas").json()[0]["id"]
        r = self.app.post(
            "/api/v1/transacciones", json={"cuenta_id": cuenta, "monto": monto, "descripcion": descripcion}
        )
        assert r.status_code == 201, r.text

    def movimientos(self) -> list[tuple]:
        return sorted(
            self.sql(
                "SELECT c.nombre, t.fecha, t.monto, t.descripcion FROM transaccion t JOIN cuenta c ON c.id=t.cuenta_id"
            )
        )

    def saldos(self) -> list[tuple]:
        return sorted((c["nombre"], c["saldo"]) for c in self.app.get("/api/v1/cuentas").json())


def _app(ruta: Path, carpeta: Path) -> TestClient:
    config = Config(db_ruta=ruta, backups_dir=carpeta, tareas_diarias=False)
    return TestClient(crear_app(config, BaseDatos(f"sqlite:///{ruta.as_posix()}"), BusEventos()))


@pytest.fixture
def receptor(tmp_path: Path) -> TestClient:
    return TestClient(
        crear_receptor(tmp_path / "receptor.db", lambda _t: TITULAR), headers={"Authorization": "Bearer s"}
    )


@pytest.fixture
def pc(cliente: TestClient, tmp_path: Path, receptor: TestClient) -> Equipo:
    """El primer equipo: el libro sembrado de las pruebas, con un movimiento propio."""
    ruta = cliente.app.state.config.db_ruta  # type: ignore[attr-defined]
    equipo = Equipo(cliente, ruta, tmp_path / "respaldos-pc", receptor)
    equipo.gasto("Mercado", -2_000_000)
    return equipo


@pytest.fixture
def otro(tmp_path: Path, receptor: TestClient) -> Iterator[Equipo]:
    """Un equipo recién instalado: libro propio y vacío."""
    ruta = tmp_path / "otro.db"
    migrar(f"sqlite:///{ruta.as_posix()}")
    with _app(ruta, tmp_path / "respaldos-otro") as app:
        yield Equipo(app, ruta, tmp_path / "respaldos-otro" / "db", receptor)


def _con_historia(otro: Equipo, pc: Equipo) -> None:
    """El otro equipo tiene su propia historia: una cuenta y movimientos que el PC no tiene."""
    r = otro.app.post(
        "/api/v1/cuentas", json={"nombre": "Billetera del otro", "tipo": "billetera", "saldo_inicial": 50_000_000}
    )
    assert r.status_code == 201, r.text
    otro.gasto("Taxi", -1_200_000, r.json()["id"])


def test_el_primer_equipo_crea_el_libro_y_el_segundo_lo_descarga(pc: Equipo, otro: Equipo) -> None:
    assert pc.situacion()["caso"] == "nuevo"
    pc.unir("subir")
    assert pc.situacion()["caso"] == "mismo"
    estado = otro.situacion()
    assert estado["caso"] == "descargar" and estado["decisiones"] == ["cuenta"]
    assert estado["cuenta"]["movimientos"] == len(pc.movimientos())

    resultado = otro.unir("cuenta")
    assert (otro.respaldos / resultado["respaldo"]).is_file()
    assert otro.libro() == pc.libro()
    assert otro.movimientos() == pc.movimientos() and otro.saldos() == pc.saldos()

    # Desde ahí sincronizan como cualquier par de equipos.
    pc.gasto("Farmacia", -300_000)
    pc.sync()
    otro.sync()
    assert otro.movimientos() == pc.movimientos()
    otro.gasto("Panadería", -80_000)
    otro.sync()
    pc.sync()
    assert otro.movimientos() == pc.movimientos() and otro.saldos() == pc.saldos()


def test_usar_el_de_la_cuenta_deja_el_propio_como_respaldo(pc: Equipo, otro: Equipo) -> None:
    pc.unir("subir")
    _con_historia(otro, pc)
    propios = otro.movimientos()
    assert otro.situacion()["caso"] == "elegir"
    with pytest.raises(union_libros.DecisionNoValida):
        otro.unir("subir")

    resultado = otro.unir("cuenta")
    assert otro.movimientos() == pc.movimientos()
    with closing(sqlite3.connect(otro.respaldos / resultado["respaldo"])) as anterior:
        assert ("Taxi",) in anterior.execute("SELECT descripcion FROM transaccion").fetchall()
    assert "Taxi" not in [m[3] for m in otro.movimientos()]
    assert "Taxi" in [m[3] for m in propios]


def test_usar_el_de_este_equipo_lo_vuelve_principal(pc: Equipo, otro: Equipo) -> None:
    pc.unir("subir")
    _con_historia(otro, pc)
    libro_pc = pc.libro()
    resultado = otro.unir("equipo")

    # La versión de la cuenta que se reemplazó queda como respaldo en este equipo.
    with closing(sqlite3.connect(otro.respaldos / resultado["respaldo"])) as anterior:
        assert anterior.execute("SELECT id_global FROM libro").fetchone() == (libro_pc,)
    assert otro.situacion()["caso"] == "mismo"

    # El PC ya no puede enviar a su libro: debe elegir cómo unirse al nuevo principal.
    pc.gasto("Después del cambio", -10_000)
    with closing(sqlite3.connect(pc.ruta)) as db:
        pendiente = db.execute("SELECT lote FROM cambio_pendiente ORDER BY secuencia DESC").fetchone()[0]
        from finanzas.sincronizacion import preparar_lote

        cuerpo = preparar_lote(db, libro_pc, pendiente).model_dump(mode="json")
    rechazo = pc.remoto.post("/v1/lotes", json=cuerpo)
    assert rechazo.status_code == 409 and rechazo.json()["detail"] == {"libro_reemplazado": otro.libro()}
    assert pc.situacion()["caso"] == "elegir"
    pc.unir("cuenta")
    assert pc.movimientos() == otro.movimientos()


def test_combinar_suma_lo_que_falta_sin_duplicar(pc: Equipo, otro: Equipo) -> None:
    cuentas = pc.app.get("/api/v1/cuentas").json()
    alta = pc.app.post(
        "/api/v1/transferencias", json={"origen_id": cuentas[0]["id"], "destino_id": cuentas[1]["id"], "monto": 500}
    )
    assert alta.status_code == 201
    pc.unir("subir")

    # El otro equipo partió de la misma información (comparten «Mercado») y luego registró lo suyo.
    with closing(sqlite3.connect(otro.ruta)) as db, closing(sqlite3.connect(pc.ruta)) as fuente:
        (libro_otro,) = db.execute("SELECT id_global FROM libro").fetchone()
        fuente.backup(db)
        with db:
            db.execute("UPDATE libro SET id_global=?", (libro_otro,))
            for tabla in ("detalle_cambio", "cambio_pendiente", "acuse_lote", "vinculo_sync"):
                db.execute(f"DELETE FROM {tabla}")
    _con_historia(otro, pc)
    otra = otro.app.post(
        "/api/v1/transferencias", json={"origen_id": cuentas[1]["id"], "destino_id": cuentas[0]["id"], "monto": 900}
    )
    assert otra.status_code == 201
    pc.gasto("Solo en el PC", -70_000)
    pc.sync()

    resultado = otro.unir("combinar")
    combinado = resultado["combinado"]
    assert combinado["cuentas"] == 1 and combinado["movimientos"] == 3 and combinado["repetidos"] >= 3
    assert otro.libro() == pc.libro()
    pares = """SELECT count(*) FROM transaccion a JOIN transaccion b
        ON a.transferencia_id=b.id AND b.transferencia_id=a.id"""
    assert otro.sql(pares) == [(4,)]

    # Lo combinado viaja al PC, que queda igual al peso.
    pc.sync()
    assert pc.movimientos() == otro.movimientos()
    assert pc.saldos() == otro.saldos()
    assert pc.sql(pares) == [(4,)]
    descripciones = [m[3] for m in pc.movimientos()]
    assert descripciones.count("Mercado") == 1 and "Taxi" in descripciones and "Solo en el PC" in descripciones


def test_libro_del_piloto_sin_instantanea_no_ofrece_opciones(pc: Equipo, otro: Equipo) -> None:
    """Un equipo vinculado antes de la instantánea solo subió lotes: hasta que suba su foto, no hay qué descargar."""
    with closing(sqlite3.connect(pc.ruta)) as db:
        with db:
            db.execute("INSERT INTO vinculo_sync VALUES (?,?,?)", (pc.libro(), TITULAR, RECEPTOR))
        sincronizar(db, pc.remoto, pc.libro())
    _con_historia(otro, pc)
    estado = otro.situacion()
    assert estado["caso"] == "sin_instantanea" and estado["decisiones"] == []
    with pytest.raises(union_libros.DecisionNoValida):
        otro.unir("cuenta")


def test_cambiar_de_receptor_vuelve_a_unir_desde_cero(pc: Equipo, otro: Equipo, tmp_path: Path) -> None:
    """Al pasar a otro receptor (p. ej. Supabase) los cursores viejos no sirven: se reinician."""
    pc.unir("subir")
    pc.gasto("Antes del cambio", -40_000)
    pc.sync()
    nuevo = TestClient(crear_receptor(tmp_path / "nuevo.db", lambda _t: TITULAR), headers={"Authorization": "Bearer s"})
    pc.remoto = otro.remoto = nuevo
    assert pc.situacion()["caso"] == "nuevo"
    union_libros.aplicar(pc.ruta, pc.respaldos, nuevo, TITULAR, "supabase+https://nuevo.supabase.co", "subir")
    assert pc.sql("SELECT max(cursor) FROM acuse_lote WHERE aplicado=1") == [(0,)]
    assert otro.situacion()["caso"] == "descargar"
    otro.unir("cuenta")
    assert otro.movimientos() == pc.movimientos()
    pc.gasto("Después del cambio", -15_000)
    pc.sync()
    otro.sync()
    assert otro.movimientos() == pc.movimientos() and otro.saldos() == pc.saldos()


def test_receptor_rechaza_instantanea_ajena_sin_principal(receptor: TestClient) -> None:
    libro_a, libro_b = "a" * 32, "b" * 32
    assert receptor.put(f"/v1/libros/{libro_a}/instantanea", params={"cursor": 0}, content=b"x").status_code == 204
    assert receptor.get("/v1/cuenta").json()["libro"] == libro_a
    assert receptor.put(f"/v1/libros/{libro_b}/instantanea", params={"cursor": 0}, content=b"y").status_code == 409
    assert receptor.put(f"/v1/libros/{libro_a}/instantanea", params={"cursor": 5}, content=b"x").status_code == 422
    respuesta = receptor.put(
        f"/v1/libros/{libro_b}/instantanea", params={"cursor": 0, "principal": "true"}, content=b"y"
    )
    assert respuesta.status_code == 204
    assert receptor.get("/v1/cuenta").json()["libro"] == libro_b
    # La versión anterior sigue disponible.
    assert receptor.get(f"/v1/libros/{libro_a}/instantanea").content == b"x"
