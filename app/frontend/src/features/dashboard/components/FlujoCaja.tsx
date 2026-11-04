/** Barras divergentes de Caudal: ingresos ↑ (chart-1), salidas ↓ (chart-2), eje cero punteado. */
import { useState } from "react";

import type { MesFlujo } from "@/shared/api/tipos";
import { abreviar, formatoCOP, nombreMes } from "@/shared/lib/formato";
import { Sensores, TooltipGrafico, ZonaGrafico } from "@/shared/ui/TooltipGrafico";

const ALTO_MITAD = 90;

export function FlujoCaja({ meses, activo }: { meses: MesFlujo[]; activo: string }) {
  const salidas = (m: MesFlujo) => m.gasto_vida + m.servicio_deuda - Math.min(0, m.apuestas_neto);
  const maximo = Math.max(1, ...meses.flatMap((m) => [m.ingresos, salidas(m)]));
  const ancho = 640;
  const paso = (ancho - 60) / Math.max(1, meses.length);
  const escala = (v: number) => Math.max(3, Math.round((v / maximo) * ALTO_MITAD));
  const actual = meses.find((m) => m.mes === activo) ?? meses.at(-1);
  const [foco, setFoco] = useState<number | null>(null);
  const centro = (i: number) => 60 + i * paso + paso / 2;
  const m0 = foco !== null ? meses[foco] : undefined;

  return (
    <div className="cd-stack" style={{ gap: 12 }}>
      <ZonaGrafico>
        <svg
          className="cd-chart"
          viewBox={`0 0 ${ancho} 230`}
          role="img"
          aria-label="Ingresos hacia arriba y salidas hacia abajo por mes"
        >
          <line className="grid" x1="44" x2={ancho} y1={110 - ALTO_MITAD} y2={110 - ALTO_MITAD} />
          <text x="34" y={114 - ALTO_MITAD} textAnchor="end">
            {abreviar(maximo)}
          </text>
          <line className="grid-dash" x1="44" x2={ancho} y1="110" y2="110" />
          <text x="34" y="114" textAnchor="end">
            0
          </text>
          <line className="grid" x1="44" x2={ancho} y1={110 + ALTO_MITAD} y2={110 + ALTO_MITAD} />
          {meses.map((m, i) => {
            const x = 60 + i * paso + paso / 2 - 14;
            const hIn = escala(m.ingresos);
            const hOut = escala(salidas(m));
            const esActivo = m.mes === activo;
            return (
              <g key={m.mes}>
                <rect
                  opacity={foco === null || foco === i ? 1 : 0.45}
                  className="s1"
                  x={x}
                  y={109 - hIn}
                  width="28"
                  height={hIn}
                  rx="6"
                />
                <rect
                  opacity={foco === null || foco === i ? 1 : 0.45}
                  className="s2"
                  x={x}
                  y="111"
                  width="28"
                  height={hOut}
                  rx="6"
                />
                <text x={x + 14} y="226" textAnchor="middle" className={esActivo ? "on" : undefined}>
                  {nombreMes(m.mes, true)}
                </text>
              </g>
            );
          })}
          <Sensores n={meses.length} x={centro} ancho={paso} alto={205} arriba={15} activo={foco} alCambiar={setFoco} />
        </svg>
        {m0 && foco !== null && (
          <TooltipGrafico izquierda={(centro(foco) / ancho) * 100}>
            <b style={{ textTransform: "capitalize" }}>{nombreMes(m0.mes)}</b>
            <span className="fila">
              <span>
                <i className="punto" style={{ background: "var(--chart-1)" }} />
                Entró
              </span>
              {formatoCOP(m0.ingresos)}
            </span>
            <span className="fila">
              <span>
                <i className="punto" style={{ background: "var(--chart-2)" }} />
                Salió
              </span>
              {formatoCOP(salidas(m0))}
            </span>
            <span className="fila">
              <span>Flujo</span>
              {formatoCOP(m0.flujo_operativo, { signo: true })}
            </span>
          </TooltipGrafico>
        )}
      </ZonaGrafico>
      {actual && (
        <div className="cd-row" style={{ justifyContent: "space-between", fontSize: 13 }}>
          <span className="cd-delta-note">
            {nombreMes(actual.mes)}: entró <b style={{ color: "var(--ink)" }}>{formatoCOP(actual.ingresos)}</b> · salió{" "}
            <b style={{ color: "var(--ink)" }}>{formatoCOP(salidas(actual))}</b>
          </span>
          <span className={`cd-badge ${actual.flujo_operativo < 0 ? "cd-badge--negative" : "cd-badge--positive"}`}>
            {formatoCOP(actual.flujo_operativo, { signo: true })}
          </span>
        </div>
      )}
      <div className="sr-only">
        <table>
          <caption>Flujo por mes</caption>
          <thead>
            <tr>
              <th>Mes</th>
              <th>Ingresos</th>
              <th>Salidas</th>
              <th>Flujo operativo</th>
            </tr>
          </thead>
          <tbody>
            {meses.map((m) => (
              <tr key={m.mes}>
                <td>{nombreMes(m.mes)}</td>
                <td>{formatoCOP(m.ingresos)}</td>
                <td>{formatoCOP(salidas(m))}</td>
                <td>{formatoCOP(m.flujo_operativo)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
