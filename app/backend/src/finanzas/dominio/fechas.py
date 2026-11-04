"""La fecha de hoy siempre en la zona de la app, aunque el servidor esté en otra (L5)."""

from datetime import date, datetime
from zoneinfo import ZoneInfo

ZONA = ZoneInfo("America/Bogota")


def hoy_bogota() -> date:
    return datetime.now(ZONA).date()
