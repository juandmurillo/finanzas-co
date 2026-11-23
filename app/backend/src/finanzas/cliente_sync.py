"""Cliente piloto para copias de un mismo libro y un receptor ya autenticado."""

import sqlite3

import httpx

from finanzas.revision_sync import (
    aplicar,
    cerrar_obsoletas,
    choques_del_lote,
    detectar_duplicados,
    entidades_retenidas,
    es_trivial,
    resolver_version,
    retener,
)
from finanzas.sincronizacion import Lote, preparar_lote


def _descargar(db: sqlite3.Connection, remoto: httpx.Client, libro: str) -> None:
    while True:
        desde = db.execute(
            "SELECT coalesce(max(cursor),0) FROM acuse_lote WHERE libro=? AND aplicado=1", (libro,)
        ).fetchone()[0]
        respuesta = remoto.get(f"/v1/libros/{libro}/lotes", params={"desde": desde})
        respuesta.raise_for_status()
        pagina = respuesta.json()
        if not pagina:
            return
        retenidas: set[int] = set()
        for entrada in pagina:
            lote = Lote.model_validate(entrada["contenido"])
            cursor = entrada["cursor"]
            if lote.libro != libro or cursor <= desde:
                raise ValueError("Página de cambios incoherente")
            with db:
                db.execute("BEGIN IMMEDIATE")
                if db.execute("SELECT id_global FROM libro").fetchone() != (libro,):
                    raise ValueError("El libro fue reemplazado")
                local = db.execute(
                    "SELECT 1 FROM cambio_pendiente WHERE libro_id=? AND lote=? AND remoto=0", (libro, lote.lote)
                ).fetchone()
                if local:
                    if preparar_lote(db, libro, lote.lote) != lote:
                        raise ValueError("Conflicto de contenido del lote")
                else:
                    tomadas = entidades_retenidas(db, libro)
                    previas = {tomadas[c.entidad_id] for c in lote.cambios if c.entidad_id in tomadas}
                    if previas or choques_del_lote(db, libro, lote):
                        # Se retiene completo y el cursor avanza: el resto del libro sigue al día.
                        retenidas.add(retener(db, libro, lote, cursor, previas))
                    else:
                        # Al restaurar el libro al final, los triggers no duplican las operaciones recibidas.
                        db.execute("DELETE FROM libro")
                        for cambio in lote.cambios:
                            aplicar(db, libro, lote.lote, cambio)
                        db.execute("INSERT INTO libro(unico,id_global) VALUES(1,?)", (libro,))
                        detectar_duplicados(db, libro, lote)
                db.execute("INSERT OR REPLACE INTO acuse_lote VALUES (?,?,?,1)", (libro, lote.lote, cursor))
            desde = cursor
        vivas = {r for (r,) in db.execute("SELECT id FROM revision_sync WHERE estado='abierta' AND tipo='version'")}
        for rid in sorted(retenidas & vivas):
            if es_trivial(db, libro, rid):
                resolver_version(db, libro, rid, "remoto")


def _subir(db: sqlite3.Connection, remoto: httpx.Client, libro: str) -> bool:
    """Envía los lotes pendientes que no tocan entidades en revisión. False si el receptor vio un choque."""
    bloqueadas = set(entidades_retenidas(db, libro))
    pendientes = db.execute(
        """SELECT lote FROM cambio_pendiente c WHERE libro_id=? AND formato=2 AND remoto=0
        AND NOT EXISTS(SELECT 1 FROM acuse_lote a WHERE a.libro=c.libro_id AND a.lote=c.lote)
        GROUP BY lote ORDER BY min(secuencia)""",
        (libro,),
    ).fetchall()
    for (clave,) in pendientes:
        filas = db.execute("SELECT entidad_id FROM cambio_pendiente WHERE libro_id=? AND lote=?", (libro, clave))
        entidades = {e for (e,) in filas}
        if entidades & bloqueadas:
            # Un lote posterior que toque lo mismo también espera, para conservar el orden.
            bloqueadas |= entidades
            continue
        respuesta = remoto.post("/v1/lotes", json=preparar_lote(db, libro, clave).model_dump(mode="json"))
        if respuesta.status_code == 409 and isinstance(respuesta.json().get("detail"), dict):
            return False
        respuesta.raise_for_status()
        with db:
            db.execute("INSERT OR IGNORE INTO acuse_lote VALUES (?,?,?,0)", (libro, clave, respuesta.json()["cursor"]))
    return True


def sincronizar(db: sqlite3.Connection, remoto: httpx.Client, libro: str) -> int:
    """Ejecutar sobre una conexión local dedicada. Devuelve cuántas revisiones siguen abiertas.

    Primero descarga, para que un choque se detecte aquí y no en el receptor; si otro equipo
    envió entre medias, el receptor rechaza el lote y la siguiente vuelta lo retiene.
    """
    if db.execute("SELECT id_global FROM libro").fetchone() != (libro,):
        raise ValueError("El libro local no coincide")
    db.execute("PRAGMA foreign_keys=ON")
    for _ in range(3):
        _descargar(db, remoto, libro)
        if _subir(db, remoto, libro):
            break
    _descargar(db, remoto, libro)
    cerrar_obsoletas(db, libro)
    (abiertas,) = db.execute(
        "SELECT count(*) FROM revision_sync WHERE libro=? AND estado='abierta'", (libro,)
    ).fetchone()
    return int(abiertas)


def main() -> None:
    """Una pasada manual del piloto sobre una copia vinculada explícitamente."""
    import argparse
    import os
    from contextlib import closing
    from pathlib import Path

    from finanzas.receptor_supabase import cliente_receptor, receptor_valido

    parser = argparse.ArgumentParser(description="Sincronizar una copia piloto de un libro de Caudal")
    parser.add_argument("--base", required=True, type=Path)
    parser.add_argument("--libro", required=True)
    parser.add_argument("--receptor", required=True, help="URL del receptor o supabase+https://<proyecto>")
    args = parser.parse_args()
    if not receptor_valido(args.receptor):
        parser.error("Usa HTTPS, supabase+https o un receptor en loopback")
    token = os.environ.get("CAUDAL_SYNC_TOKEN")
    if not token:
        parser.error("Define CAUDAL_SYNC_TOKEN con la sesión del titular")
    with (
        closing(sqlite3.connect(args.base.resolve().as_uri() + "?mode=rw", uri=True)) as db,
        cliente_receptor(args.receptor, token, os.environ.get("CAUDAL_SYNC_APIKEY")) as remoto,
    ):
        abiertas = sincronizar(db, remoto, args.libro)
        if abiertas:
            print(f"{abiertas} cambios por revisar en la app")


if __name__ == "__main__":
    main()
