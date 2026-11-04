"""Bus de eventos en memoria → Server-Sent Events (ADR-0003).

Los servicios corren en hilos del threadpool de FastAPI; la publicación se reenvía al
event loop con call_soon_threadsafe para que cada suscriptor SSE reciba el evento.
"""

from __future__ import annotations

import asyncio
import itertools
import threading
from dataclasses import replace

from finanzas.dominio.eventos import DominioCambio


class BusEventos:
    def __init__(self) -> None:
        self._loop: asyncio.AbstractEventLoop | None = None
        self._colas: set[asyncio.Queue[DominioCambio]] = set()
        self._version = itertools.count(1)
        self._candado = threading.Lock()
        self.historial: list[DominioCambio] = []

    def vincular(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def suscribir(self) -> asyncio.Queue[DominioCambio]:
        cola: asyncio.Queue[DominioCambio] = asyncio.Queue(maxsize=100)
        self._colas.add(cola)
        return cola

    def desuscribir(self, cola: asyncio.Queue[DominioCambio]) -> None:
        self._colas.discard(cola)

    def publicar(self, evento: DominioCambio) -> DominioCambio:
        with self._candado:
            evento = replace(evento, version=next(self._version))
            self.historial = [*self.historial[-49:], evento]
        if self._loop is not None and not self._loop.is_closed():
            self._loop.call_soon_threadsafe(self._repartir, evento)
        return evento

    def _repartir(self, evento: DominioCambio) -> None:
        for cola in list(self._colas):
            if cola.full():
                cola.get_nowait()
            cola.put_nowait(evento)


bus = BusEventos()
