"""Bandeja «Por revisar»: lotes remotos retenidos, conflictos y posibles duplicados."""

from alembic import op

revision = "0022"
down_revision = "0021"


def upgrade() -> None:
    # Distingue las operaciones recibidas de otro equipo de las registradas aquí.
    op.execute("ALTER TABLE cambio_pendiente ADD COLUMN remoto INTEGER NOT NULL DEFAULT 0")
    op.execute("""CREATE TABLE revision_sync (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        libro TEXT NOT NULL,
        tipo TEXT NOT NULL CHECK (tipo IN ('version', 'duplicado')),
        estado TEXT NOT NULL DEFAULT 'abierta' CHECK (estado IN ('abierta', 'resuelta')),
        decision TEXT,
        creada_en TEXT NOT NULL,
        resuelta_en TEXT,
        a_id TEXT,
        b_id TEXT
    )""")
    op.execute("""CREATE UNIQUE INDEX ux_revision_par ON revision_sync(libro, a_id, b_id)
        WHERE tipo = 'duplicado'""")
    op.execute("""CREATE TABLE revision_entidad (
        revision_id INTEGER NOT NULL REFERENCES revision_sync(id) ON DELETE CASCADE,
        entidad TEXT NOT NULL, entidad_id TEXT NOT NULL,
        PRIMARY KEY (revision_id, entidad_id)
    ) WITHOUT ROWID""")
    op.execute("""CREATE TABLE lote_retenido (
        libro TEXT NOT NULL, lote TEXT NOT NULL, cursor INTEGER NOT NULL, contenido TEXT NOT NULL,
        revision_id INTEGER NOT NULL REFERENCES revision_sync(id) ON DELETE CASCADE,
        PRIMARY KEY (libro, lote)
    )""")


def downgrade() -> None:
    op.drop_table("lote_retenido")
    op.drop_table("revision_entidad")
    op.execute("DROP INDEX ux_revision_par")
    op.drop_table("revision_sync")
    op.execute("ALTER TABLE cambio_pendiente DROP COLUMN remoto")
