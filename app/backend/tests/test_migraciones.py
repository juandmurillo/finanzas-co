"""Las migraciones que reconstruyen tablas (batch de SQLite) no pueden perder filas ni enlaces."""

from __future__ import annotations

import sqlite3
from pathlib import Path

from alembic import command
from alembic.config import Config as ConfigAlembic

from finanzas.cli import RAIZ_BACKEND


def _config(url: str) -> ConfigAlembic:
    cfg = ConfigAlembic(str(RAIZ_BACKEND / "alembic.ini"))
    cfg.set_main_option("sqlalchemy.url", url)
    cfg.attributes["configurar_logs"] = False
    return cfg


def test_0002_conserva_etiquetas_y_pares_de_transferencia(tmp_path: Path) -> None:
    ruta = tmp_path / "vieja.db"
    cfg = _config(f"sqlite:///{ruta.as_posix()}")
    command.upgrade(cfg, "0001")

    con = sqlite3.connect(ruta)
    con.execute("PRAGMA foreign_keys = ON")
    con.execute(
        "INSERT INTO cuenta (id, nombre, tipo, moneda, saldo_inicial, exenta_gmf, orden) "
        "VALUES (1, 'A', 'billetera', 'COP', 0, 0, 0), (2, 'B', 'billetera', 'COP', 0, 0, 1)"
    )
    columnas = "(id, cuenta_id, fecha, monto, descripcion, nota, estado, origen_categoria, creado_en, actualizado_en)"
    fila = "(?, ?, '2026-10-01', ?, 'x', '', 'confirmada', 'manual', '2026-10-01', '2026-10-01')"
    con.executemany(f"INSERT INTO transaccion {columnas} VALUES {fila}", [(1, 1, -500), (2, 2, 500), (3, 1, -100)])
    con.execute("UPDATE transaccion SET transferencia_id = 2 WHERE id = 1")
    con.execute("UPDATE transaccion SET transferencia_id = 1 WHERE id = 2")
    con.execute("INSERT INTO etiqueta (id, nombre) VALUES (1, 'reclamo')")
    con.execute("INSERT INTO transaccion_etiqueta (transaccion_id, etiqueta_id) VALUES (3, 1)")
    con.commit()
    con.close()

    command.upgrade(cfg, "head")

    con = sqlite3.connect(ruta)
    pares = con.execute("SELECT id, transferencia_id FROM transaccion ORDER BY id").fetchall()
    etiquetas = con.execute("SELECT transaccion_id, etiqueta_id FROM transaccion_etiqueta").fetchall()
    fallas = con.execute("PRAGMA foreign_key_check").fetchall()
    con.close()
    assert pares == [(1, 2), (2, 1), (3, None)]
    assert etiquetas == [(3, 1)]
    assert fallas == []
