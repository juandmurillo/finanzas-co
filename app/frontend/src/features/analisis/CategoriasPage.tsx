/** Categorías (RF-RP-03): árbol categoría › subcategoría, tendencia por mes, ranking y top descripciones. */
import { useQuery } from "@tanstack/react-query";
import { useSearch } from "@tanstack/react-router";
import { useState } from "react";

import type { CategoriaReporte, Grupo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { formatoCOP, nombreMes, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Icono, iconoCategoria } from "@/shared/ui/Icono";

import { AdministrarCategorias } from "./AdministrarCategorias";
import { BotonExcel, ControlPeriodo, usePeriodo } from "./Periodo";

const GRUPOS: [Grupo, string][] = [
  ["gasto_vida", "Gastos"],
  ["ingreso", "Ingresos"],
  ["servicio_deuda", "Deudas"],
];

function Tendencia({ valores, meses }: { valores: number[]; meses: string[] }) {
  const maximo = Math.max(1, ...valores);
  const ultimos = valores.slice(-12);
  const etiquetas = meses.slice(-12);
  return (
    <div className="cd-spark" style={{ height: 28 }} aria-hidden>
      {ultimos.map((v, i) => (
        <i
          key={etiquetas[i]}
          className={i === ultimos.length - 1 ? "on" : undefined}
          style={{ height: `${Math.max(8, (v / maximo) * 100)}%`, width: 5 }}
          title={`${nombreMes(etiquetas[i] ?? "")}: ${formatoCOP(v)}`}
        />
      ))}
    </div>
  );
}

interface PropsFila {
  c: CategoriaReporte;
  grupo: Grupo;
  meses: string[];
  abierta: boolean;
  alternar: () => void;
}

function FilaCategoria({ c, grupo, meses, abierta, alternar }: PropsFila) {
  return (
    <li style={{ display: "block", borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
      <button
        className="cd-row"
        onClick={alternar}
        aria-expanded={abierta}
        disabled={c.subcategorias.length === 0}
        style={{
          width: "100%",
          background: "none",
          border: 0,
          padding: 0,
          cursor: c.subcategorias.length ? "pointer" : "default",
          flexWrap: "nowrap",
          gap: 12,
          color: "inherit",
          font: "inherit",
          textAlign: "left",
        }}
      >
        <span className="cd-kpi-ico" style={{ width: 36, height: 36, flex: "none" }}>
          <Icono nombre={iconoCategoria([c.categoria], grupo)} />
        </span>
        <span className="cd-stack" style={{ gap: 6, flex: 1, minWidth: 0 }}>
          <span className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <b style={{ fontSize: 14 }}>{c.categoria}</b>
            <span className="cd-amt">{formatoCOP(c.total)}</span>
          </span>
          <span className="cd-progress" aria-hidden>
            <i style={{ width: `${Math.max(1, c.pct * 100)}%` }} />
          </span>
          <span className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
            <span className="cd-delta-note cd-num">
              {porcentaje(c.pct, 1)} · {formatoCOP(c.promedio_mensual)}/mes · {c.n} mov.
            </span>
            {c.subcategorias.length > 0 && (
              <span className="cd-delta-note">{abierta ? "Ocultar" : `${c.subcategorias.length} subcategorías`}</span>
            )}
          </span>
        </span>
        <Tendencia valores={c.tendencia} meses={meses} />
      </button>
      {abierta && (
        <table className="cd-table cd-num" style={{ marginTop: 10, marginLeft: 48, width: "calc(100% - 48px)" }}>
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
                <td>{s.subcategoria}</td>
                <td style={{ textAlign: "right" }}>{formatoCOP(s.total)}</td>
                <td style={{ textAlign: "right" }}>{s.n}</td>
                <td style={{ textAlign: "right" }}>{formatoCOP(s.ticket)}</td>
                <td style={{ textAlign: "right" }}>{porcentaje(s.pct_categoria, 0)}</td>
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
  const reporte = useQuery({
    queryKey: claves.reporteCategorias(periodo, grupo),
    queryFn: () => api.reporteCategorias(periodo, grupo),
  });
  const descripciones = useQuery({
    queryKey: claves.descripciones(periodo, grupo),
    queryFn: () => api.descripciones(periodo, grupo),
  });
  const r = reporte.data;
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
        <div className="cd-row">
          <ControlPeriodo nav={nav} />
          <BotonExcel periodo={periodo} />
        </div>
      </div>
      {selectorVista}
      <div className="cd-seg cd-seg--brand" role="tablist" aria-label="Grupo" style={{ alignSelf: "flex-start" }}>
        {GRUPOS.map(([g, texto]) => (
          <button key={g} role="tab" aria-selected={grupo === g} onClick={() => setGrupo(g)}>
            {texto}
          </button>
        ))}
      </div>

      {reporte.isPending && <TarjetaCargando />}
      {reporte.isError && <ErrorVista error={reporte.error} reintentar={() => void reporte.refetch()} />}
      {r && r.n === 0 && (
        <section className="cd-card">
          <Vacio titulo="Sin movimientos en este periodo" texto="Prueba con otro grupo o un periodo más amplio." />
        </section>
      )}
      {r && r.n > 0 && (
        <>
          <div className="cd-bento">
            {[
              { etiqueta: "Total", valor: <Dinero centavos={r.total} /> },
              { etiqueta: "Promedio mensual", valor: <Dinero centavos={r.promedio_mensual} /> },
              { etiqueta: "Movimientos", valor: r.n.toLocaleString("es-CO") },
              { etiqueta: "Meses analizados", valor: r.meses.length },
            ].map((k) => (
              <div key={k.etiqueta} className="cd-card cd-kpi span-3">
                <span className="cd-kpi-label">{k.etiqueta}</span>
                <span className="cd-kpi-value">{k.valor}</span>
              </div>
            ))}
          </div>
          <div className="cd-bento">
            <section className="cd-card span-7">
              <div className="cd-card-head">
                <h3 className="cd-card-title">Por categoría</h3>
                <span className="cd-delta-note">Toca una para ver sus subcategorías</span>
              </div>
              <ul className="cd-catlist">
                {r.categorias.map((c) => (
                  <FilaCategoria
                    key={c.categoria}
                    c={c}
                    grupo={grupo}
                    meses={r.meses}
                    abierta={abiertas.has(c.categoria)}
                    alternar={() => alternar(c.categoria)}
                  />
                ))}
              </ul>
            </section>
            <div className="span-5 cd-stack" style={{ gap: 16 }}>
              <section className="cd-card">
                <h3 className="cd-card-title">Subcategorías como categorías</h3>
                <ol className="cd-stack" style={{ gap: 10, margin: "12px 0 0", padding: 0, listStyle: "none" }}>
                  {r.ranking_subcategorias.slice(0, 10).map((s, i) => (
                    <li key={s.subcategoria} className="cd-row" style={{ flexWrap: "nowrap", gap: 10 }}>
                      <span className="cd-delta-note cd-num" style={{ width: 18, textAlign: "right" }}>
                        {i + 1}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ fontSize: 14 }}>{s.subcategoria}</b>
                        <span className="cd-delta-note">
                          {" "}
                          · {s.categoria} · {s.n} mov.
                        </span>
                      </span>
                      <span className="cd-amt">{formatoCOP(s.total)}</span>
                    </li>
                  ))}
                </ol>
              </section>
              <section className="cd-card" style={{ overflowX: "auto" }}>
                <h3 className="cd-card-title">Descripciones que más pesan</h3>
                <table className="cd-table cd-num">
                  <thead>
                    <tr>
                      <th>Descripción</th>
                      <th style={{ textAlign: "right" }}>Mov.</th>
                      <th style={{ textAlign: "right" }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(descripciones.data ?? []).map((d) => (
                      <tr key={`${d.descripcion}-${d.grupo}`}>
                        <td>
                          {d.descripcion}
                          <span className="cd-delta-note"> · {d.categoria}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>{d.n}</td>
                        <td style={{ textAlign: "right" }}>{formatoCOP(d.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            </div>
          </div>
        </>
      )}
    </>
  );
}
