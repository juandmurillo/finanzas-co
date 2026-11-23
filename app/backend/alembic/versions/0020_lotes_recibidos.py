"""Acuses del receptor y avance de descarga por libro."""

from alembic import op

revision = "0020"
down_revision = "0019"


def upgrade() -> None:
    op.execute("""CREATE TABLE acuse_lote (
        libro TEXT NOT NULL, lote TEXT NOT NULL, cursor INTEGER NOT NULL,
        aplicado INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(libro,lote))""")


def downgrade() -> None:
    op.drop_table("acuse_lote")
