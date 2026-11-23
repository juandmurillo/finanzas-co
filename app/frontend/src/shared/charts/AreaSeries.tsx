/**
 * Varias series en el tiempo con el estilo de `AreaTemporal` (Inicio): eje proporcional a las fechas, áreas
 * que se desvanecen hacia el eje en cero (por arriba y por abajo), cuadrícula fina con etiquetas pequeñas,
 * guía vertical, puntos con anillo y globo con todas las series del punto activo.
 */
import { useId } from "react";

import { marcasPorTiempo, rutaSuave } from "@/shared/lib/curvas";
import { fechaCorta, nombreMes } from "@/shared/lib/formato";

import {
  Cuadricula,
  formatoPorDefecto,
  Globo,
  MarcoGrafico,
  marcasEjeConSigno,
  TablaAlternativa,
  useActivo,
  useAncho,
  type Formato,
  CapaDesliza,
} from "./base";

const IZQ = 52;
const DER = 12;
const ABAJO = 30;
const ARRIBA = 10;
const DIA = 86_400_000;

export interface SerieTiempo {
  clave: string;
  nombre: string;
  /** Color CSS (token). */
  color: string;
  valores: number[];
  /** Formato propio en el globo (p. ej. con signo). */
  formato?: Formato;
}

export function AreaSeries({
  titulo,
  fechas,
  series,
  alto = 240,
  formato = formatoPorDefecto,
  formatoEje,
  rotulo = (f: string) => (f.length >= 10 ? fechaCorta(f, true) : nombreMes(f.slice(0, 7))),
}: {
  titulo: string;
  /** Fechas ISO comunes a todas las series. */
  fechas: string[];
  series: SerieTiempo[];
  alto?: number;
  formato?: Formato;
  /** Etiquetas del eje Y (por defecto, pesos abreviados). */
  formatoEje?: Formato;
  /** Texto de la fecha en el globo y la tabla (p. ej. «semana del 3 nov»). */
  rotulo?: (fecha: string) => string;
}) {
  const medida = useAncho<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const ancho = medida.ancho;
  const n = fechas.length;
  const valores = series.flatMap((s) => s.valores);
  const marcas = marcasEjeConSigno(Math.min(0, ...valores), Math.max(0, ...valores), 5);
  const piso = marcas[0] ?? 0;
  const tope = marcas.at(-1) ?? 1;
  const tiempos = fechas.map((f) => Date.parse(f.slice(0, 10)));
  const t0 = tiempos[0] ?? 0;
  const tramo = Math.max(1, (tiempos.at(-1) ?? 0) - t0);
  const xs = tiempos.map((t) => IZQ + ((t - t0) / tramo) * (ancho - IZQ - DER));
  const y = (v: number) => ARRIBA + (1 - (v - piso) / (tope - piso || 1)) * (alto - ARRIBA - ABAJO);
  const y0 = y(0);
  const corto = tramo <= 120 * DIA;
  const etiqueta = (f: string) => (corto ? fechaCorta(f) : `${nombreMes(f.slice(0, 7), true)} ${f.slice(2, 4)}`);
  const ejeX = marcasPorTiempo(fechas, etiqueta, Math.max(3, Math.min(8, Math.floor((ancho - IZQ) / 90))));
  const { activo, interactuando, props } = useActivo(n, xs);
  const xa = activo !== null ? (xs[activo] ?? 0) : 0;
  const rutas = series.map((s) => {
    const linea = rutaSuave(s.valores.map((v, i): [number, number] => [xs[i] ?? 0, y(v)]));
    const area = n > 1 ? `${linea} L${(xs.at(-1) ?? 0).toFixed(1)} ${y0} L${(xs[0] ?? 0).toFixed(1)} ${y0} Z` : "";
    return { linea, area };
  });

  if (n === 0) return <p className="cd-delta-note">Sin datos en este periodo.</p>;
  return (
    <MarcoGrafico titulo={titulo} alto={alto} medir={medida.medir}>
      <svg width={ancho} height={alto} role="group" aria-label={`${titulo}. Usa las flechas para recorrer.`} {...props}>
        <defs>
          {series.map((s) => (
            // Opaco en los extremos y transparente en el cero: se desvanece hacia el eje central.
            <linearGradient
              key={s.clave}
              id={`${id}-${s.clave}`}
              gradientUnits="userSpaceOnUse"
              x1="0"
              x2="0"
              y1={y(tope)}
              y2={y0}
              spreadMethod="reflect"
            >
              <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 0.26 }} />
              <stop offset="65%" style={{ stopColor: s.color, stopOpacity: 0.07 }} />
              <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0 }} />
            </linearGradient>
          ))}
        </defs>
        <Cuadricula marcas={marcas} y={y} izquierda={IZQ} derecha={ancho - DER} formato={formatoEje} />
        <CapaDesliza izquierda={IZQ} ancho={ancho} alto={alto}>
          {rutas.map((r, i) =>
            r.area ? <path key={`a-${series[i]?.clave}`} d={r.area} fill={`url(#${id}-${series[i]?.clave})`} /> : null,
          )}
          {rutas.map((r, i) => (
            <path
              key={`l-${series[i]?.clave}`}
              d={r.linea}
              className="linea-principal"
              pathLength={1}
              style={{ stroke: series[i]?.color }}
            />
          ))}
          {activo !== null && interactuando && (
            <line x1={xa} x2={xa} y1={ARRIBA} y2={alto - ABAJO + 4} className="guia-activa guia-alta" />
          )}
          {activo !== null &&
            interactuando &&
            series.map((s) => (
              <g key={s.clave} className="punto-activo" style={{ fill: s.color }}>
                <circle
                  cx={xa}
                  cy={y(s.valores[activo] ?? 0)}
                  r={8}
                  className="halo"
                  style={{ fill: `color-mix(in srgb, ${s.color} 20%, transparent)` }}
                />
                <circle cx={xa} cy={y(s.valores[activo] ?? 0)} r={4.5} style={{ fill: s.color }} />
              </g>
            ))}
          <g className="grafico-eje-x" aria-hidden>
            {ejeX.map(([texto, i]) => {
              const x = xs[i] ?? 0;
              if (interactuando && Math.abs(x - xa) < 56) return null;
              return (
                <text
                  key={texto}
                  x={Math.min(Math.max(x, IZQ + 14), ancho - DER - 14)}
                  y={alto - ABAJO / 2 + 2}
                  dy="0.34em"
                  textAnchor="middle"
                >
                  {texto}
                </text>
              );
            })}
            {activo !== null && interactuando && (
              <g>
                <rect
                  x={Math.min(Math.max(xa - 34, IZQ - 8), ancho - 70)}
                  y={alto - ABAJO / 2 - 9}
                  width={68}
                  height={22}
                  rx={11}
                  className="chip-eje"
                />
                <text
                  x={Math.min(Math.max(xa, IZQ + 26), ancho - 36)}
                  y={alto - ABAJO / 2 + 2}
                  dy="0.34em"
                  textAnchor="middle"
                  className="activo"
                >
                  {etiqueta(fechas[activo] ?? "")}
                </text>
              </g>
            )}
          </g>
        </CapaDesliza>
      </svg>
      {activo !== null && interactuando && (
        <Globo x={xa} ancho={ancho} y={ARRIBA}>
          <span>{rotulo(fechas[activo] ?? "")}</span>
          {series.map((s) => (
            <span key={s.clave} className="globo-fila">
              <i style={{ background: s.color }} aria-hidden />
              {s.nombre}
              <b>{(s.formato ?? formato)(s.valores[activo] ?? 0)}</b>
            </span>
          ))}
        </Globo>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Fecha", ...series.map((s) => s.nombre)]}
        filas={fechas.map((f, i) => [rotulo(f), ...series.map((s) => (s.formato ?? formato)(s.valores[i] ?? 0))])}
      />
    </MarcoGrafico>
  );
}
