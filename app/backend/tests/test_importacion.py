from sqlalchemy import func, select, text

from finanzas.infra.db import BaseDatos
from finanzas.infra.modelos import Transaccion
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios.importacion import importar_cashew

SALDOS_ESPERADOS = {"Nequi": 152_200_000, "Daviplata": 93_000_000, "Ahorro": 14_000_000, "Efectivo": 2_000_000}
CONFIRMADAS = 18


def _saldos(db: BaseDatos) -> dict[str, int]:
    with db.fabrica() as s:
        return {f.nombre: int(f.saldo) for f in s.execute(text("SELECT nombre, saldo FROM v_saldo_cuenta"))}


def test_importar_cashew_saldos_coinciden(uow: UnidadDeTrabajo, db: BaseDatos, csv_cashew: bytes) -> None:
    with uow:
        resultado = importar_cashew(uow, csv_cashew, "cashew.csv")
    assert resultado.creadas == CONFIRMADAS
    assert resultado.pendientes == 1  # sin «amount»: programado, no confirmado
    assert _saldos(db) == SALDOS_ESPERADOS
    assert resultado.transferencias_emparejadas > 0


def test_reimportar_no_duplica(db: BaseDatos, bus, csv_cashew: bytes) -> None:  # type: ignore[no-untyped-def]
    with UnidadDeTrabajo(db.fabrica, bus) as u:
        importar_cashew(u, csv_cashew, "cashew.csv")
    with UnidadDeTrabajo(db.fabrica, bus) as u:
        segundo = importar_cashew(u, csv_cashew + b"\n", "cashew-copia.csv")
    assert segundo.creadas == 0 and segundo.duplicadas == CONFIRMADAS + 1
    with db.fabrica() as s:
        assert (
            s.scalar(select(func.count()).select_from(Transaccion).where(Transaccion.estado == "confirmada"))
            == CONFIRMADAS
        )


def test_mismo_archivo_se_detecta(uow: UnidadDeTrabajo, db: BaseDatos, bus, csv_cashew: bytes) -> None:  # type: ignore[no-untyped-def]
    with uow:
        importar_cashew(uow, csv_cashew, "cashew.csv")
    with UnidadDeTrabajo(db.fabrica, bus) as u:
        assert importar_cashew(u, csv_cashew, "cashew.csv").archivo_repetido
