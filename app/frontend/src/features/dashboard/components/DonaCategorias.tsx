/** Dona de categorías del mes (gastos o ingresos) con ‹ mes ›: todas las categorías, sin agrupar en «Otros»;
 * la lista va debajo y muestra 6 con «Ver todas». Interactiva: pasar, enfocar o tocar resalta la categoría. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { api } from "@/shared/lib/api";
import { formatoCOP, hoyISO, moverMes, nombreMes, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { Vacio } from "@/shared/ui/Estados";
import { Icono, iconoCategoria } from "@/shared/ui/Icono";

const SERIES = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
const RADIO = 70;
const CIRCUNFERENCIA = 2 * Math.PI * RADIO;
const VISIBLES = 6;

export function DonaCategorias({ tipo }: { tipo: "gasto" | "ingreso" }) {
  const grupo = tipo === "gasto" ? "gasto_vida" : "ingreso";
  const conjunto = tipo === "gasto" ? "gastos" : "ingresos";
  const hoy = hoyISO().slice(0, 7);
  const [estado, setEstado] = useFiltroRecordado(`inicio-dona-${tipo}`, { pasos: 0 });
  const mes = moverMes(hoy, -estado.pasos);
  const periodo = { desde: mes, hasta: mes };
  const consulta = useQuery({
    queryKey: claves.reporteCategorias(periodo, conjunto),
    queryFn: () => api.reporteConjunto(periodo, conjunto),
  });
  const [activo, setActivo] = useState<number | null>(null);
  const [todas, setTodas] = useState(false);
  const filas = (consulta.data?.categorias ?? []).filter((c) => c.total > 0);
  const total = filas.reduce((t, c) => t + c.total, 0);
  const sel = activo !== null ? filas[activo] : undefined;
  // Inicio de cada arco: lo acumulado por las categorías anteriores.
  const inicios = filas.map((_, i) =>
    filas.slice(0, i).reduce((t, f) => t + (total ? (f.total / total) * CIRCUNFERENCIA : 0), 0),
  );

  return (
    <section className="cd-card cd-stack span-6" style={{ gap: 14 }}>
      <div className="cd-card-head" style={{ margin: 0 }}>
        <h3 className="cd-card-title">{tipo === "gasto" ? "Gastos por categoría" : "Ingresos por categoría"}</h3>
        <div className="cd-row" style={{ gap: 4, flexWrap: "nowrap" }}>
          <button
            type="button"
            className="cd-icon-btn"
            aria-label="Mes anterior"
            onClick={() => setEstado((e) => ({ pasos: e.pasos + 1 }))}
          >
            ‹
          </button>
          <span
            className="cd-select"
            style={{ height: 36, minWidth: 130, justifyContent: "center", textTransform: "capitalize" }}
          >
            {nombreMes(mes)}
          </span>
          <button
            type="button"
            className="cd-icon-btn"
            aria-label="Mes siguiente"
            disabled={estado.pasos === 0}
            onClick={() => setEstado((e) => ({ pasos: Math.max(0, e.pasos - 1) }))}
          >
            ›
          </button>
        </div>
      </div>
      {filas.length === 0 ? (
        <Vacio titulo={tipo === "gasto" ? "Sin gastos en este mes" : "Sin ingresos en este mes"} />
      ) : (
        <>
          <div className="cd-donut-wrap" style={{ alignSelf: "center" }}>
            <svg
              key={mes}
              className="cd-chart dona-animada"
              viewBox="0 0 160 160"
              width="170"
              height="170"
              role="img"
              aria-label={`${tipo === "gasto" ? "Gastos" : "Ingresos"} de ${nombreMes(mes)} por categoría`}
              onMouseLeave={() => setActivo(null)}
            >
              <circle className="ring-track" cx="80" cy="80" r={RADIO} fill="none" strokeWidth="20" />
              {filas.map((f, i) => {
                const largo = total ? (f.total / total) * CIRCUNFERENCIA : 0;
                const arco = (
                  <circle
                    key={f.categoria}
                    className={SERIES[i % SERIES.length]}
                    cx="80"
                    cy="80"
                    r={RADIO}
                    fill="none"
                    strokeWidth={activo === i ? 26 : 20}
                    strokeDasharray={`${Math.max(0, largo - 2)} ${CIRCUNFERENCIA}`}
                    strokeDashoffset={-(inicios[i] ?? 0)}
                    transform="rotate(-90 80 80)"
                    style={{
                      opacity: activo !== null && activo !== i ? 0.3 : i >= SERIES.length ? 0.65 : 1,
                      cursor: "pointer",
                      transition: "opacity .15s, stroke-width .15s",
                    }}
                    onMouseEnter={() => setActivo(i)}
                    onClick={() => setActivo((a) => (a === i ? null : i))}
                  />
                );
                return arco;
              })}
            </svg>
            <div className="cd-donut-center" aria-live="polite">
              <small>{sel ? sel.categoria : tipo === "gasto" ? "Gastos" : "Ingresos"}</small>
              <strong>{formatoCOP(sel ? sel.total : total)}</strong>
              {sel && total > 0 && <small>{porcentaje(sel.total / total, 0)}</small>}
            </div>
          </div>
          <ul className="cd-catlist" onMouseLeave={() => setActivo(null)}>
            {(todas ? filas : filas.slice(0, VISIBLES)).map((f, i) => (
              <li key={f.categoria} style={{ opacity: activo !== null && activo !== i ? 0.45 : 1 }}>
                <button
                  type="button"
                  className="fila-boton"
                  onMouseEnter={() => setActivo(i)}
                  onFocus={() => setActivo(i)}
                  onClick={() => setActivo((a) => (a === i ? null : i))}
                  style={{ display: "contents" }}
                >
                  <i
                    className={`cd-sw ${SERIES[i % SERIES.length]}`}
                    style={{ opacity: i >= SERIES.length ? 0.65 : 1 }}
                  />
                  <span className="cd-row" style={{ gap: 8, flexWrap: "nowrap", minWidth: 0 }}>
                    <Icono nombre={iconoCategoria([f.categoria], grupo)} pequeno />
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {f.categoria}
                    </span>
                  </span>
                  <span className="pct">{total ? Math.round((f.total / total) * 100) : 0}%</span>
                  <span className="amt">{formatoCOP(f.total)}</span>
                </button>
              </li>
            ))}
          </ul>
          {filas.length > VISIBLES && (
            <button
              type="button"
              className="cd-btn cd-btn--ghost cd-btn--sm"
              style={{ alignSelf: "center" }}
              onClick={() => setTodas((t) => !t)}
            >
              {todas ? "Ver menos" : `Ver todas (${filas.length})`}
            </button>
          )}
        </>
      )}
    </section>
  );
}
