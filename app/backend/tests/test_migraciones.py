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


def _insertar_minimo(con: sqlite3.Connection, tabla: str, valores: dict[str, object]) -> None:
    """Inserta una fila llenando con valores neutros las columnas obligatorias que la prueba no fija."""
    cols = con.execute(f"PRAGMA table_info({tabla})").fetchall()  # cid, nombre, tipo, notnull, defecto, pk
    fila = dict(valores)
    for _, nombre, tipo, notnull, defecto, pk in cols:
        if nombre in fila or pk or not notnull or defecto is not None:
            continue
        fila[nombre] = 1 if "INT" in tipo.upper() or "FLOAT" in tipo.upper() else "2026-01-01"
    nombres = ", ".join(fila)
    marcas = ", ".join("?" for _ in fila)
    con.execute(f"INSERT INTO {tabla} ({nombres}) VALUES ({marcas})", list(fila.values()))


def test_0012_creditos_pasan_a_subcategorias_sin_tocar_montos(tmp_path: Path) -> None:
    ruta = tmp_path / "vieja.db"
    cfg = _config(f"sqlite:///{ruta.as_posix()}")
    command.upgrade(cfg, "0011")

    con = sqlite3.connect(ruta)
    con.executemany(
        "INSERT INTO categoria (id, padre_id, nivel, nombre, grupo, es_fijo) VALUES (?, ?, ?, ?, 'servicio_deuda', 0)",
        [
            (10, None, 1, "Servicio de deuda"),
            (11, 10, 2, "Moto"),
            (12, 11, 3, "Abono a capital"),
            (13, 11, 3, "Intereses"),
            # Crédito importado o cerrado sin registro en `credito`: también pasa a Créditos.
            (20, 10, 2, "Crédito Viejo"),
            (21, 20, 3, "Abono a capital"),
            # Intereses de préstamos con personas: no es un crédito, se queda donde está.
            (30, 10, 2, "Préstamos personales"),
            (31, 30, 3, "Intereses"),
        ],
    )
    con.execute(
        "INSERT INTO cuenta (id, nombre, tipo, moneda, saldo_inicial, exenta_gmf, orden) "
        "VALUES (1, 'A', 'billetera', 'COP', 0, 0, 0)"
    )
    _insertar_minimo(con, "credito", {"id": 1, "nombre": "Moto", "categoria_id": 11, "estado": "activo"})
    columnas = (
        "(id, cuenta_id, fecha, monto, categoria_id, descripcion, nota, estado, origen_categoria, creado_en, "
        "actualizado_en)"
    )
    fila = "(?, 1, '2026-10-01', ?, ?, 'x', '', 'confirmada', 'manual', '2026-10-01', '2026-10-01')"
    con.executemany(
        f"INSERT INTO transaccion {columnas} VALUES {fila}", [(1, -265_000, 11), (2, -400_000, 12), (3, -9_000, 13)]
    )
    _insertar_minimo(con, "regla", {"id": 1, "nombre": "r", "condiciones": "[]", "acciones": '{"categoria_id": 13}'})
    con.commit()
    con.close()

    command.upgrade(cfg, "0012")

    con = sqlite3.connect(ruta)
    arbol = {i: (n, p, nv) for i, n, p, nv in con.execute("SELECT id, nombre, padre_id, nivel FROM categoria")}
    creditos_id = con.execute("SELECT id FROM categoria WHERE nombre = 'Créditos'").fetchone()[0]
    txs = con.execute("SELECT id, monto, categoria_id FROM transaccion ORDER BY id").fetchall()
    regla = con.execute("SELECT acciones FROM regla").fetchone()[0]
    fallas = con.execute("PRAGMA foreign_key_check").fetchall()
    con.close()
    assert arbol[creditos_id] == ("Créditos", 10, 2)
    assert arbol[11] == ("Moto", creditos_id, 3)
    assert arbol[12] == ("Abono · Moto", creditos_id, 3)
    assert arbol[20] == ("Crédito Viejo", creditos_id, 3)
    assert arbol[21] == ("Abono · Crédito Viejo", creditos_id, 3)
    assert 13 not in arbol  # los intereses del crédito se fundieron en él
    assert arbol[30] == ("Préstamos personales", 10, 2) and arbol[31] == ("Intereses", 30, 3)
    # Montos intactos; los intereses se funden en el crédito y la regla los sigue.
    assert txs == [(1, -265_000, 11), (2, -400_000, 12), (3, -9_000, 11)]
    assert '"categoria_id": 11' in regla
    assert fallas == []

    command.downgrade(cfg, "0011")
    con = sqlite3.connect(ruta)
    arbol = {i: (n, p, nv) for i, n, p, nv in con.execute("SELECT id, nombre, padre_id, nivel FROM categoria")}
    con.close()
    assert arbol[11] == ("Moto", 10, 2) and arbol[12] == ("Abono a capital", 11, 3)
    assert arbol[20] == ("Crédito Viejo", 10, 2) and arbol[21] == ("Abono a capital", 20, 3)
    assert creditos_id not in arbol
