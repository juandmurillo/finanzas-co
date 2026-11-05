/** Patrimonio neto: lo que tienes (cuentas, lo que te deben y activos) menos lo que debes (créditos y préstamos).
 * Como en el saldo disponible: un punto por cada día con movimientos, en un eje proporcional al tiempo. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";

import type { Patrimonio } from "@/shared/api/tipos";
import { api, type Periodo } from "@/shared/lib/api";
import { marcasPorTiempo, rutaSuave } from "@/shared/lib/curvas";
import { abreviar, fechaCorta, formatoCOP, nombreMes } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Dinero } from "@/shared/ui/Dinero";
import { TarjetaCargando } from "@/shared/ui/Estados";
import { SensorContinuo, TooltipGrafico, ZonaGrafico } from "@/shared/ui/TooltipGrafico";

const DIA = 86_400_000;

export function GraficoPatrimonio({ periodo, actual }: { periodo: Periodo; actual: Patrimonio }) {
  const datos = useQuery({
    queryKey: [...claves.patrimonio, periodo.desde, periodo.hasta, "movimiento"],
    queryFn: () => api.patrimonio(periodo, "movimiento"),
  });
  const [activo, setActivo] = useState<number | null>(null);
  const puntos = datos.data?.puntos ?? [];
  const W = 640;
  const valores = puntos.map((p) => p.neto);
  const max = Math.max(1, ...valores);
  const min = Math.min(0, ...valores);
  const tiempos = puntos.map((p) => Date.parse(p.fecha));
  const t0 = tiempos[0] ?? 0;
  const tramo = Math.max(1, (tiempos.at(-1) ?? 0) - t0);
  const xs = tiempos.map((t) => 48 + ((t - t0) / tramo) * (W - 58));
  const y = (v: number) => 20 + ((max - v) / Math.max(1, max - min)) * 150;
  const linea = rutaSuave(puntos.map((p, i): [number, number] => [xs[i] ?? 0, y(p.neto)]));
  const p0 = activo !== null ? puntos[activo] : undefined;
  const corto = tramo <= 120 * DIA;
  const etiqueta = (f: string) => (corto ? fechaCorta(f) : nombreMes(f.slice(0, 7), true));
  const marcas = marcasPorTiempo(
    puntos.map((p) => p.fecha),
    etiqueta,
  );
  const partes = [
    { texto: "Cuentas", valor: actual.cuentas },
    { texto: "Te deben", valor: actual.por_cobrar },
    { texto: "Activos", valor: actual.activos },
    { texto: "Créditos", valor: -actual.creditos },
    { texto: "Debes a personas", valor: -actual.por_pagar },
  ].filter((p) => p.valor !== 0);
  return (
    <>
      <div className="cd-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span
          className="cd-kpi-value"
          style={{ fontSize: 24, lineHeight: "30px", color: actual.neto < 0 ? "var(--negative)" : undefined }}
        >
          <Dinero centavos={actual.neto} />
        </span>
        <Link to="/activos" className="cd-link">
          Ver activos →
        </Link>
      </div>
      <ul className="patrimonio-partes">
        {partes.map((p) => (
          <li key={p.texto}>
            <span className="cd-delta-note">{p.texto}</span>
            <b className="cd-num">{formatoCOP(p.valor, { signo: p.valor < 0 })}</b>
          </li>
        ))}
      </ul>
      {datos.isPending ? (
        <TarjetaCargando filas={3} />
      ) : puntos.length > 1 ? (
        <ZonaGrafico>
          <svg className="cd-chart" viewBox={`0 0 ${W} 200`} role="img" aria-label="Patrimonio neto en el tiempo">
            <line className="grid" x1="44" x2={W} y1={y(max)} y2={y(max)} />
            <text x="40" y={y(max) + 4} textAnchor="end">
              {abreviar(max)}
            </text>
            {min < 0 && <line className="grid-dash" x1="44" x2={W} y1={y(0)} y2={y(0)} />}
            <text x="40" y={y(0) + 4} textAnchor="end">
              0
            </text>
            {/* El mínimo solo se rotula si no se monta sobre el cero. */}
            {y(min) - y(0) > 14 && (
              <text x="40" y={y(min) + 4} textAnchor="end">
                {abreviar(min)}
              </text>
            )}
            <path className="area1" d={`${linea} L${xs.at(-1) ?? 0} ${y(min)} L${xs[0] ?? 0} ${y(min)} Z`} />
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
            {p0 && activo !== null && <circle cx={xs[activo]} cy={y(p0.neto)} r="5" fill="var(--chart-1)" />}
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
                <span>Patrimonio</span>
                {formatoCOP(p0.neto)}
              </span>
              {activo > 0 && (
                <span className="fila">
                  <span>Cambio</span>
                  {formatoCOP(p0.neto - (puntos[activo - 1]?.neto ?? 0), { signo: true })}
                </span>
              )}
              <span className="fila">
                <span>Activos</span>
                {formatoCOP(p0.activos)}
              </span>
              <span className="fila">
                <span>Créditos</span>
                {formatoCOP(p0.deuda)}
              </span>
            </TooltipGrafico>
          )}
        </ZonaGrafico>
      ) : null}
    </>
  );
}
