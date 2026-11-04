"""meta: fecha en que se cumplió

Revision ID: 0009
Revises: 0008
Create Date: 2026-10-31 18:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0009"
down_revision: Union[str, Sequence[str], None] = "0008"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Columna nueva que admite nulos: SQLite la agrega sin reconstruir la tabla.
    op.add_column("meta", sa.Column("cumplida_en", sa.String(length=40), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("meta", schema=None) as batch_op:
        batch_op.drop_column("cumplida_en")
