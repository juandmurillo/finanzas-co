/**
 * Base de los gráficos compactos (docs/sistema/10_SISTEMA_DISENO_COMPACTO.md §3.3 y §5): medida real del
 * contenedor, escalas con marcas limpias, degradados y rayado del tema, interacción por puntero y teclado,
 * leyenda y tabla alternativa. Reglas de la skill `dataviz`: un eje, cuadrícula en línea fina continua,
 * barras de 24 px como máximo con 4 px de radio en la punta, 2 px de aire entre marcas y texto en tinta.
 */
import { useCallback, useEffect, useId, useState, type KeyboardEvent, type ReactNode } from "react";

import { abreviar, formatoCOP } from "@/shared/lib/formato";

import "./graficos.css";

export type Formato = (valor: number) => string;
export const formatoPorDefecto: Formato = (v) => formatoCOP(v);

/** Ancho real del contenedor, para dibujar a escala 1:1 (texto nítido, sin deformar). */
export function useAncho<T extends HTMLElement>(inicial = 600) {
  // Ref de función (no objeto): el contenedor se observa en cuanto existe.
  const [el, medir] = useState<T | null>(null);
  const [ancho, setAncho] = useState(inicial);
  useEffect(() => {
    if (!el || typeof ResizeObserver === "undefined") return;
    const obs = new ResizeObserver(([e]) => {
      const w = Math.round(e?.contentRect.width ?? 0);
      if (w > 0) setAncho(w);
    });
    obs.observe(el);
    return () => obs.disconnect();
  }, [el]);
  return { medir, ancho };
}

/** Máximo «redondo» y 3–4 marcas limpias para el eje: 0, 10 k, 20 k, 30 k. */
export function marcasEje(maximo: number, cuantas = 4): number[] {
  if (maximo <= 0) return [0];
  const paso0 = maximo / cuantas;
  const potencia = 10 ** Math.floor(Math.log10(paso0));
  const paso = ([1, 2, 2.5, 5, 10].find((m) => m * potencia >= paso0) ?? 10) * potencia;
  const n = Math.ceil(maximo / paso);
  return Array.from({ length: n + 1 }, (_, i) => i * paso);
}

/** Marcas para un rango con negativos (flujo): incluye el cero. */
export function marcasEjeConSigno(minimo: number, maximo: number, cuantas = 4): number[] {
  if (minimo >= 0) return marcasEje(maximo, cuantas);
  const amplitud = maximo - minimo;
  const base = marcasEje(amplitud, cuantas);
  const paso = base[1] ?? amplitud;
  const desde = Math.floor(minimo / paso) * paso;
  const hasta = Math.ceil(maximo / paso) * paso;
  // Por índice y redondeando a la precisión del paso (no a entero): con ejes de proporciones (paso 0,5) el
  // redondeo a entero repetía marcas (−0,5 → 0, 0,5 → 1), y las marcas son las claves de la cuadrícula.
  const n = Math.round((hasta - desde) / paso);
  return Array.from({ length: n + 1 }, (_, k) => Math.round((desde + k * paso) * 1e9) / 1e9);
}

/** Etiqueta compacta de eje en COP: «$ 0», «$ 250 k», «$ 1,2 M». */
export const etiquetaEje: Formato = (v) => (v === 0 ? "$ 0" : `${v < 0 ? "−" : ""}$ ${abreviar(Math.abs(v))}`);

/** Degradados y rayado del tema, con ids únicos por gráfico. */
export function useDefs() {
  const base = useId().replace(/:/g, "");
  return {
    area: `${base}-area`,
    barra: `${base}-barra`,
    rayado: `${base}-rayado`,
    Defs: ({ color = "var(--chart-1)" }: { color?: string }) => (
      <defs>
        <linearGradient id={`${base}-area`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.16" />
          <stop offset="100%" stopColor={color} stopOpacity="0.01" />
        </linearGradient>
        <linearGradient id={`${base}-barra`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="1" />
          <stop offset="100%" stopColor={color} stopOpacity="0.18" />
        </linearGradient>
        <pattern id={`${base}-rayado`} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="6" height="6" fill="var(--card)" />
          <rect width="3" height="6" fill="var(--chart-track)" />
        </pattern>
      </defs>
    ),
  };
}

/** Columna con punta redondeada (4 px) y base recta, que crece desde `y0`. Admite valores negativos. */
/** Los estilos «Geométrico» y «Futurista» quitan todo redondeo, también el de las barras de los gráficos. */
function sinRedondeo(): boolean {
  if (typeof document === "undefined") return false;
  const estilo = document.documentElement.dataset.estilo;
  return estilo === "recto" || estilo === "futurista";
}

export function rutaColumna(x: number, ancho: number, yValor: number, y0: number, radio = 4): string {
  const alto = Math.abs(y0 - yValor);
  if (alto < 0.5) return "";
  const r = sinRedondeo() ? 0 : Math.min(radio, ancho / 2, alto);
  if (yValor <= y0) {
    // hacia arriba
    return `M${x} ${y0} V${yValor + r} Q${x} ${yValor} ${x + r} ${yValor} H${x + ancho - r} Q${x + ancho} ${yValor} ${x + ancho} ${yValor + r} V${y0} Z`;
  }
  return `M${x} ${y0} V${yValor - r} Q${x} ${yValor} ${x + r} ${yValor} H${x + ancho - r} Q${x + ancho} ${yValor} ${x + ancho} ${yValor - r} V${y0} Z`;
}

/** Barra horizontal con punta redondeada a la derecha. */
export function rutaBarraH(x0: number, y: number, largo: number, grosor: number, radio = 4): string {
  if (largo < 0.5) return "";
  const r = sinRedondeo() ? 0 : Math.min(radio, grosor / 2, largo);
  const x1 = x0 + largo;
  return `M${x0} ${y} H${x1 - r} Q${x1} ${y} ${x1} ${y + r} V${y + grosor - r} Q${x1} ${y + grosor} ${x1 - r} ${y + grosor} H${x0} Z`;
}

/**
 * Elemento activo por puntero (el más cercano en X), toque y teclado (← → Inicio Fin, Escape suelta).
 * `fijo` es el activo cuando nadie interactúa (p. ej. el mes elegido).
 */
export function useActivo(n: number, xs: number[], fijo: number | null = null) {
  const [activo, setActivo] = useState<number | null>(null);
  const actual = activo ?? fijo;
  const elegirX = useCallback(
    (svg: SVGSVGElement, clienteX: number) => {
      const caja = svg.getBoundingClientRect();
      const vx = clienteX - caja.left;
      let mejor = 0;
      xs.forEach((x, i) => {
        if (Math.abs(x - vx) < Math.abs((xs[mejor] ?? x) - vx)) mejor = i;
      });
      setActivo(mejor);
    },
    [xs],
  );
  const alTeclado = (e: KeyboardEvent) => {
    if (n === 0) return;
    const base = actual ?? n - 1;
    const destino =
      e.key === "ArrowRight"
        ? Math.min(n - 1, base + 1)
        : e.key === "ArrowLeft"
          ? Math.max(0, base - 1)
          : e.key === "Home"
            ? 0
            : e.key === "End"
              ? n - 1
              : undefined;
    if (e.key === "Escape") return setActivo(null);
    if (destino === undefined) return;
    e.preventDefault();
    setActivo(destino);
  };
  return {
    activo: actual,
    interactuando: activo !== null,
    props: {
      tabIndex: 0,
      onPointerMove: (e: React.PointerEvent<SVGSVGElement>) => elegirX(e.currentTarget, e.clientX),
      onPointerDown: (e: React.PointerEvent<SVGSVGElement>) => elegirX(e.currentTarget, e.clientX),
      onPointerLeave: (e: React.PointerEvent<SVGSVGElement>) => e.pointerType === "mouse" && setActivo(null),
      onKeyDown: alTeclado,
      onBlur: () => setActivo(null),
    },
  };
}

/** Cuadrícula horizontal en línea fina continua y etiquetas del eje Y a la izquierda. */
export function Cuadricula({
  marcas,
  y,
  izquierda,
  derecha,
  formato = etiquetaEje,
}: {
  marcas: number[];
  y: (v: number) => number;
  izquierda: number;
  derecha: number;
  formato?: Formato;
}) {
  return (
    <g className="grafico-cuadricula" aria-hidden>
      {marcas.map((m) => (
        <g key={m}>
          <line x1={izquierda} x2={derecha} y1={y(m)} y2={y(m)} className={m === 0 ? "cero" : undefined} />
          <text x={izquierda - 6} y={y(m)} dy="0.32em" textAnchor="end">
            {formato(m)}
          </text>
        </g>
      ))}
    </g>
  );
}

/** Etiquetas del eje X; la activa se vuelve píldora (chip de fecha). */
export function EjeX({
  etiquetas,
  x,
  y,
  activo,
  cada = 1,
}: {
  etiquetas: string[];
  x: (i: number) => number;
  y: number;
  activo: number | null;
  cada?: number;
}) {
  return (
    <g className="grafico-eje-x" aria-hidden>
      {etiquetas.map((t, i) => {
        const esActivo = i === activo;
        if (!esActivo && i % cada !== 0 && i !== etiquetas.length - 1) return null;
        if (!esActivo && activo !== null && Math.abs(i - activo) * (x(1) - x(0)) < 34) return null;
        const ancho = Math.max(28, t.length * 6.4 + 14);
        return (
          <g key={i}>
            {esActivo && <rect x={x(i) - ancho / 2} y={y - 9} width={ancho} height={18} rx={9} className="chip-eje" />}
            <text x={x(i)} y={y} dy="0.34em" textAnchor="middle" className={esActivo ? "activo" : undefined}>
              {t}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export interface SerieLeyenda {
  nombre: string;
  /** Color de la marca (token CSS). */
  color: string;
  rayado?: boolean;
  linea?: boolean;
}

/** Leyenda: obligatoria con dos series o más. El texto va en tinta; el color, en la muestra. */
export function Leyenda({ series }: { series: SerieLeyenda[] }) {
  if (series.length < 2) return null;
  return (
    <ul className="grafico-leyenda">
      {series.map((s) => (
        <li key={s.nombre}>
          <i
            aria-hidden
            className={s.linea ? "linea" : s.rayado ? "rayado" : undefined}
            style={s.rayado ? undefined : { background: s.color }}
          />
          {s.nombre}
        </li>
      ))}
    </ul>
  );
}

/** Tabla equivalente para lectores de pantalla (siempre presente, oculta a la vista). */
export function TablaAlternativa({
  titulo,
  columnas,
  filas,
}: {
  titulo: string;
  columnas: string[];
  filas: (string | number)[][];
}) {
  // Una tabla no respeta el ancho de 1 px de sr-only: se envuelve en un div oculto para no desbordar.
  return (
    <div className="sr-only">
      <table>
        <caption>{titulo}</caption>
        <thead>
          <tr>
            {columnas.map((c) => (
              <th key={c} scope="col">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filas.map((f, i) => (
            <tr key={i}>
              {f.map((c, j) =>
                j === 0 ? (
                  <th key={j} scope="row">
                    {c}
                  </th>
                ) : (
                  <td key={j}>{c}</td>
                ),
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Recuadro flotante con fecha y valores del punto activo. `x` en píxeles dentro del contenedor. */
export function Globo({ x, ancho, y = 0, children }: { x: number; ancho: number; y?: number; children: ReactNode }) {
  const derecha = x > ancho * 0.6;
  // En un lienzo angosto (celular) el globo no cabe a ningún lado del punto: se centra sobre él sin salirse.
  const angosto = ancho < 420;
  const ANCHO_GLOBO = 196;
  const estilo = angosto
    ? { left: Math.max(4, Math.min(x - ANCHO_GLOBO / 2, ancho - ANCHO_GLOBO - 4)), top: y, maxWidth: ANCHO_GLOBO }
    : derecha
      ? { right: ancho - x + 10, top: y }
      : { left: x + 10, top: y };
  return (
    <div className="grafico-globo" role="status" style={estilo}>
      {children}
    </div>
  );
}

/** Contenedor común: mide el ancho, rotula el gráfico y agrupa leyenda, globo y tabla. */
export function MarcoGrafico({
  titulo,
  resumen,
  alto,
  medir,
  children,
  pie,
}: {
  titulo: string;
  /** Resumen textual del gráfico (qué muestra y el dato clave). */
  resumen?: string;
  alto: number;
  /** Ref de función de `useAncho` para medir el contenedor. */
  medir: (el: HTMLDivElement | null) => void;
  children: ReactNode;
  pie?: ReactNode;
}) {
  return (
    <figure className="grafico" aria-label={titulo}>
      <div ref={medir} className="grafico-lienzo" style={{ height: alto }}>
        {children}
      </div>
      {pie}
      {resumen && <figcaption className="sr-only">{resumen}</figcaption>}
    </figure>
  );
}

/**
 * Degradados por color que se desvanecen hacia el eje de origen: en columnas, de arriba (lleno) a la base;
 * en barras horizontales, del extremo (lleno) al inicio. Úsalos con `url(#${id}-${i})`.
 */
export function DefsDegradado({
  id,
  colores,
  horizontal = false,
  minimo = 0.16,
}: {
  id: string;
  colores: string[];
  horizontal?: boolean;
  minimo?: number;
}) {
  return (
    <defs>
      {colores.map((c, i) => (
        <linearGradient
          key={`${c}-${i}`}
          id={`${id}-${i}`}
          x1={horizontal ? "1" : "0"}
          y1="0"
          x2="0"
          y2={horizontal ? "0" : "1"}
        >
          <stop offset="0%" style={{ stopColor: c, stopOpacity: 1 }} />
          <stop offset="55%" style={{ stopColor: c, stopOpacity: 0.8 }} />
          <stop offset="100%" style={{ stopColor: c, stopOpacity: minimo }} />
        </linearGradient>
      ))}
    </defs>
  );
}

/**
 * Capa que se desliza con el dedo al cambiar de periodo (ver `ZonaPeriodo`): la serie (barras o línea) y las
 * etiquetas del eje X. Va recortada al área de trazado, así el eje Y, el marco, el título y la leyenda quedan
 * fijos mientras la serie entra y sale por los lados.
 */
export function CapaDesliza({
  izquierda,
  ancho,
  alto,
  children,
}: {
  izquierda: number;
  ancho: number;
  alto: number;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <>
      <defs>
        <clipPath id={`${id}-recorte`}>
          <rect x={izquierda - 2} y={0} width={Math.max(0, ancho - izquierda + 2)} height={alto} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${id}-recorte)`}>
        <g className="capa-desliza">{children}</g>
      </g>
    </>
  );
}
