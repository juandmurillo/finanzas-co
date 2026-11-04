"""Modelos SQLAlchemy. Montos en centavos (INTEGER). Referencia: docs/sistema/03_MODELO_DATOS.sql."""

from __future__ import annotations

from sqlalchemy import CheckConstraint, ForeignKey, Index, Integer, String, Text, UniqueConstraint, text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from finanzas.infra.db import Base

TIPOS_CUENTA = ("efectivo", "ahorro", "billetera", "tarjeta_credito", "credito", "inversion", "por_cobrar", "por_pagar")
GRUPOS = (
    "ingreso",
    "gasto_vida",
    "servicio_deuda",
    "apuestas",
    "ahorro_inversion",
    "prestamos_personales",
    "financiacion",
    "transferencia",
    "ajuste",
)
ESTADOS_TX = ("confirmada", "pendiente", "por_revisar")


def _en(valores: tuple[str, ...]) -> str:
    return "(" + ",".join(f"'{v}'" for v in valores) + ")"


class Cuenta(Base):
    __tablename__ = "cuenta"
    __table_args__ = (CheckConstraint(f"tipo IN {_en(TIPOS_CUENTA)}", name="ck_cuenta_tipo"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(80), unique=True)
    tipo: Mapped[str] = mapped_column(String(20))
    institucion: Mapped[str | None] = mapped_column(String(80))
    moneda: Mapped[str] = mapped_column(String(3), default="COP")
    saldo_inicial: Mapped[int] = mapped_column(Integer, default=0)
    exenta_gmf: Mapped[bool] = mapped_column(default=False)
    color: Mapped[str | None] = mapped_column(String(20))
    icono: Mapped[str | None] = mapped_column(String(40))
    orden: Mapped[int] = mapped_column(default=0)
    archivado_en: Mapped[str | None] = mapped_column(String(40))
    incluir_en_total: Mapped[bool] = mapped_column(default=True, server_default="1")


class Categoria(Base):
    """Jerarquía: nivel 1 = grupo, 2 = categoría, 3 = subcategoría."""

    __tablename__ = "categoria"
    __table_args__ = (
        UniqueConstraint("padre_id", "nombre", name="uq_categoria_padre_nombre"),
        CheckConstraint("nivel IN (1,2,3)", name="ck_categoria_nivel"),
        CheckConstraint(f"grupo IN {_en(GRUPOS)}", name="ck_categoria_grupo"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    padre_id: Mapped[int | None] = mapped_column(ForeignKey("categoria.id", ondelete="RESTRICT"))
    nivel: Mapped[int]
    nombre: Mapped[str] = mapped_column(String(80))
    grupo: Mapped[str] = mapped_column(String(30))
    es_fijo: Mapped[bool] = mapped_column(default=False)
    color: Mapped[str | None] = mapped_column(String(20))
    icono: Mapped[str | None] = mapped_column(String(40))
    archivado_en: Mapped[str | None] = mapped_column(String(40))

    padre: Mapped[Categoria | None] = relationship(remote_side=[id])


class Contraparte(Base):
    __tablename__ = "contraparte"
    __table_args__ = (
        CheckConstraint("tipo IN ('cliente','persona','comercio','entidad')", name="ck_contraparte_tipo"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(80), unique=True)
    tipo: Mapped[str] = mapped_column(String(20))


class Importacion(Base):
    __tablename__ = "importacion"

    id: Mapped[int] = mapped_column(primary_key=True)
    origen: Mapped[str] = mapped_column(String(30))
    archivo: Mapped[str] = mapped_column(String(260))
    hash_archivo: Mapped[str] = mapped_column(String(64), unique=True)
    filas_leidas: Mapped[int]
    filas_creadas: Mapped[int]
    duplicadas: Mapped[int]
    creado_en: Mapped[str] = mapped_column(String(40))


class Transaccion(Base):
    __tablename__ = "transaccion"
    __table_args__ = (
        CheckConstraint("monto <> 0", name="ck_tx_monto"),
        CheckConstraint(f"estado IN {_en(ESTADOS_TX)}", name="ck_tx_estado"),
        Index("ix_tx_fecha", "fecha"),
        Index("ix_tx_cuenta_fecha", "cuenta_id", "fecha"),
        Index("ix_tx_categoria", "categoria_id", "fecha"),
        Index("ux_tx_huella", "huella", unique=True, sqlite_where=text("huella IS NOT NULL")),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    cuenta_id: Mapped[int] = mapped_column(ForeignKey("cuenta.id"))
    fecha: Mapped[str] = mapped_column(String(40))
    monto: Mapped[int] = mapped_column(Integer)
    moneda_original: Mapped[str | None] = mapped_column(String(3))
    monto_original: Mapped[int | None] = mapped_column(Integer)
    trm: Mapped[float | None]
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("categoria.id"))
    descripcion: Mapped[str] = mapped_column(String(200), default="")
    nota: Mapped[str] = mapped_column(Text, default="")
    contraparte_id: Mapped[int | None] = mapped_column(ForeignKey("contraparte.id"))
    estado: Mapped[str] = mapped_column(String(20), default="confirmada")
    transferencia_id: Mapped[int | None] = mapped_column(ForeignKey("transaccion.id", ondelete="SET NULL"))
    credito_id: Mapped[int | None] = mapped_column(ForeignKey("credito.id"))
    prestamo_id: Mapped[int | None] = mapped_column(ForeignKey("prestamo_personal.id", ondelete="SET NULL"))
    recurrente_id: Mapped[int | None] = mapped_column(ForeignKey("recurrente.id", ondelete="SET NULL"))
    importacion_id: Mapped[int | None] = mapped_column(ForeignKey("importacion.id"))
    huella: Mapped[str | None] = mapped_column(String(64))
    origen_categoria: Mapped[str] = mapped_column(String(20), default="usuario")
    creado_en: Mapped[str] = mapped_column(String(40))
    actualizado_en: Mapped[str] = mapped_column(String(40))

    cuenta: Mapped[Cuenta] = relationship()
    categoria: Mapped[Categoria | None] = relationship()
    contraparte: Mapped[Contraparte | None] = relationship()
    etiquetas: Mapped[list[Etiqueta]] = relationship(secondary="transaccion_etiqueta")


class Etiqueta(Base):
    __tablename__ = "etiqueta"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(40), unique=True)
    color: Mapped[str | None] = mapped_column(String(20))


class TransaccionEtiqueta(Base):
    __tablename__ = "transaccion_etiqueta"

    transaccion_id: Mapped[int] = mapped_column(ForeignKey("transaccion.id", ondelete="CASCADE"), primary_key=True)
    etiqueta_id: Mapped[int] = mapped_column(ForeignKey("etiqueta.id", ondelete="CASCADE"), primary_key=True)


class Credito(Base):
    __tablename__ = "credito"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(40), unique=True)
    entidad: Mapped[str] = mapped_column(String(60))
    numero: Mapped[str | None] = mapped_column(String(40))
    cuenta_pago_id: Mapped[int | None] = mapped_column(ForeignKey("cuenta.id"))
    fecha_desembolso: Mapped[str] = mapped_column(String(40))
    capital_inicial: Mapped[int]
    monto_recibido: Mapped[int]
    tasa_ea: Mapped[float]
    tipo_tasa: Mapped[str] = mapped_column(String(10), default="fija")
    plazo_meses: Mapped[int]
    cuota: Mapped[int]
    seguro_mensual: Mapped[int] = mapped_column(default=0)
    dia_pago: Mapped[int]
    estado: Mapped[str] = mapped_column(String(20), default="activo")
    # Categoría «Servicio de deuda › {crédito}»: los movimientos ahí se ligan al crédito y recalculan su saldo.
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("categoria.id", ondelete="SET NULL"))
    # Movimiento de desembolso (grupo financiación): no es un pago, por eso no usa `transaccion.credito_id`.
    desembolso_id: Mapped[int | None] = mapped_column(
        ForeignKey("transaccion.id", ondelete="SET NULL", name="fk_credito_desembolso")
    )


class CreditoExtracto(Base):
    """El extracto del banco es la fuente de verdad del saldo de un crédito."""

    __tablename__ = "credito_extracto"
    __table_args__ = (UniqueConstraint("credito_id", "fecha_corte", name="uq_extracto_credito_fecha"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    credito_id: Mapped[int] = mapped_column(ForeignKey("credito.id", ondelete="CASCADE"))
    fecha_corte: Mapped[str] = mapped_column(String(40))
    saldo: Mapped[int]
    intereses: Mapped[int]
    abono_capital: Mapped[int]
    seguros: Mapped[int]
    cuotas_pendientes: Mapped[int]
    archivo: Mapped[str | None] = mapped_column(String(260))


class Parametro(Base):
    """Valores que cambian en el tiempo: UVT, usura, SMMLV, TRM."""

    __tablename__ = "parametro"

    clave: Mapped[str] = mapped_column(String(40), primary_key=True)
    vigencia_desde: Mapped[str] = mapped_column(String(10), primary_key=True)
    valor: Mapped[float]
    fuente: Mapped[str] = mapped_column(String(200))


class Auditoria(Base):
    __tablename__ = "auditoria"

    id: Mapped[int] = mapped_column(primary_key=True)
    entidad: Mapped[str] = mapped_column(String(40))
    entidad_id: Mapped[int]
    accion: Mapped[str] = mapped_column(String(10))
    antes: Mapped[str | None] = mapped_column(Text)
    despues: Mapped[str | None] = mapped_column(Text)
    fecha: Mapped[str] = mapped_column(String(40))


class Presupuesto(Base):
    """Asignado mensual por categoría (nivel 2 o 3). El gastado se calcula, no se guarda."""

    __tablename__ = "presupuesto"

    mes: Mapped[str] = mapped_column(String(7), primary_key=True)
    categoria_id: Mapped[int] = mapped_column(ForeignKey("categoria.id", ondelete="CASCADE"), primary_key=True)
    asignado: Mapped[int] = mapped_column(Integer, default=0)


class PrestamoPersonal(Base):
    """Préstamo informal de bajo monto (RF-PP). El capital se mueve contra cuentas por cobrar/pagar."""

    __tablename__ = "prestamo_personal"
    __table_args__ = (
        CheckConstraint("direccion IN ('presto_yo','me_prestaron')", name="ck_prestamo_direccion"),
        CheckConstraint("origen IN ('amigo','familia','companero','otra_fuente')", name="ck_prestamo_origen"),
        CheckConstraint("tipo_interes IN ('ninguno','fijo','simple_mensual')", name="ck_prestamo_interes"),
        CheckConstraint("plan IN ('fecha_unica','cuotas','libre')", name="ck_prestamo_plan"),
        CheckConstraint("estado IN ('activo','pagado','condonado')", name="ck_prestamo_estado"),
        CheckConstraint("monto > 0", name="ck_prestamo_monto"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    contraparte_id: Mapped[int] = mapped_column(ForeignKey("contraparte.id"))
    direccion: Mapped[str] = mapped_column(String(20))
    origen: Mapped[str] = mapped_column(String(20), default="amigo")
    monto: Mapped[int] = mapped_column(Integer)
    fecha: Mapped[str] = mapped_column(String(40))
    cuenta_id: Mapped[int] = mapped_column(ForeignKey("cuenta.id"))
    tipo_interes: Mapped[str] = mapped_column(String(20), default="ninguno")
    interes_total: Mapped[int] = mapped_column(Integer, default=0)
    tasa_mensual: Mapped[float | None]
    plan: Mapped[str] = mapped_column(String(20), default="fecha_unica")
    frecuencia: Mapped[str | None] = mapped_column(String(20))
    num_cuotas: Mapped[int | None]
    estado: Mapped[str] = mapped_column(String(20), default="activo")
    nota: Mapped[str] = mapped_column(Text, default="")
    creado_en: Mapped[str] = mapped_column(String(40))

    contraparte: Mapped[Contraparte] = relationship()
    cuotas: Mapped[list[PrestamoCuota]] = relationship(order_by="PrestamoCuota.numero", cascade="all, delete-orphan")


class PrestamoCuota(Base):
    __tablename__ = "prestamo_cuota"
    __table_args__ = (UniqueConstraint("prestamo_id", "numero", name="uq_prestamo_cuota"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    prestamo_id: Mapped[int] = mapped_column(ForeignKey("prestamo_personal.id", ondelete="CASCADE"))
    numero: Mapped[int]
    fecha: Mapped[str] = mapped_column(String(10))
    capital: Mapped[int]
    interes: Mapped[int] = mapped_column(default=0)


class Regla(Base):
    """Regla de categorización (RF-CA-04). Condiciones y acciones en JSON (ver dominio/reglas.py)."""

    __tablename__ = "regla"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(80))
    prioridad: Mapped[int] = mapped_column(default=100)
    condiciones: Mapped[str] = mapped_column(Text)
    acciones: Mapped[str] = mapped_column(Text)
    activa: Mapped[bool] = mapped_column(default=True)
    creado_en: Mapped[str] = mapped_column(String(40))


class Recurrente(Base):
    """Pago o ingreso que se repite (RF-RE). Sus ocurrencias se programan como transacciones pendientes."""

    __tablename__ = "recurrente"
    __table_args__ = (
        CheckConstraint("frecuencia IN ('semanal','quincenal','mensual','anual')", name="ck_recurrente_frecuencia"),
        CheckConstraint("monto <> 0", name="ck_recurrente_monto"),
        CheckConstraint("dia BETWEEN 1 AND 31", name="ck_recurrente_dia"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    cuenta_id: Mapped[int] = mapped_column(ForeignKey("cuenta.id"))
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("categoria.id", ondelete="SET NULL"))
    monto: Mapped[int] = mapped_column(Integer)
    frecuencia: Mapped[str] = mapped_column(String(20), default="mensual")
    dia: Mapped[int]
    inicio: Mapped[str] = mapped_column(String(10))
    fin: Mapped[str | None] = mapped_column(String(10))
    es_suscripcion: Mapped[bool] = mapped_column(default=False)
    activo: Mapped[bool] = mapped_column(default=True)  # False = en pausa (o cancelado si `cancelado_en`)
    cancelado_en: Mapped[str | None] = mapped_column(String(40))
    # 'calendario': cae en su día fijo · 'pago': el siguiente periodo empieza el día en que pagas (gimnasio, streaming)
    ancla: Mapped[str] = mapped_column(String(20), default="calendario")
    credito_id: Mapped[int | None] = mapped_column(ForeignKey("credito.id", ondelete="SET NULL"))
    nota: Mapped[str] = mapped_column(Text, default="")
    creado_en: Mapped[str] = mapped_column(String(40))

    cuenta: Mapped[Cuenta] = relationship()
    categoria: Mapped[Categoria | None] = relationship()


class Meta(Base):
    """Meta de ahorro, de deuda, tope de gasto mensual o hábito (RF-ME)."""

    __tablename__ = "meta"
    __table_args__ = (
        CheckConstraint("tipo IN ('ahorro','deuda','tope_gasto','habito')", name="ck_meta_tipo"),
        CheckConstraint("estado IN ('activa','cumplida','archivada')", name="ck_meta_estado"),
    )

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(120))
    tipo: Mapped[str] = mapped_column(String(20))
    objetivo: Mapped[int | None] = mapped_column(Integer)  # monto objetivo o tope (centavos)
    base: Mapped[int | None] = mapped_column(Integer)  # deuda al crear la meta, para medir el avance
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("categoria.id", ondelete="SET NULL"))
    cuenta_id: Mapped[int | None] = mapped_column(ForeignKey("cuenta.id", ondelete="SET NULL"))
    fecha_objetivo: Mapped[str | None] = mapped_column(String(10))
    estado: Mapped[str] = mapped_column(String(20), default="activa")
    creado_en: Mapped[str] = mapped_column(String(40))
    cumplida_en: Mapped[str | None] = mapped_column(String(40))

    categoria: Mapped[Categoria | None] = relationship()
    cuenta: Mapped[Cuenta | None] = relationship()


class CreditoPago(Base):
    """Desglose de un pago a un crédito (calculado: ver dominio/creditos.desglosar_pagos)."""

    __tablename__ = "credito_pago"
    __table_args__ = (CheckConstraint("tipo IN ('cuota','abono')", name="ck_credito_pago_tipo"),)

    transaccion_id: Mapped[int] = mapped_column(ForeignKey("transaccion.id", ondelete="CASCADE"), primary_key=True)
    credito_id: Mapped[int] = mapped_column(ForeignKey("credito.id", ondelete="CASCADE"))
    tipo: Mapped[str] = mapped_column(String(10), default="cuota")
    capital: Mapped[int] = mapped_column(Integer, default=0)
    interes: Mapped[int] = mapped_column(Integer, default=0)
    seguro: Mapped[int] = mapped_column(Integer, default=0)
    saldo_despues: Mapped[int] = mapped_column(Integer, default=0)


class HuellaFusionada(Base):
    """Huellas de importación de movimientos que se unieron con otro: al reimportar Cashew no reaparecen."""

    __tablename__ = "huella_fusionada"

    huella: Mapped[str] = mapped_column(String(64), primary_key=True)
    transaccion_id: Mapped[int | None] = mapped_column(ForeignKey("transaccion.id", ondelete="SET NULL"))


class PresupuestoGrupo(Base):
    """Un presupuesto con varias categorías (p. ej. «Hogar» = arriendo + servicios + internet)."""

    __tablename__ = "presupuesto_grupo"

    id: Mapped[int] = mapped_column(primary_key=True)
    nombre: Mapped[str] = mapped_column(String(80), unique=True)
    icono: Mapped[str | None] = mapped_column(String(40))
    color: Mapped[str | None] = mapped_column(String(20))
    es_fijo: Mapped[bool] = mapped_column(default=False)
    orden: Mapped[int] = mapped_column(default=0)

    categorias: Mapped[list[PresupuestoGrupoCategoria]] = relationship(cascade="all, delete-orphan")


class PresupuestoGrupoCategoria(Base):
    """Una categoría pertenece a un solo grupo, para no contar dos veces su gasto."""

    __tablename__ = "presupuesto_grupo_categoria"

    grupo_id: Mapped[int] = mapped_column(ForeignKey("presupuesto_grupo.id", ondelete="CASCADE"), primary_key=True)
    categoria_id: Mapped[int] = mapped_column(
        ForeignKey("categoria.id", ondelete="CASCADE"), primary_key=True, unique=True
    )


class PresupuestoGrupoMes(Base):
    __tablename__ = "presupuesto_grupo_mes"

    grupo_id: Mapped[int] = mapped_column(ForeignKey("presupuesto_grupo.id", ondelete="CASCADE"), primary_key=True)
    mes: Mapped[str] = mapped_column(String(7), primary_key=True)
    asignado: Mapped[int] = mapped_column(Integer, default=0)


class MetaObjetivo(Base):
    """Qué rastrea una meta: varias cuentas (ahorro) o varias categorías (tope, hábito)."""

    __tablename__ = "meta_objetivo"
    __table_args__ = (CheckConstraint("(cuenta_id IS NULL) <> (categoria_id IS NULL)", name="ck_meta_objetivo_uno"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    meta_id: Mapped[int] = mapped_column(ForeignKey("meta.id", ondelete="CASCADE"))
    cuenta_id: Mapped[int | None] = mapped_column(ForeignKey("cuenta.id", ondelete="CASCADE"))
    categoria_id: Mapped[int | None] = mapped_column(ForeignKey("categoria.id", ondelete="CASCADE"))


class RecurrenteOmision(Base):
    """Un periodo que el usuario decidió saltar: no se vuelve a programar (fase 8, punto 4)."""

    __tablename__ = "recurrente_omision"

    recurrente_id: Mapped[int] = mapped_column(ForeignKey("recurrente.id", ondelete="CASCADE"), primary_key=True)
    fecha: Mapped[str] = mapped_column(String(10), primary_key=True)
    creado_en: Mapped[str] = mapped_column(String(40))


class Preferencia(Base):
    """Ajustes de la persona: nombre, perfil para el asistente, módulos opcionales y si son datos demo."""

    __tablename__ = "preferencia"

    clave: Mapped[str] = mapped_column(String(40), primary_key=True)
    valor: Mapped[str] = mapped_column(Text)
