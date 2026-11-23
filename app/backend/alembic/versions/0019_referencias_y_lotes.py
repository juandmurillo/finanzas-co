"""Referencias portables y lotes atómicos para la cola."""

from alembic import op

revision = "0019"
down_revision = "0018"


def upgrade() -> None:
    op.execute("ALTER TABLE libro ADD COLUMN lote_activo TEXT")
    op.execute("ALTER TABLE cambio_pendiente ADD COLUMN lote TEXT")
    op.execute("ALTER TABLE detalle_cambio ADD COLUMN antes_global TEXT")
    op.execute("ALTER TABLE detalle_cambio ADD COLUMN despues_global TEXT")
    op.execute("""CREATE TRIGGER asignar_lote AFTER INSERT ON cambio_pendiente
        WHEN EXISTS (SELECT 1 FROM libro) BEGIN
        UPDATE cambio_pendiente SET lote = COALESCE((SELECT lote_activo FROM libro), NEW.operacion),
        formato = 2 WHERE secuencia = NEW.secuencia;
        END""")
    for campo, destino in (
        ("cuenta_id", "cuenta"),
        ("categoria_id", "categoria"),
        ("padre_id", "categoria"),
        ("transferencia_id", "transaccion"),
    ):
        op.execute(f"""CREATE TRIGGER referencia_{campo} AFTER INSERT ON detalle_cambio
            WHEN NEW.campo = '{campo}' AND EXISTS (SELECT 1 FROM libro) BEGIN
            UPDATE detalle_cambio SET antes_global = (SELECT id_global FROM {destino} WHERE id = NEW.antes),
            despues_global = (SELECT id_global FROM {destino} WHERE id = NEW.despues)
            WHERE secuencia = NEW.secuencia AND campo = NEW.campo;
            END""")


def downgrade() -> None:
    for campo in ("cuenta_id", "categoria_id", "padre_id", "transferencia_id"):
        op.execute(f"DROP TRIGGER referencia_{campo}")
    op.execute("DROP TRIGGER asignar_lote")
    op.execute("UPDATE cambio_pendiente SET formato = 1 WHERE formato = 2")
    op.execute("ALTER TABLE detalle_cambio DROP COLUMN antes_global")
    op.execute("ALTER TABLE detalle_cambio DROP COLUMN despues_global")
    op.execute("ALTER TABLE cambio_pendiente DROP COLUMN lote")
    op.execute("ALTER TABLE libro DROP COLUMN lote_activo")
