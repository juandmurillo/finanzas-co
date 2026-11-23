"""Versión de partida y valores modificados en las operaciones del libro."""

from alembic import op

revision = "0018"
down_revision = "0017"

TABLAS = ("cuenta", "categoria", "transaccion")
EVENTOS = (
    ("INSERT", "crear", "NEW", "NEW.id_global IS NOT NULL"),
    ("UPDATE", "crear", "NEW", "OLD.id_global IS NULL AND NEW.id_global IS NOT NULL"),
    ("UPDATE", "editar", "NEW", "OLD.id_global IS NOT NULL"),
    ("DELETE", "eliminar", "OLD", "OLD.id_global IS NOT NULL"),
)


def _triggers(con_detalle: bool) -> None:
    for tabla in TABLAS:
        columnas = [
            fila[1]
            for fila in op.get_bind().exec_driver_sql(f"PRAGMA table_info({tabla})")
            if fila[1] not in ("id", "id_global")
        ]
        for evento, accion, fila, condicion in EVENTOS:
            nombre = f"cola_{tabla}_{evento}_{accion}"
            op.execute(f"DROP TRIGGER {nombre}")
            campos = "libro_id, entidad, entidad_id, accion"
            valores = f"id_global, '{tabla}', {fila}.id_global, '{accion}'"
            detalle = ""
            if con_detalle:
                campos += ", formato, version_base"
                base = (
                    "NULL"
                    if accion == "crear"
                    else f"""COALESCE((
                    SELECT operacion FROM cambio_pendiente WHERE libro_id = libro.id_global
                    AND entidad = '{tabla}' AND entidad_id = {fila}.id_global
                    ORDER BY secuencia DESC LIMIT 1), {fila}.id_global)"""
                )
                valores += f", 1, {base}"
                if accion == "editar":
                    diferencias = " OR ".join(f"OLD.{c} IS NOT NEW.{c}" for c in columnas)
                    condicion += f" AND ({diferencias})"
                filas = []
                for c in columnas:
                    antes = "NULL" if accion == "crear" else f"OLD.{c}"
                    despues = "NULL" if accion == "eliminar" else f"NEW.{c}"
                    filtro = f" WHERE {antes} IS NOT {despues}" if accion == "editar" else ""
                    filas.append(f"SELECT last_insert_rowid(), '{c}', {antes}, {despues}{filtro}")
                detalle = (
                    "INSERT INTO detalle_cambio (secuencia, campo, antes, despues) " + " UNION ALL ".join(filas) + ";"
                )
            op.execute(f"""CREATE TRIGGER {nombre} AFTER {evento} ON {tabla}
                WHEN ({condicion}) AND EXISTS (SELECT 1 FROM libro) BEGIN
                INSERT INTO cambio_pendiente ({campos}) SELECT {valores} FROM libro;
                {detalle}
                END""")


def upgrade() -> None:
    op.execute("ALTER TABLE cambio_pendiente ADD COLUMN formato INTEGER NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE cambio_pendiente ADD COLUMN version_base TEXT")
    op.execute("CREATE INDEX ix_cambio_version ON cambio_pendiente(libro_id, entidad, entidad_id, secuencia)")
    # Columnas sin afinidad para preservar números, texto y NULL tal como entraron en SQLite.
    op.execute("""CREATE TABLE detalle_cambio (
        secuencia INTEGER NOT NULL REFERENCES cambio_pendiente(secuencia) ON DELETE CASCADE,
        campo TEXT NOT NULL, antes, despues, PRIMARY KEY (secuencia, campo)
    ) WITHOUT ROWID""")
    _triggers(True)


def downgrade() -> None:
    _triggers(False)
    op.execute("DROP TABLE detalle_cambio")
    op.execute("DROP INDEX ix_cambio_version")
    op.execute("ALTER TABLE cambio_pendiente DROP COLUMN version_base")
    op.execute("ALTER TABLE cambio_pendiente DROP COLUMN formato")
