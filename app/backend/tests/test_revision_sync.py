"""Bandeja «Por revisar»: dos equipos con la misma instantánea y un receptor compartido."""

import sqlite3
from collections.abc import Iterator
from contextlib import closing
from dataclasses import dataclass
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from finanzas.cliente_sync import sincronizar
from finanzas.config import Config
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.main import crear_app
from finanzas.sincronizacion import crear_receptor, preparar_lote


@dataclass
class Equipo:
    app: TestClient
    ruta: Path
    receptor: TestClient
    libro: str

    def sync(self) -> int:
        with closing(sqlite3.connect(self.ruta)) as db:
            return sincronizar(db, self.receptor, self.libro)

    def sql(self, consulta: str, *args: object) -> list[tuple]:
        with closing(sqlite3.connect(self.ruta)) as db:
            return db.execute(consulta, args).fetchall()

    def id_local(self, id_global: str) -> int:
        return self.sql("SELECT id FROM transaccion WHERE id_global=?", id_global)[0][0]

    def revision(self) -> list[dict]:
        r = self.app.get("/api/v1/sync/revision")
        assert r.status_code == 200, r.text
        return r.json()

    def resolver(self, rid: int, **cuerpo: object) -> int:
        return self.app.post(f"/api/v1/sync/revision/{rid}", json=cuerpo).status_code

    def saldos(self) -> list[tuple]:
        return sorted((c["nombre"], c["saldo"]) for c in self.app.get("/api/v1/cuentas").json())


@pytest.fixture
def equipos(cliente: TestClient, tmp_path: Path) -> Iterator[tuple[Equipo, Equipo]]:
    ruta_pc = cliente.app.state.config.db_ruta  # type: ignore[attr-defined]
    copia = tmp_path / "telefono.db"
    with closing(sqlite3.connect(ruta_pc)) as origen, closing(sqlite3.connect(copia)) as destino:
        origen.backup(destino)
        (libro,) = origen.execute("SELECT id_global FROM libro").fetchone()
    receptor = tmp_path / "receptor.db"
    config = Config(db_ruta=copia, backups_dir=tmp_path / "Backups2", tareas_diarias=False)
    with TestClient(crear_app(config, BaseDatos(f"sqlite:///{copia.as_posix()}"), BusEventos())) as telefono:
        pc = Equipo(cliente, ruta_pc, TestClient(crear_receptor(receptor, lambda _t: "titular")), libro)
        tel = Equipo(telefono, copia, TestClient(crear_receptor(receptor, lambda _t: "titular")), libro)
        for equipo in (pc, tel):
            equipo.receptor.headers["Authorization"] = "Bearer sesion"
        pc.sync()
        tel.sync()
        yield pc, tel


def _gasto(equipo: Equipo, descripcion: str, monto: int = -20_000) -> str:
    cuenta = equipo.app.get("/api/v1/cuentas").json()[0]["id"]
    r = equipo.app.post("/api/v1/transacciones", json={"cuenta_id": cuenta, "monto": monto, "descripcion": descripcion})
    assert r.status_code == 201, r.text
    return equipo.sql("SELECT id_global FROM transaccion WHERE id=?", r.json()["id"])[0][0]


def _estado(equipo: Equipo, id_global: str) -> list[tuple]:
    return equipo.sql("SELECT monto, nota, descripcion FROM transaccion WHERE id_global=?", id_global)


def test_ediciones_en_campos_distintos_se_fusionan(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    gasto = _gasto(pc, "Mercado")
    pc.sync()
    tel.sync()
    assert pc.app.patch(f"/api/v1/transacciones/{pc.id_local(gasto)}", json={"monto": -25_000}).status_code == 200
    assert tel.app.patch(f"/api/v1/transacciones/{tel.id_local(gasto)}", json={"nota": "domicilio"}).status_code == 200
    pc.sync()

    # El receptor no admite un cambio que parte de una versión ya superada.
    with closing(sqlite3.connect(tel.ruta)) as db:
        (clave,) = db.execute("SELECT lote FROM cambio_pendiente ORDER BY secuencia DESC LIMIT 1").fetchone()
        cuerpo = preparar_lote(db, tel.libro, clave).model_dump(mode="json")
    rechazo = tel.receptor.post("/v1/lotes", json=cuerpo)
    assert rechazo.status_code == 409 and rechazo.json()["detail"] == {"conflicto": [gasto]}

    assert tel.sync() == 1
    (revision,) = tel.revision()
    (entidad,) = revision["entidades"]
    campos = {c["campo"]: c for c in entidad["campos"]}
    assert entidad["titulo"] == "Mercado"
    assert campos.keys() == {"monto", "nota"}
    assert campos["monto"]["remoto"] == _estado(pc, gasto)[0][0] and not campos["monto"]["ambos"]
    assert campos["nota"]["local"] == "domicilio"
    # Mientras se revisa, el teléfono sigue con su versión y el resto del libro funciona.
    assert _estado(tel, gasto)[0][1] == "domicilio"
    assert tel.resolver(revision["id"], decision="campos") == 204
    assert tel.resolver(revision["id"], decision="campos") == 404

    assert tel.sync() == 0
    pc.sync()
    assert _estado(pc, gasto) == _estado(tel, gasto) == [(_estado(pc, gasto)[0][0], "domicilio", "Mercado")]
    assert pc.saldos() == tel.saldos()


def test_el_mismo_campo_pide_eleccion(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    gasto = _gasto(pc, "Taxi")
    pc.sync()
    tel.sync()
    pc.app.patch(f"/api/v1/transacciones/{pc.id_local(gasto)}", json={"monto": -30_000})
    tel.app.patch(f"/api/v1/transacciones/{tel.id_local(gasto)}", json={"monto": -35_000})
    pc.sync()
    assert tel.sync() == 1
    (revision,) = tel.revision()
    (entidad,) = revision["entidades"]
    assert [c["campo"] for c in entidad["campos"] if c["ambos"]] == ["monto"]
    assert tel.resolver(revision["id"], decision="campos") == 409
    elegido = {gasto: {"monto": "local"}}
    assert tel.resolver(revision["id"], decision="campos", campos=elegido) == 204
    tel.sync()
    pc.sync()
    assert _estado(pc, gasto) == _estado(tel, gasto)
    assert _estado(pc, gasto)[0][0] == tel.sql("SELECT monto FROM transaccion WHERE id_global=?", gasto)[0][0]
    assert pc.saldos() == tel.saldos()


def test_edicion_contra_borrado_conserva_la_edicion(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    gasto = _gasto(pc, "Farmacia")
    pc.sync()
    tel.sync()
    assert pc.app.delete(f"/api/v1/transacciones/{pc.id_local(gasto)}").status_code == 204
    tel.app.patch(f"/api/v1/transacciones/{tel.id_local(gasto)}", json={"nota": "reembolsable"})
    pc.sync()
    assert tel.sync() == 1
    (revision,) = tel.revision()
    (entidad,) = revision["entidades"]
    assert entidad["local_existe"] and not entidad["remoto_existe"]
    assert tel.resolver(revision["id"], decision="campos") == 409
    assert tel.resolver(revision["id"], decision="local") == 204
    tel.sync()
    pc.sync()
    assert [fila[1] for fila in _estado(pc, gasto)] == ["reembolsable"]
    assert pc.saldos() == tel.saldos()


def test_borrado_aceptado_desde_la_bandeja(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    gasto = _gasto(pc, "Parqueadero")
    pc.sync()
    tel.sync()
    pc.app.delete(f"/api/v1/transacciones/{pc.id_local(gasto)}")
    tel.app.patch(f"/api/v1/transacciones/{tel.id_local(gasto)}", json={"nota": "x"})
    pc.sync()
    tel.sync()
    (revision,) = tel.revision()
    assert tel.resolver(revision["id"], decision="remoto") == 204
    assert tel.sync() == 0
    pc.sync()
    assert _estado(pc, gasto) == _estado(tel, gasto) == []
    assert pc.saldos() == tel.saldos()


def test_misma_edicion_en_ambos_se_resuelve_sola(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    gasto = _gasto(pc, "Cine")
    pc.sync()
    tel.sync()
    pc.app.patch(f"/api/v1/transacciones/{pc.id_local(gasto)}", json={"nota": "con Ana"})
    tel.app.patch(f"/api/v1/transacciones/{tel.id_local(gasto)}", json={"nota": "con Ana"})
    pc.sync()
    assert tel.sync() == 0
    assert tel.revision() == []
    pc.sync()
    assert _estado(pc, gasto) == _estado(tel, gasto)


def test_transferencia_retenida_no_rompe_el_par(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    cuentas = pc.app.get("/api/v1/cuentas").json()
    alta = pc.app.post(
        "/api/v1/transferencias", json={"origen_id": cuentas[0]["id"], "destino_id": cuentas[1]["id"], "monto": 500}
    )
    salida = alta.json()[0]
    pc.sync()
    tel.sync()
    (global_salida,) = pc.sql("SELECT id_global FROM transaccion WHERE id=?", salida["id"])[0]
    pc.app.patch(f"/api/v1/transacciones/{salida['id']}", json={"monto": -700})
    tel.app.patch(f"/api/v1/transacciones/{tel.id_local(global_salida)}", json={"nota": "arriendo"})
    pc.sync()
    assert tel.sync() == 1
    pares = """SELECT a.monto, b.monto FROM transaccion a JOIN transaccion b
        ON a.transferencia_id=b.id AND b.transferencia_id=a.id WHERE a.id_global=?"""
    # La pata sin choque tampoco se aplica: el par sigue cuadrado mientras se revisa.
    assert tel.sql(pares, global_salida) == [(-500, 500)]
    (revision,) = tel.revision()
    assert tel.resolver(revision["id"], decision="campos") == 204
    tel.sync()
    pc.sync()
    assert tel.sql(pares, global_salida) == pc.sql(pares, global_salida) == [(-700, 700)]
    assert _estado(pc, global_salida) == _estado(tel, global_salida)
    assert pc.saldos() == tel.saldos()


def test_alta_parecida_en_otro_equipo_se_propone_como_duplicado(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    del_pc = _gasto(pc, "Almuerzo", -18_000)
    del_tel = _gasto(tel, "Almuerzo con Ana", -18_000)
    otro = _gasto(tel, "Almuerzo", -9_000)
    pc.sync()
    assert tel.sync() == 1
    (revision,) = tel.revision()
    assert revision["tipo"] == "duplicado"
    origenes = {m["id"]: m["origen"] for m in revision["movimientos"]}
    assert origenes == {del_pc: "otro_equipo", del_tel: "este_equipo"}
    assert otro not in origenes
    assert tel.resolver(revision["id"], decision="mismo", datos={"descripcion": "f" * 32}) == 409
    assert tel.resolver(revision["id"], decision="mismo", datos={"descripcion": del_tel}) == 204
    tel.sync()
    # El PC también lo vio como posible duplicado; al llegar la unión se cierra solo.
    assert pc.sync() == 0
    sobrevive = min(del_pc, del_tel)
    for equipo in (pc, tel):
        filas = equipo.sql("SELECT id_global, descripcion FROM transaccion WHERE monto=-18000")
        assert filas == [(sobrevive, "Almuerzo con Ana")]
        assert equipo.revision() == []
    assert pc.saldos() == tel.saldos()


def test_son_dos_gastos_no_vuelve_a_preguntar(equipos: tuple[Equipo, Equipo]) -> None:
    pc, tel = equipos
    _gasto(pc, "Café", -6_000)
    _gasto(tel, "Café", -6_000)
    pc.sync()
    tel.sync()
    (revision,) = tel.revision()
    assert tel.resolver(revision["id"], decision="dos") == 204
    tel.sync()
    assert tel.revision() == []
    assert len(tel.sql("SELECT 1 FROM transaccion WHERE monto=-6000")) == 2
