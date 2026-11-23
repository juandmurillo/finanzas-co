"""El receptor dentro de Supabase, con la misma interfaz HTTP que el receptor local.

`cliente_receptor` devuelve un `httpx.Client` que habla con `/v1/...`. Si el receptor configurado es
`supabase+https://<proyecto>.supabase.co`, un transporte traduce cada ruta a una función de
`supabase/receptor.sql` (PostgREST, `/rest/v1/rpc/...`) con la sesión de la persona. El resto del
cliente (sincronizar, revisar, unir libros) no distingue un receptor del otro.
"""

import base64
import contextlib
import json
import re
from typing import Any
from urllib.parse import urlsplit

import httpx

from finanzas.infra.red import verificacion_tls

PREFIJO = "supabase+"
_INSTANTANEA = re.compile(r"^/v1/libros/([0-9a-f]{32})/instantanea$")
_LOTES = re.compile(r"^/v1/libros/([0-9a-f]{32})/lotes$")


def es_supabase(receptor: str) -> bool:
    return receptor.startswith(PREFIJO)


def receptor_valido(receptor: str) -> bool:
    """HTTPS siempre; HTTP solo hacia este mismo equipo."""
    url = urlsplit(receptor.removeprefix(PREFIJO))
    if es_supabase(receptor):
        return url.scheme == "https" and bool(url.hostname)
    return url.scheme == "https" or (url.scheme == "http" and url.hostname in {"127.0.0.1", "localhost", "::1"})


class TransporteSupabase(httpx.BaseTransport):
    def __init__(self, origen: str, apikey: str, transporte: httpx.BaseTransport | None = None) -> None:
        self._rpc = httpx.Client(
            base_url=f"{origen.rstrip('/')}/rest/v1/rpc",
            verify=verificacion_tls(),
            timeout=60.0,
            transport=transporte,
        )
        self._apikey = apikey

    def close(self) -> None:
        self._rpc.close()

    def _llamar(self, peticion: httpx.Request, funcion: str, argumentos: dict[str, Any]) -> httpx.Response:
        return self._rpc.post(
            f"/{funcion}",
            json=argumentos,
            headers={"apikey": self._apikey, "Authorization": peticion.headers.get("authorization", "")},
        )

    @staticmethod
    def _error(peticion: httpx.Request, respuesta: httpx.Response) -> httpx.Response:
        """PostgREST devuelve {message, code}; el cliente espera {detail} como el receptor local."""
        try:
            cuerpo = respuesta.json()
            mensaje = cuerpo.get("message", "") if isinstance(cuerpo, dict) else ""
        except ValueError:
            mensaje = ""
        detalle: Any = mensaje or "El receptor rechazó la solicitud"
        if mensaje.startswith("{"):
            # Los choques y el libro reemplazado viajan como JSON dentro del mensaje.
            with contextlib.suppress(ValueError):
                detalle = json.loads(mensaje)
        estado = respuesta.status_code
        if estado in (401, 403) or "JWT" in mensaje:
            estado = 401
        return httpx.Response(estado, json={"detail": detalle}, request=peticion)

    def handle_request(self, request: httpx.Request) -> httpx.Response:
        ruta, metodo = request.url.path, request.method
        parametros = request.url.params
        if metodo == "GET" and ruta == "/v1/sesion":
            respuesta = self._llamar(request, "caudal_sesion", {})
        elif metodo == "GET" and ruta == "/v1/cuenta":
            respuesta = self._llamar(request, "caudal_cuenta", {})
        elif metodo == "POST" and ruta == "/v1/lotes":
            respuesta = self._llamar(request, "caudal_recibir_lote", {"p_lote": json.loads(request.content)})
        elif metodo == "GET" and (m := _LOTES.match(ruta)):
            argumentos = {"p_libro": m.group(1), "p_desde": int(parametros.get("desde", 0))}
            respuesta = self._llamar(request, "caudal_lotes", argumentos)
        elif metodo == "PUT" and (m := _INSTANTANEA.match(ruta)):
            argumentos = {
                "p_libro": m.group(1),
                "p_cursor": int(parametros.get("cursor", 0)),
                "p_principal": parametros.get("principal") == "true",
                "p_resumen": json.loads(request.headers.get("x-caudal-resumen", "{}")),
                "p_contenido": base64.b64encode(request.content).decode(),
            }
            respuesta = self._llamar(request, "caudal_guardar_instantanea", argumentos)
            if respuesta.is_success:
                return httpx.Response(204, request=request)
        elif metodo == "GET" and (m := _INSTANTANEA.match(ruta)):
            respuesta = self._llamar(request, "caudal_leer_instantanea", {"p_libro": m.group(1)})
            if respuesta.is_success:
                foto = respuesta.json() if respuesta.content.strip() else None
                if not foto:
                    return httpx.Response(404, json={"detail": "Ese libro aún no tiene instantánea"}, request=request)
                return httpx.Response(
                    200,
                    content=base64.b64decode(foto["contenido"]),
                    headers={"x-caudal-cursor": str(foto["cursor"]), "content-type": "application/gzip"},
                    request=request,
                )
        else:
            return httpx.Response(404, json={"detail": "Ruta desconocida"}, request=request)
        if not respuesta.is_success:
            return self._error(request, respuesta)
        return httpx.Response(200, json=respuesta.json(), request=request)


def cliente_receptor(receptor: str, token: str, apikey: str | None = None, timeout: float = 60.0) -> httpx.Client:
    cabeceras = {"Authorization": f"Bearer {token}"}
    if es_supabase(receptor):
        if not apikey:
            raise ValueError("Falta la clave publicable de Supabase para sincronizar")
        transporte = TransporteSupabase(receptor.removeprefix(PREFIJO), apikey)
        return httpx.Client(
            base_url="https://receptor.caudal", headers=cabeceras, transport=transporte, timeout=timeout
        )
    return httpx.Client(base_url=receptor, headers=cabeceras, verify=verificacion_tls(), timeout=timeout)
