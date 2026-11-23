"""Recibos de altas de movimientos y transferencias."""

import sqlalchemy as sa
from alembic import op

revision = "0015"
down_revision = "0014"


def upgrade() -> None:
    op.create_table(
        "recibo_captura",
        sa.Column("clave", sa.String(36), primary_key=True),
        sa.Column("huella", sa.String(64), nullable=False),
        sa.Column("respuesta", sa.JSON(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("recibo_captura")
