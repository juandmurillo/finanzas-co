/** Interacción común de los gráficos SVG (regla de la app, fase 8): al pasar el mouse o tocar, una guía
 * vertical marca el punto y un recuadro muestra sus valores. Uso: envolver el <svg> en <ZonaGrafico>, poner
 * <Sensores> dentro del svg y <TooltipGrafico> fuera de él. */
import type { ReactNode } from "react";

/** Franjas invisibles que detectan el mouse por índice (una por mes, día…). */
export function Sensores({
  n,
  x,
  ancho,
  alto,
  arriba = 0,
  alCambiar,
  activo,
}: {
  n: number;
  /** Centro de la franja `i` en coordenadas del viewBox. */
  x: (i: number) => number;
  ancho: number;
  alto: number;
  arriba?: number;
  alCambiar: (i: number | null) => void;
  activo: number | null;
}) {
  return (
    <g onMouseLeave={() => alCambiar(null)}>
      {activo !== null && (
        <line
          x1={x(activo)}
          x2={x(activo)}
          y1={arriba}
          y2={alto}
          stroke="var(--ink-subtle)"
          strokeWidth="1"
          strokeDasharray="3 3"
          pointerEvents="none"
        />
      )}
      {Array.from({ length: n }, (_, i) => (
        <rect
          key={i}
          x={x(i) - ancho / 2}
          y={arriba}
          width={ancho}
          height={alto - arriba}
          fill="transparent"
          onMouseEnter={() => alCambiar(i)}
          onTouchStart={() => alCambiar(i)}
        />
      ))}
    </g>
  );
}

/** Sensor para ejes proporcionales al tiempo: una sola zona que elige el punto más cercano al cursor. */
export function SensorContinuo({
  xs,
  izquierda,
  ancho,
  arriba,
  alto,
  activo,
  alCambiar,
}: {
  xs: number[];
  izquierda: number;
  ancho: number;
  arriba: number;
  alto: number;
  activo: number | null;
  alCambiar: (i: number | null) => void;
}) {
  const elegir = (e: SVGRectElement, clienteX: number) => {
    const matriz = e.ownerSVGElement?.getScreenCTM();
    if (!matriz) return;
    const vx = (clienteX - matriz.e) / matriz.a;
    const cercano = xs.reduce((mejor, x, i) => (Math.abs(x - vx) < Math.abs((xs[mejor] ?? x) - vx) ? i : mejor), 0);
    alCambiar(cercano);
  };
  const guia = activo !== null ? xs[activo] : undefined;
  return (
    <g>
      {guia !== undefined && (
        <line
          x1={guia}
          x2={guia}
          y1={arriba}
          y2={alto}
          stroke="var(--ink-subtle)"
          strokeWidth="1"
          strokeDasharray="3 3"
          pointerEvents="none"
        />
      )}
      <rect
        x={izquierda}
        y={arriba}
        width={ancho}
        height={alto - arriba}
        fill="transparent"
        onMouseMove={(e) => elegir(e.currentTarget, e.clientX)}
        onMouseLeave={() => alCambiar(null)}
        onTouchStart={(e) => {
          const t = e.touches[0];
          if (t) elegir(e.currentTarget, t.clientX);
        }}
        onTouchMove={(e) => {
          const t = e.touches[0];
          if (t) elegir(e.currentTarget, t.clientX);
        }}
      />
    </g>
  );
}

/** Recuadro con los valores del punto activo; `izquierda` en % del ancho del gráfico. */
export function TooltipGrafico({ izquierda, children }: { izquierda: number; children: ReactNode }) {
  const lado = izquierda > 60 ? { right: `${100 - izquierda + 2}%` } : { left: `${izquierda + 2}%` };
  return (
    <div className="grafico-tooltip" role="status" style={lado}>
      {children}
    </div>
  );
}

export function ZonaGrafico({ children }: { children: ReactNode }) {
  return <div style={{ position: "relative" }}>{children}</div>;
}
