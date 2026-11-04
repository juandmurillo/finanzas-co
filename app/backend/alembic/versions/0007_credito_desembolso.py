"""credito: movimiento de desembolso enlazado

Revision ID: 0007
Revises: 0006
Create Date: 2026-10-31 12:00:00

"""

from datetime import date
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

from finanzas.infra.db import VISTAS_SQL, crear_vistas


revision: str = "0007"
down_revision: Union[str, Sequence[str], None] = "0006"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    for nombre in VISTAS_SQL:
        op.execute(f"DROP VIEW IF EXISTS {nombre}")
    with op.batch_alter_table("credito", schema=None) as batch_op:
        batch_op.add_column(sa.Column("desembolso_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_credito_desembolso", "transaccion", ["desembolso_id"], ["id"], ondelete="SET NULL"
        )
    crear_vistas(op.get_bind())

    # Enlaza los desembolsos ya registrados (grupo financiación) con su crédito: mismo monto recibido
    # y fecha a 5 días o menos del desembolso. Cada movimiento se usa una sola vez.
    con = op.get_bind()
    usados: set[int] = set()
    creditos = con.execute(sa.text("SELECT id, monto_recibido, fecha_desembolso FROM credito")).all()
    for cid, recibido, fecha in creditos:
        candidatos = con.execute(
            sa.text(
                "SELECT t.id, t.fecha FROM transaccion t JOIN categoria c ON c.id = t.categoria_id "
                "WHERE c.grupo = 'financiacion' AND t.monto = :monto AND t.estado = 'confirmada'"
            ),
            {"monto": recibido},
        ).all()
        base = date.fromisoformat(fecha[:10])
        cercanos = sorted(
            (abs((date.fromisoformat(f[:10]) - base).days), tid)
            for tid, f in candidatos
            if tid not in usados and abs((date.fromisoformat(f[:10]) - base).days) <= 5
        )
        if cercanos:
            tid = cercanos[0][1]
            usados.add(tid)
            con.execute(sa.text("UPDATE credito SET desembolso_id = :t WHERE id = :c"), {"t": tid, "c": cid})


def downgrade() -> None:
    for nombre in VISTAS_SQL:
        op.execute(f"DROP VIEW IF EXISTS {nombre}")
    with op.batch_alter_table("credito", schema=None) as batch_op:
        batch_op.drop_constraint("fk_credito_desembolso", type_="foreignkey")
        batch_op.drop_column("desembolso_id")
    crear_vistas(op.get_bind())
