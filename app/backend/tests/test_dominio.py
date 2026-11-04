from hypothesis import given
from hypothesis import strategies as st

from finanzas.dominio.clasificacion import FilaCashew, PerfilClasificacion, clasificar
from finanzas.dominio.dinero import a_centavos, a_pesos, formato_cop
from finanzas.dominio.grupos import Grupo


def fila(
    monto: int, categoria: str, titulo: str = "", nota: str = "", sub: str = "", tipo: str = "default"
) -> FilaCashew:
    return FilaCashew("Nequi", monto, titulo, nota, categoria, sub, tipo)


def test_a_centavos_respeta_decimales_del_extracto() -> None:
    assert a_centavos("46951.18") == 4_695_118
    assert a_centavos("-72524.22") == -7_252_422
    assert a_centavos(286000) == 28_600_000


@given(st.integers(min_value=-(10**12), max_value=10**12))
def test_ida_y_vuelta_centavos_pesos(centavos: int) -> None:
    assert a_centavos(a_pesos(centavos)) == centavos


def test_formato_cop_es_co() -> None:
    assert formato_cop(483_679_028) == "$ 4.836.790"
    assert formato_cop(-2_500_000) == "- $ 25.000"
    assert formato_cop(5_000_000, signo=True) == "+ $ 50.000"
    assert formato_cop(123_456_789, decimales=True) == "$ 1.234.567,89"


def test_familia_es_ingreso_normal() -> None:
    perfil = PerfilClasificacion(fuentes_ingreso={"padre": ("Familia", "")})
    c = clasificar(fila(10_000_000, "Padre"), perfil)
    assert (c.grupo, c.categoria) == (Grupo.INGRESO, "Familia")
    assert clasificar(fila(10_000_000, "Padre")).categoria == "Otros ingresos"  # sin perfil, genérico


def test_transferencia_entre_cuentas() -> None:
    c = clasificar(
        fila(-5_000_000, "Corrección de equilibrio", "Transferir a", "Saldo transferido\nCuenta 1 → Cuenta 2")
    )
    assert c.grupo == Grupo.TRANSFERENCIA


def test_cuota_va_al_credito_del_perfil() -> None:
    perfil = PerfilClasificacion(acreedores=(("banco a 2", "Crédito A2"), ("banco a", "Crédito A1")))
    c = clasificar(fila(-5_000_000, "Prestamo", "Pago Banco A 2", tipo="repetitive"), perfil)
    assert (c.grupo, c.categoria, c.subcategoria) == (Grupo.SERVICIO_DEUDA, "Crédito A2", "Abono a capital")
    assert clasificar(fila(-5_000_000, "Prestamo", "Pago x", tipo="repetitive")).categoria == "Otro crédito"


def test_desembolso_no_es_ingreso() -> None:
    assert clasificar(fila(100_000_000, "Prestamo", "Initial Record")).grupo == Grupo.FINANCIACION


def test_subcategoria_derivada_de_descripcion() -> None:
    assert clasificar(fila(-8_000_000, "Factura", "Internet hogar del mes")).subcategoria == "Internet hogar"


def test_seguro_erroneo_queda_en_reclamo() -> None:
    c = clasificar(fila(-3_000_000, "Otros", nota="Error - seguro"), PerfilClasificacion(claves_reclamo=("seguro",)))
    assert "reclamo" in c.etiquetas
