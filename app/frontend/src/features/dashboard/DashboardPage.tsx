/** Inicio: saldo disponible con seis indicadores compactos, flujo de caja con próximos pagos (primero lo
 * vencido), donas de gastos e ingresos, saldo en el tiempo, mapa de calor y movimientos recientes. Cada gráfico
 * recuerda su periodo. */
import { useSistema } from "@/shared/lib/useSistema";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { useCaptura } from "@/features/captura";
import { FilaMovimiento } from "@/features/transacciones";
import type { Dashboard } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, nombreMes } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { DiasRestantes } from "@/shared/ui/DiasRestantes";
import { Icono, iconoCategoria, type NombreIcono } from "@/shared/ui/Icono";
import { CuentaEtiqueta, LogoCuenta } from "@/shared/ui/SelectorCuenta";

import { ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";

import { DonaCategorias } from "./components/DonaCategorias";
import { FlujoCaja } from "./components/FlujoCaja";
import { MapaCalor } from "./components/MapaCalor";
import { ValorNeto } from "./components/ValorNeto";

/** Cuotas de deuda de los próximos 30 días que el saldo no alcanza a cubrir. */
function faltanteCuotas(d: Dashboard): { faltante: number; cuotas: number } {
  return { cuotas: d.cuotas_proximas, faltante: Math.max(0, d.cuotas_proximas - d.saldo_total) };
}

function Kpi({
  etiqueta,
  icono,
  valor,
  nota,
  negativo,
  a,
}: {
  etiqueta: string;
  icono: NombreIcono;
  valor: number;
  nota: string;
  /** Solo lo que pide atención va en rojo (gastar no es rojo). */
  negativo?: boolean;
  a: "/flujo" | "/deudas" | "/categorias" | "/recurrentes";
}) {
  return (
    <Link
      to={a}
      search={a === "/categorias" ? { grupo: "ingreso" } : undefined}
      className="cd-card cd-kpi kpi-compacta tarjeta-enlace span-3"
      aria-label={`${etiqueta}: ver detalle`}
    >
      <span className="cd-kpi-label">
        <span className="cd-kpi-ico">
          <Icono nombre={icono} pequeno />
        </span>
        {etiqueta}
      </span>
      <div className="cd-kpi-value" style={negativo ? { color: "var(--negative)" } : undefined}>
        <Dinero centavos={valor} />
      </div>
      <span className="cd-delta-note kpi-nota">{nota}</span>
    </Link>
  );
}

const pagos = (n: number) => `${n} ${n === 1 ? "pago" : "pagos"}`;

/** Flujo de caja del Inicio: 6 m, 12 m o todo, con ‹ › para ir a periodos anteriores. */
function FlujoInicio({ mes }: { mes: string }) {
  const nav = usePeriodo("12m", "inicio-flujo");
  const mensual = useQuery({
    queryKey: claves.reporteMensual(nav.periodo),
    queryFn: () => api.reporteMensual(nav.periodo),
  });
  return (
    <section className="cd-card span-8">
      <div className="cd-card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <Link to="/flujo" className="cd-card-title tarjeta-enlace-titulo">
          Flujo de caja →
        </Link>
        <ControlPeriodo nav={nav} opciones={["6m", "12m", "todo", "rango"]} />
      </div>
      {mensual.data ? <FlujoCaja meses={mensual.data.meses} activo={mes} /> : <TarjetaCargando filas={3} />}
    </section>
  );
}

export function DashboardPage() {
  const { abrir, abrirMovimiento } = useCaptura();
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
  const ingresoPromedio = d.flujo.length ? d.flujo.reduce((t, m) => t + m.ingresos, 0) / d.flujo.length : 0;
  const { cuotas, faltante } = faltanteCuotas(d);
  // Gastos del mes: vida + cuotas + lo perdido en apuestas (sin transferencias ni préstamos)
  const gastosMes = mesActual
    ? mesActual.gasto_vida + mesActual.servicio_deuda - Math.min(0, mesActual.apuestas_neto)
    : 0;
  const mesCorto = nombreMes(d.mes).split(" ")[0];
  const incluidas = d.cuentas.filter((c) => c.incluir_en_total);
  const eventos = (cal.data?.eventos ?? []).filter((e) => e.monto < 0);
  const enCamino = { total: -eventos.reduce((t, e) => t + e.monto, 0), n: eventos.length };
  const vencidos = (cal.data?.vencidos ?? []).filter((e) => e.monto < 0);
  const vencido = { total: -vencidos.reduce((t, e) => t + e.monto, 0), n: vencidos.length };
  const idsVencidos = new Set(vencidos.map((e) => e.id));
  const proximos = d.proximos_pagos.filter((p) => !idsVencidos.has(p.id)).slice(0, 5);

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
        <Link
          to="/cuentas"
          className="cd-balance inicio-saldo tarjeta-enlace span-3"
          aria-label="Saldo disponible: ver cuentas"
        >
          <div className="cd-balance-top">
            <span className="cd-balance-label">Saldo disponible</span>
            <span className="cd-chip-glass">{incluidas.length} cuentas</span>
          </div>
          <div className="cd-balance-value">
            <Dinero centavos={d.saldo_total} />
          </div>
          <ul className="inicio-cuentas">
            {incluidas.map((c) => (
              <li key={c.id}>
                <LogoCuenta cuenta={c} tam={18} />
                <span>{c.nombre}</span>
                <b className="cd-num">{formatoCOP(c.saldo)}</b>
              </li>
            ))}
          </ul>
        </Link>
        <Kpi
          etiqueta={`Ingreso de ${mesCorto}`}
          icono="entra"
          valor={mesActual?.ingresos ?? 0}
          nota={`Promedio ${formatoCOP(ingresoPromedio)}/mes`}
          a="/categorias"
        />
        <Kpi
          etiqueta="Vencido"
          icono="alerta"
          valor={vencido.total}
          negativo={vencido.n > 0}
          nota={vencido.n ? `${pagos(vencido.n)} sin registrar` : "Al día"}
          a="/recurrentes"
        />
        <Kpi
          etiqueta={`Flujo de ${mesCorto}`}
          icono="flujo"
          valor={mesActual?.flujo_operativo ?? 0}
          negativo={(mesActual?.flujo_operativo ?? 0) < 0}
          nota={(mesActual?.flujo_operativo ?? 0) < 0 ? "Déficit" : "Superávit"}
          a="/flujo"
        />
        <Kpi etiqueta={`Gasto de ${mesCorto}`} icono="sale" valor={gastosMes} nota="Vida y cuotas" a="/flujo" />
        <Kpi
          etiqueta="En camino"
          icono="calendario"
          valor={enCamino.total}
          nota={`${pagos(enCamino.n)} en 30 días`}
          a="/recurrentes"
        />
        <Kpi
          etiqueta="Deuda"
          icono="deudas"
          valor={d.deuda_total}
          nota={`${d.creditos.length} ${d.creditos.length === 1 ? "crédito" : "créditos"} · ${formatoCOP(d.cuotas_mes)}/mes`}
          a="/deudas"
        />

        <FlujoInicio mes={d.mes} />
        <section className="cd-card span-4">
          <div className="cd-card-head">
            <h3 className="cd-card-title">Próximos pagos</h3>
            <Link className="cd-link" to="/recurrentes">
              Ver todo →
            </Link>
          </div>
          {d.proximos_pagos.length || vencidos.length ? (
            <ul className="cd-list">
              {vencidos.map((e) => (
                <li key={`vencido-${e.tipo}-${e.id}`} style={{ padding: 0 }}>
                  <button
                    type="button"
                    className="fila-boton cd-row"
                    style={{ padding: "10px 8px", gap: 12, flexWrap: "nowrap" }}
                    disabled={e.tipo !== "programada"}
                    onClick={() => abrirMovimiento(e.id)}
                  >
                    <span
                      className="cd-avatar cd-avatar--sq"
                      style={{ background: "var(--negative-soft)", color: "var(--negative)" }}
                    >
                      <Icono nombre="alerta" />
                    </span>
                    <div className="grow">
                      {e.descripcion || e.categoria_ruta?.at(-1)}
                      <small>
                        {fechaCorta(e.fecha)}
                        {e.cuenta ? ` · ${e.cuenta}` : ""}
                      </small>
                    </div>
                    <span className="cd-stack" style={{ alignItems: "flex-end", gap: 4 }}>
                      <span className="cd-amt">{formatoCOP(Math.abs(e.monto))}</span>
                      <DiasRestantes dias={e.dias} />
                    </span>
                  </button>
                </li>
              ))}
              {proximos.map((p) => (
                <li key={p.id} style={{ padding: 0 }}>
                  <button
                    type="button"
                    className="fila-boton cd-row"
                    style={{ padding: "10px 8px", gap: 12, flexWrap: "nowrap" }}
                    onClick={() => abrirMovimiento(p)}
                  >
                    <span
                      className="cd-avatar cd-avatar--sq"
                      style={{ background: "var(--brand-soft)", color: "var(--on-brand-soft)" }}
                    >
                      <Icono nombre={iconoCategoria(p.categoria_ruta, p.grupo)} />
                    </span>
                    <div className="grow">
                      {p.descripcion || p.categoria_ruta.at(-1)}
                      <small>
                        {fechaCorta(p.fecha)} · <CuentaEtiqueta nombre={p.cuenta} id={p.cuenta_id} />
                      </small>
                    </div>
                    <span className="cd-stack" style={{ alignItems: "flex-end", gap: 4 }}>
                      <span className="cd-amt">{formatoCOP(Math.abs(p.monto))}</span>
                      <DiasRestantes dias={p.dias} />
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <Vacio titulo="No tienes pagos programados" />
          )}
        </section>

        <DonaCategorias tipo="gasto" />
        <DonaCategorias tipo="ingreso" />

        <ValorNeto />
        <MapaCalor />

        <section className="cd-card span-12">
          <div className="cd-card-head">
            <h3 className="cd-card-title">Movimientos recientes</h3>
            <Link className="cd-link" to="/movimientos">
              Ver todo →
            </Link>
          </div>
          {recientes.isPending && <TarjetaCargando filas={5} />}
          {recientes.isError && <ErrorVista error={recientes.error} reintentar={() => void recientes.refetch()} />}
          {recientes.data && (
            <ul className="cd-list">
              {recientes.data.items.map((tx) => (
                <FilaMovimiento key={tx.id} tx={tx} mostrarFecha />
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}
