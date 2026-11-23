/**
 * Serie en el tiempo con eje proporcional a las fechas (un punto por cada día con datos), al estilo de la
 * referencia «Revenue over time»: cabecera con la cifra actual y su variación, eje Y con 5–6 valores, área
 * que se desvanece hacia abajo, guía vertical a todo lo alto, punto con anillo, globo con fecha y valor, y la
 * fecha activa como píldora en el eje X.
 */
import { useId, type ReactNode } from "react";

import { marcasPorTiempo, rutaSuave } from "@/shared/lib/curvas";
import { fechaCorta, nombreMes, porcentaje } from "@/shared/lib/formato";

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
} from "./base";

const IZQ = 52;
const DER = 12;
const ABAJO = 30;
const ARRIBA = 10;
const DIA = 86_400_000;

/** «21 nov» (o «21 nov 2026») para fechas con día; «noviembre 2026» para puntos mensuales (AAAA-MM). */
function fechaPunto(f: string, conAnio = false): string {
  return f.length >= 10 ? fechaCorta(f, conAnio) : nombreMes(f.slice(0, 7));
}

export interface PuntoTiempo {
  /** Fecha ISO (AAAA-MM-DD…). */
  fecha: string;
  valor: number;
}

export function AreaTemporal({
  titulo,
  nombreSerie,
  puntos,
  alto = 240,
  formato = formatoPorDefecto,
  extraGlobo,
}: {
  titulo: string;
  nombreSerie: string;
  puntos: PuntoTiempo[];
  alto?: number;
  formato?: Formato;
  /** Filas adicionales del globo para el punto `i` (p. ej. activos y créditos). */
  extraGlobo?: (i: number) => ReactNode;
}) {
  const medida = useAncho<HTMLDivElement>();
  const id = useId().replace(/:/g, "");
  const ancho = medida.ancho;
  const n = puntos.length;
  const valores = puntos.map((p) => p.valor);
  const marcas = marcasEjeConSigno(Math.min(0, ...valores), Math.max(0, ...valores), 5);
  const piso = marcas[0] ?? 0;
  const tope = marcas.at(-1) ?? 1;
  const tiempos = puntos.map((p) => Date.parse(p.fecha.slice(0, 10)));
  const t0 = tiempos[0] ?? 0;
  const tramo = Math.max(1, (tiempos.at(-1) ?? 0) - t0);
  const xs = tiempos.map((t) => IZQ + ((t - t0) / tramo) * (ancho - IZQ - DER));
  const y = (v: number) => ARRIBA + (1 - (v - piso) / (tope - piso || 1)) * (alto - ARRIBA - ABAJO);
  const corto = tramo <= 120 * DIA;
  const etiqueta = (f: string) =>
    corto && f.length >= 10 ? fechaCorta(f) : `${nombreMes(f.slice(0, 7), true)} ${f.slice(2, 4)}`;
  const ejeX = marcasPorTiempo(
    puntos.map((p) => p.fecha),
    etiqueta,
    Math.max(3, Math.min(8, Math.floor((ancho - IZQ) / 90))),
  );
  const linea = rutaSuave(puntos.map((p, i): [number, number] => [xs[i] ?? 0, y(p.valor)]));
  const base = y(Math.max(piso, 0));
  const area = n > 1 ? `${linea} L${(xs.at(-1) ?? 0).toFixed(1)} ${base} L${(xs[0] ?? 0).toFixed(1)} ${base} Z` : "";
  const { activo, interactuando, props } = useActivo(n, xs);
  const p = activo !== null ? puntos[activo] : undefined;
  const xa = activo !== null ? (xs[activo] ?? 0) : 0;
  const anterior = activo !== null && activo > 0 ? puntos[activo - 1] : undefined;

  if (n === 0) return <p className="cd-delta-note">Sin datos en este periodo.</p>;
  return (
    <MarcoGrafico titulo={titulo} alto={alto} medir={medida.medir}>
      <svg width={ancho} height={alto} role="group" aria-label={`${titulo}. Usa las flechas para recorrer.`} {...props}>
        <defs>
          <linearGradient id={`${id}-a`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.32 }} />
            <stop offset="60%" style={{ stopColor: "var(--chart-1)", stopOpacity: 0.1 }} />
            <stop offset="100%" style={{ stopColor: "var(--chart-1)", stopOpacity: 0 }} />
          </linearGradient>
        </defs>
        <Cuadricula marcas={marcas} y={y} izquierda={IZQ} derecha={ancho - DER} />
        {area && <path d={area} fill={`url(#${id}-a)`} />}
        <path d={linea} className="linea-principal" pathLength={1} />
        {p && activo !== null && interactuando && (
          <line x1={xa} x2={xa} y1={ARRIBA} y2={alto - ABAJO + 4} className="guia-activa guia-alta" />
        )}
        {p && activo !== null && (
          <g className="punto-activo">
            {interactuando && <circle cx={xa} cy={y(p.valor)} r={9} className="halo" />}
            <circle cx={xa} cy={y(p.valor)} r={interactuando ? 5 : 3.5} />
          </g>
        )}
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
          {p && interactuando && (
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
                {fechaPunto(p.fecha)}
              </text>
            </g>
          )}
        </g>
      </svg>
      {p && activo !== null && interactuando && (
        <Globo x={xa} ancho={ancho} y={Math.max(0, y(p.valor) - 64)}>
          <span>{fechaPunto(p.fecha, true)}</span>
          <span className="globo-fila">
            <i style={{ background: "var(--chart-1)" }} aria-hidden />
            {nombreSerie}
            <b>{formato(p.valor)}</b>
          </span>
          {anterior && (
            <small>
              {p.valor - anterior.valor >= 0 ? "+" : "−"} {formato(Math.abs(p.valor - anterior.valor))} frente al{" "}
              {fechaPunto(anterior.fecha)}
            </small>
          )}
          {extraGlobo?.(activo)}
        </Globo>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Fecha", nombreSerie]}
        filas={puntos.map((q) => [fechaPunto(q.fecha, true), formato(q.valor)])}
      />
    </MarcoGrafico>
  );
}

/** Cabecera de la referencia: etiqueta, cifra grande y variación a la derecha. */
export function CabeceraSerie({
  etiqueta,
  valor,
  inicial,
  formato = formatoPorDefecto,
  referencia = "inicio del periodo",
  accion,
}: {
  etiqueta: string;
  valor: number;
  /** Valor al inicio del periodo, para la variación. */
  inicial?: number;
  formato?: Formato;
  referencia?: string;
  accion?: ReactNode;
}) {
  const cambio = inicial !== undefined && inicial !== 0 ? (valor - inicial) / Math.abs(inicial) : null;
  const sube = (cambio ?? 0) >= 0;
  return (
    <div className="cabecera-serie">
      <div>
        <span className="cabecera-serie-etiqueta">{etiqueta}</span>
        <b className="cabecera-serie-valor">{formato(valor)}</b>
      </div>
      <div className="cabecera-serie-lado">
        {cambio !== null && inicial !== undefined && (
          <span className={`cabecera-serie-delta ${sube ? "sube" : "baja"}`}>
            <i aria-hidden>{sube ? "▲" : "▼"}</i>
            {/* Sobre 999 % el porcentaje no dice nada útil (partía de casi cero): solo el monto. */}
            {Math.abs(cambio) <= 9.99 && `${porcentaje(Math.abs(cambio), 1)} · `}
            {sube ? "+" : "−"}
            {formato(Math.abs(valor - inicial))}
            <small> vs {referencia}</small>
          </span>
        )}
        {accion}
      </div>
    </div>
  );
}
