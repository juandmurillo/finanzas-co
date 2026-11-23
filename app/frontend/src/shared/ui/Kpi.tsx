/**
 * Primitivas de resumen del sistema compacto (docs/sistema/10_SISTEMA_DISENO_COMPACTO.md §4.1–4.3, 4.6):
 * KPI compacto, cabecera de tarjeta, fila de métricas y tarjeta de hallazgo. Presentacionales puras.
 */
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { formatoCOP, porcentaje } from "@/shared/lib/formato";

import { Dinero } from "./Dinero";
import { Esqueleto } from "./Estados";
import { Icono, type NombreIcono } from "./Icono";
import "./primitivas.css";

/** «mejora» en verde; «alerta» en rojo (solo tope superado, mora o error); «neutro» para el resto. */
export type SentidoDelta = "mejora" | "alerta" | "neutro";

export interface Delta {
  /** Variación como fracción: 0,12 = +12 %. */
  valor: number;
  sentido?: SentidoDelta;
  /** Texto alternativo a la cifra, p. ej. «+$ 456». */
  texto?: string;
}

export function PildoraDelta({ delta }: { delta: Delta }) {
  const sube = delta.valor > 0;
  const plano = delta.valor === 0;
  const texto = delta.texto ?? `${sube ? "+" : plano ? "" : "−"}${porcentaje(Math.abs(delta.valor), 1)}`;
  return (
    <span className={`pildora-delta pildora-delta--${delta.sentido ?? "neutro"}`}>
      {!plano && !delta.texto && <span aria-hidden>{sube ? "↑" : "↓"}</span>}
      <span>
        {!delta.texto && <span className="sr-only">{sube ? "sube " : plano ? "sin cambio " : "baja "}</span>}
        {texto}
      </span>
    </span>
  );
}

interface PropsKpi {
  etiqueta: string;
  /** Centavos (se muestra con `Dinero`) o un texto ya formateado («24 %», «14 días»). */
  valor: number | string;
  icono?: NombreIcono;
  delta?: Delta;
  /** Nota corta junto a la cifra: «vs oct», «de $ 1.200.000». */
  nota?: string;
  /** Pie con enlace separado por una línea («Ver detalle →»). */
  pie?: { texto: string; a: string };
  /** Flecha ↗ en la esquina para abrir la sección. */
  abrir?: string;
  /** Mini indicador a la derecha (anillo o gauge). */
  indicador?: ReactNode;
  /** Fondo de marca. Una por pantalla como máximo. */
  inversa?: boolean;
  cargando?: boolean;
  className?: string;
}

export function KpiCompacto({
  etiqueta,
  valor,
  icono,
  delta,
  nota,
  pie,
  abrir,
  indicador,
  inversa,
  cargando,
  className = "",
}: PropsKpi) {
  return (
    <section
      className={`cd-card kpi-c ${inversa ? "kpi-c--inversa" : ""} ${className}`}
      aria-label={etiqueta}
      aria-busy={cargando || undefined}
    >
      <div className="kpi-c-arriba">
        {icono && (
          <span className="kpi-c-ico" aria-hidden>
            <Icono nombre={icono} pequeno />
          </span>
        )}
        <span className="kpi-c-etiqueta">{etiqueta}</span>
        {delta && !cargando && <PildoraDelta delta={delta} />}
        {abrir && (
          <Link to={abrir} className="kpi-c-abrir" aria-label={`Abrir ${etiqueta}`}>
            ↗
          </Link>
        )}
      </div>
      <div className="kpi-c-cuerpo">
        <div className="kpi-c-cifra">
          {cargando ? (
            <Esqueleto alto={26} ancho="60%" />
          ) : (
            <span className="kpi-c-valor">{typeof valor === "number" ? <Dinero centavos={valor} /> : valor}</span>
          )}
          {nota && !cargando && <span className="kpi-c-nota">{nota}</span>}
        </div>
        {indicador && <div className="kpi-c-indicador">{indicador}</div>}
      </div>
      {pie && (
        <Link to={pie.a} className="kpi-c-pie">
          {pie.texto}
          <Icono nombre="flecha" pequeno />
        </Link>
      )}
    </section>
  );
}

/** Título + rango aplicado + una acción (§4.2). */
export function CabeceraTarjeta({
  titulo,
  rango,
  accion,
  id,
  nivel = 2,
  rangoSoloEscritorio = false,
}: {
  titulo: string;
  rango?: string;
  /** El subtítulo repite lo que ya dice el título o el selector de periodo: en el celular se omite. */
  rangoSoloEscritorio?: boolean;
  accion?: ReactNode;
  id?: string;
  nivel?: 2 | 3;
}) {
  const Encabezado = nivel === 2 ? "h2" : "h3";
  return (
    <div className="cd-card-head cabecera-tarjeta">
      <div className="cabecera-texto">
        <Encabezado id={id} className="cd-card-title">
          {titulo}
        </Encabezado>
        {rango && <span className={`cd-card-rango ${rangoSoloEscritorio ? "solo-escritorio" : ""}`}>{rango}</span>}
      </div>
      {accion}
    </div>
  );
}

export interface Metrica {
  etiqueta: string;
  /** Centavos o texto. */
  valor: number | string;
  nota?: string;
  /** Color de dato: «ingreso» en verde; el resto en tinta. */
  tono?: "ingreso" | "alerta";
}

/** Tres o cuatro cifras sin caja, separadas por líneas finas (§4.3). */
export function FilaMetricas({ metricas, etiqueta }: { metricas: Metrica[]; etiqueta?: string }) {
  return (
    <dl className="fila-metricas" aria-label={etiqueta}>
      {metricas.map((m) => (
        <div key={m.etiqueta}>
          <dt>{m.etiqueta}</dt>
          <dd className={m.tono ? `tono-${m.tono}` : undefined}>
            {typeof m.valor === "number" ? formatoCOP(m.valor) : m.valor}
          </dd>
          {m.nota && <dd className="fila-metricas-nota">{m.nota}</dd>}
        </div>
      ))}
    </dl>
  );
}

/**
 * Tarjeta de hallazgo (§4.6). `frase` lleva `{cifra}` donde va la cifra resaltada:
 * «Gastaste {cifra} más en domicilios los viernes». Una por pantalla.
 */
export function TarjetaInsight({
  frase,
  cifra,
  chip = "Hallazgo",
  actual,
  total,
  alCambiar,
  compacta,
}: {
  frase: string;
  cifra: string;
  chip?: string;
  /** Paginación entre hallazgos (0-based). */
  actual?: number;
  total?: number;
  alCambiar?: (i: number) => void;
  /** Media altura: frase más pequeña, para compartir columna con otra tarjeta. */
  compacta?: boolean;
}) {
  const [antes, despues = ""] = frase.split("{cifra}");
  return (
    <section className={`cd-card insight ${compacta ? "insight--compacta" : ""}`} aria-live="polite">
      <span className="insight-chip">
        <Icono nombre="info" pequeno />
        {chip}
      </span>
      <p className="insight-frase">
        {antes}
        <span className="insight-cifra">{cifra}</span>
        {despues}
      </p>
      {total !== undefined && total > 1 && (
        <div className="insight-pasos" role="group" aria-label="Hallazgos">
          {Array.from({ length: total }, (_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Hallazgo ${i + 1} de ${total}`}
              aria-current={i === actual ? "true" : undefined}
              onClick={() => alCambiar?.(i)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
