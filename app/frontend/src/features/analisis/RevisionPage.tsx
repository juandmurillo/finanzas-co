/** Revisión mensual (RF-RP-05) y reporte de apuestas (RF-RP-07): qué cambió, sin juicios, y nunca oculto. */
import { useApuestasVisibles } from "@/shared/lib/useSistema";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { CambioCategoria, RevisionMensual } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";

import { KpisEstrategicos } from "./KpisRevision";
import { aPeriodo } from "./Periodo";

const INDICADORES: Record<RevisionMensual["indicadores"][number]["clave"], string> = {
  ingresos: "Ingresos",
  gasto_vida: "Gasto de vida",
  servicio_deuda: "Cuotas de deuda",
  apuestas_neto: "Apuestas (neto)",
  flujo_operativo: "Flujo operativo",
};

function Diferencia({ actual, base }: { actual: number; base: number }) {
  const d = actual - base;
  if (d === 0) return <span className="cd-badge cd-badge--plain">igual</span>;
  return (
    <span className="cd-badge cd-badge--neutral cd-num">
      {d > 0 ? "↑" : "↓"} {formatoCOP(Math.abs(d))}
    </span>
  );
}

function ListaCambios({ titulo, cambios, vacio }: { titulo: string; cambios: CambioCategoria[]; vacio: string }) {
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <h3 className="cd-card-title">{titulo}</h3>
      {cambios.length === 0 && <span className="cd-delta-note">{vacio}</span>}
      {cambios.map((c) => (
        <div key={c.categoria} className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <span>
            <b style={{ fontSize: 14 }}>{c.categoria}</b>
            <span className="cd-delta-note cd-num">
              {" "}
              · {formatoCOP(c.actual)} contra {formatoCOP(c.promedio)}
            </span>
          </span>
          <span className="cd-amt">
            {c.diferencia > 0 ? "+" : "−"}
            {formatoCOP(Math.abs(c.diferencia))}
          </span>
        </div>
      ))}
    </section>
  );
}

function Apuestas() {
  const periodo = aPeriodo("12m");
  const consulta = useQuery({ queryKey: claves.apuestas(periodo), queryFn: () => api.apuestas(periodo) });
  const a = consulta.data;
  if (!a) return consulta.isError ? <ErrorVista error={consulta.error} /> : <TarjetaCargando filas={3} />;
  const maximo = Math.max(1, ...a.por_mes.map((m) => Math.abs(m.neto)));
  return (
    <section className="cd-card cd-stack" style={{ gap: 16 }} aria-label="Apuestas de los últimos 12 meses">
      <div className="cd-card-head">
        <h3 className="cd-card-title">Apuestas · últimos 12 meses</h3>
        <span className="cd-delta-note">Meta: $0</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 12 }}>
        {[
          {
            etiqueta: "Días sin apostar",
            valor: a.racha_actual ?? "—",
            nota: a.ultima ? `última: ${fechaCorta(a.ultima, true)}` : "sin registros",
          },
          { etiqueta: "Mejor racha", valor: `${a.racha_mayor} días`, nota: "sin apostar" },
          { etiqueta: "Apostado", valor: formatoCOP(a.apostado), nota: `${a.n} registros` },
          {
            etiqueta: "Neto",
            valor: formatoCOP(a.neto, { signo: true }),
            nota: `ganado ${formatoCOP(a.ganado)}`,
          },
        ].map((k) => (
          <div key={k.etiqueta} className="cd-stack" style={{ gap: 2 }}>
            <span className="cd-delta-note">{k.etiqueta}</span>
            <span className="cd-amt" style={{ fontSize: 20 }}>
              {k.valor}
            </span>
            <span className="cd-delta-note">{k.nota}</span>
          </div>
        ))}
      </div>
      {a.por_mes.length > 0 && (
        <div className="cd-stack" style={{ gap: 6 }}>
          <div className="cd-spark" style={{ height: 48, gap: 6 }} aria-hidden>
            {a.por_mes.map((m) => (
              <i
                key={m.mes}
                className={m.neto < 0 ? "neg" : "on"}
                style={{ height: `${Math.max(6, (Math.abs(m.neto) / maximo) * 100)}%`, width: 14 }}
                title={`${nombreMes(m.mes)}: ${formatoCOP(m.neto, { signo: true })}`}
              />
            ))}
          </div>
          <span className="cd-delta-note">Neto por mes (más alto = más movimiento; rojo = pérdida)</span>
        </div>
      )}
      <div className="sr-only">
        <table>
          <caption>Apuestas por mes</caption>
          <thead>
            <tr>
              <th>Mes</th>
              <th>Apostado</th>
              <th>Ganado</th>
              <th>Neto</th>
            </tr>
          </thead>
          <tbody>
            {a.por_mes.map((m) => (
              <tr key={m.mes}>
                <td>{nombreMes(m.mes)}</td>
                <td>{formatoCOP(m.apostado)}</td>
                <td>{formatoCOP(m.ganado)}</td>
                <td>{formatoCOP(m.neto)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export function RevisionPage() {
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const consulta = useQuery({ queryKey: claves.revision(mes), queryFn: () => api.revision(mes) });
  const r = consulta.data;
  const flujo = r?.indicadores.find((i) => i.clave === "flujo_operativo");
  const apuestas = useApuestasVisibles();

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Revisión mensual</h1>
          <p>Cómo vas frente a tus metas, qué cambió frente al mes anterior y a tu promedio de 3 meses.</p>
        </div>
        <div className="cd-row" style={{ gap: 4 }}>
          <button className="cd-icon-btn" aria-label="Mes anterior" onClick={() => setMes(moverMes(mes, -1))}>
            ‹
          </button>
          <span
            className="cd-select"
            style={{ height: 40, minWidth: 150, justifyContent: "center", textTransform: "capitalize" }}
          >
            {nombreMes(mes)}
          </span>
          <button
            className="cd-icon-btn"
            aria-label="Mes siguiente"
            disabled={mes >= hoyISO().slice(0, 7)}
            onClick={() => setMes(moverMes(mes, 1))}
          >
            ›
          </button>
        </div>
      </div>

      {consulta.isPending && <TarjetaCargando />}
      {consulta.isError && <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />}
      {r && flujo && (
        <>
          <KpisEstrategicos
            kpis={
              apuestas
                ? r.kpis
                : { ...r.kpis, secundarios: r.kpis.secundarios.filter((k) => k.clave !== "racha_sin_apostar") }
            }
          />
          <div className="cd-bento">
            <div className="span-4 cd-balance">
              <div className="cd-balance-top">
                <span className="cd-balance-label">Flujo operativo</span>
                <span className="cd-chip-glass" style={{ textTransform: "capitalize" }}>
                  {nombreMes(mes)}
                </span>
              </div>
              <div className="cd-balance-value">
                <Dinero centavos={flujo.actual} signo />
              </div>
              <div className="cd-balance-foot">
                <span className="cd-delta">promedio {formatoCOP(flujo.promedio, { signo: true })}</span>
              </div>
            </div>
            <section className="cd-card span-8 cd-stack" style={{ gap: 12 }}>
              <h3 className="cd-card-title">Lo más importante</h3>
              <ol className="cd-stack" style={{ gap: 10, margin: 0, padding: 0, listStyle: "none" }}>
                {r.hallazgos.map((h, i) => (
                  <li key={h} className="cd-row" style={{ flexWrap: "nowrap", alignItems: "flex-start", gap: 12 }}>
                    <span
                      className="cd-kpi-ico cd-num"
                      style={{ width: 28, height: 28, flex: "none", fontWeight: 700 }}
                    >
                      {i + 1}
                    </span>
                    <span style={{ fontSize: 14, lineHeight: 1.5 }}>{h}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <div className="cd-bento">
            <section className="cd-card span-8" style={{ overflowX: "auto" }}>
              <h3 className="cd-card-title">Comparativo</h3>
              <table className="cd-table cd-num">
                <thead>
                  <tr>
                    <th>Indicador</th>
                    <th style={{ textAlign: "right" }}>Este mes</th>
                    <th style={{ textAlign: "right" }}>Mes anterior</th>
                    <th style={{ textAlign: "right" }}>Promedio 3 meses</th>
                    <th style={{ textAlign: "right" }}>Frente al promedio</th>
                  </tr>
                </thead>
                <tbody>
                  {r.indicadores
                    .filter((i) => apuestas || i.clave !== "apuestas_neto")
                    .map((i) => (
                      <tr key={i.clave}>
                        <td>{INDICADORES[i.clave]}</td>
                        <td style={{ textAlign: "right", fontWeight: 700 }}>{formatoCOP(i.actual)}</td>
                        <td style={{ textAlign: "right" }}>{formatoCOP(i.anterior)}</td>
                        <td style={{ textAlign: "right" }}>{formatoCOP(i.promedio)}</td>
                        <td style={{ textAlign: "right" }}>
                          <Diferencia actual={i.actual} base={i.promedio} />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </section>
            <section className="cd-card span-4 cd-stack" style={{ gap: 12 }}>
              <h3 className="cd-card-title">El mes en datos</h3>
              <div className="cd-stack" style={{ gap: 2 }}>
                <span className="cd-delta-note">Días con algún gasto</span>
                <span className="cd-amt" style={{ fontSize: 20 }}>
                  {r.dias_con_gasto}
                </span>
              </div>
              {r.mayor_gasto && (
                <div className="cd-stack" style={{ gap: 2 }}>
                  <span className="cd-delta-note">Gasto más grande</span>
                  <span className="cd-amt" style={{ fontSize: 20 }}>
                    {formatoCOP(r.mayor_gasto.monto)}
                  </span>
                  <span className="cd-delta-note">
                    {r.mayor_gasto.descripcion || r.mayor_gasto.categoria} · {fechaCorta(r.mayor_gasto.fecha)}
                  </span>
                </div>
              )}
            </section>
          </div>

          <div className="cd-bento">
            <div className="span-6">
              <ListaCambios titulo="Subió frente a tu promedio" cambios={r.subidas} vacio="Ninguna categoría subió." />
            </div>
            <div className="span-6">
              <ListaCambios titulo="Bajó frente a tu promedio" cambios={r.bajadas} vacio="Ninguna categoría bajó." />
            </div>
          </div>
        </>
      )}
      {apuestas && <Apuestas />}
    </>
  );
}
