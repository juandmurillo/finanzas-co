"""Guardia local (S1): CORS no impide que otra página *envíe* peticiones a la API de este computador, solo que
lea la respuesta. Por eso aquí se rechaza lo que escribe desde un origen ajeno y cualquier petición con un Host
que no sea el nuestro (DNS rebinding). Sin cabecera Origin, como en la consola, sigue funcionando."""

from __future__ import annotations

import json
from collections.abc import Iterable
from urllib.parse import urlsplit

from starlette.types import ASGIApp, Receive, Scope, Send

METODOS_SEGUROS = {"GET", "HEAD", "OPTIONS"}


class GuardiaOrigen:
    def __init__(self, app: ASGIApp, origenes: Iterable[str], hosts: Iterable[str]) -> None:
        self.app = app
        self.origenes = set(origenes)
        self.hosts = {h.lower() for h in hosts}

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        cabeceras = {k.decode().lower(): v.decode() for k, v in scope["headers"]}
        host = urlsplit(f"//{cabeceras.get('host', '')}").hostname or ""
        origen = cabeceras.get("origin")
        ajeno = origen is not None and origen not in self.origenes and scope["method"] not in METODOS_SEGUROS
        if host.lower() not in self.hosts or ajeno:
            await self._rechazar(send)
            return
        await self.app(scope, receive, send)

    @staticmethod
    async def _rechazar(send: Send) -> None:
        cuerpo = json.dumps(
            {"type": "about:blank", "title": "Origen no permitido", "status": 403, "detail": "Petición de otro sitio"}
        ).encode()
        cabeceras = [(b"content-type", b"application/problem+json"), (b"content-length", str(len(cuerpo)).encode())]
        await send({"type": "http.response.start", "status": 403, "headers": cabeceras})
        await send({"type": "http.response.body", "body": cuerpo})
