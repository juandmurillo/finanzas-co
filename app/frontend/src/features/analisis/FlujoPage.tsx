/** Flujo de caja (RF-RP-02, fase 8 punto 12) con la estructura del resumen «All Spending» de Cashew:
 * periodo con ‹ ›, columna «Actual» (totales que llevan a sus movimientos, gráfico acumulado y desglose por
 * categorías de gasto o ingreso) y columna «Historial» (una tarjeta por mes, toca una para verla). */
import { rutaSuave } from "@/shared/lib/curvas";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { CategoriaReporte } from "@/shared/api/tipos";
import { api, type Periodo } from "@/shared/lib/api";
import { abreviar, fechaCorta, formatoCOP, hoyISO, moverMes, nombreMes, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Icono, iconoCategoria, type NombreIcono } from "@/shared/ui/Icono";
import { SensorContinuo, TooltipGrafico, ZonaGrafico } from "@/shared/ui/TooltipGrafico";

import { BotonExcel, ControlPeriodo, usePeriodo, type NavPeriodo } from "./Periodo";

const SERIES = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;

function etiquetaPeriodo(p: Periodo): string {
  if (!p.desde || !p.hasta) return "todo el historial";
  return p.desde === p.hasta
    ? nombreMes(p.desde)
    : `${nombreMes(p.desde, true)} – ${nombreMes(p.hasta, true)} ${p.hasta.slice(0, 4)}`;
}

// ---------- Totales ----------
function FilaTotal({
  icono,
  texto,
  valor,
  color,
  nota,
  a,
  grupo,
}: {
  icono: NombreIcono;
  texto: string;
  valor: number;
  color?: string;
  nota?: string;
  a: "/movimientos" | "/recurrentes" | "/prestamos";
  grupo?: string;
}) {
  return (
    <li>
      <Link to={a} search={grupo ? { grupo } : undefined} className="flujo-total" title={nota}>
        <span className="flujo-total-rotulo">
          <span className="cd-kpi-ico">
            <Icono nombre={icono} pequeno />
          </span>
          {texto}
        </span>
        <b className="cd-num" style={{ color }}>
          {formatoCOP(valor)}
        </b>
      </Link>
    </li>
  );
}

function Totales({ periodo }: { periodo: Periodo }) {
  const mensual = useQuery({ queryKey: claves.reporteMensual(periodo), queryFn: () => api.reporteMensual(periodo) });
  const cal = useQuery({ queryKey: claves.calendario(30), queryFn: () => api.calendario(30) });
  const prestamos = useQuery({ queryKey: ["prestamos", "resumen"], queryFn: api.resumenPrestamos });
  const t = mensual.data?.totales;
  if (mensual.isPending) return <TarjetaCargando filas={4} />;
  if (mensual.isError) return <ErrorVista error={mensual.error} reintentar={() => void mensual.refetch()} />;
  const gasto = t?.gastos_total ?? 0;
  const ingreso = t?.ingresos_total ?? 0;
  const neto = ingreso - gasto;
  const proximos = (cal.data?.eventos ?? []).filter((e) => e.monto < 0);
  const vencidos = (cal.data?.vencidos ?? []).filter((e) => e.monto < 0);
  return (
    <section className="cd-card cd-stack" style={{ gap: 10 }}>
      <span className="cd-kpi-label">Resumen de {etiquetaPeriodo(periodo)}</span>
      <ul className="flujo-totales">
        <FilaTotal
          icono="flujo"
          texto="Neto"
          nota="Ingresos menos gastos"
          valor={neto}
          color={neto < 0 ? "var(--negative)" : "var(--positive)"}
          a="/movimientos"
        />
        <FilaTotal icono="sale" texto="Gastos" valor={gasto} a="/movimientos" />
        <FilaTotal
          icono="entra"
          texto="Ingresos"
          valor={ingreso}
          color="var(--positive)"
          a="/movimientos"
          grupo="ingreso"
        />
        {prestamos.data && (prestamos.data.me_deben > 0 || prestamos.data.debo > 0) && (
          <>
            <FilaTotal
              icono="persona"
              texto="Me deben"
              nota="préstamos a personas"
              valor={prestamos.data.me_deben}
              a="/prestamos"
            />
            <FilaTotal
              icono="persona"
              texto="Debo"
              nota="préstamos de personas"
              valor={prestamos.data.debo}
              a="/prestamos"
            />
          </>
        )}
        <FilaTotal
          icono="calendario"
          texto="Próximos"
          nota={`${proximos.length} pagos en 30 días`}
          valor={-proximos.reduce((s, e) => s + e.monto, 0)}
          a="/recurrentes"
        />
        <FilaTotal
          icono="alerta"
          texto="Vencidos"
          nota={vencidos.length ? `${vencidos.length} sin registrar` : "al día"}
          valor={-vencidos.reduce((s, e) => s + e.monto, 0)}
          color={vencidos.length ? "var(--negative)" : undefined}
          a="/recurrentes"
        />
      </ul>
      {t && (
        <span className="cd-delta-note cd-num">
          Con créditos y préstamos (neto de caja): {formatoCOP(t.flujo_neto, { signo: true })}
        </span>
      )}
    </section>
  );
}

// ---------- Gráfico de ingresos, gastos y neto ----------
const LINEAS = [
  { clave: "ingreso", texto: "Ingresos", color: "var(--positive)" },
  { clave: "gasto", texto: "Gastos", color: "var(--negative)" },
  { clave: "neto", texto: "Neto", color: "var(--ink)" },
] as const;

function GraficoFlujo({ periodo }: { periodo: Periodo }) {
  const datos = useQuery({
    queryKey: ["reportes", "calor", periodo.desde, periodo.hasta],
    queryFn: () => api.calor(periodo),
  });
  const [cfg, setCfg] = useFiltroRecordado("flujo-grafico", {
    acumulado: true,
    ingreso: true,
    gasto: true,
    neto: false,
  });
  const [activo, setActivo] = useState<number | null>(null);
  const dias = datos.data?.dias ?? [];
  if (datos.isPending) return <TarjetaCargando filas={3} />;
  if (dias.length < 2) return null;
  // Sin acumular, un periodo largo se lee mejor por meses.
  const porMes = !cfg.acumulado && dias.length > 62;
  const base = porMes
    ? [
        ...dias
          .reduce((m, d) => {
            const k = d.fecha.slice(0, 7);
            const v = m.get(k) ?? { fecha: `${k}-01`, gasto: 0, ingreso: 0 };
            return m.set(k, { ...v, gasto: v.gasto + d.gasto, ingreso: v.ingreso + d.ingreso });
          }, new Map<string, { fecha: string; gasto: number; ingreso: number }>())
          .values(),
      ]
    : dias.map((d) => ({ fecha: d.fecha, gasto: d.gasto, ingreso: d.ingreso }));
  const serie = base.reduce<{ fecha: string; gasto: number; ingreso: number; neto: number }[]>((acc, d) => {
    const previo = cfg.acumulado ? acc.at(-1) : undefined;
    const gasto = (previo?.gasto ?? 0) + d.gasto;
    const ingreso = (previo?.ingreso ?? 0) + d.ingreso;
    acc.push({ fecha: d.fecha, gasto, ingreso, neto: ingreso - gasto });
    return acc;
  }, []);
  const visibles = LINEAS.filter((l) => cfg[l.clave]);
  const valores = serie.flatMap((p) => visibles.map((l) => p[l.clave]));
  const max = Math.max(1, ...valores);
  const min = Math.min(0, ...valores);
  const W = 640;
  const tiempos = serie.map((p) => Date.parse(p.fecha));
  const t0 = tiempos[0] ?? 0;
  const tramo = Math.max(1, (tiempos.at(-1) ?? 0) - t0);
  const xs = tiempos.map((t) => 48 + ((t - t0) / tramo) * (W - 58));
  const y = (v: number) => 175 - ((v - min) / Math.max(1, max - min)) * 155;
  const linea = (k: "gasto" | "ingreso" | "neto") =>
    rutaSuave(serie.map((p, i): [number, number] => [xs[i] ?? 0, y(p[k])]));
  const p0 = activo !== null ? serie[activo] : undefined;
  const cada = Math.max(1, Math.ceil(serie.length / 6));
  const etiqueta = (f: string) => (porMes ? nombreMes(f.slice(0, 7), true) : fechaCorta(f));
  return (
    <section className="cd-card cd-stack" style={{ gap: 10 }}>
      <div className="cd-card-head" style={{ margin: 0, flexWrap: "wrap", gap: 8 }}>
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Forma de sumar">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              role="radio"
              aria-checked={cfg.acumulado === v}
              aria-selected={cfg.acumulado === v}
              onClick={() => {
                setActivo(null);
                setCfg((c) => ({ ...c, acumulado: v }));
              }}
            >
              {v ? "Acumulado" : porMes || dias.length > 62 ? "Por mes" : "Por día"}
            </button>
          ))}
        </div>
        <div className="cd-row" style={{ gap: 6 }}>
          {LINEAS.map((l) => (
            <button
              key={l.clave}
              type="button"
              className="cd-btn cd-btn--sm selector-chip"
              aria-pressed={cfg[l.clave]}
              // Siempre queda al menos una línea a la vista.
              disabled={cfg[l.clave] && visibles.length === 1}
              onClick={() => setCfg((c) => ({ ...c, [l.clave]: !c[l.clave] }))}
            >
              <i className="cd-sw" style={{ background: l.color }} />
              {l.texto}
            </button>
          ))}
        </div>
      </div>
      <ZonaGrafico>
        <svg className="cd-chart" viewBox={`0 0 ${W} 200`} role="img" aria-label="Ingresos, gastos y neto en el tiempo">
          <line className="grid" x1="44" x2={W} y1={y(max)} y2={y(max)} />
          <text x="40" y={y(max) + 4} textAnchor="end">
            {abreviar(max)}
          </text>
          <line className="grid-dash" x1="44" x2={W} y1={y(0)} y2={y(0)} />
          <text x="40" y={y(0) + 4} textAnchor="end">
            0
          </text>
          {min < 0 && (
            <text x="40" y={y(min) + 4} textAnchor="end">
              {abreviar(min)}
            </text>
          )}
          {visibles.map((l) => (
            <path key={l.clave} d={linea(l.clave)} fill="none" stroke={l.color} strokeWidth="2.5" />
          ))}
          {serie.map((p, i) =>
            i % cada === 0 ? (
              <text key={p.fecha} x={xs[i]} y="194" textAnchor={i === 0 ? "start" : "middle"}>
                {etiqueta(p.fecha)}
              </text>
            ) : null,
          )}
          {p0 &&
            activo !== null &&
            visibles.map((l) => <circle key={l.clave} cx={xs[activo]} cy={y(p0[l.clave])} r="4.5" fill={l.color} />)}
          <SensorContinuo
            xs={xs}
            izquierda={44}
            ancho={W - 44}
            arriba={10}
            alto={178}
            activo={activo}
            alCambiar={setActivo}
          />
        </svg>
        {p0 && activo !== null && (
          <TooltipGrafico izquierda={((xs[activo] ?? 0) / W) * 100}>
            <b style={{ textTransform: "capitalize" }}>
              {porMes ? nombreMes(p0.fecha.slice(0, 7)) : fechaCorta(p0.fecha, true)}
            </b>
            {visibles.map((l) => (
              <span key={l.clave} className="fila">
                <span>
                  <i className="punto" style={{ background: l.color }} />
                  {l.texto}
                </span>
                {formatoCOP(p0[l.clave], l.clave === "neto" ? { signo: true } : undefined)}
              </span>
            ))}
          </TooltipGrafico>
        )}
      </ZonaGrafico>
    </section>
  );
}

// ---------- Desglose por categorías ----------
function Desglose({ periodo }: { periodo: Periodo }) {
  const [vista, setVista] = useFiltroRecordado("flujo-desglose", { tipo: "gasto" as "gasto" | "ingreso", subs: false });
  const grupo = vista.tipo === "gasto" ? "gasto_vida" : "ingreso";
  const conjunto = vista.tipo === "gasto" ? "gastos" : "ingresos";
  const datos = useQuery({
    queryKey: claves.reporteCategorias(periodo, conjunto),
    queryFn: () => api.reporteConjunto(periodo, conjunto),
  });
  const [activo, setActivo] = useState<number | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const filas: CategoriaReporte[] = (datos.data?.categorias ?? []).filter((c) => c.total > 0);
  const total = filas.reduce((t, c) => t + c.total, 0);
  const R = 70;
  const C = 2 * Math.PI * R;
  const inicios = filas.map((_, i) => filas.slice(0, i).reduce((t, f) => t + (total ? (f.total / total) * C : 0), 0));
  const sel = activo !== null ? filas[activo] : undefined;
  const alternar = (c: string) =>
    setAbiertas((a) => {
      const n = new Set(a);
      if (n.has(c)) n.delete(c);
      else n.add(c);
      return n;
    });
  return (
    <section className="cd-card cd-stack" style={{ gap: 14 }}>
      <div className="cd-card-head" style={{ margin: 0, flexWrap: "wrap", gap: 8 }}>
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Tipo">
          {(["gasto", "ingreso"] as const).map((t) => (
            <button
              key={t}
              role="radio"
              aria-checked={vista.tipo === t}
              aria-selected={vista.tipo === t}
              onClick={() => {
                setActivo(null);
                setVista((v) => ({ ...v, tipo: t }));
              }}
            >
              {t === "gasto" ? "Gastos" : "Ingresos"}
            </button>
          ))}
        </div>
        <label className="cd-row cd-delta-note" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={vista.subs}
            onChange={(e) => setVista((v) => ({ ...v, subs: e.target.checked }))}
          />
          Mostrar todas las subcategorías
        </label>
      </div>
      {datos.isPending && <TarjetaCargando filas={4} />}
      {datos.data && filas.length === 0 && <Vacio titulo="Sin movimientos en este periodo" />}
      {filas.length > 0 && (
        <div className="flujo-desglose">
          <div className="cd-donut-wrap" style={{ alignSelf: "start", justifySelf: "center" }}>
            <svg
              className="cd-chart dona-animada"
              viewBox="0 0 160 160"
              key={`${vista.tipo}-${periodo.desde}-${periodo.hasta}`}
              width="180"
              height="180"
              role="img"
              aria-label="Composición por categoría"
              onMouseLeave={() => setActivo(null)}
            >
              <circle className="ring-track" cx="80" cy="80" r={R} fill="none" strokeWidth="20" />
              {filas.map((f, i) => (
                <circle
                  key={f.categoria}
                  className={SERIES[i % SERIES.length]}
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  strokeWidth={activo === i ? 26 : 20}
                  strokeDasharray={`${Math.max(0, (total ? (f.total / total) * C : 0) - 2)} ${C}`}
                  strokeDashoffset={-(inicios[i] ?? 0)}
                  transform="rotate(-90 80 80)"
                  style={{
                    opacity: activo !== null && activo !== i ? 0.3 : i >= SERIES.length ? 0.65 : 1,
                    cursor: "pointer",
                  }}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => setActivo((a) => (a === i ? null : i))}
                />
              ))}
            </svg>
            <div className="cd-donut-center" aria-live="polite">
              <small>{sel ? sel.categoria : vista.tipo === "gasto" ? "Gastos" : "Ingresos"}</small>
              <strong>{formatoCOP(sel ? sel.total : total)}</strong>
              {sel && <small>{porcentaje(sel.total / total, 0)}</small>}
            </div>
          </div>
          <ul className="cd-list" style={{ margin: 0 }} onMouseLeave={() => setActivo(null)}>
            {filas.map((f, i) => {
              const abierta = vista.subs || abiertas.has(f.categoria);
              return (
                <li
                  key={f.categoria}
                  className="cd-stack"
                  style={{ gap: 4, alignItems: "stretch", opacity: activo !== null && activo !== i ? 0.5 : 1 }}
                >
                  <button
                    type="button"
                    className="fila-boton cd-row"
                    style={{ gap: 10, flexWrap: "nowrap", padding: "6px 4px" }}
                    aria-expanded={abierta}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => alternar(f.categoria)}
                  >
                    <i className={`cd-sw ${SERIES[i % SERIES.length]}`} />
                    <Icono nombre={iconoCategoria([f.categoria], grupo)} pequeno />
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{f.categoria}</span>
                    <span className="cd-delta-note cd-num">{porcentaje(f.pct, 0)}</span>
                    <b className="cd-num">{formatoCOP(f.total)}</b>
                    <span className="cd-delta-note" aria-hidden>
                      {f.subcategorias.length ? (abierta ? "▾" : "▸") : ""}
                    </span>
                  </button>
                  {abierta && f.subcategorias.length > 0 && (
                    <ul className="flujo-subcategorias">
                      {f.subcategorias.map((s) => (
                        <li key={s.subcategoria}>
                          <span>{s.subcategoria}</span>
                          <span className="cd-delta-note cd-num">{porcentaje(s.pct_categoria, 0)}</span>
                          <span className="cd-num">{formatoCOP(s.total)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <Link className="cd-link" to="/categorias" search={{ grupo }} style={{ alignSelf: "flex-end" }}>
        Ver análisis por categoría →
      </Link>
    </section>
  );
}

// ---------- Historial ----------
function Historial({ nav }: { nav: NavPeriodo }) {
  const [ajuste, setAjuste] = useFiltroRecordado("flujo-historial", { cuantos: 8, acumulado: false });
  const hoy = hoyISO().slice(0, 7);
  const periodo = { desde: moverMes(hoy, -(ajuste.cuantos - 1)), hasta: hoy };
  const datos = useQuery({ queryKey: claves.reporteMensual(periodo), queryFn: () => api.reporteMensual(periodo) });
  const meses = [...(datos.data?.meses ?? [])];
  const conAcumulado = meses.reduce<{ m: (typeof meses)[number]; neto: number; acumulado: number }[]>((acc, m) => {
    const neto = m.ingresos_total - m.gastos_total;
    acc.push({ m, neto, acumulado: (acc.at(-1)?.acumulado ?? 0) + neto });
    return acc;
  }, []);
  const elegido =
    nav.preset === "rango" && nav.periodo.desde === nav.periodo.hasta
      ? nav.periodo.desde
      : nav.preset === "mes" && nav.pasos === 0
        ? hoy
        : null;
  return (
    <section className="cd-card cd-stack" style={{ gap: 10 }}>
      <div className="cd-card-head" style={{ margin: 0 }}>
        <h3 className="cd-card-title">Historial</h3>
        <label className="cd-row cd-delta-note" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={ajuste.acumulado}
            onChange={(e) => setAjuste((a) => ({ ...a, acumulado: e.target.checked }))}
          />
          Neto acumulado
        </label>
      </div>
      {datos.isPending && <TarjetaCargando filas={4} />}
      <div className="cd-stack" style={{ gap: 8 }}>
        {[...conAcumulado].reverse().map(({ m, neto, acumulado }) => {
          const valor = ajuste.acumulado ? acumulado : neto;
          return (
            <button
              key={m.mes}
              type="button"
              className={`flujo-mes ${elegido === m.mes ? "activo" : ""}`}
              onClick={() => nav.setRango(m.mes, m.mes)}
            >
              <span className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                <b style={{ textTransform: "capitalize" }}>{nombreMes(m.mes)}</b>
                <b className="cd-num" style={{ color: valor < 0 ? "var(--negative)" : "var(--positive)" }}>
                  {formatoCOP(valor, { signo: true })}
                </b>
              </span>
              <span className="cd-row cd-delta-note cd-num" style={{ gap: 12 }}>
                <span>↓ {formatoCOP(m.gastos_total)}</span>
                <span style={{ color: "var(--positive)" }}>↑ {formatoCOP(m.ingresos_total)}</span>
              </span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="cd-btn cd-btn--ghost cd-btn--sm"
        onClick={() => setAjuste((a) => ({ ...a, cuantos: a.cuantos + 8 }))}
      >
        Cargar más meses
      </button>
    </section>
  );
}

export function FlujoPage() {
  const nav = usePeriodo("mes", "flujo");
  const [pestana, setPestana] = useState<"actual" | "historial">("actual");
  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Flujo de caja</h1>
          <p>Cuánto entró, cuánto salió y en qué, en el periodo que elijas. Sin transferencias entre tus cuentas.</p>
        </div>
        <div className="cd-row">
          <ControlPeriodo nav={nav} />
          <BotonExcel periodo={nav.periodo} />
        </div>
      </div>
      <div className="cd-seg flujo-pestanas" role="tablist" aria-label="Vista">
        {(["actual", "historial"] as const).map((p) => (
          <button key={p} role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)}>
            {p === "actual" ? "Actual" : "Historial"}
          </button>
        ))}
      </div>
      <div className="cd-bento">
        <div className={`span-8 cd-stack flujo-col ${pestana === "actual" ? "visible" : ""}`} style={{ gap: 24 }}>
          <Totales periodo={nav.periodo} />
          <GraficoFlujo periodo={nav.periodo} />
          <Desglose periodo={nav.periodo} />
        </div>
        <div className={`span-4 flujo-col ${pestana === "historial" ? "visible" : ""}`} style={{ alignSelf: "start" }}>
          <Historial nav={nav} />
        </div>
      </div>
    </>
  );
}
