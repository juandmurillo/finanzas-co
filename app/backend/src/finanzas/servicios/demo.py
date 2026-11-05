"""Datos de demostración: 18 meses de una persona ficticia, generados con semilla fija y usando los mismos
servicios que la app, para que cuadren igual que los datos reales. Ningún dato es de una persona real."""

from __future__ import annotations

import random
from datetime import date, timedelta

from sqlalchemy import func, select

from finanzas.dominio.errores import Conflicto
from finanzas.dominio.eventos import DominioCambio
from finanzas.dominio.fechas import hoy_bogota
from finanzas.dominio.grupos import Grupo
from finanzas.infra.modelos import Cuenta, Recurrente, Transaccion
from finanzas.infra.repositorios import categoria_por_ruta
from finanzas.infra.uow import UnidadDeTrabajo
from finanzas.servicios import activos, creditos, metas, prestamos, presupuesto, recurrentes, sistema, transacciones

MESES = 18
SEMILLA = 2026
PESO = 100  # centavos


def _fecha(d: date, azar: random.Random) -> str:
    return f"{d.isoformat()}T{azar.randint(7, 21):02d}:{azar.randint(0, 59):02d}"


def _mes_atras(hoy: date, n: int) -> date:
    total = hoy.year * 12 + hoy.month - 1 - n
    return date(total // 12, total % 12 + 1, 1)


def generar(uow: UnidadDeTrabajo, hoy: date | None = None) -> dict[str, int]:
    """Llena una base sin cuentas. Con la misma fecha y semilla siempre produce lo mismo."""
    sesion = uow.sesion
    if sesion.scalar(select(func.count()).select_from(Cuenta)):
        raise Conflicto("Los datos de demostración solo se cargan en una instalación vacía")
    hoy = hoy or hoy_bogota()
    azar = random.Random(SEMILLA)
    sistema.asegurar_categorias(sesion)
    inicio = _mes_atras(hoy, MESES - 1)

    cuentas = {}
    for orden, (nombre, tipo, saldo) in enumerate(
        (
            ("Billetera digital", "billetera", 350_000),
            ("Cuenta de nómina", "ahorro", 900_000),
            ("Ahorros", "ahorro", 1_200_000),
            ("Efectivo", "efectivo", 80_000),
        )
    ):
        c = Cuenta(nombre=nombre, tipo=tipo, saldo_inicial=saldo * PESO, orden=orden)
        sesion.add(c)
        cuentas[nombre] = c
    sesion.flush()
    nomina, billetera, ahorros, efectivo = (
        cuentas["Cuenta de nómina"].id,
        cuentas["Billetera digital"].id,
        cuentas["Ahorros"].id,
        cuentas["Efectivo"].id,
    )

    def cat(grupo: Grupo, categoria: str, sub: str | None = None) -> int:
        return categoria_por_ruta(sesion, grupo, categoria, sub).id

    def mov(cuenta: int, monto: int, categoria: int, fecha: date, descripcion: str) -> None:
        if fecha > hoy:
            return
        transacciones.registrar(
            uow,
            transacciones.DatosTransaccion(cuenta, monto * PESO, categoria, _fecha(fecha, azar), descripcion),
        )

    # Dos créditos: uno caro de consumo y uno de moto, con sus cuotas programadas.
    desembolso_a = _mes_atras(hoy, 14).replace(day=10)
    credito_a = creditos.crear(
        uow,
        creditos.DatosCredito(
            nombre="Crédito de consumo",
            entidad="Banco Ejemplo",
            fecha_desembolso=desembolso_a.isoformat(),
            capital_inicial=6_000_000 * PESO,
            monto_recibido=5_800_000 * PESO,
            tasa_ea=0.26,
            plazo_meses=36,
            cuota=240_000 * PESO,
            dia_pago=10,
            seguro_mensual=6_000 * PESO,
            cuenta_pago_id=nomina,
            cuenta_desembolso_id=nomina,
        ),
    )
    desembolso_b = _mes_atras(hoy, 9).replace(day=20)
    credito_b = creditos.crear(
        uow,
        creditos.DatosCredito(
            nombre="Crédito de moto",
            entidad="Financiera Ejemplo",
            fecha_desembolso=desembolso_b.isoformat(),
            capital_inicial=9_000_000 * PESO,
            monto_recibido=9_000_000 * PESO,
            tasa_ea=0.19,
            plazo_meses=48,
            cuota=265_000 * PESO,
            dia_pago=20,
            cuenta_pago_id=nomina,
            cuenta_desembolso_id=nomina,
        ),
    )

    gastos = [
        (Grupo.GASTO_VIDA, "Comida", "Mercado", 8, 55_000, 140_000, "Mercado", billetera),
        (Grupo.GASTO_VIDA, "Comida", "Restaurantes", 6, 18_000, 55_000, "Almuerzo", billetera),
        (Grupo.GASTO_VIDA, "Transporte", "Taxi y apps", 6, 8_000, 28_000, "Taxi", billetera),
        (Grupo.GASTO_VIDA, "Transporte", "Gasolina", 3, 25_000, 45_000, "Gasolina", efectivo),
        (Grupo.GASTO_VIDA, "Relaciones sociales", "Salidas y celebraciones", 2, 40_000, 125_000, "Salida", billetera),
        (Grupo.GASTO_VIDA, "Compras", "Ropa", 1, 60_000, 180_000, "Ropa", billetera),
        (Grupo.GASTO_VIDA, "Salud", "Medicamentos", 1, 15_000, 60_000, "Farmacia", efectivo),
    ]

    for n in range(MESES - 1, -1, -1):
        primero = _mes_atras(hoy, n)
        indice = MESES - 1 - n
        # Ingresos: salario con aumento anual y proyectos independientes algunos meses.
        salario = 3_200_000 + (250_000 if primero.year > inicio.year else 0)
        mov(nomina, salario, cat(Grupo.INGRESO, "Salario"), primero, "Nómina")
        # Lo del mes pasa de la nómina a las cuentas de uso diario.
        for destino, monto_mes, texto_mes in (
            (billetera, 1_200_000, "Plata del mes"),
            (efectivo, 150_000, "Retiro de efectivo"),
        ):
            if primero.replace(day=2) <= hoy:
                transacciones.transferir(
                    uow, nomina, destino, monto_mes * PESO, _fecha(primero.replace(day=2), azar), texto_mes
                )
        if azar.random() < 0.55:
            monto = azar.randrange(400_000, 1_500_000, 50_000)
            dia = primero.replace(day=azar.randint(5, 24))
            mov(billetera, monto, cat(Grupo.INGRESO, "Trabajo independiente", "Proyectos"), dia, "Proyecto web")
        # Gastos variables.
        for grupo, categoria, sub, veces, minimo, maximo, texto, cuenta in gastos:
            for _ in range(azar.randint(max(1, veces - 2), veces + 1)):
                dia = primero.replace(day=azar.randint(1, 27))
                mov(cuenta, -azar.randrange(minimo, maximo, 1_000), cat(grupo, categoria, sub), dia, texto)
        # Fijos ya pagados de los meses anteriores.
        if primero < hoy.replace(day=1):
            hogar = cat(Grupo.GASTO_VIDA, "Hogar", "Arriendo")
            mov(nomina, -950_000, hogar, primero.replace(day=3), "Arriendo")
            mov(
                nomina,
                -azar.randrange(110_000, 170_000, 1_000),
                cat(Grupo.GASTO_VIDA, "Hogar", "Servicios públicos"),
                primero.replace(day=12),
                "Servicios públicos",
            )
            mov(
                nomina,
                -68_000,
                cat(Grupo.GASTO_VIDA, "Factura", "Internet hogar"),
                primero.replace(day=8),
                "Internet hogar",
            )
            mov(
                billetera,
                -39_000,
                cat(Grupo.GASTO_VIDA, "Factura", "Celular"),
                primero.replace(day=16),
                "Plan de celular",
            )
            mov(billetera, -25_000, cat(Grupo.GASTO_VIDA, "Factura", "Streaming"), primero.replace(day=5), "Streaming")
            mov(nomina, -90_000, cat(Grupo.GASTO_VIDA, "Salud física", "Gimnasio"), primero.replace(day=2), "Gimnasio")
            # Ahorro mensual.
            transacciones.transferir(
                uow, nomina, ahorros, 200_000 * PESO, _fecha(primero.replace(day=27), azar), "Ahorro del mes"
            )
            # Cuotas de los créditos ya desembolsados.
            if primero.replace(day=10) > desembolso_a:
                mov(nomina, -240_000, credito_a.categoria_id or 0, primero.replace(day=10), "Cuota Crédito de consumo")
            if primero.replace(day=20) > desembolso_b:
                mov(nomina, -265_000, credito_b.categoria_id or 0, primero.replace(day=20), "Cuota Crédito de moto")
        # Para qué se pidieron los créditos: un gasto grande el mes del desembolso.
        if primero == desembolso_a.replace(day=1):
            mov(nomina, -5_000_000, cat(Grupo.GASTO_VIDA, "Hogar"), desembolso_a, "Muebles y arreglos")
        if indice == 6:  # un abono extra a la deuda más cara
            abono = cat(Grupo.SERVICIO_DEUDA, credito_a.nombre, creditos.ABONO)
            mov(nomina, -400_000, abono, primero.replace(day=15), "Abono a capital")

    # Recurrentes: arrancan el mes siguiente al último pagado.
    siguiente = hoy.replace(day=1)
    for nombre, cuenta, monto, dia_cobro, categoria, sub, suscripcion in (
        ("Arriendo", nomina, 950_000, 3, "Hogar", "Arriendo", False),
        ("Servicios públicos", nomina, 140_000, 12, "Hogar", "Servicios públicos", False),
        ("Internet hogar", nomina, 68_000, 8, "Factura", "Internet hogar", False),
        ("Plan de celular", billetera, 39_000, 16, "Factura", "Celular", False),
        ("Streaming", billetera, 25_000, 5, "Factura", "Streaming", True),
        ("Gimnasio", nomina, 90_000, 2, "Salud física", "Gimnasio", True),
    ):
        recurrentes.crear(
            uow,
            recurrentes.DatosRecurrente(
                nombre=nombre,
                cuenta_id=cuenta,
                monto=-monto * PESO,
                frecuencia="mensual",
                dia=dia_cobro,
                inicio=siguiente.replace(day=dia_cobro).isoformat(),
                categoria_id=cat(Grupo.GASTO_VIDA, categoria, sub),
                es_suscripcion=suscripcion,
            ),
        )

    # Presupuestos vigentes desde hace 6 meses.
    desde = _mes_atras(hoy, 5).isoformat()[:7]
    for nombre, categorias, tope, fijo in (
        ("Hogar", [cat(Grupo.GASTO_VIDA, "Hogar")], 1_150_000, True),
        ("Comida", [cat(Grupo.GASTO_VIDA, "Comida")], 800_000, False),
        ("Transporte", [cat(Grupo.GASTO_VIDA, "Transporte")], 250_000, False),
        ("Facturas", [cat(Grupo.GASTO_VIDA, "Factura")], 140_000, True),
    ):
        grupo_p = presupuesto.crear_grupo(uow, presupuesto.DatosGrupo(nombre, categorias, es_fijo=fijo))
        presupuesto.asignar(uow, desde, grupo_p.id, tope * PESO)

    # Metas.
    metas.crear(
        uow,
        metas.DatosMeta(
            nombre="Fondo de emergencia",
            tipo="ahorro",
            objetivo=9_000_000 * PESO,
            cuenta_ids=[ahorros],
            fecha_objetivo=(hoy + timedelta(days=420)).isoformat(),
        ),
    )
    metas.crear(uow, metas.DatosMeta(nombre="Salir de deudas", tipo="deuda"))
    metas.crear(
        uow,
        metas.DatosMeta(
            nombre="Tope de salidas",
            tipo="tope_gasto",
            objetivo=250_000 * PESO,
            categoria_ids=[cat(Grupo.GASTO_VIDA, "Relaciones sociales")],
        ),
    )

    # Inversiones ficticias: el aporte sale de una cuenta, no es gasto.
    compra_cdt = _mes_atras(hoy, 8).replace(day=12).isoformat()
    activos.crear(
        uow,
        activos.DatosActivo(
            nombre="CDT a 360 días",
            clase="cdt",
            fecha_compra=compra_cdt,
            costo=1_500_000 * PESO,
            valor_actual=1_590_000 * PESO,
            cuenta_id=ahorros,
            tasa_ea=0.095,
            vencimiento=(_mes_atras(hoy, 8).replace(day=12) + timedelta(days=360)).isoformat(),
        ),
    )
    fondo = activos.crear(
        uow,
        activos.DatosActivo(
            nombre="Fondo de inversión colectiva",
            clase="fondo",
            fecha_compra=_mes_atras(hoy, 12).replace(day=5).isoformat(),
            costo=500_000 * PESO,
            valor_actual=540_000 * PESO,
            cuenta_id=nomina,
        ),
    )
    activos.mover(uow, fondo.id, "aporte", 300_000 * PESO, _mes_atras(hoy, 3).replace(day=5).isoformat(), nomina)
    activos.crear(
        uow,
        activos.DatosActivo(
            nombre="Moto",
            clase="vehiculo",
            fecha_compra=desembolso_b.isoformat(),
            costo=8_800_000 * PESO,
            valor_actual=7_400_000 * PESO,
            cuenta_id=nomina,
        ),
    )

    # Un préstamo a una persona ficticia, en dos cuotas.
    prestamos.crear(
        uow,
        prestamos.DatosPrestamo(
            direccion="presto_yo",
            persona="Persona de ejemplo",
            monto=300_000 * PESO,
            cuenta_id=billetera,
            fecha=(hoy - timedelta(days=20)).isoformat(),
            plan="cuotas",
            frecuencia="mensual",
            num_cuotas=2,
        ),
    )
    sistema.guardar(sesion, "es_demo", "1")
    uow.sesion.flush()
    recurrentes.programar_todos(uow, hoy)
    uow.registrar(DominioCambio(("sistema", "cuentas", "categorias", "dashboard", "transacciones"), "crear"))
    return {
        "movimientos": sesion.scalar(select(func.count()).select_from(Transaccion)) or 0,
        "recurrentes": sesion.scalar(select(func.count()).select_from(Recurrente)) or 0,
    }
