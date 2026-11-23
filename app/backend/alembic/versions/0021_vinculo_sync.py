"""Titular y receptor autorizados para el libro."""

from alembic import op

revision = "0021"
down_revision = "0020"


def upgrade() -> None:
    op.execute("CREATE TABLE vinculo_sync(libro TEXT PRIMARY KEY, titular TEXT NOT NULL, receptor TEXT NOT NULL)")


def downgrade() -> None:
    op.drop_table("vinculo_sync")
