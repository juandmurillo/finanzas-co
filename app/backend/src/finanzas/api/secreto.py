"""Guardia del secreto por arranque (arranque portátil, Android).

En el teléfono cualquier otra app puede llamar a 127.0.0.1, sin cabecera Origin. Por eso, cuando la API arranca con
un secreto, toda petición debe traerlo: en la cookie que deja `/entrar?secreto=…` (la abre solo la app, que conoce el
secreto) o en la cabecera `X-Caudal-Secreto`. La cookie cubre también lo que no puede llevar cabeceras propias: el
canal de eventos (EventSource), las descargas y el propio frontend."""

from __future__ import annotations

import hmac
import json
from http.cookies import SimpleCookie
from urllib.parse import parse_qs

from starlette.types import ASGIApp, Receive, Scope, Send

COOKIE = "caudal_sesion"
CABECERA = "x-caudal-secreto"
RUTA_ENTRAR = "/entrar"


class GuardiaSecreto:
    def __init__(self, app: ASGIApp, secreto: str) -> None:
        self.app = app
        self.secreto = secreto

    def _valido(self, valor: str | None) -> bool:
        return valor is not None and hmac.compare_digest(valor.encode(), self.secreto.encode())

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        cabeceras = {k.decode("latin-1").lower(): v.decode("latin-1") for k, v in scope["headers"]}
        if scope["path"] == RUTA_ENTRAR:
            consulta = parse_qs(scope.get("query_string", b"").decode())
            if self._valido((consulta.get("secreto") or [None])[0]):
                await self._entrar(send)
            else:
                await self._rechazar(send)
            return
        galletas: SimpleCookie = SimpleCookie()
        galletas.load(cabeceras.get("cookie", ""))
        galleta = galletas.get(COOKIE)
        if self._valido(cabeceras.get(CABECERA)) or self._valido(galleta.value if galleta else None):
            await self.app(scope, receive, send)
            return
        await self._rechazar(send)

    async def _entrar(self, send: Send) -> None:
        galleta = f"{COOKIE}={self.secreto}; Path=/; HttpOnly; SameSite=Strict"
        cabeceras = [(b"location", b"/"), (b"set-cookie", galleta.encode()), (b"content-length", b"0")]
        await send({"type": "http.response.start", "status": 303, "headers": cabeceras})
        await send({"type": "http.response.body", "body": b""})

    @staticmethod
    async def _rechazar(send: Send) -> None:
        cuerpo = json.dumps(
            {"type": "about:blank", "title": "Sin autorización", "status": 401, "detail": "Falta el secreto de la app"}
        ).encode()
        cabeceras = [(b"content-type", b"application/problem+json"), (b"content-length", str(len(cuerpo)).encode())]
        await send({"type": "http.response.start", "status": 401, "headers": cabeceras})
        await send({"type": "http.response.body", "body": cuerpo})
