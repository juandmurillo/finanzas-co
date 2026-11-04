# Backend · Finanzas

API local (FastAPI + SQLite). Corre solo en `127.0.0.1` y rechaza peticiones de otros sitios.

## Uso

```bash
cd app/backend
uv sync                      # instala dependencias (Python 3.13)
uv run finanzas migrar       # crea o actualiza data/finanzas.db (respalda antes)
uv run finanzas sembrar      # parámetros de Colombia y categorías base (idempotente)
uv run finanzas demo         # opcional: llena una base vacía con datos ficticios
uv run finanzas servir       # API en http://127.0.0.1:8000 · documentación en /docs
```

Si tu red intercepta TLS, agrega `--system-certs` a los comandos de `uv`. Los respaldos quedan en
`data/respaldos/` (al migrar o servir). Toda la configuración va en `.env` (ver `.env.example`).

## Estructura

```
src/finanzas/
  dominio/      dinero (centavos), grupos, clasificación, eventos, errores — sin I/O
  servicios/    casos de uso: transacciones, créditos, presupuesto, metas, importación, demo…
  infra/        base de datos y vistas, modelos, repositorios, consultas, UnitOfWork, bus de eventos
  api/          rutas v1, esquemas, dependencias y guardia de origen
  main.py       crear_app()   ·   cli.py   comandos
alembic/        migraciones
tests/          pruebas con datos ficticios (tests/fixtures)
```

## Importar desde Cashew

`uv run finanzas importar-cashew ruta/al/export.csv`, o desde la app. No duplica movimientos. Para clasificar según
tus acreedores y clientes, crea un JSON como `tests/fixtures/perfil_prueba.json` y apunta a él con
`FINANZAS_PERFIL_CLASIFICACION`.

## Calidad

```bash
uv run pytest -q
uv run ruff check src tests && uv run ruff format --check src tests
uv run mypy src
```
