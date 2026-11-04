"""Unit of Work: una transacción de base de datos por caso de uso.

Los eventos registrados durante el caso de uso solo se publican si el commit sale bien.
"""

from __future__ import annotations

from types import TracebackType

from sqlalchemy.orm import Session, sessionmaker

from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.eventos import BusEventos


class UnidadDeTrabajo:
    def __init__(self, fabrica: sessionmaker[Session], bus: BusEventos) -> None:
        self._fabrica = fabrica
        self._bus = bus
        self._pendientes: list[DominioCambio] = []
        self.sesion: Session

    def __enter__(self) -> UnidadDeTrabajo:
        self.sesion = self._fabrica()
        return self

    def __exit__(self, tipo: type[BaseException] | None, exc: BaseException | None, tb: TracebackType | None) -> None:
        try:
            if tipo is None:
                self.sesion.commit()
                for evento in self._pendientes:
                    self._bus.publicar(evento)
            else:
                self.sesion.rollback()
        finally:
            self.sesion.close()

    def registrar(self, evento: DominioCambio) -> None:
        self._pendientes.append(evento)
