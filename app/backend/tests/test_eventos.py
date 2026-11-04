import asyncio
import threading

from finanzas.dominio.eventos import DominioCambio
from finanzas.infra.eventos import BusEventos


def test_evento_publicado_desde_otro_hilo_llega_al_suscriptor() -> None:
    """Los servicios corren en el threadpool; el SSE vive en el event loop."""

    async def escenario() -> DominioCambio:
        bus = BusEventos()
        bus.vincular(asyncio.get_running_loop())
        cola = bus.suscribir()
        hilo = threading.Thread(target=bus.publicar, args=(DominioCambio(("dashboard",), "crear", (7,)),))
        hilo.start()
        hilo.join()
        return await asyncio.wait_for(cola.get(), timeout=2)

    evento = asyncio.run(escenario())
    assert evento.ids == (7,) and evento.version == 1


def test_eventos_no_se_publican_si_falla_el_commit(uow, bus: BusEventos) -> None:  # type: ignore[no-untyped-def]
    try:
        with uow:
            uow.registrar(DominioCambio(("transacciones",), "crear"))
            raise RuntimeError("falla simulada")
    except RuntimeError:
        pass
    assert bus.historial == []
