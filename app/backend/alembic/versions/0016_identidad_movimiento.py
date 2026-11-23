"""Identidad portable de cada movimiento del libro."""

import sqlalchemy as sa
from alembic import op

revision = "0016"
down_revision = "0015"


def upgrade() -> None:
    op.add_column("transaccion", sa.Column("id_global", sa.String(32)))
    op.execute("UPDATE transaccion SET id_global = lower(hex(randomblob(16)))")
    op.create_index("ux_tx_global", "transaccion", ["id_global"], unique=True)
    op.execute("""
        CREATE TRIGGER asignar_id_global AFTER INSERT ON transaccion
        WHEN NEW.id_global IS NULL
        BEGIN
            UPDATE transaccion SET id_global = lower(hex(randomblob(16))) WHERE id = NEW.id;
        END
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER asignar_id_global")
    op.drop_index("ux_tx_global", table_name="transaccion")
    op.execute("ALTER TABLE transaccion DROP COLUMN id_global")
