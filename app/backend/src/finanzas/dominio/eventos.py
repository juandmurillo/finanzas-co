"""Eventos de dominio (ADR-0003): avisan qué entidades cambiaron para refrescar la UI."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import UTC, datetime


@dataclass(frozen=True)
class DominioCambio:
    entidades: tuple[str, ...]
    accion: str
    ids: tuple[int, ...] = ()
    version: int = 0
    fecha: str = field(default_factory=lambda: datetime.now(UTC).isoformat())

    def a_dict(self) -> dict[str, object]:
        return {
            "entidades": list(self.entidades),
            "accion": self.accion,
            "ids": list(self.ids),
            "version": self.version,
            "fecha": self.fecha,
        }
