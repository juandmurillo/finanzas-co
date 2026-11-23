"""Receptor piloto separado de la API financiera local.

Arranque: uvicorn finanzas.sincronizacion:desde_entorno --factory
"""

import json
import os
import sqlite3
from collections.abc import Callable
from contextlib import closing
from pathlib import Path
from typing import Annotated, Literal
from uuid import UUID

import httpx
from fastapi import Depends, FastAPI, HTTPException, Query, Request, Response
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field, model_validator

from finanzas.infra.red import verificacion_tls

Identidad = Annotated[str, Field(pattern=r"^[0-9a-f]{32}$")]
LIMITE_INSTANTANEA = 50_000_000


class Cambio(BaseModel):
    operacion: Identidad
    entidad: Literal["cuenta", "categoria", "transaccion"]
    entidad_id: Identidad
    accion: Literal["crear", "editar", "eliminar"]
    version_base: Identidad | None
    campos: dict[str, tuple[str | int | float | None, str | int | float | None]] = Field(min_length=1, max_length=64)


class Lote(BaseModel):
    libro: Identidad
    lote: Identidad
    cambios: list[Cambio] = Field(min_length=1, max_length=500)

    @model_validator(mode="after")
    def operaciones_distintas(self) -> "Lote":
        if len({c.operacion for c in self.cambios}) != len(self.cambios):
            raise ValueError("El lote repite una operación")
        return self


def preparar_lote(db: sqlite3.Connection, libro: str, clave: str) -> Lote:
    """Serializa un lote local confirmado con referencias portables."""
    filas = db.execute(
        """SELECT secuencia, formato, operacion, entidad, entidad_id, accion, version_base
        FROM cambio_pendiente WHERE libro_id=? AND lote=? ORDER BY secuencia""",
        (libro, clave),
    )
    cambios = []
    for secuencia, formato, operacion, entidad, entidad_id, accion, base in filas:
        if formato != 2:
            raise ValueError("Este lote requiere una instantánea inicial")
        campos = {}
        for campo, antes, despues, ant_global, post_global in db.execute(
            "SELECT campo, antes, despues, antes_global, despues_global FROM detalle_cambio WHERE secuencia=?",
            (secuencia,),
        ):
            if campo.endswith("_id"):
                if (antes is not None and ant_global is None) or (despues is not None and post_global is None):
                    raise ValueError(f"Falta la referencia global de {campo}")
                antes, despues = ant_global, post_global
            campos[campo] = (antes, despues)
        cambios.append(
            Cambio(
                operacion=operacion,
                entidad=entidad,
                entidad_id=entidad_id,
                accion=accion,
                version_base=base,
                campos=campos,
            )
        )
    return Lote(libro=libro, lote=clave, cambios=cambios)


def _choques(db: sqlite3.Connection, titular: str, lote: Lote) -> list[str]:
    """Entidades cuyo cambio no parte de la última versión aceptada.

    Sin versión registrada (entidades de la instantánea inicial) se acepta la primera edición.
    Recrear con la misma identidad solo vale sobre un borrado conocido.
    """
    cabezas: dict[str, tuple[str, str] | None] = {}
    choques = []
    for c in lote.cambios:
        if c.entidad_id not in cabezas:
            cabezas[c.entidad_id] = db.execute(
                "SELECT operacion, accion FROM cabeza WHERE usuario=? AND libro=? AND entidad_id=?",
                (titular, lote.libro, c.entidad_id),
            ).fetchone()
        previa = cabezas[c.entidad_id]
        if c.accion == "crear":
            valido = (previa is None and c.version_base is None) or (
                previa is not None and previa[1] == "eliminar" and c.version_base == previa[0]
            )
        else:
            valido = previa is None or (previa[1] != "eliminar" and c.version_base == previa[0])
        if not valido and c.entidad_id not in choques:
            choques.append(c.entidad_id)
        cabezas[c.entidad_id] = (c.operacion, c.accion)
    return choques


def crear_receptor(ruta: Path, identificar: Callable[[str], str]) -> FastAPI:
    app = FastAPI(title="Caudal · recepción de cambios")
    with closing(sqlite3.connect(ruta)) as db:
        db.execute("""CREATE TABLE IF NOT EXISTS lote (
            cursor INTEGER PRIMARY KEY AUTOINCREMENT, usuario TEXT NOT NULL, libro TEXT NOT NULL,
            clave TEXT NOT NULL, contenido TEXT NOT NULL, UNIQUE(usuario, libro, clave))""")
        db.execute("CREATE INDEX IF NOT EXISTS ix_descarga ON lote(usuario, libro, cursor)")
        db.execute("""CREATE TABLE IF NOT EXISTS operacion (
            usuario TEXT NOT NULL, libro TEXT NOT NULL, clave TEXT NOT NULL, PRIMARY KEY(usuario, libro, clave))""")
        # Última versión aceptada de cada entidad: un cambio debe partir de ella.
        db.execute("""CREATE TABLE IF NOT EXISTS cabeza (
            usuario TEXT NOT NULL, libro TEXT NOT NULL, entidad_id TEXT NOT NULL,
            operacion TEXT NOT NULL, accion TEXT NOT NULL, PRIMARY KEY(usuario, libro, entidad_id))""")
        # Libro principal de cada cuenta: los equipos nuevos se unen a él.
        db.execute("""CREATE TABLE IF NOT EXISTS cuenta_libro (
            usuario TEXT PRIMARY KEY, libro TEXT NOT NULL, generacion INTEGER NOT NULL,
            actualizado_en TEXT NOT NULL)""")
        # Última foto completa de cada libro. La del libro reemplazado queda como versión anterior.
        db.execute("""CREATE TABLE IF NOT EXISTS instantanea (
            usuario TEXT NOT NULL, libro TEXT NOT NULL, cursor INTEGER NOT NULL, creada_en TEXT NOT NULL,
            resumen TEXT NOT NULL, contenido BLOB NOT NULL, PRIMARY KEY(usuario, libro))""")

    def usuario(credencial: Annotated[HTTPAuthorizationCredentials, Depends(HTTPBearer())]) -> str:
        return identificar(credencial.credentials)

    def libro_principal(db: sqlite3.Connection, titular: str) -> str | None:
        if fila := db.execute("SELECT libro FROM cuenta_libro WHERE usuario=?", (titular,)).fetchone():
            return str(fila[0])
        # Cuentas del piloto anteriores a la instantánea: si solo hay un libro con lotes, es el principal.
        libros = db.execute("SELECT DISTINCT libro FROM lote WHERE usuario=? LIMIT 2", (titular,)).fetchall()
        return str(libros[0][0]) if len(libros) == 1 else None

    @app.get("/v1/sesion")
    def sesion(titular: Annotated[str, Depends(usuario)]) -> dict[str, str]:
        return {"titular": titular}

    @app.get("/v1/cuenta")
    def cuenta(titular: Annotated[str, Depends(usuario)]) -> dict[str, object]:
        with closing(sqlite3.connect(ruta)) as db:
            libro = libro_principal(db, titular)
            if libro is None:
                return {"libro": None, "cursor": 0, "instantanea": None}
            (cursor,) = db.execute(
                "SELECT coalesce(max(cursor),0) FROM lote WHERE usuario=? AND libro=?", (titular, libro)
            ).fetchone()
            foto = db.execute(
                "SELECT cursor, creada_en, resumen, length(contenido) FROM instantanea WHERE usuario=? AND libro=?",
                (titular, libro),
            ).fetchone()
            return {
                "libro": libro,
                "cursor": cursor,
                "instantanea": (
                    {"cursor": foto[0], "creada_en": foto[1], "resumen": json.loads(foto[2]), "bytes": foto[3]}
                    if foto
                    else None
                ),
            }

    @app.put("/v1/libros/{libro}/instantanea", status_code=204)
    async def guardar_instantanea(
        libro: Identidad,
        request: Request,
        titular: Annotated[str, Depends(usuario)],
        cursor: Annotated[int, Query(ge=0)],
        principal: bool = False,
    ) -> None:
        """Foto comprimida del libro hasta `cursor`. `principal` reemplaza el libro de la cuenta."""
        contenido = await request.body()
        if not 0 < len(contenido) <= LIMITE_INSTANTANEA:
            raise HTTPException(413, "La instantánea no tiene un tamaño válido")
        try:
            resumen = json.loads(request.headers.get("x-caudal-resumen", "{}"))
            assert isinstance(resumen, dict) and all(isinstance(v, int) for v in resumen.values())
        except (ValueError, AssertionError) as exc:
            raise HTTPException(422, "Resumen no válido") from exc
        with closing(sqlite3.connect(ruta)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            actual = libro_principal(db, titular)
            if actual not in (None, libro) and not principal:
                raise HTTPException(409, {"libro_reemplazado": actual})
            (maximo,) = db.execute(
                "SELECT coalesce(max(cursor),0) FROM lote WHERE usuario=? AND libro=?", (titular, libro)
            ).fetchone()
            if cursor > maximo:
                raise HTTPException(422, "La instantánea dice incluir cambios que el receptor no tiene")
            if actual != libro:
                db.execute(
                    """INSERT INTO cuenta_libro VALUES (?,?,1,datetime('now'))
                    ON CONFLICT(usuario) DO UPDATE SET libro=excluded.libro, generacion=generacion+1,
                    actualizado_en=excluded.actualizado_en""",
                    (titular, libro),
                )
            db.execute(
                "INSERT OR REPLACE INTO instantanea VALUES (?,?,?,datetime('now'),?,?)",
                (titular, libro, cursor, json.dumps(resumen), contenido),
            )

    @app.get("/v1/libros/{libro}/instantanea")
    def leer_instantanea(libro: Identidad, titular: Annotated[str, Depends(usuario)]) -> Response:
        with closing(sqlite3.connect(ruta)) as db:
            fila = db.execute(
                "SELECT cursor, contenido FROM instantanea WHERE usuario=? AND libro=?", (titular, libro)
            ).fetchone()
        if not fila:
            raise HTTPException(404, "Ese libro aún no tiene instantánea")
        return Response(fila[1], media_type="application/gzip", headers={"x-caudal-cursor": str(fila[0])})

    @app.post("/v1/lotes")
    def recibir(lote: Lote, titular: Annotated[str, Depends(usuario)]) -> dict[str, int]:
        contenido = json.dumps(lote.model_dump(), sort_keys=True, separators=(",", ":"), allow_nan=False)
        if len(contenido.encode()) > 2_000_000:
            raise HTTPException(413, "Lote demasiado grande")
        with closing(sqlite3.connect(ruta)) as db, db:
            db.execute("BEGIN IMMEDIATE")
            principal = db.execute("SELECT libro FROM cuenta_libro WHERE usuario=?", (titular,)).fetchone()
            if principal and principal[0] != lote.libro:
                # Otro equipo eligió su libro como principal: este debe volver a unirse.
                raise HTTPException(409, {"libro_reemplazado": principal[0]})
            claves = (titular, lote.libro, lote.lote)
            previo = db.execute("SELECT cursor, contenido FROM lote WHERE usuario=? AND libro=? AND clave=?", claves)
            if fila := previo.fetchone():
                if fila[1] != contenido:
                    raise HTTPException(409, "La clave del lote ya corresponde a otros cambios")
                return {"cursor": fila[0]}
            if choques := _choques(db, titular, lote):
                # El cliente descarga, retiene lo del otro equipo y lo muestra en «Por revisar».
                raise HTTPException(409, {"conflicto": choques})
            try:
                db.executemany(
                    "INSERT INTO operacion VALUES (?,?,?)", [(titular, lote.libro, c.operacion) for c in lote.cambios]
                )
            except sqlite3.IntegrityError as exc:
                raise HTTPException(409, "Una operación ya pertenece a otro lote") from exc
            cursor = db.execute(
                "INSERT INTO lote(usuario,libro,clave,contenido) VALUES (?,?,?,?)", (*claves, contenido)
            )
            assert cursor.lastrowid is not None
            db.executemany(
                "INSERT OR REPLACE INTO cabeza VALUES (?,?,?,?,?)",
                [(titular, lote.libro, c.entidad_id, c.operacion, c.accion) for c in lote.cambios],
            )
            return {"cursor": cursor.lastrowid}

    @app.get("/v1/libros/{libro}/lotes")
    def descargar(
        libro: Identidad, titular: Annotated[str, Depends(usuario)], desde: Annotated[int, Query(ge=0)] = 0
    ) -> list[dict[str, object]]:
        with closing(sqlite3.connect(ruta)) as db:
            filas = db.execute(
                """SELECT cursor, contenido FROM lote WHERE usuario=? AND libro=? AND cursor>?
                                  ORDER BY cursor LIMIT 20""",
                (titular, libro, desde),
            )
            return [{"cursor": cursor, "contenido": json.loads(contenido)} for cursor, contenido in filas]

    return app


def desde_entorno() -> FastAPI:
    origen = os.environ["SUPABASE_URL"].rstrip("/")
    if not origen.startswith("https://"):
        raise ValueError("SUPABASE_URL requiere HTTPS")
    clave = os.environ["SUPABASE_PUBLISHABLE_KEY"]

    def identificar(token: str) -> str:
        try:
            respuesta = httpx.get(
                f"{origen}/auth/v1/user",
                headers={"apikey": clave, "Authorization": f"Bearer {token}"},
                verify=verificacion_tls(),
                timeout=15.0,
            )
            if respuesta.status_code in (401, 403):
                raise HTTPException(401, "Sesión inválida")
            respuesta.raise_for_status()
            return str(UUID(respuesta.json()["id"]))
        except (httpx.HTTPError, KeyError, ValueError) as exc:
            raise HTTPException(503, "No se pudo verificar la sesión") from exc

    return crear_receptor(Path(os.environ["CAUDAL_SYNC_DB"]), identificar)
