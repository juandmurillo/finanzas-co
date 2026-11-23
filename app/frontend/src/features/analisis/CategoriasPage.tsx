/** Categorías (RF-RP-03): árbol categoría › subcategoría, tendencia por mes, ranking y top descripciones. */
import { useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import type { CategoriaReporte, Grupo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { formatoCOP, nombreMes, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { rangoFechas } from "@/features/dashboard/components/CategoriasMes";
import { BarrasApiladas, BarrasHorizontales, Distribucion, type Parte, type SerieBarras } from "@/shared/charts";
import { intensidadActual } from "@/shared/lib/movimiento";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { iconoCategoria } from "@/shared/ui/Icono";
import { IconoCategoria, tonosCategoria, useEstiloCategorias, type EstiloCategoria } from "@/shared/ui/EstiloCategoria";
import { CabeceraTarjeta, KpiCompacto } from "@/shared/ui/Kpi";

import { AdministrarCategorias } from "./AdministrarCategorias";
import { BotonExcel, ControlPeriodo, usePeriodo } from "./Periodo";
import { BarraFiltros } from "@/shared/ui/BarraFiltros";

import { ZonaPeriodo } from "@/features/analisis/ZonaPeriodo";
import { keepPreviousData } from "@tanstack/react-query";
interface Parte2 {
  nombre: string;
  categoria: string;
  id: number | null;
  total: number;
  n: number;
  ticket: number;
}

const GRUPOS: [Grupo, string][] = [
  ["gasto_vida", "Gastos"],
  ["ingreso", "Ingresos"],
  ["servicio_deuda", "Deudas"],
];

interface PropsFila {
  c: CategoriaReporte;
  grupo: Grupo;
  abierta: boolean;
  alternar: () => void;
  estilo: EstiloCategoria;
  seleccionada: boolean;
  alSeleccionar: () => void;
  alVerMovimientos: () => void;
}

function FilaCategoria({
  c,
  grupo,
  abierta,
  alternar,
  estilo,
  seleccionada,
  alSeleccionar,
  alVerMovimientos,
}: PropsFila) {
  const color = estilo.color;
  return (
    <li
      data-categoria={c.categoria}
      className={`cat-fila ${seleccionada ? "cat-fila--sel" : ""}`}
      style={{ display: "block", borderBottom: "1px solid var(--border)", paddingBottom: 12 }}
    >
      <button
        className="cd-row"
        onClick={alSeleccionar}
        aria-pressed={seleccionada}
        aria-label={`${c.categoria}: ${formatoCOP(c.total)}, ${porcentaje(c.pct, 1)} del total. Resaltar en el reparto`}
        style={{
          width: "100%",
          background: "none",
          border: 0,
          padding: 0,
          cursor: "pointer",
          flexWrap: "nowrap",
          gap: 12,
          color: "inherit",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span
          className="cd-kpi-ico"
          style={{
            width: 32,
            height: 32,
            flex: "none",
            background: `color-mix(in srgb, ${color} 18%, transparent)`,
            color,
          }}
        >
          <IconoCategoria estilo={estilo} ruta={[c.categoria]} grupo={grupo} />
        </span>
        <span className="cd-stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <span className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <b style={{ fontSize: 14 }}>{c.categoria}</b>
            <span className="cd-amt">{formatoCOP(c.total)}</span>
          </span>
          <span className="categoria-barra" aria-hidden>
            <i style={{ width: `${Math.max(1, c.pct * 100)}%`, background: color }} />
          </span>
          <span className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <span className="cd-delta-note cd-num">
              {porcentaje(c.pct, 1)} · {formatoCOP(c.promedio_mensual)}/mes · {c.n} mov.
            </span>
          </span>
        </span>
      </button>
      {(seleccionada || c.subcategorias.length > 0) && (
        <div className="cat-fila-acciones">
          {seleccionada && (
            <span className="cat-fila-dato cd-num">
              <b>{formatoCOP(c.total)}</b> · {porcentaje(c.pct, 1)} del total
            </span>
          )}
          {c.subcategorias.length > 0 && (
            <button
              type="button"
              className="cd-btn cd-btn--ghost cd-btn--sm"
              aria-expanded={abierta}
              onClick={alternar}
            >
              {abierta ? "Ocultar subcategorías" : `${c.subcategorias.length} subcategorías`}
            </button>
          )}
          {seleccionada && (
            <button type="button" className="cd-btn cd-btn--secondary cd-btn--sm" onClick={alVerMovimientos}>
              Ver movimientos ›
            </button>
          )}
        </div>
      )}
      {abierta && (
        <table
          className="cd-table cd-num tabla-apilable"
          style={{ marginTop: 10, marginLeft: 48, width: "calc(100% - 48px)" }}
        >
          <thead>
            <tr>
              <th>Subcategoría</th>
              <th style={{ textAlign: "right" }}>Total</th>
              <th style={{ textAlign: "right" }}>Mov.</th>
              <th style={{ textAlign: "right" }}>Ticket</th>
              <th style={{ textAlign: "right" }}>% de {c.categoria}</th>
            </tr>
          </thead>
          <tbody>
            {c.subcategorias.map((s) => (
              <tr key={s.subcategoria}>
                <td data-etiqueta="Subcategoría">{s.subcategoria}</td>
                <td data-etiqueta="Total" style={{ textAlign: "right" }}>
                  {formatoCOP(s.total)}
                </td>
                <td data-etiqueta="Mov." style={{ textAlign: "right" }}>
                  {s.n}
                </td>
                <td data-etiqueta="Ticket" style={{ textAlign: "right" }}>
                  {formatoCOP(s.ticket)}
                </td>
                <td data-etiqueta="% de categoría" style={{ textAlign: "right" }}>
                  {porcentaje(s.pct_categoria, 0)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}

export function CategoriasPage() {
  const nav = usePeriodo("todo", "categorias");
  const { periodo } = nav;
  const [vista, setVista] = useState<"analisis" | "administrar">("analisis");
  const selectorVista = (
    <div className="cd-seg" role="tablist" aria-label="Vista" style={{ alignSelf: "flex-start" }}>
      {(
        [
          ["analisis", "Análisis"],
          ["administrar", "Administrar"],
        ] as const
      ).map(([v, t]) => (
        <button key={v} role="tab" aria-selected={vista === v} onClick={() => setVista(v)}>
          {t}
        </button>
      ))}
    </div>
  );
  const busqueda: { grupo?: string } = useSearch({ strict: false });
  const [grupo, setGrupo] = useState<Grupo>(
    GRUPOS.some(([g]) => g === busqueda.grupo) ? (busqueda.grupo as Grupo) : "gasto_vida",
  );
  const [abiertas, setAbiertas] = useState<Set<string>>(new Set());
  const [nivel, setNivel] = useFiltroRecordado("categorias-nivel", "categoria" as "categoria" | "subcategoria");
  // Gastos e Ingresos muestran todo; Deudas es la vista de un solo grupo.
  const conjunto = grupo === "gasto_vida" ? "gastos" : grupo === "ingreso" ? "ingresos" : undefined;
  const reporte = useQuery({
    queryKey: claves.reporteCategorias(periodo, conjunto ?? grupo),
    queryFn: () => (conjunto ? api.reporteConjunto(periodo, conjunto) : api.reporteCategorias(periodo, grupo)),
    placeholderData: keepPreviousData,
  });
  const r = reporte.data;
  const estiloDe = useEstiloCategorias();
  const partes: Parte2[] = !r
    ? []
    : nivel === "categoria"
      ? r.categorias.map((c) => ({
          nombre: c.categoria,
          categoria: c.categoria,
          id: c.id ?? null,
          total: c.total,
          n: c.n,
          ticket: c.n ? Math.round(c.total / c.n) : 0,
        }))
      : r.ranking_subcategorias.map((x) => ({
          nombre: x.subcategoria,
          categoria: x.categoria,
          id: null,
          total: x.total,
          n: x.n,
          ticket: x.ticket,
        }));
  const meses12 = (r?.meses ?? []).slice(-12);
  const arriba = (r?.categorias ?? []).slice(0, 5);
  const resto = (r?.categorias ?? []).slice(5);
  const apiladas: SerieBarras[] = [
    ...arriba.map((c) => ({
      nombre: c.categoria,
      color: estiloDe({ id: c.id, nombre: c.categoria }).color,
      valores: c.tendencia.slice(-12),
    })),
    ...(resto.length
      ? [
          {
            nombre: "Otras",
            color: "var(--chart-track)",
            valores: meses12.map((_, k) => resto.reduce((t, c) => t + (c.tendencia.slice(-12)[k] ?? 0), 0)),
          },
        ]
      : []),
  ];
  const navegar = useNavigate();
  const verMovimientos = (parte: Parte) => {
    if (parte.id == null) return;
    void navegar({
      to: "/movimientos",
      search: { categoria: parte.id, etiqueta: parte.nombre, ...rangoFechas(periodo) },
    });
  };
  // Selección compartida entre la lista y el reparto (barra horizontal en escritorio, vertical en el celular).
  const [seleccion, setSeleccion] = useState<string | null>(null);
  const elegirDesdeGrafica = (nombre: string | null) => {
    setSeleccion(nombre);
    if (!nombre) return;
    // La fila elegida se hace visible si está fuera de la vista (sin tapar la barra superior ni el menú).
    requestAnimationFrame(() =>
      document
        .querySelector(`[data-categoria="${CSS.escape(nombre)}"]`)
        ?.scrollIntoView({ block: "nearest", behavior: intensidadActual() === "maxima" ? "smooth" : "auto" }),
    );
  };
  const alternar = (nombre: string) =>
    setAbiertas((a) => {
      const nuevo = new Set(a);
      if (nuevo.has(nombre)) nuevo.delete(nombre);
      else nuevo.add(nombre);
      return nuevo;
    });

  if (vista === "administrar") {
    return (
      <>
        <div className="cd-pagehead">
          <div>
            <h1>Categorías</h1>
            <p>Crea, edita (nombre, ícono y color) o elimina categorías sin perder movimientos.</p>
          </div>
          {selectorVista}
        </div>
        <AdministrarCategorias />
      </>
    );
  }

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Categorías</h1>
          <p>En qué se va (y de dónde viene) tu dinero, con cada subcategoría a la vista.</p>
        </div>
        {selectorVista}
      </div>
      <BarraFiltros>
        <ControlPeriodo nav={nav} />
        <div className="cd-seg cd-seg--brand" role="tablist" aria-label="Grupo">
          {GRUPOS.map(([g, texto]) => (
            <button key={g} role="tab" aria-selected={grupo === g} onClick={() => setGrupo(g)}>
              {texto}
            </button>
          ))}
        </div>
        <div className="cd-seg" role="radiogroup" aria-label="Nivel">
          {(["categoria", "subcategoria"] as const).map((n) => (
            <button
              key={n}
              role="radio"
              aria-checked={nivel === n}
              aria-selected={nivel === n}
              onClick={() => setNivel(() => n)}
            >
              {n === "categoria" ? "Categorías" : "Subcategorías"}
            </button>
          ))}
        </div>
        <span className="empuje">
          <BotonExcel periodo={periodo} />
        </span>
      </BarraFiltros>

      {reporte.isPending && <TarjetaCargando />}
      {reporte.isError && <ErrorVista error={reporte.error} reintentar={() => void reporte.refetch()} />}
      {r && r.n === 0 && (
        <section className="cd-card">
          <Vacio titulo="Sin movimientos en este periodo" texto="Prueba con otro grupo o un periodo más amplio." />
        </section>
      )}
      {r && r.n > 0 && (
        <>
          <div className="cd-bento categorias-kpis">
            <KpiCompacto className="span-3" inversa etiqueta="Total" icono="categorias" valor={r.total} />
            <KpiCompacto
              className="span-3"
              etiqueta="Promedio mensual"
              icono="calendario"
              valor={r.promedio_mensual}
              nota={`en ${r.meses.length} ${r.meses.length === 1 ? "mes" : "meses"}`}
            />
            <KpiCompacto
              className="span-3"
              etiqueta="Movimientos"
              icono="movimientos"
              valor={r.n.toLocaleString("es-CO")}
              nota={r.n ? `ticket medio ${formatoCOP(Math.round(r.total / r.n))}` : undefined}
            />
            <KpiCompacto
              className="span-3"
              etiqueta={nivel === "categoria" ? "Categoría principal" : "Subcategoría principal"}
              icono={iconoCategoria([partes[0]?.categoria ?? ""], grupo)}
              valor={partes[0]?.nombre ?? "—"}
              nota={partes[0] && r.total ? `${porcentaje(partes[0].total / r.total, 0)} del total` : undefined}
            />
          </div>
          <section className="cd-card reparto-tarjeta">
            <CabeceraTarjeta
              titulo="Reparto"
              rango={
                nivel === "categoria"
                  ? `${partes.length} categorías · toca una para ver sus movimientos`
                  : `${partes.length} subcategorías`
              }
            />
            <Distribucion
              titulo={`Reparto por ${nivel === "categoria" ? "categoría" : "subcategoría"} · ${GRUPOS.find(([g]) => g === grupo)?.[1] ?? ""}`}
              partes={partes.map((c) => ({
                nombre: c.nombre,
                valor: c.total,
                id: c.id,
                color: estiloDe({ id: c.id, ruta: [c.categoria, c.nombre] }).color,
              }))}
              soloBarra
              alElegir={verMovimientos}
              seleccionada={seleccion}
              alSeleccionar={(parte) => elegirDesdeGrafica(parte?.nombre ?? null)}
            />
          </section>
          <div className="cd-bento">
            <section className="cd-card span-7 lista-con-reparto">
              <div className="lista-con-reparto-lista">
                {nivel === "categoria" ? (
                  <>
                    <CabeceraTarjeta titulo="Por categoría" rango="Toca una para ver sus subcategorías" />
                    <ul className="cd-catlist">
                      {r.categorias.map((c) => (
                        <FilaCategoria
                          key={c.categoria}
                          estilo={estiloDe({ id: c.id, nombre: c.categoria })}
                          c={c}
                          grupo={grupo}
                          abierta={abiertas.has(c.categoria)}
                          alternar={() => alternar(c.categoria)}
                          seleccionada={seleccion === c.categoria}
                          alSeleccionar={() => setSeleccion((s) => (s === c.categoria ? null : c.categoria))}
                          alVerMovimientos={() => verMovimientos({ nombre: c.categoria, valor: c.total, id: c.id })}
                        />
                      ))}
                    </ul>
                  </>
                ) : (
                  <>
                    <CabeceraTarjeta titulo="Por subcategoría" rango="cada una como si fuera categoría" />
                    <ul className="cd-catlist">
                      {partes.map((x) => (
                        <li
                          key={`${x.categoria}-${x.nombre}`}
                          data-categoria={x.nombre}
                          className={`fila-sub cat-fila ${seleccion === x.nombre ? "cat-fila--sel" : ""}`}
                          onClick={(e) => {
                            if ((e.target as Element).closest("button")) return;
                            setSeleccion((s) => (s === x.nombre ? null : x.nombre));
                          }}
                        >
                          <span
                            className="cd-kpi-ico"
                            style={{
                              width: 32,
                              height: 32,
                              flex: "none",
                              ...tonosCategoria(estiloDe({ id: x.id, ruta: [x.categoria, x.nombre] })),
                            }}
                          >
                            <IconoCategoria
                              estilo={estiloDe({ id: x.id, ruta: [x.categoria, x.nombre] })}
                              ruta={[x.categoria]}
                              grupo={grupo}
                            />
                          </span>
                          <span className="cd-stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
                            <span className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
                              <b style={{ fontSize: 14 }}>{x.nombre}</b>
                              <span className="cd-amt">{formatoCOP(x.total)}</span>
                            </span>
                            <span className="categoria-barra" aria-hidden>
                              <i
                                style={{
                                  width: `${Math.max(1, (x.total / (r.total || 1)) * 100)}%`,
                                  background: estiloDe({ id: x.id, ruta: [x.categoria, x.nombre] }).color,
                                }}
                              />
                            </span>
                            <span className="cd-delta-note cd-num">
                              {x.categoria} · {porcentaje(x.total / (r.total || 1), 1)} · {x.n} mov. · ticket{" "}
                              {formatoCOP(x.ticket)}
                            </span>
                            {seleccion === x.nombre && (
                              <span className="cat-fila-acciones">
                                <span className="cat-fila-dato cd-num">
                                  <b>{formatoCOP(x.total)}</b> · {porcentaje(x.total / (r.total || 1), 1)} del total
                                </span>
                                <button
                                  type="button"
                                  className="cd-btn cd-btn--secondary cd-btn--sm"
                                  onClick={() => verMovimientos({ nombre: x.nombre, valor: x.total, id: x.id })}
                                >
                                  Ver movimientos ›
                                </button>
                              </span>
                            )}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </div>
              {/* Celular: el reparto como barra vertical a la derecha de la lista, fija mientras se recorre. */}
              <div className="reparto-columna" aria-hidden={false}>
                <RepartoVertical
                  seleccionada={seleccion}
                  alSeleccionar={elegirDesdeGrafica}
                  titulo={`Reparto por ${nivel === "categoria" ? "categoría" : "subcategoría"}`}
                  partes={(nivel === "categoria"
                    ? r.categorias.map((c) => ({
                        nombre: c.categoria,
                        valor: c.total,
                        color: estiloDe({ id: c.id, nombre: c.categoria }).color,
                      }))
                    : partes.map((x) => ({
                        nombre: x.nombre,
                        valor: x.total,
                        color: estiloDe({ id: x.id, ruta: [x.categoria, x.nombre] }).color,
                      }))
                  ).filter((x) => x.valor > 0)}
                />
              </div>
            </section>
            <div className="span-5 cd-stack" style={{ gap: "var(--gap-bento)" }}>
              {r.meses.length > 1 && (
                <section className="cd-card">
                  <CabeceraTarjeta titulo="Mes a mes" rango="las 5 categorías más grandes y el resto" />
                  <ZonaPeriodo nav={nav} cargando={reporte.isPlaceholderData}>
                    <BarrasApiladas
                      titulo="Mes a mes por categoría"
                      alto={220}
                      etiquetas={meses12.map((m) => nombreMes(m, true))}
                      detalles={meses12.map((m) => nombreMes(m))}
                      series={apiladas}
                    />
                  </ZonaPeriodo>
                </section>
              )}
              <section className="cd-card">
                <CabeceraTarjeta
                  titulo="Ticket medio"
                  rango={`cuánto cuesta en promedio cada movimiento, por ${nivel === "categoria" ? "categoría" : "subcategoría"}`}
                />
                <BarrasHorizontales
                  titulo="Ticket medio"
                  datos={[...partes]
                    .sort((a, b) => b.ticket - a.ticket)
                    .slice(0, 8)
                    .map((x) => ({ etiqueta: x.nombre, valor: x.ticket }))}
                />
              </section>
              <section className="cd-card">
                <CabeceraTarjeta titulo="Frecuencia" rango="número de movimientos en el periodo" />
                <BarrasHorizontales
                  titulo="Movimientos por categoría"
                  formato={(v) => `${v.toLocaleString("es-CO")} mov.`}
                  datos={[...partes]
                    .sort((a, b) => b.n - a.n)
                    .slice(0, 8)
                    .map((x) => ({ etiqueta: x.nombre, valor: x.n }))}
                />
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/** Reparto como barra vertical segmentada (celular): mismo orden y color que la lista; cada tramo mide su parte.
 * Tocar un tramo elige su categoría en la lista (y la hace visible); la elegida queda resaltada. */
function RepartoVertical({
  titulo,
  partes,
  seleccionada,
  alSeleccionar,
}: {
  titulo: string;
  partes: { nombre: string; valor: number; color: string }[];
  seleccionada: string | null;
  alSeleccionar: (nombre: string | null) => void;
}) {
  const total = partes.reduce((t, p) => t + p.valor, 0) || 1;
  return (
    <div className="reparto-vertical" role="group" aria-label={titulo}>
      {partes.map((p) => (
        <button
          key={p.nombre}
          type="button"
          className={`reparto-vertical-tramo ${seleccionada === p.nombre ? "activo" : ""} ${seleccionada && seleccionada !== p.nombre ? "atenuado" : ""}`}
          style={{ flexGrow: p.valor, background: p.color }}
          aria-label={`${p.nombre}: ${formatoCOP(p.valor)}, ${porcentaje(p.valor / total, 1)} del total`}
          aria-pressed={seleccionada === p.nombre}
          onClick={() => alSeleccionar(seleccionada === p.nombre ? null : p.nombre)}
        />
      ))}
    </div>
  );
}
