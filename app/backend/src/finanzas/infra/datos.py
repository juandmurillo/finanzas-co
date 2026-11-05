"""Exportar y reemplazar todos los datos. Un archivo cargado nunca toca la base hasta pasar por una base temporal:
se valida su forma y su integridad, se migra a la versión actual y solo entonces se copian sus filas."""

from __future__ import annotations

import json
import sqlite3
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any

from finanzas.dominio.errores import ErrorValidacion
from finanzas.infra import migraciones

FORMATO = "caudal-finanzas"
VERSION = 1
LIMITE_BYTES = 200 * 1024 * 1024
ENCABEZADO_SQLITE = b"SQLite format 3\x00"
_ESCALARES = (str, int, float, bool, type(None))


def _leer(ruta: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{ruta.as_posix()}?mode=ro", uri=True)


def _tablas(conexion: sqlite3.Connection, esquema: str = "main") -> list[str]:
    filas = conexion.execute(
        f"SELECT name FROM {esquema}.sqlite_master WHERE type = 'table' "
        "AND name NOT LIKE 'sqlite_%' AND name != 'alembic_version' ORDER BY name"
    )
    return [f[0] for f in filas]


def _columnas(conexion: sqlite3.Connection, tabla: str, esquema: str = "main") -> list[str]:
    return [f[1] for f in conexion.execute(f'PRAGMA {esquema}.table_info("{tabla}")')]


def revision_de(conexion: sqlite3.Connection) -> str | None:
    try:
        fila = conexion.execute("SELECT version_num FROM alembic_version").fetchone()
    except sqlite3.Error:
        return None
    return str(fila[0]) if fila else None


def exportar(ruta: Path) -> dict[str, Any]:
    """Todo en un diccionario apto para JSON, con la versión del esquema para poder volver a cargarlo."""
    conexion = _leer(ruta)
    try:
        conexion.row_factory = sqlite3.Row
        return {
            "formato": FORMATO,
            "version": VERSION,
            "revision": revision_de(conexion),
            "tablas": {t: [dict(f) for f in conexion.execute(f'SELECT * FROM "{t}"')] for t in _tablas(conexion)},
        }
    finally:
        conexion.close()


def conteos(ruta: Path) -> dict[str, int]:
    conexion = _leer(ruta)
    try:
        return {t: conexion.execute(f'SELECT count(*) FROM "{t}"').fetchone()[0] for t in _tablas(conexion)}
    finally:
        conexion.close()


def _verificar_integridad(ruta: Path) -> None:
    conexion = _leer(ruta)
    try:
        if conexion.execute("PRAGMA integrity_check").fetchone()[0] != "ok":
            raise ErrorValidacion("El archivo está dañado: no pasa el chequeo de integridad")
        if conexion.execute("PRAGMA foreign_key_check").fetchone():
            raise ErrorValidacion("El archivo tiene datos incoherentes: hay referencias a filas que no existen")
    except sqlite3.DatabaseError as exc:
        raise ErrorValidacion("El archivo no es una copia válida") from exc
    finally:
        conexion.close()


def _validar_revision(revision: Any) -> str:
    if not isinstance(revision, str) or not revision:
        raise ErrorValidacion("El archivo no indica de qué versión de la app viene")
    if revision not in migraciones.revisiones():
        raise ErrorValidacion("El archivo viene de una versión más nueva de la app: actualízala antes de cargarlo")
    return revision


def _desde_sqlite(contenido: bytes, destino: Path) -> None:
    destino.write_bytes(contenido)
    _verificar_integridad(destino)
    conexion = _leer(destino)
    try:
        revision = revision_de(conexion)
    finally:
        conexion.close()
    _validar_revision(revision)


def _desde_json(contenido: bytes, destino: Path) -> None:
    try:
        datos = json.loads(contenido)
    except (ValueError, UnicodeDecodeError) as exc:
        raise ErrorValidacion("El archivo no es un JSON válido") from exc
    if not isinstance(datos, dict) or datos.get("formato") != FORMATO:
        raise ErrorValidacion("Este JSON no es una exportación de la app")
    if datos.get("version") != VERSION:
        raise ErrorValidacion("Formato de exportación no compatible con esta versión")
    tablas = datos.get("tablas")
    if not isinstance(tablas, dict):
        raise ErrorValidacion("A la exportación le faltan las tablas")
    migraciones.actualizar(f"sqlite:///{destino.as_posix()}", _validar_revision(datos.get("revision")))
    conexion = sqlite3.connect(destino, isolation_level=None)
    try:
        conexion.execute("PRAGMA foreign_keys = OFF")
        conexion.execute("BEGIN")
        conocidas = set(_tablas(conexion))
        for tabla in conocidas:  # las migraciones siembran algunas filas: manda el archivo
            conexion.execute(f'DELETE FROM "{tabla}"')
        for tabla, filas in tablas.items():
            if tabla not in conocidas:
                raise ErrorValidacion(f"Tabla desconocida en el archivo: {tabla}")
            if not isinstance(filas, list):
                raise ErrorValidacion(f"La tabla {tabla} no tiene el formato esperado")
            permitidas = set(_columnas(conexion, tabla))
            for fila in filas:
                if not isinstance(fila, dict) or not set(fila) <= permitidas:
                    raise ErrorValidacion(f"La tabla {tabla} tiene columnas desconocidas")
                if not all(isinstance(v, _ESCALARES) for v in fila.values()):
                    raise ErrorValidacion(f"La tabla {tabla} tiene valores no válidos")
                columnas = ", ".join(f'"{c}"' for c in fila)
                marcas = ", ".join("?" for _ in fila)
                conexion.execute(f'INSERT INTO "{tabla}" ({columnas}) VALUES ({marcas})', list(fila.values()))
        conexion.execute("COMMIT")
    except sqlite3.Error as exc:
        raise ErrorValidacion(f"El archivo no se pudo leer: {exc}") from exc
    finally:
        conexion.close()
    _verificar_integridad(destino)


@contextmanager
def candidato(contenido: bytes) -> Iterator[Path]:
    """Base temporal, validada y ya en la versión actual, con el contenido de un archivo JSON o SQLite."""
    if len(contenido) > LIMITE_BYTES:
        raise ErrorValidacion("El archivo pasa del límite de 200 MB")
    with tempfile.TemporaryDirectory(prefix="finanzas-carga-", ignore_cleanup_errors=True) as carpeta:
        ruta = Path(carpeta) / "candidato.db"
        if contenido.startswith(ENCABEZADO_SQLITE):
            _desde_sqlite(contenido, ruta)
        else:
            _desde_json(contenido, ruta)
        migraciones.actualizar(f"sqlite:///{ruta.as_posix()}")
        _verificar_integridad(ruta)
        yield ruta


def reemplazar(destino: Path, origen: Path | None) -> None:
    """Cambia todas las filas de `destino` por las de `origen` (o las borra) en una sola transacción: si algo falla,
    la base queda como estaba. Las llaves foráneas se revisan al final, porque el orden de copia no importa."""
    conexion = sqlite3.connect(destino, isolation_level=None, timeout=10)
    try:
        conexion.execute("PRAGMA foreign_keys = ON")
        if origen:
            conexion.execute("ATTACH DATABASE ? AS origen", (origen.as_posix(),))
        conexion.execute("BEGIN IMMEDIATE")
        conexion.execute("PRAGMA defer_foreign_keys = ON")
        tablas = _tablas(conexion)
        try:
            for tabla in tablas:
                conexion.execute(f'DELETE FROM "{tabla}"')
            if origen:
                en_origen = set(_tablas(conexion, "origen"))
                for tabla in tablas:
                    if tabla not in en_origen:
                        continue
                    comunes = set(_columnas(conexion, tabla, "origen"))
                    columnas = ", ".join(f'"{c}"' for c in _columnas(conexion, tabla) if c in comunes)
                    conexion.execute(f'INSERT INTO main."{tabla}" ({columnas}) SELECT {columnas} FROM origen."{tabla}"')
            if conexion.execute("PRAGMA main.foreign_key_check").fetchone():
                raise ErrorValidacion("Los datos tienen referencias incoherentes; no se cambió nada")
            conexion.execute("COMMIT")
        except Exception:
            conexion.execute("ROLLBACK")
            raise
    finally:
        conexion.close()
