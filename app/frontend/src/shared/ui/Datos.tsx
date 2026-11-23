/**
 * Primitivas de detalle del sistema compacto (§4.4, 4.5, 4.7 y gráfico 5.5): lista densa, tabla densa con
 * estado en punto, mini tarjeta de cuenta o meta y barra de límite. Presentacionales puras.
 */
import { Link } from "@tanstack/react-router";
import { Fragment, type ReactNode } from "react";

import { formatoCOP, porcentaje } from "@/shared/lib/formato";

import { Vacio } from "./Estados";
import { Icono, type NombreIcono } from "./Icono";
import "./primitivas.css";

// ---------- Lista densa ----------

export interface FilaLista {
  clave: string | number;
  titulo: string;
  detalle?: string;
  /** Ícono, logo o burbuja de categoría (28 px). */
  inicio?: ReactNode;
  /** Centavos con signo: los positivos van en verde con «+», los negativos en tinta con «−». */
  monto?: number;
  /** Contenido libre a la derecha en lugar del monto (insignia, días restantes…). */
  fin?: ReactNode;
  alElegir?: () => void;
}

export function ListaDensa({
  filas,
  max = 5,
  verTodas,
  vacio = "Nada por aquí todavía.",
  etiqueta,
}: {
  filas: FilaLista[];
  max?: number;
  verTodas?: { texto?: string; a: string };
  vacio?: string;
  etiqueta?: string;
}) {
  if (filas.length === 0) return <p className="lista-densa-vacia">{vacio}</p>;
  const visibles = filas.slice(0, max);
  return (
    <>
      <ul className="lista-densa" aria-label={etiqueta}>
        {visibles.map((f) => {
          const contenido = (
            <>
              {f.inicio && <span className="lista-densa-inicio">{f.inicio}</span>}
              <span className="lista-densa-texto">
                <b>{f.titulo}</b>
                {f.detalle && <small>{f.detalle}</small>}
              </span>
              {f.fin ??
                (f.monto !== undefined && (
                  <b className={`lista-densa-monto cd-num ${f.monto > 0 ? "tono-ingreso" : ""}`}>
                    {f.monto > 0 ? "+ " : f.monto < 0 ? "− " : ""}
                    {formatoCOP(Math.abs(f.monto))}
                  </b>
                ))}
            </>
          );
          return (
            <li key={f.clave}>
              {f.alElegir ? (
                <button type="button" className="lista-densa-fila" onClick={f.alElegir}>
                  {contenido}
                </button>
              ) : (
                <div className="lista-densa-fila">{contenido}</div>
              )}
            </li>
          );
        })}
      </ul>
      {verTodas && filas.length > max && (
        <Link to={verTodas.a} className="cd-link lista-densa-mas">
          {verTodas.texto ?? `Ver las ${filas.length}`} →
        </Link>
      )}
    </>
  );
}

// ---------- Tabla densa ----------

export type TonoEstado = "positivo" | "aviso" | "negativo" | "neutro" | "info";

/** Estado como punto de color + texto: nunca solo color. */
export function EstadoPunto({ tono, texto }: { tono: TonoEstado; texto: string }) {
  return (
    <span className={`estado-punto estado-punto--${tono}`}>
      <i aria-hidden />
      {texto}
    </span>
  );
}

export interface Columna<T> {
  clave: string;
  titulo: string;
  alinear?: "inicio" | "fin";
  /** Se oculta en el celular (la fila se vuelve tarjeta compacta). */
  secundaria?: boolean;
  /** Clase extra para la celda (p. ej. «acciones»). */
  clase?: string;
  render: (fila: T) => ReactNode;
}

export function TablaDensa<T>({
  columnas,
  filas,
  claveFila,
  titulo,
  seleccionada,
  alElegir,
  vacio,
  grupo,
  cabeceraGrupo,
}: {
  columnas: Columna<T>[];
  filas: T[];
  claveFila: (fila: T) => string | number;
  /** Descripción accesible de la tabla. */
  titulo: string;
  seleccionada?: string | number | null;
  alElegir?: (fila: T) => void;
  vacio?: { titulo: string; texto?: string; accion?: ReactNode };
  /** Agrupa filas consecutivas con la misma clave (p. ej. el día) bajo una fila de encabezado. */
  grupo?: (fila: T) => string;
  cabeceraGrupo?: (clave: string, filas: T[]) => ReactNode;
}) {
  if (filas.length === 0)
    return <Vacio titulo={vacio?.titulo ?? "Sin resultados"} texto={vacio?.texto} accion={vacio?.accion} />;
  return (
    <div className="tabla-densa-caja">
      <table className="tabla-densa">
        <caption className="sr-only">{titulo}</caption>
        <thead>
          <tr>
            {columnas.map((c) => (
              <th
                key={c.clave}
                scope="col"
                className={`${c.alinear === "fin" ? "fin" : ""} ${c.secundaria ? "secundaria" : ""}`}
              >
                {c.titulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => {
            const clave = claveFila(f);
            const g = grupo?.(f);
            const nuevoGrupo = g !== undefined && (i === 0 || grupo?.(filas[i - 1] as T) !== g);
            const fila = (
              <tr
                key={clave}
                aria-selected={seleccionada === undefined ? undefined : seleccionada === clave}
                tabIndex={alElegir ? 0 : undefined}
                onClick={alElegir ? () => alElegir(f) : undefined}
                onKeyDown={
                  alElegir
                    ? (e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          alElegir(f);
                        }
                      }
                    : undefined
                }
                className={alElegir ? "elegible" : undefined}
              >
                {columnas.map((c) => (
                  <td
                    key={c.clave}
                    data-titulo={c.titulo}
                    className={`${c.alinear === "fin" ? "fin cd-num" : ""} ${c.secundaria ? "secundaria" : ""} ${c.clase ?? ""}`}
                  >
                    {c.render(f)}
                  </td>
                ))}
              </tr>
            );
            if (!nuevoGrupo || g === undefined) return fila;
            const delGrupo = filas.filter((x) => grupo?.(x) === g);
            return (
              <Fragment key={`grupo-${g}-${clave}`}>
                <tr className="tabla-grupo">
                  <th colSpan={columnas.length} scope="colgroup">
                    {cabeceraGrupo ? cabeceraGrupo(g, delGrupo) : g}
                  </th>
                </tr>
                {fila}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---------- Mini tarjeta ----------

/**
 * Cuenta, meta o activo en rejilla 2×2 (§4.7). `color` es un token de color (`chart-3`, `positive`…):
 * el color sigue a la entidad, no al orden.
 */
export function MiniTarjeta({
  titulo,
  icono,
  color = "chart-1",
  valor,
  meta,
  detalle,
  a,
  estado,
}: {
  titulo: string;
  icono: NombreIcono;
  color?: string;
  /** Centavos. */
  valor: number;
  /** Centavos: si existe, muestra «de $ meta» y la barra de avance. */
  meta?: number;
  detalle?: string;
  a?: string;
  estado?: { tono: TonoEstado; texto: string };
}) {
  const avance = meta ? Math.max(0, Math.min(1, valor / meta)) : null;
  const cuerpo = (
    <>
      <span
        className="mini-tarjeta-ico"
        style={{ background: `color-mix(in srgb, var(--${color}) 18%, transparent)`, color: `var(--${color})` }}
        aria-hidden
      >
        <Icono nombre={icono} pequeno />
      </span>
      <b className="mini-tarjeta-titulo">{titulo}</b>
      <span className="mini-tarjeta-valor cd-num">
        {formatoCOP(valor)}
        {meta !== undefined && <small> de {formatoCOP(meta)}</small>}
      </span>
      {detalle && <small className="mini-tarjeta-detalle">{detalle}</small>}
      {estado && <EstadoPunto {...estado} />}
      {avance !== null && (
        <span
          className="mini-tarjeta-barra"
          role="progressbar"
          aria-label={`Avance de ${titulo}`}
          aria-valuenow={Math.round(avance * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${avance * 100}%`, background: `var(--${color})` }} />
        </span>
      )}
    </>
  );
  return a ? (
    <Link to={a} className="cd-card mini-tarjeta mini-tarjeta--enlace">
      {cuerpo}
    </Link>
  ) : (
    <div className="cd-card mini-tarjeta">{cuerpo}</div>
  );
}

// ---------- Barra de límite ----------

/**
 * Lo gastado sólido y lo restante rayado (§5.5). Desde el 80 % se marca en ámbar; pasado el límite, en rojo
 * con texto. `ritmo` (0–1) dibuja la marca de lo que «debería» llevarse a hoy.
 */
export function BarraLimite({
  etiqueta,
  gastado,
  limite,
  ritmo,
  segmentos,
  compacta,
  alta,
}: {
  etiqueta: string;
  gastado: number;
  limite: number;
  ritmo?: number;
  /** Divide la barra en tramos (p. ej. 6) en lugar de una barra continua. */
  segmentos?: number;
  compacta?: boolean;
  /** Pista más gruesa, para listas donde la barra es lo principal. */
  alta?: boolean;
}) {
  const uso = limite > 0 ? gastado / limite : 0;
  const estado = uso > 1 ? "excedido" : uso >= 0.8 ? "aviso" : "normal";
  const restante = limite - gastado;
  const ancho = `${Math.min(1, uso) * 100}%`;
  return (
    <div
      className={`barra-limite barra-limite--${estado} ${compacta ? "barra-limite--compacta" : ""} ${alta ? "barra-limite--alta" : ""}`}
    >
      {!compacta && (
        <div className="barra-limite-texto">
          <span>
            <b className="cd-num">{formatoCOP(gastado)}</b> de {formatoCOP(limite)}
          </span>
          <span className="cd-num">
            {estado === "excedido" ? (
              <span className="tono-alerta">
                <Icono nombre="alerta" pequeno /> Te pasaste {formatoCOP(-restante)}
              </span>
            ) : (
              `Quedan ${formatoCOP(restante)}`
            )}
          </span>
        </div>
      )}
      <div
        className="barra-limite-pista"
        role="meter"
        aria-label={etiqueta}
        aria-valuemin={0}
        aria-valuemax={limite}
        aria-valuenow={Math.min(gastado, limite)}
        aria-valuetext={`${porcentaje(uso, 0)} usado: ${formatoCOP(gastado)} de ${formatoCOP(limite)}`}
      >
        {segmentos ? (
          Array.from({ length: segmentos }, (_, i) => {
            const lleno = Math.max(0, Math.min(1, uso * segmentos - i));
            return (
              <span key={i} className="barra-limite-tramo">
                <i style={{ width: `${lleno * 100}%` }} />
              </span>
            );
          })
        ) : (
          <i className="barra-limite-lleno" style={{ width: ancho }} />
        )}
        {ritmo !== undefined && (
          <span
            className="barra-limite-ritmo"
            style={{ left: `${Math.max(0, Math.min(1, ritmo)) * 100}%` }}
            title={`Ritmo ideal a hoy: ${porcentaje(ritmo, 0)}`}
          />
        )}
      </div>
    </div>
  );
}
