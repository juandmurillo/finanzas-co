import sqlite3
from collections.abc import Iterator
from contextlib import closing, contextmanager
from typing import Annotated, Any, Literal

import httpx
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi import Path as PathParam
from fastapi.responses import JSONResponse
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel, Field

from finanzas import union_libros
from finanzas.cliente_sync import sincronizar
from finanzas.config import Config
from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.sesion_segura import SesionSegura
from finanzas.receptor_supabase import cliente_receptor, es_supabase, receptor_valido
from finanzas.revision_sync import RevisionNoEncontrada, listar, resolver_duplicado, resolver_version

router = APIRouter(prefix="/api/v1/sync")


Credencial = Annotated[HTTPAuthorizationCredentials, Depends(HTTPBearer())]
SIN_CONEXION = "Sin conexión con la sincronización. Los cambios siguen en este equipo."


def _receptor(config: Config) -> str:
    if config.host not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(403, "La vinculación requiere acceso local")
    receptor = (config.sync_receptor or "").rstrip("/")
    if not receptor_valido(receptor) or (es_supabase(receptor) and not config.sync_apikey):
        raise HTTPException(503, "Falta configurar el receptor de sincronización")
    return receptor


@contextmanager
def _remoto(
    receptor: str, credencial: HTTPAuthorizationCredentials, apikey: str | None = None
) -> Iterator[httpx.Client]:
    """Cliente del receptor con la sesión de la persona; traduce los fallos de red a respuestas claras."""
    with cliente_receptor(receptor, credencial.credentials, apikey) as remoto:
        try:
            yield remoto
        except httpx.HTTPStatusError as exc:
            raise HTTPException(exc.response.status_code, "El receptor rechazó la solicitud") from exc
        except httpx.RequestError as exc:
            raise HTTPException(503, SIN_CONEXION) from exc


def _titular(remoto: httpx.Client) -> str:
    identidad = remoto.get("/v1/sesion")
    identidad.raise_for_status()
    titular = identidad.json()["titular"]
    if not isinstance(titular, str) or not titular:
        raise HTTPException(502, "El receptor no identificó la sesión")
    return titular


def _libro_de_la_cuenta(remoto: httpx.Client) -> dict[str, Any] | None:
    """None con receptores anteriores a la instantánea, que no conocen /v1/cuenta."""
    respuesta = remoto.get("/v1/cuenta")
    if respuesta.status_code == 404:
        return None
    respuesta.raise_for_status()
    cuenta = respuesta.json()
    return cuenta if isinstance(cuenta, dict) else None


@router.post("/ejecutar")
def ejecutar(request: Request, credencial: Credencial, vincular: bool = False) -> dict[str, str]:
    config: Config = request.app.state.config
    receptor = _receptor(config)
    with closing(sqlite3.connect(config.db_ruta)) as db, _remoto(receptor, credencial, config.sync_apikey) as remoto:
        try:
            libro = db.execute("SELECT id_global FROM libro").fetchone()[0]
            if not vincular and not db.execute("SELECT 1 FROM vinculo_sync WHERE libro=?", (libro,)).fetchone():
                return {"estado": "sin_vincular"}
            titular = _titular(remoto)
            vinculo = db.execute("SELECT titular,receptor FROM vinculo_sync WHERE libro=?", (libro,)).fetchone()
            if vinculo is not None and vinculo[0] == titular and vinculo[1] != receptor and not vincular:
                # Misma cuenta con otro receptor (por ejemplo, al pasar a Supabase): hay que volver a unirse.
                return {"estado": "sin_vincular"}
            if vinculo is not None and vinculo[0] != titular:
                # Con otra cuenta no se consulta nada más del receptor.
                raise HTTPException(
                    403, "Este libro está vinculado a otra cuenta. Entra con la cuenta con la que lo vinculaste."
                )
            cuenta = _libro_de_la_cuenta(remoto)
            if cuenta and cuenta["libro"] not in (None, libro):
                # Otro equipo es el libro de la cuenta (o lo reemplazó): hay que elegir cómo unirse.
                return {"estado": "otro_libro"}
            with db:
                db.execute("BEGIN IMMEDIATE")
                if db.execute("SELECT id_global FROM libro").fetchone() != (libro,):
                    raise HTTPException(409, "El libro cambió")
                if vincular:
                    db.execute("INSERT OR IGNORE INTO vinculo_sync VALUES(?,?,?)", (libro, titular, receptor))
            anterior = db.total_changes
            abiertas = sincronizar(db, remoto, libro)
            cambios = db.total_changes > anterior
        except (ValueError, sqlite3.IntegrityError) as exc:
            raise HTTPException(409, "Hay cambios pendientes de conciliación") from exc
        if cuenta is not None and (cuenta["libro"] is None or cuenta["instantanea"] is None):
            # Sin foto del libro, otro equipo no podría unirse: este la sube.
            union_libros.subir_instantanea(config.db_ruta, remoto)
        return {"estado": "al_dia", "cambios": "si" if cambios else "no", "por_revisar": str(abiertas)}


class Union(BaseModel):
    decision: union_libros.Decision


@router.get("/union")
def situacion_union(request: Request, credencial: Credencial) -> dict[str, Any]:
    """Qué tiene este equipo frente al libro de la cuenta y qué opciones hay para unirlos."""
    config: Config = request.app.state.config
    with _remoto(_receptor(config), credencial, config.sync_apikey) as remoto:
        _titular(remoto)
        return union_libros.situacion(config.db_ruta, remoto)


@router.post("/union")
def unir(request: Request, credencial: Credencial, cuerpo: Union) -> dict[str, Any]:
    config: Config = request.app.state.config
    receptor = _receptor(config)
    with _remoto(receptor, credencial, config.sync_apikey) as remoto:
        titular = _titular(remoto)
        try:
            resultado = union_libros.aplicar(
                config.db_ruta, config.backups_dir / "db", remoto, titular, receptor, cuerpo.decision
            )
        except union_libros.DecisionNoValida as exc:
            raise HTTPException(409, str(exc)) from exc
        except (ValueError, sqlite3.IntegrityError) as exc:
            raise HTTPException(409, f"No se pudo unir el libro: {exc}") from exc
    request.app.state.bus.publicar(DominioCambio(("todo",), "reemplazar"))
    return resultado


class Resolucion(BaseModel):
    """«local», «remoto» o «campos» para versiones; «dos» o «mismo» para posibles duplicados.

    En «campos», por entidad: campo → «local» | «remoto». En «mismo»: campo → movimiento elegido.
    """

    decision: Literal["local", "remoto", "campos", "dos", "mismo"]
    campos: dict[str, dict[str, Literal["local", "remoto"]]] = Field(default_factory=dict)
    datos: dict[str, str] = Field(default_factory=dict)


def _conexion(request: Request) -> sqlite3.Connection:
    return sqlite3.connect(request.app.state.config.db_ruta)


# ── Sesión persistente de la cuenta ──────────────────────────────────────────
# El SDK de Supabase guarda su sesión con este adaptador en vez de localStorage: queda cifrada
# por el sistema junto a la base del libro y sobrevive a reinicios y al modo avión.

ClaveSesion = Annotated[str, PathParam(pattern=r"^sb-[a-z0-9-]{1,80}$")]
SIN_CACHE = {"Cache-Control": "no-store"}


class ValorSesion(BaseModel):
    valor: str = Field(max_length=65_536)


def _sesion(request: Request) -> SesionSegura:
    config: Config = request.app.state.config
    if config.host not in {"127.0.0.1", "::1", "localhost"}:
        raise HTTPException(403, "La sesión solo se guarda con acceso local")
    return SesionSegura(config.db_ruta.with_suffix(".sesion"))


@router.get("/sesion/{clave}")
def leer_sesion(clave: ClaveSesion, request: Request) -> JSONResponse:
    return JSONResponse({"valor": _sesion(request).obtener(clave)}, headers=SIN_CACHE)


@router.put("/sesion/{clave}", status_code=204)
def guardar_sesion(clave: ClaveSesion, cuerpo: ValorSesion, request: Request) -> None:
    _sesion(request).guardar(clave, cuerpo.valor)


@router.delete("/sesion/{clave}", status_code=204)
def borrar_sesion(clave: ClaveSesion, request: Request) -> None:
    _sesion(request).borrar(clave)


@router.get("/estado")
def estado(request: Request) -> dict[str, object]:
    """Lo que sigue solo en este equipo; se muestra antes de cerrar sesión."""
    with closing(_conexion(request)) as db:
        (libro,) = db.execute("SELECT id_global FROM libro").fetchone()
        vinculo = db.execute("SELECT titular FROM vinculo_sync WHERE libro=?", (libro,)).fetchone()
        (pendientes,) = db.execute(
            """SELECT count(DISTINCT lote) FROM cambio_pendiente c WHERE libro_id=? AND formato=2 AND remoto=0
            AND NOT EXISTS (SELECT 1 FROM acuse_lote a WHERE a.libro=c.libro_id AND a.lote=c.lote)""",
            (libro,),
        ).fetchone()
        (por_revisar,) = db.execute(
            "SELECT count(*) FROM revision_sync WHERE libro=? AND estado='abierta'", (libro,)
        ).fetchone()
    return {
        "vinculado": vinculo is not None,
        "titular": vinculo[0] if vinculo else None,
        "pendientes": pendientes if vinculo else 0,
        "por_revisar": por_revisar,
    }


@router.get("/revision")
def revision(request: Request) -> list[dict[str, object]]:
    with closing(_conexion(request)) as db:
        (libro,) = db.execute("SELECT id_global FROM libro").fetchone()
        return listar(db, libro)


@router.post("/revision/{rid}", status_code=204)
def resolver(rid: int, cuerpo: Resolucion, request: Request) -> None:
    with closing(_conexion(request)) as db:
        (libro,) = db.execute("SELECT id_global FROM libro").fetchone()
        try:
            if cuerpo.decision == "dos" or cuerpo.decision == "mismo":
                resolver_duplicado(db, libro, rid, cuerpo.decision, cuerpo.datos)
            else:
                resolver_version(db, libro, rid, cuerpo.decision, dict(cuerpo.campos))
        except RevisionNoEncontrada as exc:
            raise HTTPException(404, "Esta revisión ya se resolvió") from exc
        except (ValueError, sqlite3.IntegrityError) as exc:
            raise HTTPException(409, str(exc) or "No se pudo aplicar la decisión") from exc
    request.app.state.bus.publicar(DominioCambio(entidades=("transaccion", "cuenta", "categoria"), accion="revision"))
