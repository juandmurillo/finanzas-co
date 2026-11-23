"""Créditos como subcategorías: Servicio de deuda › Créditos › {crédito}.

Antes cada crédito era una categoría (nivel 2) con «Abono a capital» debajo. Ahora hay una categoría general
«Créditos» y cada crédito es una subcategoría; los abonos a capital van en la subcategoría hermana
«Abono · {crédito}» (no caben debajo: la jerarquía tiene tres niveles). Otras subcategorías que tuviera un
crédito (p. ej. «Intereses» de importaciones) se funden en el crédito: sus movimientos, recurrentes,
presupuestos, metas y reglas pasan a él. Los montos no cambian; solo se reorganiza la clasificación.

Revision ID: 0012
Revises: 0011
"""

import json
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "0012"
down_revision: Union[str, Sequence[str], None] = "0011"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

CREDITOS = "Créditos"
ABONO_VIEJO = "Abono a capital"
PREFIJO_ABONO = "Abono · "

# Tablas con una columna categoria_id simple (se reasignan al fundir).
_REFERENCIAS = ("transaccion", "recurrente", "meta", "meta_objetivo")


def _fundir(con: sa.Connection, origen: int, destino: int) -> None:
    """Pasa todo lo que usa `origen` a `destino` y borra `origen`."""
    for tabla in _REFERENCIAS:
        con.execute(
            sa.text(f"UPDATE {tabla} SET categoria_id = :d WHERE categoria_id = :o"), {"d": destino, "o": origen}
        )
    # Presupuestos por grupo: la categoría es única; si el destino ya está en un grupo, se quita el origen.
    ya = con.execute(
        sa.text("SELECT 1 FROM presupuesto_grupo_categoria WHERE categoria_id = :d"), {"d": destino}
    ).first()
    if ya:
        con.execute(sa.text("DELETE FROM presupuesto_grupo_categoria WHERE categoria_id = :o"), {"o": origen})
    else:
        con.execute(
            sa.text("UPDATE presupuesto_grupo_categoria SET categoria_id = :d WHERE categoria_id = :o"),
            {"d": destino, "o": origen},
        )
    con.execute(sa.text("DELETE FROM presupuesto WHERE categoria_id = :o"), {"o": origen})
    for rid, acciones in con.execute(sa.text("SELECT id, acciones FROM regla")).all():
        datos = json.loads(acciones or "{}")
        if datos.get("categoria_id") == origen:
            datos["categoria_id"] = destino
            con.execute(
                sa.text("UPDATE regla SET acciones = :a WHERE id = :i"),
                {"a": json.dumps(datos, ensure_ascii=False), "i": rid},
            )
    con.execute(sa.text("DELETE FROM categoria WHERE id = :o"), {"o": origen})


def _hija(con: sa.Connection, padre: int, nombre: str) -> int | None:
    fila = con.execute(
        sa.text("SELECT id FROM categoria WHERE padre_id = :p AND nombre = :n"), {"p": padre, "n": nombre}
    ).first()
    return fila[0] if fila else None


def upgrade() -> None:
    con = op.get_bind()
    raiz = con.execute(
        sa.text("SELECT id FROM categoria WHERE nivel = 1 AND grupo = 'servicio_deuda' ORDER BY id LIMIT 1")
    ).first()
    if raiz is None:
        return
    raiz_id = raiz[0]
    # Es un crédito toda categoría de Servicio de deuda ligada a un crédito registrado, o que tenga
    # «Abono a capital» debajo (créditos importados o ya cerrados sin registro en `credito`).
    creditos = con.execute(
        sa.text(
            "SELECT c.id, c.nombre FROM categoria c "
            "WHERE c.nivel = 2 AND c.padre_id = :r AND c.nombre <> :g AND ("
            "  c.id IN (SELECT categoria_id FROM credito WHERE categoria_id IS NOT NULL)"
            "  OR EXISTS (SELECT 1 FROM categoria h WHERE h.padre_id = c.id AND h.nombre = :a)"
            ") ORDER BY c.id"
        ),
        {"r": raiz_id, "g": CREDITOS, "a": ABONO_VIEJO},
    ).all()
    if not creditos:
        return
    general = _hija(con, raiz_id, CREDITOS)
    if general is None:
        con.execute(
            sa.text(
                "INSERT INTO categoria (padre_id, nivel, nombre, grupo, es_fijo) "
                "VALUES (:p, 2, :n, 'servicio_deuda', 1)"
            ),
            {"p": raiz_id, "n": CREDITOS},
        )
        general = _hija(con, raiz_id, CREDITOS)
    assert general is not None

    for cat_id, nombre in creditos:
        hijas = con.execute(sa.text("SELECT id, nombre FROM categoria WHERE padre_id = :p"), {"p": cat_id}).all()
        for hija_id, hija_nombre in hijas:
            if hija_nombre == ABONO_VIEJO:
                nuevo = f"{PREFIJO_ABONO}{nombre}"[:80]
                existente = _hija(con, general, nuevo)
                if existente is not None:
                    _fundir(con, hija_id, existente)
                else:
                    con.execute(
                        sa.text("UPDATE categoria SET padre_id = :g, nombre = :n, nivel = 3 WHERE id = :i"),
                        {"g": general, "n": nuevo, "i": hija_id},
                    )
            else:
                _fundir(con, hija_id, cat_id)
        choque = _hija(con, general, nombre)
        if choque is not None and choque != cat_id:
            _fundir(con, choque, cat_id)
        con.execute(sa.text("UPDATE categoria SET padre_id = :g, nivel = 3 WHERE id = :i"), {"g": general, "i": cat_id})


def downgrade() -> None:
    con = op.get_bind()
    raiz = con.execute(
        sa.text("SELECT id FROM categoria WHERE nivel = 1 AND grupo = 'servicio_deuda' ORDER BY id LIMIT 1")
    ).first()
    if raiz is None:
        return
    general = _hija(con, raiz[0], CREDITOS)
    if general is None:
        return
    # Todo lo que cuelga de «Créditos» y no es un abono vuelve a ser categoría de Servicio de deuda.
    creditos = con.execute(
        sa.text("SELECT id, nombre FROM categoria WHERE padre_id = :g AND nombre NOT LIKE :p"),
        {"g": general, "p": f"{PREFIJO_ABONO}%"},
    ).all()
    for cat_id, nombre in creditos:
        con.execute(sa.text("UPDATE categoria SET padre_id = :r, nivel = 2 WHERE id = :i"), {"r": raiz[0], "i": cat_id})
        abono = _hija(con, general, f"{PREFIJO_ABONO}{nombre}"[:80])
        if abono is not None:
            con.execute(
                sa.text("UPDATE categoria SET padre_id = :c, nombre = :n, nivel = 3 WHERE id = :i"),
                {"c": cat_id, "n": ABONO_VIEJO, "i": abono},
            )
    restantes = con.execute(sa.text("SELECT COUNT(*) FROM categoria WHERE padre_id = :g"), {"g": general}).scalar()
    usada = con.execute(sa.text("SELECT COUNT(*) FROM transaccion WHERE categoria_id = :g"), {"g": general}).scalar()
    if not restantes and not usada:
        con.execute(sa.text("DELETE FROM categoria WHERE id = :g"), {"g": general})
