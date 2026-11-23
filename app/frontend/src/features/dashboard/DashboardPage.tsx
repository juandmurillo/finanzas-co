/** Inicio (sistema compacto, docs/sistema/10_SISTEMA_DISENO_COMPACTO.md §6): saldo con acciones rápidas, seis
 * KPIs compactos con variación frente al mes anterior, flujo de caja en dos tonos, próximos pagos (primero lo
 * vencido), hallazgos del mes, distribución de gastos e ingresos, saldo en el tiempo, mapa de calor y
 * movimientos recientes. Cada gráfico recuerda su periodo. */
import { useSistema } from "@/shared/lib/useSistema";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useCaptura } from "@/features/captura";
import { TablaMovimientos } from "@/features/transacciones";
import type { Dashboard } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { BarrasAgrupadas } from "@/shared/charts";
import { fechaCorta, formatoCOP, hoyISO, nombreMes, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { DiasRestantes } from "@/shared/ui/DiasRestantes";
import { ListaDensa } from "@/shared/ui/Datos";
import { Icono } from "@/shared/ui/Icono";
import { IconoCategoria, tonosCategoria, useEstiloCategorias } from "@/shared/ui/EstiloCategoria";
import { useDesvanecido } from "@/shared/lib/useDesvanecido";
import { CarruselInsight } from "@/shared/ui/CarruselInsight";
import { CabeceraTarjeta, KpiCompacto } from "@/shared/ui/Kpi";
import { LogoCuenta } from "@/shared/ui/SelectorCuenta";

import { ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";

import { CategoriasMes } from "./components/CategoriasMes";
import { GastoDiario } from "./components/GastoDiario";
import { MapaCalor } from "./components/MapaCalor";
import "./inicio.css";
import { SaldoPatrimonio } from "./components/SaldoPatrimonio";

import { ZonaPeriodo } from "@/features/analisis/ZonaPeriodo";
import { keepPreviousData } from "@tanstack/react-query";
/** Cuotas de deuda de los próximos 30 días que el saldo no alcanza a cubrir. */
function faltanteCuotas(d: Dashboard): { faltante: number; cuotas: number } {
  return { cuotas: d.cuotas_proximas, faltante: Math.max(0, d.cuotas_proximas - d.saldo_total) };
}

const pagos = (n: number) => `${n} ${n === 1 ? "pago" : "pagos"}`;

/** Flujo de caja del Inicio: ingresos y gastos por mes en dos tonos, con periodo recordado. */
function FlujoInicio() {
  const nav = usePeriodo("12m", "inicio-flujo");
  const mensual = useQuery({
    queryKey: claves.reporteMensual(nav.periodo),
    queryFn: () => api.reporteMensual(nav.periodo),
    placeholderData: keepPreviousData,
  });
  const meses = mensual.data?.meses ?? [];
  return (
    <section className="cd-card span-8">
      <CabeceraTarjeta
        titulo="Flujo de caja"
        rango="Ingresos y gastos por mes"
        rangoSoloEscritorio
        accion={<ControlPeriodo nav={nav} opciones={["6m", "12m", "todo", "rango"]} />}
      />
      {mensual.isError && <ErrorVista error={mensual.error} reintentar={() => void mensual.refetch()} />}
      {mensual.isPending && <TarjetaCargando filas={3} />}
      {mensual.data && (
        <ZonaPeriodo nav={nav} cargando={mensual.isPlaceholderData}>
          <BarrasAgrupadas
            titulo="Ingresos y gastos por mes"
            etiquetas={meses.map((m) => nombreMes(m.mes, true))}
            detalles={meses.map((m) => nombreMes(m.mes))}
            series={[
              { nombre: "Ingresos", color: "var(--chart-1)", valores: meses.map((m) => m.ingresos_total) },
              {
                nombre: "Gastos",
                color: "color-mix(in srgb, var(--chart-1) 40%, var(--card))",
                valores: meses.map((m) => m.gastos_total),
              },
            ]}
            alto={220}
            relativo
            desvanecer
          />
        </ZonaPeriodo>
      )}
      <Link to="/flujo" className="cd-link" style={{ marginTop: 8 }}>
        Ver flujo de caja →
      </Link>
    </section>
  );
}

/** Hallazgos del mes calculados con los datos de Inicio (nada inventado: si falta el dato, no se dice). */
function hallazgos(
  d: Dashboard,
  enCamino: { total: number; n: number },
  promedio: (k: "ingresos_total" | "gastos_total") => number,
): { frase: string; cifra: string }[] {
  const salida: { frase: string; cifra: string }[] = [];
  const m = d.mes_actual;
  const mes = nombreMes(d.mes).split(" ")[0];
  const promGastos = promedio("gastos_total");
  if (m && promGastos > 0)
    salida.push({
      frase: `En ${mes} llevas gastado el {cifra} de lo que gastas en un mes promedio.`,
      cifra: porcentaje(m.gastos_total / promGastos, 0),
    });
  const promIngresos = promedio("ingresos_total");
  if (m && promIngresos > 0)
    salida.push({
      frase: `Tus ingresos de ${mes} van en el {cifra} de tu promedio mensual.`,
      cifra: porcentaje(m.ingresos_total / promIngresos, 0),
    });
  if (enCamino.n > 0)
    salida.push({
      frase: `En los próximos 30 días salen {cifra} en ${pagos(enCamino.n)} programados.`,
      cifra: formatoCOP(enCamino.total),
    });
  return salida;
}

/** Parte del mes ya transcurrida (1 si el mes ya terminó). */
function fraccionDelMes(mes: string): number {
  const hoy = hoyISO();
  if (hoy.slice(0, 7) !== mes) return 1;
  const [a, m] = mes.split("-").map(Number);
  const dias = new Date(a ?? 2000, m ?? 1, 0).getDate();
  return Number(hoy.slice(8, 10)) / dias;
}

/** Variación frente a una referencia; null si no hay con qué comparar. */
function variacion(actual: number | undefined, anterior: number | undefined): number | null {
  if (actual === undefined || !anterior) return null;
  return (actual - anterior) / Math.abs(anterior);
}

export function DashboardPage() {
  const filaKpis1 = useDesvanecido<HTMLDivElement>();
  const filaKpis2 = useDesvanecido<HTMLDivElement>();
  const { abrir, abrirMovimiento } = useCaptura();
  const estiloCat = useEstiloCategorias();
  const dash = useQuery({ queryKey: claves.dashboard, queryFn: api.dashboard });
  const sistema = useSistema();
  const cal = useQuery({ queryKey: claves.calendario(30), queryFn: () => api.calendario(30) });
  const recientes = useQuery({
    queryKey: claves.transacciones({ estado: "confirmada", limite: 7 }),
    queryFn: () => api.transacciones({ estado: "confirmada", limite: 7 }),
  });

  if (dash.isPending) {
    return (
      <div className="cd-bento">
        <div className="span-4">
          <TarjetaCargando />
        </div>
        <div className="span-8">
          <TarjetaCargando />
        </div>
      </div>
    );
  }
  if (dash.isError) return <ErrorVista error={dash.error} reintentar={() => void dash.refetch()} />;

  const d = dash.data;
  const mesActual = d.mes_actual;
  const promedio = (k: "ingresos_total" | "gastos_total") =>
    d.flujo.length ? d.flujo.reduce((t, m) => t + m[k], 0) / d.flujo.length : 0;
  const { cuotas, faltante } = faltanteCuotas(d);
  const mesCorto = nombreMes(d.mes).split(" ")[0];
  const incluidas = d.cuentas.filter((c) => c.incluir_en_total);
  const eventos = (cal.data?.eventos ?? []).filter((e) => e.monto < 0);
  const enCamino = { total: -eventos.reduce((t, e) => t + e.monto, 0), n: eventos.length };
  const vencidos = (cal.data?.vencidos ?? []).filter((e) => e.monto < 0);
  const vencido = { total: -vencidos.reduce((t, e) => t + e.monto, 0), n: vencidos.length };
  const idsVencidos = new Set(vencidos.map((e) => e.id));
  const proximos = d.proximos_pagos.filter((p) => !idsVencidos.has(p.id)).slice(0, 5);
  const flujoMes = mesActual?.flujo_operativo ?? 0;
  // El mes en curso va a medias: se compara con el ritmo promedio a la fecha, no con un mes completo.
  const avanceMes = fraccionDelMes(d.mes);
  const dIngresos = variacion(mesActual?.ingresos_total, promedio("ingresos_total") * avanceMes);
  const dGastos = variacion(mesActual?.gastos_total, promedio("gastos_total") * avanceMes);
  const notaRitmo = avanceMes < 1 ? "vs ritmo promedio" : "vs promedio";
  const lista = hallazgos(d, enCamino, promedio);

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>{sistema.data?.nombre ? `Hola, ${sistema.data.nombre}` : "Hola"}</h1>
          <p>Así van tus finanzas en {nombreMes(d.mes)}.</p>
        </div>
      </div>

      {faltante > 0 && (
        <div
          role="alert"
          className="cd-row"
          style={{
            justifyContent: "space-between",
            padding: "16px 20px",
            borderRadius: "var(--radius-lg)",
            background: "var(--negative-soft)",
            color: "var(--negative)",
          }}
        >
          <div className="cd-row" style={{ alignItems: "flex-start", flexWrap: "nowrap" }}>
            <Icono nombre="alerta" />
            <div className="cd-stack" style={{ gap: 2 }}>
              <b style={{ fontSize: 15 }}>Te faltan {formatoCOP(faltante)} para las próximas cuotas</b>
              <span style={{ fontSize: 13, fontWeight: 500, color: "var(--ink-muted)" }}>
                Pagas {formatoCOP(cuotas)} en créditos y hoy tienes {formatoCOP(d.saldo_total)}.
              </span>
            </div>
          </div>
          <div className="cd-row" style={{ gap: 8 }}>
            <Link
              to="/deudas"
              className="cd-btn cd-btn--sm"
              style={{ background: "var(--negative)", color: "var(--card)", textDecoration: "none" }}
            >
              Ver deudas
            </Link>
            <button className="cd-btn cd-btn--sm cd-btn--secondary" onClick={() => abrir("ingreso")}>
              Registrar ingreso
            </button>
          </div>
        </div>
      )}

      <div className="cd-bento">
        <section className="cd-balance inicio-saldo span-4" aria-labelledby="inicio-saldo">
          <div className="cd-balance-top">
            <span id="inicio-saldo" className="cd-balance-label">
              Saldo disponible
            </span>
            <Link to="/cuentas" className="cd-chip-glass inicio-saldo-cuentas">
              {incluidas.length} cuentas →
            </Link>
          </div>
          <div className="cd-balance-value">
            <Dinero centavos={d.saldo_total} />
          </div>
          <ul className="inicio-cuentas">
            {incluidas.slice(0, 4).map((c) => (
              <li key={c.id}>
                <LogoCuenta cuenta={c} tam={18} />
                <span>{c.nombre}</span>
                <b className="cd-num">{formatoCOP(c.saldo)}</b>
              </li>
            ))}
          </ul>
          <div className="inicio-acciones">
            <button className="cd-btn cd-btn--sm" onClick={() => abrir("gasto")}>
              <Icono nombre="sale" pequeno /> Gasto
            </button>
            <button className="cd-btn cd-btn--sm" onClick={() => abrir("ingreso")}>
              <Icono nombre="entra" pequeno /> Ingreso
            </button>
            <button className="cd-btn cd-btn--sm" onClick={() => abrir("transferencia")}>
              <Icono nombre="movimientos" pequeno /> Transferir
            </button>
          </div>
        </section>

        <div className="span-8 inicio-kpis">
          <div
            ref={filaKpis1}
            className="inicio-kpis-fila desvanece-lados"
            role="group"
            aria-label="Ingresos, gastos y flujo del mes"
          >
            <KpiCompacto
              etiqueta="Ingresos"
              icono="entra"
              valor={mesActual?.ingresos_total ?? 0}
              delta={
                dIngresos === null ? undefined : { valor: dIngresos, sentido: dIngresos > 0 ? "mejora" : "neutro" }
              }
              nota={notaRitmo}
              pie={{ texto: `Promedio ${formatoCOP(promedio("ingresos_total"))}/mes`, a: "/flujo" }}
            />
            <KpiCompacto
              etiqueta="Gastos"
              icono="sale"
              valor={mesActual?.gastos_total ?? 0}
              delta={dGastos === null ? undefined : { valor: dGastos }}
              nota={notaRitmo}
              pie={{ texto: `Promedio ${formatoCOP(promedio("gastos_total"))}/mes`, a: "/flujo" }}
            />
            <KpiCompacto
              etiqueta={`Flujo de ${mesCorto}`}
              icono="flujo"
              valor={flujoMes}
              delta={{
                valor: 0,
                sentido: flujoMes < 0 ? "alerta" : "mejora",
                texto: flujoMes < 0 ? "Déficit" : "Superávit",
              }}
              pie={{ texto: "Ver flujo de caja", a: "/flujo" }}
            />
          </div>
          <div
            ref={filaKpis2}
            className="inicio-kpis-fila desvanece-lados"
            role="group"
            aria-label="Pendientes y deuda"
          >
            <KpiCompacto
              etiqueta="Vencido"
              icono="alerta"
              valor={vencido.total}
              cargando={cal.isPending}
              delta={
                cal.isSuccess
                  ? vencido.n
                    ? { valor: 0, sentido: "alerta", texto: `${pagos(vencido.n)} sin registrar` }
                    : { valor: 0, sentido: "mejora", texto: "Al día" }
                  : undefined
              }
              nota={cal.isError ? "No se pudo consultar" : undefined}
              pie={{ texto: "Ver recurrentes", a: "/recurrentes" }}
            />
            <KpiCompacto
              etiqueta="En camino"
              icono="calendario"
              valor={enCamino.total}
              cargando={cal.isPending}
              nota={`${pagos(enCamino.n)} en 30 días`}
              pie={{ texto: "Ver calendario", a: "/recurrentes" }}
            />
            <KpiCompacto
              etiqueta="Deuda"
              icono="deudas"
              valor={d.deuda_total}
              nota={`${formatoCOP(d.cuotas_mes)}/mes`}
              pie={{
                texto: `${d.creditos.length} ${d.creditos.length === 1 ? "crédito" : "créditos"}`,
                a: "/deudas",
              }}
            />
          </div>
        </div>

        <FlujoInicio />
        <section className="cd-card span-4 inicio-proximos">
          <CabeceraTarjeta
            titulo="Próximos pagos"
            rango={vencidos.length ? `${pagos(vencidos.length)} vencidos primero` : "Próximos 30 días"}
            accion={
              <Link className="cd-link" to="/recurrentes">
                Ver todo →
              </Link>
            }
          />
          <ListaDensa
            etiqueta="Próximos pagos"
            vacio="No tienes pagos programados."
            max={40}
            filas={[
              ...vencidos.map((e) => ({
                clave: `vencido-${e.tipo}-${e.id}`,
                titulo: e.descripcion || e.categoria_ruta?.at(-1) || "Pago",
                detalle: `${fechaCorta(e.fecha)}${e.cuenta ? ` · ${e.cuenta}` : ""}`,
                inicio: (
                  <span className="inicio-ico inicio-ico--alerta">
                    <Icono nombre="alerta" pequeno />
                  </span>
                ),
                fin: <MontoConDias monto={e.monto} dias={e.dias} />,
                alElegir: e.tipo === "programada" ? () => abrirMovimiento(e.id) : undefined,
              })),
              ...proximos.map((p) => ({
                clave: p.id,
                titulo: p.descripcion || p.categoria_ruta.at(-1) || "Pago",
                detalle: `${fechaCorta(p.fecha)} · ${p.cuenta}`,
                inicio: (
                  <span className="inicio-ico" style={tonosCategoria(estiloCat({ ruta: p.categoria_ruta }))}>
                    <IconoCategoria
                      estilo={estiloCat({ ruta: p.categoria_ruta })}
                      ruta={p.categoria_ruta}
                      grupo={p.grupo}
                      tam={16}
                    />
                  </span>
                ),
                fin: <MontoConDias monto={p.monto} dias={p.dias} />,
                alElegir: () => abrirMovimiento(p),
              })),
            ]}
          />
        </section>

        <div className="span-4 inicio-columna">
          {lista.length > 0 && <CarruselInsight items={lista} chip="Este mes" />}
          <GastoDiario />
        </div>
        <div className="span-8">
          <CategoriasMes />
        </div>

        <SaldoPatrimonio patrimonio={d.patrimonio} />
        <MapaCalor />

        <section className="cd-card span-12">
          <CabeceraTarjeta
            titulo="Movimientos recientes"
            accion={
              <Link className="cd-link" to="/movimientos">
                Ver todo →
              </Link>
            }
          />
          {recientes.isPending && <TarjetaCargando filas={5} />}
          {recientes.isError && <ErrorVista error={recientes.error} reintentar={() => void recientes.refetch()} />}
          {recientes.data && (
            <TablaMovimientos
              titulo="Movimientos recientes"
              items={recientes.data.items}
              vacio={{ titulo: "Aún no hay movimientos" }}
            />
          )}
        </section>
      </div>
    </>
  );
}

/** Monto de un pago con los días que faltan (o el retraso) debajo. */
function MontoConDias({ monto, dias }: { monto: number; dias: number }) {
  return (
    <span className="inicio-monto-dias">
      <b className="cd-num">{formatoCOP(Math.abs(monto))}</b>
      <DiasRestantes dias={dias} />
    </span>
  );
}
