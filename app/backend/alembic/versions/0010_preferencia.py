"""preferencia: ajustes de la persona (nombre, módulos, perfil)

Revision ID: 0010
Revises: 0009
Create Date: 2026-11-04 15:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0010"
down_revision: Union[str, Sequence[str], None] = "0009"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "preferencia",
        sa.Column("clave", sa.String(length=40), nullable=False),
        sa.Column("valor", sa.Text(), nullable=False),
        sa.PrimaryKeyConstraint("clave"),
    )


def downgrade() -> None:
    op.drop_table("preferencia")
