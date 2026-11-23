"""Unir un equipo al libro de la cuenta.

Casos al vincular (`situacion`):
- nuevo: la cuenta no tiene libro; este equipo lo crea y sube su instantánea.
- mismo: este equipo ya tiene el libro de la cuenta; solo sincroniza.
- descargar: la cuenta tiene libro y este equipo no tiene movimientos; se descarga.
- elegir: los dos tienen historia; la persona decide entre «cuenta», «equipo» o «combinar».
- sin_instantanea: la cuenta tiene libro, pero ningún equipo ha subido su foto todavía.

La versión que no queda como principal siempre se guarda como respaldo en este equipo
(«Datos y respaldos»), con el mismo formato que los respaldos diarios.
"""

import gzip
import json
import sqlite3
import tempfile
import time
from contextlib import closing
from datetime import datetime
from pathlib import Path
from typing import Any, Literal
from uuid import uuid4

import httpx

from finanzas.cliente_sync import sincronizar
from finanzas.infra import datos, respaldos

Decision = Literal["subir", "cuenta", "equipo", "combinar"]
DECISIONES_POR_CASO: dict[str, set[str]] = {
    "nuevo": {"subir"},
    "mismo": {"subir"},
    "descargar": {"cuenta"},
    "elegir": {"cuenta", "equipo", "combinar"},
    "sin_instantanea": set(),
}
# Relaciones con módulos que aún no se sincronizan: al combinar, el movimiento entra suelto.
SIN_REPLICAR = ("credito_id", "prestamo_id", "recurrente_id", "importacion_id", "contraparte_id")
MAXIMO_POR_LOTE = 400


class DecisionNoValida(ValueError):
    pass


def _libro(db: sqlite3.Connection) -> str:
    return str(db.execute("SELECT id_global FROM libro").fetchone()[0])


def resumen_local(db_ruta: Path) -> dict[str, int]:
    conteos = datos.conteos(db_ruta)
    return {"cuentas": conteos.get("cuenta", 0), "movimientos": conteos.get("transaccion", 0)}


def _cursor_aplicado(db: sqlite3.Connection, libro: str) -> int:
    (cursor,) = db.execute(
        "SELECT coalesce(max(cursor),0) FROM acuse_lote WHERE libro=? AND aplicado=1", (libro,)
    ).fetchone()
    return int(cursor)


def situacion(db_ruta: Path, remoto: httpx.Client) -> dict[str, Any]:
    respuesta = remoto.get("/v1/cuenta")
    respuesta.raise_for_status()
    cuenta = respuesta.json()
    with closing(sqlite3.connect(db_ruta)) as db:
        libro = _libro(db)
    local = resumen_local(db_ruta)
    if cuenta["libro"] is None:
        caso = "nuevo"
    elif cuenta["libro"] == libro:
        caso = "mismo"
    elif cuenta["instantanea"] is None:
        caso = "sin_instantanea"
    elif local["movimientos"] == 0:
        caso = "descargar"
    else:
        caso = "elegir"
    foto = cuenta["instantanea"] or {}
    return {
        "caso": caso,
        "decisiones": sorted(DECISIONES_POR_CASO[caso]),
        "equipo": local,
        "cuenta": {**foto.get("resumen", {}), "guardada_en": foto.get("creada_en")} if foto else None,
    }


def subir_instantanea(db_ruta: Path, remoto: httpx.Client, principal: bool = False) -> None:
    """Foto comprimida del libro hasta el último lote aplicado aquí."""
    with tempfile.TemporaryDirectory(prefix="caudal-foto-", ignore_cleanup_errors=True) as carpeta:
        copia = Path(carpeta) / "foto.db"
        respaldos.copiar(db_ruta, copia)
        with closing(sqlite3.connect(copia)) as db:
            libro = _libro(db)
            cursor = _cursor_aplicado(db, libro)
            # Lo que es de este equipo no viaja: revisiones pendientes y su sesión de sincronización.
            with db:
                for tabla in ("revision_entidad", "lote_retenido", "revision_sync", "vinculo_sync"):
                    db.execute(f"DELETE FROM {tabla}")
            db.execute("VACUUM")
        contenido = gzip.compress(copia.read_bytes())
    respuesta = remoto.put(
        f"/v1/libros/{libro}/instantanea",
        params={"cursor": cursor, "principal": str(principal).lower()},
        content=contenido,
        headers={"Content-Type": "application/gzip", "X-Caudal-Resumen": json.dumps(resumen_local(db_ruta))},
    )
    respuesta.raise_for_status()


def _descargar_instantanea(remoto: httpx.Client, libro: str) -> bytes:
    respuesta = remoto.get(f"/v1/libros/{libro}/instantanea")
    respuesta.raise_for_status()
    return gzip.decompress(respuesta.content)


def _guardar_como_respaldo(contenido: bytes, carpeta: Path) -> Path:
    """Una copia que llega de otro equipo, con el nombre de los respaldos para poder restaurarla."""
    carpeta.mkdir(parents=True, exist_ok=True)
    while (destino := carpeta / f"finanzas-{datetime.now():%Y%m%d-%H%M%S}.db").exists():
        time.sleep(1)
    destino.write_bytes(contenido)
    return destino


def _vincular(db_ruta: Path, titular: str, receptor: str) -> None:
    with closing(sqlite3.connect(db_ruta)) as db, db:
        libro = _libro(db)
        anterior = db.execute("SELECT receptor FROM vinculo_sync WHERE libro=?", (libro,)).fetchone()
        if anterior and anterior[0] != receptor:
            # Los cursores son de cada receptor. Lo ya confirmado en el anterior viaja en la instantánea:
            # se da por enviado y la descarga empieza desde el principio en el nuevo.
            db.execute("UPDATE acuse_lote SET cursor=0, aplicado=1 WHERE libro=?", (libro,))
        db.execute("INSERT OR REPLACE INTO vinculo_sync VALUES (?,?,?)", (libro, titular, receptor))


def _adoptar(db_ruta: Path, carpeta_respaldos: Path, contenido: bytes, titular: str, receptor: str) -> Path:
    """Reemplaza este libro por el de la cuenta; el actual queda como respaldo."""
    with datos.candidato(contenido) as candidato:
        copia = respaldos.respaldar(db_ruta, carpeta_respaldos)
        datos.reemplazar(db_ruta, candidato)
    assert copia is not None
    with closing(sqlite3.connect(db_ruta)) as db, db:
        for tabla in ("revision_entidad", "lote_retenido", "revision_sync"):
            db.execute(f"DELETE FROM {tabla}")
    _vincular(db_ruta, titular, receptor)
    return copia


def _columnas(db: sqlite3.Connection, tabla: str, esquema: str = "main") -> list[str]:
    return [r[1] for r in db.execute(f"PRAGMA {esquema}.table_info({tabla})")]


def combinar(destino: Path, origen: Path) -> dict[str, int]:
    """Suma al libro `destino` las cuentas, categorías y movimientos de `origen` que no tiene.

    Cuentas por nombre, categorías por su ruta y movimientos por cuenta, fecha, importe y
    descripción (o por la huella de importación). Las transferencias entran con su par. Lo
    nuevo queda en la cola de cambios, en lotes de hasta MAXIMO_POR_LOTE operaciones.
    """
    cuenta_r: dict[str, int] = {"cuentas": 0, "categorias": 0, "movimientos": 0, "repetidos": 0, "sueltos": 0}
    db = sqlite3.connect(destino)
    db.row_factory = sqlite3.Row
    try:
        db.execute("PRAGMA foreign_keys=ON")
        db.execute("ATTACH DATABASE ? AS otro", (origen.as_posix(),))
        with db:
            db.execute("BEGIN IMMEDIATE")

            def lote_nuevo() -> None:
                db.execute("UPDATE libro SET lote_activo=?", (uuid4().hex,))

            def quizas_rotar() -> None:
                (n,) = db.execute(
                    "SELECT count(*) FROM cambio_pendiente WHERE lote=(SELECT lote_activo FROM libro)"
                ).fetchone()
                if n >= MAXIMO_POR_LOTE:
                    lote_nuevo()

            def insertar(tabla: str, fila: sqlite3.Row, cambios: dict[str, Any]) -> int:
                # Row: `in` sobre la fila mira los valores, por eso se comparan los nombres de columna.
                de_la_fila = set(fila.keys())
                columnas = [c for c in _columnas(db, tabla) if c not in ("id", "id_global") and c in de_la_fila]
                valores = {c: fila[c] for c in columnas} | cambios | {"id_global": uuid4().hex}
                cur = db.execute(
                    f"INSERT INTO {tabla} ({','.join(valores)}) VALUES ({','.join('?' for _ in valores)})",
                    tuple(valores.values()),
                )
                assert cur.lastrowid is not None
                return cur.lastrowid

            lote_nuevo()
            cuentas: dict[int, int] = {}
            for fila in db.execute("SELECT * FROM otro.cuenta").fetchall():
                if existente := db.execute("SELECT id FROM main.cuenta WHERE nombre=?", (fila["nombre"],)).fetchone():
                    cuentas[fila["id"]] = existente[0]
                else:
                    cuentas[fila["id"]] = insertar("cuenta", fila, {})
                    cuenta_r["cuentas"] += 1
                    quizas_rotar()

            categorias: dict[int, int] = {}
            for fila in db.execute("SELECT * FROM otro.categoria ORDER BY nivel, id").fetchall():
                padre = categorias.get(fila["padre_id"]) if fila["padre_id"] is not None else None
                existente = db.execute(
                    "SELECT id FROM main.categoria WHERE nombre=? AND padre_id IS ?", (fila["nombre"], padre)
                ).fetchone()
                if existente:
                    categorias[fila["id"]] = existente[0]
                else:
                    categorias[fila["id"]] = insertar("categoria", fila, {"padre_id": padre})
                    cuenta_r["categorias"] += 1
                    quizas_rotar()

            def repetido(fila: sqlite3.Row) -> bool:
                if (
                    fila["huella"]
                    and db.execute("SELECT 1 FROM main.transaccion WHERE huella=?", (fila["huella"],)).fetchone()
                ):
                    return True
                return bool(
                    db.execute(
                        """SELECT 1 FROM main.transaccion WHERE cuenta_id=? AND fecha=? AND monto=?
                        AND descripcion=?""",
                        (cuentas[fila["cuenta_id"]], fila["fecha"], fila["monto"], fila["descripcion"]),
                    ).fetchone()
                )

            def copiar_movimiento(fila: sqlite3.Row) -> int:
                if any(fila[c] is not None for c in SIN_REPLICAR):
                    cuenta_r["sueltos"] += 1
                cambios: dict[str, Any] = {c: None for c in SIN_REPLICAR} | {
                    "cuenta_id": cuentas[fila["cuenta_id"]],
                    "categoria_id": categorias.get(fila["categoria_id"]),
                    "transferencia_id": None,
                }
                cuenta_r["movimientos"] += 1
                return insertar("transaccion", fila, cambios)

            hechos: set[int] = set()
            for fila in db.execute("SELECT * FROM otro.transaccion ORDER BY id").fetchall():
                if fila["id"] in hechos:
                    continue
                hechos.add(fila["id"])
                par = (
                    db.execute("SELECT * FROM otro.transaccion WHERE id=?", (fila["transferencia_id"],)).fetchone()
                    if fila["transferencia_id"] is not None
                    else None
                )
                if par is not None:
                    hechos.add(par["id"])
                    if repetido(fila) and repetido(par):
                        cuenta_r["repetidos"] += 2
                        continue
                    salida, entrada = copiar_movimiento(fila), copiar_movimiento(par)
                    db.execute("UPDATE transaccion SET transferencia_id=? WHERE id=?", (entrada, salida))
                    db.execute("UPDATE transaccion SET transferencia_id=? WHERE id=?", (salida, entrada))
                elif repetido(fila):
                    cuenta_r["repetidos"] += 1
                    continue
                else:
                    copiar_movimiento(fila)
                quizas_rotar()
            db.execute("UPDATE libro SET lote_activo=NULL")
        db.execute("DETACH DATABASE otro")
    finally:
        db.close()
    return cuenta_r


def aplicar(
    db_ruta: Path,
    carpeta_respaldos: Path,
    remoto: httpx.Client,
    titular: str,
    receptor: str,
    decision: Decision,
) -> dict[str, Any]:
    estado = situacion(db_ruta, remoto)
    if decision not in DECISIONES_POR_CASO[estado["caso"]]:
        raise DecisionNoValida("Esa opción no corresponde a la situación de este equipo")
    resultado: dict[str, Any] = {"decision": decision, "respaldo": None, "combinado": None}
    cuenta = remoto.get("/v1/cuenta").json()
    if decision == "subir":
        _vincular(db_ruta, titular, receptor)
        with closing(sqlite3.connect(db_ruta)) as db:
            sincronizar(db, remoto, _libro(db))
        subir_instantanea(db_ruta, remoto)
    elif decision == "cuenta":
        contenido = _descargar_instantanea(remoto, cuenta["libro"])
        resultado["respaldo"] = _adoptar(db_ruta, carpeta_respaldos, contenido, titular, receptor).name
        with closing(sqlite3.connect(db_ruta)) as db:
            sincronizar(db, remoto, _libro(db))
    elif decision == "equipo":
        anterior = _descargar_instantanea(remoto, cuenta["libro"])
        with datos.candidato(anterior):
            pass  # valida la copia antes de guardarla como versión anterior
        resultado["respaldo"] = _guardar_como_respaldo(anterior, carpeta_respaldos).name
        _vincular(db_ruta, titular, receptor)
        # Primero se vuelve principal (los lotes de un libro ajeno se rechazan), luego se envía lo pendiente.
        subir_instantanea(db_ruta, remoto, principal=True)
        with closing(sqlite3.connect(db_ruta)) as db:
            sincronizar(db, remoto, _libro(db))
        subir_instantanea(db_ruta, remoto)
    else:
        contenido = _descargar_instantanea(remoto, cuenta["libro"])
        copia = _adoptar(db_ruta, carpeta_respaldos, contenido, titular, receptor)
        resultado["respaldo"] = copia.name
        resultado["combinado"] = combinar(db_ruta, copia)
        with closing(sqlite3.connect(db_ruta)) as db:
            sincronizar(db, remoto, _libro(db))
    return resultado
