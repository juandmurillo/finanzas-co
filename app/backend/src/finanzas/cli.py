"""Línea de comandos de la app (ver `finanzas --help`)."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

from finanzas.config import obtener_config
from finanzas.infra.db import BaseDatos
from finanzas.infra.eventos import BusEventos
from finanzas.infra.migraciones import actualizar
from finanzas.infra.respaldos import respaldar, restaurar
from finanzas.infra.uow import UnidadDeTrabajo

RAIZ_BACKEND = Path(__file__).resolve().parents[2]


def migrar(url: str) -> None:
    actualizar(url)


def _asegurar_parametros(url: str) -> None:
    from finanzas.servicios.parametros import asegurar_publicos
    from finanzas.servicios.sistema import asegurar_categorias

    with BaseDatos(url).fabrica() as sesion:
        asegurar_publicos(sesion)
        asegurar_categorias(sesion)  # una base nueva debe poder usarse sin importar nada
        sesion.commit()


def main(argv: list[str] | None = None) -> int:
    config = obtener_config()
    parser = argparse.ArgumentParser(prog="finanzas")
    sub = parser.add_subparsers(dest="comando", required=True)
    sub.add_parser("migrar", help="Crea o actualiza el esquema de la base")
    sub.add_parser("sembrar", help="Parámetros de Colombia, categorías base y el archivo de semillas si hay")
    sub.add_parser("demo", help="Llena una instalación vacía con datos de demostración")
    imp = sub.add_parser("importar-cashew", help="Importa un CSV exportado de Cashew")
    imp.add_argument("archivo", nargs="?", help="Por defecto, el cashew-*.csv más reciente de la carpeta de respaldos")
    sub.add_parser("respaldar", help="Copia la base a la carpeta de respaldos")
    res = sub.add_parser("restaurar", help="Reemplaza la base por un respaldo (con la API detenida)")
    res.add_argument("archivo", help="Nombre del respaldo (finanzas-AAAAMMDD-HHMMSS.db) o ruta")
    sub.add_parser("evaluar-sugerencias", help="Mide el acierto del clasificador sobre el historial")
    uni = sub.add_parser("unificar-pagos-credito", help="Une Intereses + Abono de cada cuota en un pago (fase 7)")
    uni.add_argument("--aplicar", action="store_true", help="Sin esto solo muestra lo que haría")
    ins = sub.add_parser("instantanea", help="Foto de solo lectura para un agente de seguimiento")
    ins.add_argument("--cerrar", action="store_true", help="Marca la instantánea en curso como revisión terminada")
    sub.add_parser("openapi", help="Escribe openapi.json (tipos del frontend)")
    srv = sub.add_parser("servir", help="Inicia la API en 127.0.0.1")
    srv.add_argument("--recargar", action="store_true")
    args = parser.parse_args(argv)

    if args.comando == "servir":
        import uvicorn

        respaldar(config.db_ruta, config.backups_dir / "db")
        migrar(config.db_url)
        _asegurar_parametros(config.db_url)
        uvicorn.run("finanzas.main:crear_app", factory=True, host=config.host, port=config.puerto, reload=args.recargar)
        return 0

    if args.comando == "migrar":
        respaldar(config.db_ruta, config.backups_dir / "db")
        migrar(config.db_url)
        print(f"Esquema al día en {config.db_ruta}")
        return 0
    if args.comando == "openapi":
        import json

        from finanzas.main import crear_app

        destino = RAIZ_BACKEND / "openapi.json"
        esquema = crear_app(config).openapi()
        destino.write_text(json.dumps(esquema, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"OpenAPI escrito en {destino}")
        return 0
    if args.comando == "respaldar":
        print(respaldar(config.db_ruta, config.backups_dir / "db") or "No hay base que respaldar")
        return 0
    if args.comando == "restaurar":
        copia = Path(args.archivo)
        if not copia.exists():
            copia = config.backups_dir / "db" / args.archivo
        restaurar(copia, config.db_ruta)
        print(f"Base restaurada desde {copia.name}; la anterior quedó al lado como respaldo.")
        return 0
    if args.comando == "demo":
        migrar(config.db_url)
        from finanzas.servicios.demo import generar

        with UnidadDeTrabajo(BaseDatos(config.db_url).fabrica, BusEventos()) as uow:
            print(f"Datos de demostración listos: {generar(uow)}")
        return 0
    if args.comando == "instantanea":
        return _instantanea(config.db_url, config.agente_dir, args.cerrar)

    db = BaseDatos(config.db_url)
    migrar(config.db_url)
    uow = UnidadDeTrabajo(db.fabrica, BusEventos())
    if args.comando == "evaluar-sugerencias":
        import json

        from finanzas.infra.consultas_clasificador import precision

        with db.fabrica() as sesion:
            print(json.dumps(precision(sesion), ensure_ascii=False, indent=2))
        return 0
    if args.comando == "unificar-pagos-credito":
        import json

        from finanzas.servicios.unificar_creditos import unificar

        if args.aplicar:
            respaldar(config.db_ruta, config.backups_dir / "db")
        with db.fabrica() as sesion:
            resumen = unificar(sesion)
            if args.aplicar and resumen["totales_iguales"]:
                sesion.commit()
                resumen["aplicado"] = True
            else:
                sesion.rollback()
                resumen["aplicado"] = False
        print(json.dumps(resumen, ensure_ascii=False, indent=2))
        return 0 if resumen["totales_iguales"] else 1
    if args.comando == "sembrar":
        from finanzas.servicios.semillas import sembrar

        with uow:
            print(sembrar(uow))
        return 0

    from finanzas.servicios.importacion import importar_cashew

    ruta = Path(args.archivo) if args.archivo else _ultimo_cashew(config.backups_dir)
    if ruta is None or not ruta.exists():
        print("No encontré el archivo de Cashew", file=sys.stderr)
        return 1
    with uow:
        resultado = importar_cashew(uow, ruta.read_bytes(), ruta.name)
    print(resultado)
    return 0


def _instantanea(url: str, carpeta: Path, cerrar: bool) -> int:
    """Sin migrar ni respaldar: el agente puede correr con la API encendida y no debe tocar la base."""
    from sqlalchemy import text

    from finanzas.infra import instantanea_agente

    if cerrar:
        base = instantanea_agente.cerrar(carpeta)
        print(f"Revisión cerrada: {base}" if base else "No hay instantánea en curso que cerrar")
        return 0 if base else 1
    with BaseDatos(url).fabrica() as sesion:
        sesion.execute(text("PRAGMA query_only = ON"))
        print(instantanea_agente.abrir(sesion, carpeta))
    return 0


def _ultimo_cashew(carpeta: Path) -> Path | None:
    archivos = sorted(carpeta.glob("cashew-*.csv"))
    return archivos[-1] if archivos else None


if __name__ == "__main__":
    sys.exit(main())
