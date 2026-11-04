"""DTO de la API. Todos los montos van en centavos (enteros)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class CuentaOut(BaseModel):
    id: int
    nombre: str
    tipo: str
    saldo: int
    institucion: str | None = None
    color: str | None = None
    icono: str | None = Field(default=None, description="Ruta del logo (/cuentas/x.svg) o nombre de ícono")
    incluir_en_total: bool = True
    saldo_inicial: int = 0


TipoCuenta = Literal["efectivo", "ahorro", "billetera", "tarjeta_credito", "inversion"]


class CuentaIn(BaseModel):
    nombre: str = Field(min_length=1, max_length=80)
    tipo: TipoCuenta = "billetera"
    institucion: str | None = Field(default=None, max_length=80)
    saldo_inicial: int = Field(default=0, description="Centavos: saldo el día que empiezas a registrarla")
    color: str | None = None
    icono: str | None = Field(default=None, max_length=40)
    incluir_en_total: bool = True


class CuentaCambios(BaseModel):
    """Edición parcial: solo cambia lo que se envía. El saldo nunca se edita (se registra un ajuste)."""

    nombre: str | None = Field(default=None, min_length=1, max_length=80)
    tipo: TipoCuenta | None = None
    institucion: str | None = Field(default=None, max_length=80)
    icono: str | None = Field(default=None, max_length=40)
    incluir_en_total: bool | None = None
    archivada: bool | None = None


class TransaccionIn(BaseModel):
    cuenta_id: int
    monto: int = Field(description="Centavos: positivo entra, negativo sale")
    categoria_id: int | None = None
    fecha: str | None = Field(default=None, description="YYYY-MM-DD o ISO; por defecto, ahora")
    descripcion: str = Field(default="", max_length=200)
    nota: str = ""
    estado: str = "confirmada"
    origen_categoria: Literal["usuario", "sugerida"] = Field(
        default="usuario", description="'sugerida' si la categoría es la que propuso el clasificador sin cambios"
    )
    moneda_original: Literal["COP", "USD"] | None = None
    monto_original: int | None = Field(default=None, description="Centavos de dólar, con signo")
    trm: float | None = Field(default=None, gt=0, description="COP por USD usada para convertir")


class TransaccionCambios(BaseModel):
    cuenta_id: int | None = None
    monto: int | None = None
    categoria_id: int | None = None
    fecha: str | None = None
    descripcion: str | None = Field(default=None, max_length=200)
    nota: str | None = None
    estado: str | None = None


class TransaccionOut(BaseModel):
    id: int
    moneda_original: str | None = None
    monto_original: int | None = None
    trm: float | None = None
    cuenta_id: int
    cuenta: str
    fecha: str
    monto: int
    categoria_id: int | None
    grupo: str | None
    categoria_ruta: list[str]
    descripcion: str
    nota: str
    estado: str
    contraparte: str | None
    transferencia_id: int | None
    credito_id: int | None = None
    prestamo_id: int | None = None
    recurrente_id: int | None = None
    etiquetas: list[str]


class PaginaTransacciones(BaseModel):
    items: list[TransaccionOut]
    siguiente: str | None


class TransferenciaIn(BaseModel):
    origen_id: int
    destino_id: int
    monto: int = Field(gt=0)
    fecha: str | None = None
    descripcion: str = "Transferencia"


class CategoriaNodo(BaseModel):
    id: int
    nombre: str
    nivel: int
    grupo: str
    es_fijo: bool
    icono: str | None = None
    color: str | None = None
    hijos: list[CategoriaNodo]


class ResultadoImportacionOut(BaseModel):
    filas_leidas: int
    creadas: int
    pendientes: int
    duplicadas: int
    omitidas: int
    transferencias_emparejadas: int
    archivo_repetido: bool
