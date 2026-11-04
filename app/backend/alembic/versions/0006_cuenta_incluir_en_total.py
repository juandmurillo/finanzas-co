"""cuenta: incluir en el saldo total

Revision ID: 0006
Revises: 0005
Create Date: 2026-10-31 10:00:00

"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from finanzas.infra.db import VISTAS_SQL, crear_vistas


revision: str = "0006"
down_revision: Union[str, Sequence[str], None] = "0005"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Cada cuenta decide si suma al saldo total (Inicio, Cuentas, colchón y saldo proyectado).
    # SQLite reconstruye `cuenta` (batch): las vistas que la usan salen antes y vuelven al final.
    for nombre in VISTAS_SQL:
        op.execute(f"DROP VIEW IF EXISTS {nombre}")
    with op.batch_alter_table("cuenta", schema=None) as batch_op:
        batch_op.add_column(sa.Column("incluir_en_total", sa.Boolean(), nullable=False, server_default=sa.true()))
    crear_vistas(op.get_bind())


def downgrade() -> None:
    for nombre in VISTAS_SQL:
        op.execute(f"DROP VIEW IF EXISTS {nombre}")
    with op.batch_alter_table("cuenta", schema=None) as batch_op:
        batch_op.drop_column("incluir_en_total")
    crear_vistas(op.get_bind())
