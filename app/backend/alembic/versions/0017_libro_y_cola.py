"""Identidad del libro y registro durable de cambios locales."""

import sqlalchemy as sa
from alembic import op

revision = "0017"
down_revision = "0016"


def upgrade() -> None:
    op.execute("""CREATE TABLE libro (
        unico INTEGER PRIMARY KEY CHECK (unico = 1),
        id_global TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16))))
    )""")
    op.execute("INSERT INTO libro (unico) VALUES (1)")
    op.execute("""CREATE TABLE cambio_pendiente (
        secuencia INTEGER PRIMARY KEY AUTOINCREMENT,
        operacion TEXT NOT NULL UNIQUE DEFAULT (lower(hex(randomblob(16)))),
        libro_id TEXT NOT NULL, entidad TEXT NOT NULL, entidad_id TEXT NOT NULL, accion TEXT NOT NULL
    )""")
    for tabla in ("cuenta", "categoria", "transaccion"):
        if tabla != "transaccion":
            op.add_column(tabla, sa.Column("id_global", sa.String(32)))
            op.execute(f"UPDATE {tabla} SET id_global = lower(hex(randomblob(16)))")
            op.create_index(f"ux_{tabla}_global", tabla, ["id_global"], unique=True)
            op.execute(f"""CREATE TRIGGER identidad_{tabla} AFTER INSERT ON {tabla}
                WHEN NEW.id_global IS NULL BEGIN
                UPDATE {tabla} SET id_global = lower(hex(randomblob(16))) WHERE id = NEW.id;
                END""")
        # El alta sin ID produce un UPDATE interno al asignar la identidad.
        for evento, accion, fila, condicion in (
            ("INSERT", "crear", "NEW", "NEW.id_global IS NOT NULL"),
            ("UPDATE", "crear", "NEW", "OLD.id_global IS NULL AND NEW.id_global IS NOT NULL"),
            ("UPDATE", "editar", "NEW", "OLD.id_global IS NOT NULL"),
            ("DELETE", "eliminar", "OLD", "OLD.id_global IS NOT NULL"),
        ):
            op.execute(f"""CREATE TRIGGER cola_{tabla}_{evento}_{accion} AFTER {evento} ON {tabla}
                WHEN {condicion} BEGIN
                INSERT INTO cambio_pendiente (libro_id, entidad, entidad_id, accion)
                SELECT id_global, '{tabla}', {fila}.id_global, '{accion}' FROM libro;
                END""")


def downgrade() -> None:
    for tabla in ("cuenta", "categoria", "transaccion"):
        for sufijo in ("INSERT_crear", "UPDATE_crear", "UPDATE_editar", "DELETE_eliminar"):
            op.execute(f"DROP TRIGGER cola_{tabla}_{sufijo}")
        if tabla != "transaccion":
            op.execute(f"DROP TRIGGER identidad_{tabla}")
            op.drop_index(f"ux_{tabla}_global", table_name=tabla)
            op.execute(f"ALTER TABLE {tabla} DROP COLUMN id_global")
    op.drop_table("cambio_pendiente")
    op.drop_table("libro")
