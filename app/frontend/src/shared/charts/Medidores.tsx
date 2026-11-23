/**
 * Medidores (§5.6): gauge de 180° para metas y anillo para porcentajes. Trazo de 10 px con extremos
 * redondeados; la pista es un paso más claro del mismo color. El color indica severidad solo si se pide
 * (`severidad`), con texto: normal → marca, ≥ 80 % → aviso, > 100 % → alerta.
 */
import { useId } from "react";

import { formatoCOP, porcentaje } from "@/shared/lib/formato";

import "./graficos.css";

function colorDe(fraccion: number, severidad: boolean): string {
  if (!severidad) return "var(--chart-1)";
  if (fraccion > 1) return "var(--negative)";
  if (fraccion >= 0.8) return "var(--warning)";
  return "var(--chart-1)";
}

function arco(cx: number, cy: number, r: number, desde: number, hasta: number): string {
  const p = (a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const;
  const [x1, y1] = p(desde);
  const [x2, y2] = p(hasta);
  const grande = hasta - desde > Math.PI ? 1 : 0;
  return `M${x1.toFixed(2)} ${y1.toFixed(2)} A${r} ${r} 0 ${grande} 1 ${x2.toFixed(2)} ${y2.toFixed(2)}`;
}

/** Gauge de media luna: valor y «de $ meta» al centro, con un punto en el extremo del avance. */
export function Gauge({
  titulo,
  valor,
  meta,
  severidad = false,
  tamano = 200,
  grosor = 10,
  formato = (v: number) => formatoCOP(v),
}: {
  titulo: string;
  valor: number;
  meta: number;
  severidad?: boolean;
  tamano?: number;
  /** Grosor del trazo en px (10 por defecto). */
  grosor?: number;
  formato?: (v: number) => string;
}) {
  const fraccion = meta > 0 ? valor / meta : 0;
  const visible = Math.max(0, Math.min(1, fraccion));
  const r = tamano / 2 - grosor;
  const cx = tamano / 2;
  const cy = tamano / 2 + 2;
  const fin = Math.PI + visible * Math.PI;
  const color = colorDe(fraccion, severidad);
  const idGauge = useId().replace(/:/g, "");
  return (
    <figure className="medidor" style={{ width: tamano }} tabIndex={0}>
      <svg
        width={tamano}
        height={tamano / 2 + grosor + 4}
        role="meter"
        aria-label={titulo}
        aria-valuemin={0}
        aria-valuemax={meta}
        aria-valuenow={Math.min(valor, meta)}
        aria-valuetext={`${formato(valor)} de ${formato(meta)}, ${porcentaje(fraccion, 0)}`}
      >
        <path d={arco(cx, cy, r, Math.PI, 2 * Math.PI)} className="medidor-pista" strokeWidth={grosor} />
        <defs>
          <linearGradient
            id={`${idGauge}-g`}
            gradientUnits="userSpaceOnUse"
            x1={cx - r - grosor / 2}
            y1="0"
            x2={Math.max(cx + r * Math.cos(fin) + grosor / 2, cx - r + grosor)}
            y2="0"
          >
            <stop offset="0%" style={{ stopColor: color, stopOpacity: 0.15 }} />
            <stop offset="100%" style={{ stopColor: color, stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        {visible > 0 && (
          <path
            d={arco(cx, cy, r, Math.PI, fin)}
            stroke={`url(#${idGauge}-g)`}
            strokeWidth={grosor}
            className="medidor-lleno"
          />
        )}
        {visible > 0 && (
          <circle
            cx={cx + r * Math.cos(fin)}
            cy={cy + r * Math.sin(fin)}
            r={Math.max(6, grosor / 2 + 2)}
            fill={color}
            className="medidor-punto"
          />
        )}
      </svg>
      <figcaption className="medidor-centro" style={{ top: tamano / 2 - 34 }}>
        <b>{formato(valor)}</b>
        <small>
          de {formato(meta)} · {porcentaje(fraccion, 0)}
        </small>
      </figcaption>
      <div className="grafico-globo medidor-globo" aria-hidden>
        <span>{titulo}</span>
        <span className="globo-fila">
          Llevas
          <b>{formato(valor)}</b>
        </span>
        <span className="globo-fila">
          Meta
          <b>{formato(meta)}</b>
        </span>
        <span className="globo-fila globo-total">
          {valor >= meta ? "Superada por" : "Faltan"}
          <b>{formato(Math.abs(meta - valor))}</b>
        </span>
      </div>
    </figure>
  );
}

/** Círculo completo con el porcentaje dentro. El trazo se desvanece hacia su origen (arriba) con un
 * degradado cónico y termina en un punto redondeado. */
export function Circulo({
  titulo,
  fraccion,
  texto,
  color,
  severidad = false,
  tamano = 64,
  grosor = 6,
}: {
  titulo: string;
  fraccion: number;
  texto?: string;
  color?: string;
  severidad?: boolean;
  tamano?: number;
  grosor?: number;
}) {
  const visible = Math.max(0, Math.min(1, fraccion));
  const trazo = color && !(severidad && fraccion > 1) ? color : colorDe(fraccion, severidad);
  const etiqueta = texto ?? porcentaje(fraccion, 0);
  const angulo = visible * 2 * Math.PI;
  const radio = tamano / 2 - grosor / 2;
  return (
    <figure
      className="circulo"
      style={{ width: tamano, height: tamano }}
      role="meter"
      aria-label={titulo}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(visible * 100)}
      aria-valuetext={etiqueta}
    >
      <span
        className="circulo-anillo"
        aria-hidden
        style={{
          background:
            visible > 0
              ? `conic-gradient(color-mix(in srgb, ${trazo} 12%, transparent) 0turn, ${trazo} ${visible}turn, var(--chart-track) ${visible}turn)`
              : "var(--chart-track)",
          WebkitMask: `radial-gradient(farthest-side, transparent calc(100% - ${grosor}px), #000 calc(100% - ${grosor}px + 0.5px))`,
          mask: `radial-gradient(farthest-side, transparent calc(100% - ${grosor}px), #000 calc(100% - ${grosor}px + 0.5px))`,
        }}
      />
      {visible > 0 && visible < 1 && (
        <span
          className="circulo-punta"
          aria-hidden
          style={{
            width: grosor,
            height: grosor,
            background: trazo,
            left: tamano / 2 + radio * Math.sin(angulo) - grosor / 2,
            top: tamano / 2 - radio * Math.cos(angulo) - grosor / 2,
          }}
        />
      )}
      <figcaption className="cd-num" style={{ fontSize: Math.max(11, Math.round(tamano / 4.6)) }}>
        {etiqueta}
      </figcaption>
    </figure>
  );
}

/** Medio círculo con el porcentaje dentro; el trazo se desvanece hacia su origen (izquierda). */
export function MedioAnillo({
  titulo,
  fraccion,
  texto,
  detalle,
  color,
  severidad = false,
  tamano = 160,
  grosor = 14,
}: {
  titulo: string;
  fraccion: number;
  texto?: string;
  /** Texto pequeño bajo el porcentaje. */
  detalle?: string;
  color?: string;
  severidad?: boolean;
  tamano?: number;
  grosor?: number;
}) {
  const id = useId().replace(/:/g, "");
  const visible = Math.max(0, Math.min(1, fraccion));
  const r = tamano / 2 - grosor / 2 - 1;
  const cx = tamano / 2;
  const cy = tamano / 2;
  const alto = cy + grosor / 2 + 1;
  const trazo = color && !(severidad && fraccion > 1) ? color : colorDe(fraccion, severidad);
  const fin = Math.PI + Math.max(0.02, visible) * Math.PI;
  const xFin = cx + r * Math.cos(fin);
  const etiqueta = texto ?? porcentaje(fraccion, 0);
  return (
    <figure className="medio-anillo" style={{ width: tamano }}>
      <svg
        width={tamano}
        height={alto}
        role="meter"
        aria-label={titulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(visible * 100)}
        aria-valuetext={etiqueta}
      >
        <defs>
          <linearGradient
            id={`${id}-g`}
            gradientUnits="userSpaceOnUse"
            x1={cx - r - grosor / 2}
            y1="0"
            x2={Math.max(xFin + grosor / 2, cx - r + grosor)}
            y2="0"
          >
            <stop offset="0%" style={{ stopColor: trazo, stopOpacity: 0.15 }} />
            <stop offset="100%" style={{ stopColor: trazo, stopOpacity: 1 }} />
          </linearGradient>
        </defs>
        <path d={arco(cx, cy, r, Math.PI, 2 * Math.PI)} className="medidor-pista" strokeWidth={grosor} />
        {visible > 0 && (
          <path
            d={arco(cx, cy, r, Math.PI, fin)}
            stroke={`url(#${id}-g)`}
            strokeWidth={grosor}
            className="medidor-lleno"
          />
        )}
      </svg>
      <figcaption style={{ top: alto - Math.max(20, tamano / 5) - (detalle ? 14 : 0) }}>
        <b className="cd-num" style={{ fontSize: Math.max(13, Math.round(tamano / 6.5)) }}>
          {etiqueta}
        </b>
        {detalle && <small>{detalle}</small>}
      </figcaption>
    </figure>
  );
}

/** Anillo de 270° con el porcentaje al centro y un subtítulo («$ 6.632 de $ 12.840»). */
export function Anillo({
  titulo,
  fraccion,
  subtitulo,
  severidad = false,
  tamano = 132,
}: {
  titulo: string;
  fraccion: number;
  subtitulo?: string;
  severidad?: boolean;
  tamano?: number;
}) {
  const visible = Math.max(0, Math.min(1, fraccion));
  const grosor = tamano < 64 ? 6 : 10;
  const r = tamano / 2 - grosor / 2 - 1;
  const c = tamano / 2;
  const inicio = (3 * Math.PI) / 4; // abajo a la izquierda
  const total = (3 * Math.PI) / 2;
  const color = colorDe(fraccion, severidad);
  return (
    <figure className="medidor anillo" style={{ width: tamano, height: tamano }} tabIndex={0}>
      <svg
        width={tamano}
        height={tamano}
        role="meter"
        aria-label={titulo}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(Math.min(1, fraccion) * 100)}
        aria-valuetext={`${porcentaje(fraccion, 0)}${subtitulo ? `, ${subtitulo}` : ""}`}
      >
        <path d={arco(c, c, r, inicio, inicio + total)} className="medidor-pista" strokeWidth={grosor} />
        {visible > 0 && (
          <path
            d={arco(c, c, r, inicio, inicio + total * visible)}
            stroke={color}
            strokeWidth={grosor}
            className="medidor-lleno"
          />
        )}
      </svg>
      <figcaption className="medidor-centro anillo-centro">
        <b style={{ fontSize: tamano < 64 ? 12 : 22 }}>{porcentaje(fraccion, 0)}</b>
        {subtitulo && tamano >= 96 && <small>{subtitulo}</small>}
      </figcaption>
      <div className="grafico-globo medidor-globo" aria-hidden>
        <span>{titulo}</span>
        <b>{porcentaje(fraccion, 1)}</b>
        {subtitulo && <small>{subtitulo}</small>}
        {severidad && (
          <small>{fraccion > 1 ? "Pasaste el límite" : fraccion >= 0.8 ? "Cerca del límite" : "Vas bien"}</small>
        )}
      </div>
    </figure>
  );
}
