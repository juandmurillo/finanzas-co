/** Revisión mensual (RF-RP-05) y reporte de apuestas (RF-RP-07): qué cambió, sin juicios, y nunca oculto. */
import { useApuestasVisibles } from "@/shared/lib/useSistema";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { CambioCategoria, RevisionMensual } from "@/shared/api/tipos";
import { BarrasAgrupadas } from "@/shared/charts";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { BarraFiltros } from "@/shared/ui/BarraFiltros";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { CabeceraTarjeta, KpiCompacto } from "@/shared/ui/Kpi";

import { KpisEstrategicos } from "./KpisRevision";
import { aPeriodo } from "./Periodo";

function diasDelMes(mes: string): number {
  const [a, m] = mes.split("-").map(Number);
  return new Date(a ?? 2000, m ?? 1, 0).getDate();
}

const INDICADORES: Record<RevisionMensual["indicadores"][number]["clave"], string> = {
  ingresos: "Ingresos",
  gasto_vida: "Gasto de vida",
  servicio_deuda: "Cuotas de deuda",
  apuestas_neto: "Apuestas (neto)",
  flujo_operativo: "Flujo operativo",
};

/** Barras divergentes: a la derecha lo que subió frente al promedio, a la izquierda lo que bajó. */
function Cambios({ subidas, bajadas }: { subidas: CambioCategoria[]; bajadas: CambioCategoria[] }) {
  const filas = [...subidas.slice(0, 6), ...bajadas.slice(0, 6)].sort((a, b) => b.diferencia - a.diferencia);
  const maximo = Math.max(1, ...filas.map((c) => Math.abs(c.diferencia)));
  return (
    <section className="cd-card">
      <CabeceraTarjeta titulo="Qué cambió" rango="cada categoría frente a su promedio de 3 meses" />
      {filas.length === 0 ? (
        <p className="cd-delta-note">Ninguna categoría cambió frente a tu promedio.</p>
      ) : (
        <ul className="cambios-div" aria-label="Cambios por categoría">
          {filas.map((c) => {
            const ancho = `${(Math.abs(c.diferencia) / maximo) * 50}%`;
            const sube = c.diferencia > 0;
            return (
              <li
                key={c.categoria}
                title={`${c.categoria}: ${formatoCOP(c.actual)} contra ${formatoCOP(c.promedio)} de promedio`}
              >
                <span className="cambios-nombre">{c.categoria}</span>
                <span className="cambios-pista" aria-hidden>
                  <i
                    className={sube ? "sube" : "baja"}
                    style={sube ? { left: "50%", width: ancho } : { right: "50%", width: ancho }}
                  />
                </span>
                <b className={`cd-num ${sube ? "texto-sube" : "texto-baja"}`}>
                  {sube ? "+" : "−"}
                  {formatoCOP(Math.abs(c.diferencia))}
                </b>
              </li>
            );
          })}
        </ul>
      )}
      <p className="cd-delta-note cambios-leyenda">
        <span>
          <i className="baja" /> gastaste menos
        </span>
        <span>
          <i className="sube" /> gastaste más
        </span>
      </p>
    </section>
  );
}

function Apuestas({ mes }: { mes: string }) {
  const periodo = aPeriodo("12m");
  const consulta = useQuery({ queryKey: claves.apuestas(periodo), queryFn: () => api.apuestas(periodo) });
  const a = consulta.data;
  if (!a) return consulta.isError ? <ErrorVista error={consulta.error} /> : <TarjetaCargando filas={3} />;
  const delMes = a.por_mes.find((m) => m.mes === mes);
  const anteriores = a.por_mes.filter((m) => m.mes < mes);
  const promedio = anteriores.length ? anteriores.reduce((t, m) => t + m.apostado, 0) / anteriores.length : 0;
  const meses = a.por_mes.slice(-8);
  return (
    <div className="cd-bento" aria-label="Apuestas">
      <section className="cd-card span-5">
        <CabeceraTarjeta titulo={`Apuestas de ${nombreMes(mes)}`} rango="Meta: $0" />
        <div className="apuestas-kpis">
          <KpiCompacto
            etiqueta="Apostado"
            icono="dado"
            valor={delMes?.apostado ?? 0}
            nota={
              delMes
                ? `${delMes.n} ${delMes.n === 1 ? "apuesta" : "apuestas"} · promedio ${formatoCOP(Math.round(promedio))}`
                : "nada este mes"
            }
          />
          <KpiCompacto
            etiqueta="Neto"
            icono={delMes && delMes.neto < 0 ? "sale" : "entra"}
            valor={formatoCOP(delMes?.neto ?? 0, { signo: true })}
            delta={delMes && delMes.neto < 0 ? { valor: 0, sentido: "alerta", texto: "Pérdida" } : undefined}
            nota={`ganado ${formatoCOP(delMes?.ganado ?? 0)}`}
          />
          <KpiCompacto
            etiqueta="Días sin apostar"
            icono="calendario"
            valor={String(a.racha_actual ?? "—")}
            nota={a.ultima ? `última: ${fechaCorta(a.ultima, true)}` : "sin registros"}
          />
          <KpiCompacto etiqueta="Mejor racha" icono="check" valor={`${a.racha_mayor} días`} nota="sin apostar" />
        </div>
      </section>
      <section className="cd-card span-7">
        <CabeceraTarjeta titulo="Frente a meses anteriores" rango="apostado y ganado por mes" />
        {meses.length === 0 ? (
          <p className="cd-delta-note">Sin apuestas en los últimos 12 meses.</p>
        ) : (
          <BarrasAgrupadas
            titulo="Apuestas por mes"
            alto={220}
            relativo
            etiquetas={meses.map((m) => nombreMes(m.mes, true))}
            detalles={meses.map((m) => nombreMes(m.mes))}
            series={[
              { nombre: "Apostado", color: "var(--chart-2)", valores: meses.map((m) => m.apostado) },
              { nombre: "Ganado", color: "var(--positive)", valores: meses.map((m) => m.ganado) },
            ]}
          />
        )}
      </section>
    </div>
  );
}

export function RevisionPage() {
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const consulta = useQuery({ queryKey: claves.revision(mes), queryFn: () => api.revision(mes) });
  const r = consulta.data;
  const flujo = r?.indicadores.find((i) => i.clave === "flujo_operativo");
  // El gráfico compara montos positivos; el flujo ya está en los indicadores y las apuestas, al final.
  const comparables = (r?.indicadores ?? []).filter((i) =>
    ["ingresos", "gasto_vida", "servicio_deuda"].includes(i.clave),
  );
  const apuestas = useApuestasVisibles();

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Revisión mensual</h1>
          <p>Cómo vas frente a tus metas, qué cambió frente al mes anterior y a tu promedio de 3 meses.</p>
        </div>
      </div>
      <BarraFiltros etiqueta="Mes de la revisión">
        <div className="selector-mes">
          <button className="cd-icon-btn" aria-label="Mes anterior" onClick={() => setMes(moverMes(mes, -1))}>
            ‹
          </button>
          <span aria-live="polite">{nombreMes(mes)}</span>
          <button
            className="cd-icon-btn"
            aria-label="Mes siguiente"
            disabled={mes >= hoyISO().slice(0, 7)}
            onClick={() => setMes(moverMes(mes, 1))}
          >
            ›
          </button>
        </div>
      </BarraFiltros>
      {consulta.isPending && <TarjetaCargando />}
      {consulta.isError && <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />}
      {r && flujo && (
        <>
          <KpisEstrategicos
            mes={mes}
            flujo={flujo}
            kpis={
              apuestas
                ? r.kpis
                : { ...r.kpis, secundarios: r.kpis.secundarios.filter((k) => k.clave !== "racha_sin_apostar") }
            }
          />
          <div className="cd-bento">
            <section className="cd-card span-7">
              <CabeceraTarjeta titulo="Comparativo" rango="este mes, el anterior y tu promedio de 3 meses" />
              <BarrasAgrupadas
                titulo="Comparativo del mes"
                alto={240}
                relativo
                etiquetas={comparables.map((i) => INDICADORES[i.clave])}
                series={[
                  { nombre: nombreMes(mes), color: "var(--chart-1)", valores: comparables.map((i) => i.actual) },
                  { nombre: "Mes anterior", color: "var(--chart-3)", valores: comparables.map((i) => i.anterior) },
                  {
                    nombre: "Promedio 3 meses",
                    color: "var(--chart-track)",
                    valores: comparables.map((i) => i.promedio),
                  },
                ]}
              />
            </section>
            <section className="cd-card span-5 cd-stack" style={{ gap: 12 }}>
              <CabeceraTarjeta titulo="Lo más importante" rango={`${r.hallazgos.length} hallazgos`} />
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
            <div className="span-8">
              <Cambios subidas={r.subidas} bajadas={r.bajadas} />
            </div>
            <div className="span-4 revision-mes-datos">
              <KpiCompacto
                etiqueta="Días con algún gasto"
                icono="calendario"
                valor={String(r.dias_con_gasto)}
                nota={`de ${diasDelMes(mes)} días del mes`}
              />
              {r.mayor_gasto && (
                <KpiCompacto
                  etiqueta="Gasto más grande"
                  icono="sale"
                  valor={r.mayor_gasto.monto}
                  nota={`${r.mayor_gasto.descripcion || r.mayor_gasto.categoria} · ${fechaCorta(r.mayor_gasto.fecha)}`}
                />
              )}
            </div>
          </div>
        </>
      )}
      {apuestas && <Apuestas mes={mes} />}
    </>
  );
}
