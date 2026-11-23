"""categorías con color e ícono sugeridos donde no hay uno elegido

Revision ID: 0014
Revises: 0013
Create Date: 2026-11-22 18:00:00

"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

from finanzas.dominio.estilo_categorias import estilo_categoria, sugerir

revision: str = "0014"
down_revision: str | Sequence[str] | None = "0013"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    # Solo llena vacíos: lo que la persona ya eligió no cambia.
    bind = op.get_bind()
    filas = bind.execute(
        sa.text("SELECT id, padre_id, nivel, nombre, grupo, icono, color FROM categoria ORDER BY nivel, padre_id, id")
    ).all()
    usados: dict[int | None, set[str]] = {}
    for f in filas:
        if f.nivel == 2 and f.color:
            usados.setdefault(f.padre_id, set()).add(f.color)
    for f in filas:
        if f.nivel == 2:
            hermanas = usados.setdefault(f.padre_id, set())
            icono, color = estilo_categoria(f.nombre, f.grupo, hermanas)
            nuevo_icono = f.icono or icono
            nuevo_color = f.color or color
            hermanas.add(nuevo_color)
        elif f.nivel == 3:
            nuevo_icono = f.icono or sugerir(f.nombre, f.grupo)[0]
            nuevo_color = f.color
        else:
            continue
        if (nuevo_icono, nuevo_color) != (f.icono, f.color):
            bind.execute(
                sa.text("UPDATE categoria SET icono = :i, color = :c WHERE id = :id"),
                {"i": nuevo_icono, "c": nuevo_color, "id": f.id},
            )


def downgrade() -> None:
    # No se distinguen los sugeridos de los elegidos: se conservan.
    pass
