"""Activos e inversiones: activo, valoraciones, movimientos y metas que rastrean activos.

Revision ID: 0011
Revises: 0010
"""

from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "0011"
down_revision: Union[str, Sequence[str], None] = "0010"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "activo",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("nombre", sa.String(120), nullable=False),
        sa.Column("clase", sa.String(30), nullable=False),
        sa.Column("moneda", sa.String(3), nullable=False, server_default="COP"),
        sa.Column("fecha_compra", sa.String(10), nullable=False),
        sa.Column("tasa_ea", sa.Float()),
        sa.Column("vencimiento", sa.String(10)),
        sa.Column("estado", sa.String(10), nullable=False, server_default="activo"),
        sa.Column("nota", sa.String(300), nullable=False, server_default=""),
        sa.Column("creado_en", sa.String(40), nullable=False),
        sa.CheckConstraint("estado IN ('activo','vendido')", name="ck_activo_estado"),
    )
    op.create_table(
        "activo_valoracion",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("activo_id", sa.Integer(), sa.ForeignKey("activo.id", ondelete="CASCADE"), nullable=False),
        sa.Column("fecha", sa.String(10), nullable=False),
        sa.Column("valor", sa.Integer(), nullable=False),
        sa.UniqueConstraint("activo_id", "fecha", name="ux_activo_valoracion_fecha"),
    )
    op.create_table(
        "activo_movimiento",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("activo_id", sa.Integer(), sa.ForeignKey("activo.id", ondelete="CASCADE"), nullable=False),
        sa.Column("tipo", sa.String(12), nullable=False),
        sa.Column("fecha", sa.String(10), nullable=False),
        sa.Column("monto", sa.Integer(), nullable=False),
        sa.Column("transaccion_id", sa.Integer(), sa.ForeignKey("transaccion.id", ondelete="CASCADE")),
        sa.Column("nota", sa.String(300), nullable=False, server_default=""),
        sa.CheckConstraint("tipo IN ('aporte','retiro','rendimiento','venta')", name="ck_activo_mov_tipo"),
        sa.CheckConstraint("monto > 0", name="ck_activo_mov_monto"),
    )
    with op.batch_alter_table("meta_objetivo", recreate="always") as lote:
        lote.drop_constraint("ck_meta_objetivo_uno", type_="check")
        lote.add_column(sa.Column("activo_id", sa.Integer()))
        lote.create_foreign_key("fk_meta_objetivo_activo", "activo", ["activo_id"], ["id"], ondelete="CASCADE")
        lote.create_check_constraint(
            "ck_meta_objetivo_uno",
            "(cuenta_id IS NOT NULL) + (categoria_id IS NOT NULL) + (activo_id IS NOT NULL) = 1",
        )


def downgrade() -> None:
    op.execute("DELETE FROM meta_objetivo WHERE activo_id IS NOT NULL")
    with op.batch_alter_table("meta_objetivo", recreate="always") as lote:
        lote.drop_constraint("ck_meta_objetivo_uno", type_="check")
        lote.drop_constraint("fk_meta_objetivo_activo", type_="foreignkey")
        lote.drop_column("activo_id")
        lote.create_check_constraint("ck_meta_objetivo_uno", "(cuenta_id IS NULL) <> (categoria_id IS NULL)")
    op.drop_table("activo_movimiento")
    op.drop_table("activo_valoracion")
    op.drop_table("activo")
