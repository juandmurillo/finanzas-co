"""Entorno de Alembic. La URL sale de FINANZAS_DB_RUTA salvo que el llamador fije sqlalchemy.url."""

from logging.config import fileConfig

from alembic import context

from finanzas.config import obtener_config
from finanzas.infra import modelos  # noqa: F401  (registra las tablas en Base.metadata)
from finanzas.infra.db import Base, crear_motor

config = context.config
if config.config_file_name is not None and config.attributes.get("configurar_logs", True):
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def _url() -> str:
    return config.get_main_option("sqlalchemy.url") or obtener_config().db_url


def run_migrations_offline() -> None:
    context.configure(url=_url(), target_metadata=target_metadata, literal_binds=True, render_as_batch=True)
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    motor = crear_motor(_url())
    with motor.connect() as conexion:
        # El batch de SQLite borra y recrea tablas: con las FK activas, el DROP dispara ON DELETE
        # CASCADE / SET NULL y se pierden etiquetas y pares de transferencia. El PRAGMA solo
        # surte efecto fuera de una transacción, por eso va antes y se confirma de inmediato.
        sqlite = conexion.dialect.name == "sqlite"
        if sqlite:
            conexion.exec_driver_sql("PRAGMA foreign_keys = OFF")
            conexion.commit()
        context.configure(connection=conexion, target_metadata=target_metadata, render_as_batch=True)
        with context.begin_transaction():
            context.run_migrations()
        if sqlite:
            conexion.commit()
            fallas = conexion.exec_driver_sql("PRAGMA foreign_key_check").fetchall()
            conexion.exec_driver_sql("PRAGMA foreign_keys = ON")
            conexion.commit()
            if fallas:
                raise RuntimeError(f"La migración dejó llaves foráneas rotas: {fallas[:5]}")


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
