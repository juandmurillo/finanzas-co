"""cuenta y categoría con símbolo propio: emoji o imagen (data URL), además del logo o ícono

Revision ID: 0013
Revises: 0012
Create Date: 2026-11-22 10:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from finanzas.infra.db import VISTAS_SQL, crear_vistas


revision: str = "0013"
down_revision: Union[str, Sequence[str], None] = "0012"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # SQLite reconstruye las tablas (batch): las vistas que las usan salen antes y vuelven al final.
    for nombre in VISTAS_SQL:
        op.execute(f"DROP VIEW IF EXISTS {nombre}")
    for tabla in ("cuenta", "categoria"):
        with op.batch_alter_table(tabla) as batch:
            batch.alter_column("icono", existing_type=sa.String(length=40), type_=sa.Text(), existing_nullable=True)
    crear_vistas(op.get_bind())


def downgrade() -> None:
    for nombre in VISTAS_SQL:
        op.execute(f"DROP VIEW IF EXISTS {nombre}")
    # Las imágenes no caben en 40 caracteres: se pierden al bajar de versión.
    for tabla in ("cuenta", "categoria"):
        op.execute(f"UPDATE {tabla} SET icono = NULL WHERE length(icono) > 40")
        with op.batch_alter_table(tabla) as batch:
            batch.alter_column("icono", existing_type=sa.Text(), type_=sa.String(length=40), existing_nullable=True)
    crear_vistas(op.get_bind())
