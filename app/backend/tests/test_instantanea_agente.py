"""Instantánea del agente analista-finanzas: solo lectura, sin datos sensibles y con traspaso entre revisiones."""

from __future__ import annotations

import json
from pathlib import Path

import pytest
from sqlalchemy import text

from finanzas.dominio.grupos import Grupo
from finanzas.infra import consultas
from finanzas.infra import herramientas_asistente as h
from finanzas.infra import instantanea_agente as ia
from finanzas.infra.db import BaseDatos
from finanzas.infra.repositorios import categoria_por_ruta


def _gasto(db: BaseDatos, descripcion: str, monto: int, marca: str, con_categoria: bool = True) -> None:
    with db.fabrica() as s:
        cuenta = consultas.en_total(consultas.saldos_cuentas(s))[0]["id"]
        categoria = categoria_por_ruta(s, Grupo.GASTO_VIDA, "Comida", None).id if con_categoria else None
        s.execute(
            text(
                "INSERT INTO transaccion (cuenta_id, fecha, monto, categoria_id, descripcion, nota, estado, "
                "origen_categoria, creado_en, actualizado_en) "
                "VALUES (:c, :m, :v, :k, :d, '', 'confirmada', 'usuario', :m, :m)"
            ),
            {"c": cuenta, "m": marca, "v": monto, "k": categoria, "d": descripcion},
        )
        s.commit()


def test_primera_revision_no_tiene_base(db_sembrada: BaseDatos, tmp_path: Path) -> None:
    with db_sembrada.fabrica() as s:
        ruta = ia.abrir(s, tmp_path / "agente")
    foto = json.loads(ruta.read_text(encoding="utf-8"))
    assert foto["novedades"] == {"primera_revision": True}
    assert {"caja", "deudas", "calendario", "presupuesto", "metas", "renta"} <= foto.keys()


def test_abrir_no_mueve_la_base_hasta_cerrar(db_sembrada: BaseDatos, tmp_path: Path) -> None:
    carpeta = tmp_path / "agente"
    with db_sembrada.fabrica() as s:
        ia.abrir(s, carpeta)
    assert not (carpeta / ia.BASE).exists()
    assert ia.cerrar(carpeta) == carpeta / ia.BASE
    assert ia.cerrar(carpeta) is None


def test_novedades_traen_lo_registrado_tras_abrir_la_revision(db_sembrada: BaseDatos, tmp_path: Path) -> None:
    carpeta = tmp_path / "agente"
    with db_sembrada.fabrica() as s:
        base = ia.generar(s)
    base["generada"] = "2026-01-01T00:00:00-05:00"
    carpeta.mkdir()
    (carpeta / ia.BASE).write_text(json.dumps(base), encoding="utf-8")

    _gasto(db_sembrada, "Mercado de prueba", -5_000_000, "2026-01-02T10:00:00-05:00")
    _gasto(db_sembrada, "Anterior al corte", -1_000_000, "2025-12-31T10:00:00-05:00")

    with db_sembrada.fabrica() as s:
        foto = json.loads(ia.abrir(s, carpeta).read_text(encoding="utf-8"))
    n = foto["novedades"]
    assert n["movimientos"]["cantidad"] == 1
    assert n["movimientos"]["salidas"] == -50_000
    assert n["movimientos"]["muestra"][0]["descripcion"] == "Mercado de prueba"
    assert n["saldo_liquido"]["diferencia"] == -60_000


def test_novedades_incluyen_movimientos_sin_categoria(db_sembrada: BaseDatos, tmp_path: Path) -> None:
    _gasto(db_sembrada, "Sin clasificar", -100_000, "2026-01-02T10:00:00-05:00", con_categoria=False)
    with db_sembrada.fabrica() as s:
        movimientos = ia._movimientos_tocados(s, "2026-01-01T00:00:00-05:00")
    assert movimientos["muestra"][0]["categoria"] == "Sin categoría"


def test_cuota_de_prestamo_personal_va_en_pesos(db_sembrada: BaseDatos, monkeypatch: pytest.MonkeyPatch) -> None:
    prestamo = {
        "direccion": "presto_yo",
        "origen": "amigo",
        "monto": 1_000_000,
        "pendiente": 1_000_000,
        "tasa_ea": 0.0,
        "proxima_cuota": {"numero": 1, "fecha": "2026-12-01", "monto": 1_000_000},
        "dias_vencido": 0,
    }
    monkeypatch.setattr(h.consultas_prestamos, "listar", lambda _s, _e: [prestamo])
    with db_sembrada.fabrica() as s:
        fila = h.prestamos_personales(s)["prestamos"][0]
    assert fila["pendiente"] == 10_000
    assert fila["proxima_cuota"]["monto"] == 10_000


def test_base_danada_cuenta_como_primera_revision(db_sembrada: BaseDatos, tmp_path: Path) -> None:
    carpeta = tmp_path / "agente"
    carpeta.mkdir()
    (carpeta / ia.BASE).write_text("{roto", encoding="utf-8")
    with db_sembrada.fabrica() as s:
        foto = json.loads(ia.abrir(s, carpeta).read_text(encoding="utf-8"))
    assert foto["novedades"]["primera_revision"] is True
