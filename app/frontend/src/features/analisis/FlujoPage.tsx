/** Flujo de caja (RF-RP-02, fase 8 punto 12) con la estructura del resumen «All Spending» de Cashew:
 * periodo con ‹ ›, columna «Actual» (totales que llevan a sus movimientos, gráfico acumulado y desglose por
 * categorías de gasto o ingreso) y columna «Historial» (una tarjeta por mes, toca una para verla). */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { rangoFechas } from "@/features/dashboard/components/CategoriasMes";
import { useState } from "react";

import type { CategoriaReporte } from "@/shared/api/tipos";
import { AreaSeries } from "@/shared/charts";
import { IconoCategoria, useEstiloCategorias } from "@/shared/ui/EstiloCategoria";
import { api, type Periodo } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, moverMes, nombreMes, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { CabeceraTarjeta, KpiCompacto } from "@/shared/ui/Kpi";

import { BotonExcel, ControlPeriodo, usePeriodo, type NavPeriodo } from "./Periodo";
import { BarraFiltros } from "@/shared/ui/BarraFiltros";

import { ZonaPeriodo } from "@/features/analisis/ZonaPeriodo";
function etiquetaPeriodo(p: Periodo): string {
  if (!p.desde || !p.hasta) return "todo el historial";
  return p.desde === p.hasta
    ? nombreMes(p.desde)
    : `${nombreMes(p.desde, true)} – ${nombreMes(p.hasta, true)} ${p.hasta.slice(0, 4)}`;
}

// ---------- Totales ----------
function Totales({ periodo }: { periodo: Periodo }) {
  const mensual = useQuery({ queryKey: claves.reporteMensual(periodo), queryFn: () => api.reporteMensual(periodo) });
  const cal = useQuery({ queryKey: claves.calendario(30), queryFn: () => api.calendario(30) });
  const prestamos = useQuery({ queryKey: ["prestamos", "resumen"], queryFn: api.resumenPrestamos });
  const t = mensual.data?.totales;
  if (mensual.isError) return <ErrorVista error={mensual.error} reintentar={() => void mensual.refetch()} />;
  const cargando = mensual.isPending;
  const gasto = t?.gastos_total ?? 0;
  const ingreso = t?.ingresos_total ?? 0;
  const neto = ingreso - gasto;
  const proximos = (cal.data?.eventos ?? []).filter((e) => e.monto < 0);
  const vencidos = (cal.data?.vencidos ?? []).filter((e) => e.monto < 0);
  const pr = prestamos.data;
  return (
    <div className="flujo-kpis" aria-label={`Resumen de ${etiquetaPeriodo(periodo)}`}>
      <KpiCompacto
        inversa
        etiqueta="Neto"
        icono="flujo"
        valor={neto}
        cargando={cargando}
        nota={t ? `con créditos y préstamos ${formatoCOP(t.flujo_neto, { signo: true })}` : undefined}
      />
      <KpiCompacto
        etiqueta="Ingresos"
        icono="entra"
        valor={ingreso}
        cargando={cargando}
        abrir="/movimientos"
        nota={etiquetaPeriodo(periodo)}
      />
      <KpiCompacto
        etiqueta="Gastos"
        icono="sale"
        valor={gasto}
        cargando={cargando}
        abrir="/movimientos"
        nota={ingreso > 0 ? `${porcentaje(gasto / ingreso, 0)} de lo que entró` : etiquetaPeriodo(periodo)}
      />
      <KpiCompacto
        etiqueta="Próximos 30 días"
        icono="calendario"
        valor={-proximos.reduce((t2, e) => t2 + e.monto, 0)}
        abrir="/recurrentes"
        delta={vencidos.length ? { valor: 0, sentido: "alerta", texto: `${vencidos.length} vencidos` } : undefined}
        nota={
          pr && (pr.me_deben > 0 || pr.debo > 0)
            ? `${proximos.length} pagos · te deben ${formatoCOP(pr.me_deben)}`
            : `${proximos.length} pagos programados`
        }
      />
    </div>
  );
}

// ---------- Gráfico de ingresos, gastos y neto ----------
const LINEAS = [
  { clave: "ingreso", texto: "Ingresos", color: "var(--positive)" },
  { clave: "gasto", texto: "Gastos", color: "var(--negative)" },
  { clave: "neto", texto: "Neto", color: "var(--ink)" },
] as const;

type Paso = "dia" | "semana" | "mes";

/** Lunes de la semana de `f` (AAAA-MM-DD). */
function lunes(f: string): string {
  const d = new Date(`${f.slice(0, 10)}T12:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

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
  const dias = datos.data?.dias ?? [];
  if (datos.isPending) return <TarjetaCargando filas={3} />;
  if (dias.length < 2) return null;
  // Sin acumular: por día hasta 2 meses, por semana hasta 13 meses y por mes en periodos más largos.
  const paso: Paso = cfg.acumulado || dias.length <= 62 ? "dia" : dias.length <= 400 ? "semana" : "mes";
  const clave = (f: string) => (paso === "dia" ? f.slice(0, 10) : paso === "semana" ? lunes(f) : `${f.slice(0, 7)}-01`);
  const base = [
    ...dias
      .reduce((m, d) => {
        const k = clave(d.fecha);
        const v = m.get(k) ?? { fecha: k, gasto: 0, ingreso: 0 };
        return m.set(k, { ...v, gasto: v.gasto + d.gasto, ingreso: v.ingreso + d.ingreso });
      }, new Map<string, { fecha: string; gasto: number; ingreso: number }>())
      .values(),
  ];
  const serie = base.reduce<{ fecha: string; gasto: number; ingreso: number; neto: number }[]>((acc, d) => {
    const previo = cfg.acumulado ? acc.at(-1) : undefined;
    const gasto = (previo?.gasto ?? 0) + d.gasto;
    const ingreso = (previo?.ingreso ?? 0) + d.ingreso;
    acc.push({ fecha: d.fecha, gasto, ingreso, neto: ingreso - gasto });
    return acc;
  }, []);
  const visibles = LINEAS.filter((l) => cfg[l.clave]);
  const nombrePaso = paso === "dia" ? "Por día" : paso === "semana" ? "Por semana" : "Por mes";
  const pasoSinAcumular = dias.length <= 62 ? "Por día" : dias.length <= 400 ? "Por semana" : "Por mes";
  const rotulo = (f: string) =>
    paso === "semana"
      ? `Semana del ${fechaCorta(f, true)}`
      : paso === "mes"
        ? nombreMes(f.slice(0, 7))
        : fechaCorta(f, true);
  return (
    <section className="cd-card cd-stack" style={{ gap: 10 }}>
      <CabeceraTarjeta
        titulo="Ingresos y gastos"
        rango={`${cfg.acumulado ? "Acumulado" : nombrePaso} · ${etiquetaPeriodo(periodo)}`}
      />
      <div className="cd-row" style={{ margin: 0, flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Forma de sumar">
          {[true, false].map((v) => (
            <button
              key={String(v)}
              role="radio"
              aria-checked={cfg.acumulado === v}
              aria-selected={cfg.acumulado === v}
              onClick={() => setCfg((c) => ({ ...c, acumulado: v }))}
            >
              {v ? "Acumulado" : pasoSinAcumular}
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
      <AreaSeries
        titulo="Ingresos, gastos y neto en el tiempo"
        fechas={serie.map((p) => p.fecha)}
        rotulo={rotulo}
        alto={260}
        series={visibles.map((l) => ({
          clave: l.clave,
          nombre: l.texto,
          color: l.color,
          valores: serie.map((p) => p[l.clave]),
          formato: l.clave === "neto" ? (v: number) => formatoCOP(v, { signo: true }) : undefined,
        }))}
      />
    </section>
  );
}

// ---------- Desglose por categorías ----------
interface Fila {
  id: number | null;
  nombre: string;
  categoria: string;
  total: number;
  subs: CategoriaReporte["subcategorias"];
}

function Desglose({ periodo }: { periodo: Periodo }) {
  const [vista, setVista] = useFiltroRecordado("flujo-desglose-v2", {
    tipo: "gasto" as "gasto" | "ingreso",
    nivel: "categoria" as "categoria" | "subcategoria",
  });
  const grupo = vista.tipo === "gasto" ? "gasto_vida" : "ingreso";
  const conjunto = vista.tipo === "gasto" ? "gastos" : "ingresos";
  const datos = useQuery({
    queryKey: claves.reporteCategorias(periodo, conjunto),
    queryFn: () => api.reporteConjunto(periodo, conjunto),
  });
  const estilo = useEstiloCategorias();
  const [activo, setActivo] = useState<number | null>(null);
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const categorias: CategoriaReporte[] = (datos.data?.categorias ?? []).filter((c) => c.total > 0);
  const total = categorias.reduce((t, c) => t + c.total, 0);
  const colorFila = (f: { id: number | null; nombre: string; categoria: string }) =>
    estilo({ id: f.id, ruta: [f.categoria, f.nombre] }).color;
  // Por subcategoría: cada una como si fuera categoría; lo que no tiene subcategoría queda con su categoría.
  const filas: Fila[] =
    vista.nivel === "categoria"
      ? categorias.map((c) => ({
          id: c.id ?? null,
          nombre: c.categoria,
          categoria: c.categoria,
          total: c.total,
          subs: c.subcategorias,
        }))
      : categorias
          .flatMap((c) => {
            const subs = c.subcategorias.map((x) => ({
              id: x.id ?? null,
              nombre: x.subcategoria,
              categoria: c.categoria,
              total: x.total,
              subs: [],
            }));
            const resto = c.total - c.subcategorias.reduce((t, x) => t + x.total, 0);
            return resto > 0
              ? [...subs, { id: c.id ?? null, nombre: c.categoria, categoria: c.categoria, total: resto, subs: [] }]
              : subs;
          })
          .filter((f) => f.total > 0)
          .sort((a, b) => b.total - a.total);
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
      <CabeceraTarjeta
        titulo={vista.tipo === "gasto" ? "En qué se fue" : "De dónde vino"}
        rango={`${filas.length} ${vista.nivel === "categoria" ? "categorías" : "subcategorías"} · ${formatoCOP(total)}`}
      />
      <div className="cd-row" style={{ margin: 0, flexWrap: "wrap", gap: 8, justifyContent: "space-between" }}>
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
        <div className="cd-seg" role="radiogroup" aria-label="Nivel">
          {(["categoria", "subcategoria"] as const).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={vista.nivel === n}
              aria-selected={vista.nivel === n}
              onClick={() => {
                setActivo(null);
                setVista((v) => ({ ...v, nivel: n }));
              }}
            >
              {n === "categoria" ? "Categorías" : "Subcategorías"}
            </button>
          ))}
        </div>
      </div>
      {datos.isPending && <TarjetaCargando filas={4} />}
      {datos.data && filas.length === 0 && <Vacio titulo="Sin movimientos en este periodo" />}
      {filas.length > 0 && (
        <div className="flujo-desglose">
          <div className="cd-donut-wrap" style={{ alignSelf: "start", justifySelf: "center" }}>
            <svg
              className="cd-chart dona-animada"
              viewBox="0 0 160 160"
              key={`${vista.tipo}-${vista.nivel}-${periodo.desde}-${periodo.hasta}`}
              width="180"
              height="180"
              role="img"
              aria-label="Composición por categoría"
              onMouseLeave={() => setActivo(null)}
            >
              <defs>
                {filas.map((f, i) => (
                  // Cada tramo se desvanece hacia el centro (el origen de la dona).
                  <radialGradient
                    key={`${f.categoria}-${f.nombre}`}
                    id={`dona-flujo-${i}`}
                    gradientUnits="userSpaceOnUse"
                    cx="80"
                    cy="80"
                    r="83"
                  >
                    <stop offset="68%" style={{ stopColor: colorFila(f), stopOpacity: 0.3 }} />
                    <stop offset="100%" style={{ stopColor: colorFila(f), stopOpacity: 1 }} />
                  </radialGradient>
                ))}
              </defs>
              <circle className="ring-track" cx="80" cy="80" r={R} fill="none" strokeWidth="20" />
              {filas.map((f, i) => (
                <circle
                  key={`${f.categoria}-${f.nombre}`}
                  stroke={`url(#dona-flujo-${i})`}
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  strokeWidth={activo === i ? 26 : 20}
                  strokeDasharray={`${Math.max(0, (total ? (f.total / total) * C : 0) - 2)} ${C}`}
                  strokeDashoffset={-(inicios[i] ?? 0)}
                  transform="rotate(-90 80 80)"
                  style={{
                    opacity: activo !== null && activo !== i ? 0.3 : 1,
                    cursor: "pointer",
                  }}
                  onMouseEnter={() => setActivo(i)}
                  onClick={() => setActivo((a) => (a === i ? null : i))}
                />
              ))}
            </svg>
            <div className="cd-donut-center" aria-live="polite">
              <small>{sel ? sel.nombre : vista.tipo === "gasto" ? "Gastos" : "Ingresos"}</small>
              <strong>{formatoCOP(sel ? sel.total : total)}</strong>
              {sel && <small>{porcentaje(sel.total / total, 0)}</small>}
            </div>
          </div>
          <ul className="cd-list" style={{ margin: 0 }} onMouseLeave={() => setActivo(null)}>
            {filas.map((f, i) => {
              const abierta = abiertas.has(f.nombre);
              return (
                <li
                  key={`${f.categoria}-${f.nombre}`}
                  className="cd-stack"
                  style={{ gap: 4, alignItems: "stretch", opacity: activo !== null && activo !== i ? 0.5 : 1 }}
                >
                  <button
                    type="button"
                    className="fila-boton cd-row"
                    style={{ gap: 10, flexWrap: "nowrap", padding: "6px 4px" }}
                    aria-expanded={abierta}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => alternar(f.nombre)}
                  >
                    <i className="cd-sw" style={{ background: colorFila(f) }} />
                    <IconoCategoria
                      estilo={estilo({ id: f.id, ruta: [f.categoria, f.nombre] })}
                      ruta={[f.categoria]}
                      grupo={grupo}
                      tam={18}
                    />
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>
                      {f.nombre}
                      {vista.nivel === "subcategoria" && f.nombre !== f.categoria && (
                        <small className="cd-delta-note" style={{ display: "block", fontWeight: 400 }}>
                          {f.categoria}
                        </small>
                      )}
                    </span>
                    <span className="cd-delta-note cd-num">{porcentaje(total ? f.total / total : 0, 0)}</span>
                    <b className="cd-num">{formatoCOP(f.total)}</b>
                    <span className="cd-delta-note" aria-hidden>
                      {abierta ? "▾" : "▸"}
                    </span>
                  </button>
                  {abierta && (
                    <div className="flujo-detalle">
                      {f.subs.length > 0 && (
                        <ul className="flujo-subcategorias">
                          {f.subs.map((x) => (
                            <li key={x.subcategoria}>
                              <Link
                                className="flujo-sub-enlace"
                                to="/movimientos"
                                search={{
                                  categoria: x.id ?? f.id ?? undefined,
                                  etiqueta: `${f.nombre} › ${x.subcategoria}`,
                                  ...rangoFechas(periodo),
                                }}
                                aria-label={`${x.subcategoria}: ${formatoCOP(x.total)}. Ver sus movimientos`}
                              >
                                <span>{x.subcategoria}</span>
                                <span className="cd-delta-note cd-num">{porcentaje(x.pct_categoria, 0)}</span>
                                <span className="cd-num">{formatoCOP(x.total)}</span>
                                <span aria-hidden className="cd-delta-note">
                                  →
                                </span>
                              </Link>
                            </li>
                          ))}
                        </ul>
                      )}
                      {f.id != null && (
                        <Link
                          className="cd-link flujo-ver-movs"
                          to="/movimientos"
                          search={{
                            categoria: f.id,
                            etiqueta:
                              vista.nivel === "subcategoria" && f.nombre !== f.categoria
                                ? `${f.categoria} › ${f.nombre}`
                                : f.nombre,
                            ...rangoFechas(periodo),
                          }}
                        >
                          Ver los movimientos de {f.nombre} →
                        </Link>
                      )}
                    </div>
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
  const tope = Math.max(1, ...meses.flatMap((m) => [m.gastos_total, m.ingresos_total]));
  const elegido =
    nav.preset === "rango" && nav.periodo.desde === nav.periodo.hasta
      ? nav.periodo.desde
      : nav.preset === "mes" && nav.pasos === 0
        ? hoy
        : null;
  return (
    <section className="cd-card cd-stack" style={{ gap: 10 }}>
      <div className="cd-card-head" style={{ margin: 0 }}>
        <h2 className="cd-card-title">Mes a mes</h2>
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
              <span className="flujo-mes-barras" aria-hidden>
                <i className="entra" style={{ width: `${(m.ingresos_total / tope) * 100}%` }} />
                <i className="sale" style={{ width: `${(m.gastos_total / tope) * 100}%` }} />
              </span>
              <span className="cd-row cd-delta-note cd-num" style={{ gap: 12 }}>
                <span style={{ color: "var(--negative)" }}>↓ {formatoCOP(m.gastos_total)}</span>
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
      </div>
      <BarraFiltros>
        <ControlPeriodo nav={nav} />
        <div className="cd-seg flujo-pestanas" role="tablist" aria-label="Vista">
          {(["actual", "historial"] as const).map((p) => (
            <button key={p} role="tab" aria-selected={pestana === p} onClick={() => setPestana(p)}>
              {p === "actual" ? "Actual" : "Historial"}
            </button>
          ))}
        </div>
        <span className="empuje">
          <BotonExcel periodo={nav.periodo} />
        </span>
      </BarraFiltros>
      <div className="cd-bento">
        <div
          className={`span-8 cd-stack flujo-col ${pestana === "actual" ? "visible" : ""}`}
          style={{ gap: "var(--gap-bento)" }}
        >
          <Totales periodo={nav.periodo} />
          <ZonaPeriodo nav={nav}>
            <GraficoFlujo periodo={nav.periodo} />
          </ZonaPeriodo>
          <Desglose periodo={nav.periodo} />
        </div>
        <div className={`span-4 flujo-col ${pestana === "historial" ? "visible" : ""}`} style={{ alignSelf: "start" }}>
          <Historial nav={nav} />
        </div>
      </div>
    </>
  );
}
