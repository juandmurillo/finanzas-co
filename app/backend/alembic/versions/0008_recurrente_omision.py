"""recurrente_omision: periodos que el usuario decidió saltar

Revision ID: 0008
Revises: 0007
Create Date: 2026-10-31 15:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0008"
down_revision: Union[str, Sequence[str], None] = "0007"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "recurrente_omision",
        sa.Column("recurrente_id", sa.Integer(), nullable=False),
        sa.Column("fecha", sa.String(length=10), nullable=False),
        sa.Column("creado_en", sa.String(length=40), nullable=False),
        sa.ForeignKeyConstraint(["recurrente_id"], ["recurrente.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("recurrente_id", "fecha"),
    )


def downgrade() -> None:
    op.drop_table("recurrente_omision")
