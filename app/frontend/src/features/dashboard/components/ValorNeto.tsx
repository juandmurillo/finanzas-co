/** Evolución del saldo disponible (cuentas que suman al total), un punto por cada día con movimientos. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";
import { api } from "@/shared/lib/api";
import { rutaSuave } from "@/shared/lib/curvas";
import { abreviar, fechaCorta, formatoCOP, nombreMes } from "@/shared/lib/formato";
import { TarjetaCargando } from "@/shared/ui/Estados";
import { SensorContinuo, TooltipGrafico, ZonaGrafico } from "@/shared/ui/TooltipGrafico";

const DIA = 86_400_000;

export function ValorNeto() {
  const nav = usePeriodo("12m", "inicio-valor-neto");
  const { desde, hasta } = nav.periodo;
  const datos = useQuery({
    queryKey: ["reportes", "valor-neto", desde, hasta, "movimiento"],
    queryFn: () => api.valorNeto(nav.periodo, "movimiento"),
  });
  const [activo, setActivo] = useState<number | null>(null);
  const puntos = datos.data?.puntos ?? [];
  const W = 640;
  const H = 200;
  const valores = puntos.map((p) => p.saldo);
  const max = Math.max(1, ...valores);
  const min = Math.min(0, ...valores);
  const tiempos = puntos.map((p) => Date.parse(p.fecha));
  const t0 = tiempos[0] ?? 0;
  const tramo = Math.max(1, (tiempos.at(-1) ?? 0) - t0);
  const xs = tiempos.map((t) => 48 + ((t - t0) / tramo) * (W - 58));
  const y = (v: number) => 20 + ((max - v) / Math.max(1, max - min)) * 150;
  const linea = rutaSuave(puntos.map((p, i): [number, number] => [xs[i] ?? 0, y(p.saldo)]));
  const area = puntos.length
    ? `${linea} L${(xs.at(-1) ?? 0).toFixed(1)} ${y(min)} L${(xs[0] ?? 0).toFixed(1)} ${y(min)} Z`
    : "";
  const primero = puntos[0]?.saldo ?? 0;
  const ultimo = puntos.at(-1)?.saldo ?? 0;
  const p0 = activo !== null ? puntos[activo] : undefined;
  const corto = tramo <= 120 * DIA;
  const etiqueta = (f: string) => (corto ? fechaCorta(f) : nombreMes(f.slice(0, 7), true));
  // Marcas repartidas por tiempo, sin repetir etiqueta.
  const marcas = [
    ...new Map(
      Array.from({ length: 6 }, (_, k) => {
        const objetivo = t0 + (tramo * k) / 5;
        const i = tiempos.reduce(
          (m, t, j) => (Math.abs(t - objetivo) < Math.abs((tiempos[m] ?? t) - objetivo) ? j : m),
          0,
        );
        return [etiqueta(puntos[i]?.fecha ?? ""), i] as const;
      }),
    ).entries(),
  ];

  return (
    <section className="cd-card cd-stack span-12" style={{ gap: 12 }}>
      <div className="cd-card-head" style={{ flexWrap: "wrap", gap: 8, margin: 0 }}>
        <div className="cd-stack" style={{ gap: 2 }}>
          <h3 className="cd-card-title">Saldo disponible</h3>
          {puntos.length > 1 && (
            <span className="cd-delta-note cd-num">
              {formatoCOP(ultimo - primero, { signo: true })} en el periodo · de {formatoCOP(primero)} a{" "}
              {formatoCOP(ultimo)}
            </span>
          )}
        </div>
        <ControlPeriodo nav={nav} opciones={["3m", "6m", "12m", "todo", "rango"]} />
      </div>
      {datos.isPending ? (
        <TarjetaCargando filas={3} />
      ) : puntos.length === 0 ? (
        <span className="cd-delta-note">Sin movimientos en este periodo.</span>
      ) : (
        <ZonaGrafico>
          <svg className="cd-chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Saldo disponible en el tiempo">
            <line className="grid" x1="44" x2={W} y1={y(max)} y2={y(max)} />
            <text x="40" y={y(max) + 4} textAnchor="end">
              {abreviar(max)}
            </text>
            {min < 0 && (
              <>
                <line className="grid-dash" x1="44" x2={W} y1={y(0)} y2={y(0)} />
                <text x="40" y={y(0) + 4} textAnchor="end">
                  0
                </text>
              </>
            )}
            <text x="40" y={y(min) + 4} textAnchor="end">
              {abreviar(min)}
            </text>
            <path className="area1" d={area} />
            <path className="l1" d={linea} strokeWidth="2.5" />
            {marcas.map(([texto, i], k) => (
              <text
                key={texto}
                x={xs[i]}
                y="192"
                textAnchor={k === 0 ? "start" : k === marcas.length - 1 ? "end" : "middle"}
              >
                {texto}
              </text>
            ))}
            {p0 && activo !== null && <circle cx={xs[activo]} cy={y(p0.saldo)} r="5" fill="var(--chart-1)" />}
            <SensorContinuo
              xs={xs}
              izquierda={44}
              ancho={W - 44}
              arriba={10}
              alto={175}
              activo={activo}
              alCambiar={setActivo}
            />
          </svg>
          {p0 && activo !== null && (
            <TooltipGrafico izquierda={((xs[activo] ?? 0) / W) * 100}>
              <b style={{ textTransform: "capitalize" }}>{fechaCorta(p0.fecha, true)}</b>
              <span className="fila">
                <span>Saldo</span>
                {formatoCOP(p0.saldo)}
              </span>
              {activo > 0 && (
                <span className="fila">
                  <span>Cambio</span>
                  {formatoCOP(p0.saldo - (puntos[activo - 1]?.saldo ?? 0), { signo: true })}
                </span>
              )}
            </TooltipGrafico>
          )}
        </ZonaGrafico>
      )}
    </section>
  );
}
