/**
 * Área con degradado + serie de comparación (§5.1): la serie principal lleva línea de 2 px y un lavado que
 * se apaga hacia abajo; la de comparación (periodo anterior) va como línea tenue sin área. Punto activo con
 * anillo de superficie y halo, guía vertical y la fecha activa como chip en el eje.
 */
import { rutaSuave } from "@/shared/lib/curvas";

import {
  Cuadricula,
  EjeX,
  formatoPorDefecto,
  Globo,
  Leyenda,
  MarcoGrafico,
  marcasEjeConSigno,
  TablaAlternativa,
  useActivo,
  useAncho,
  useDefs,
  type Formato,
} from "./base";

const IZQ = 48;
const ABAJO = 26;
const ARRIBA = 10;

export interface PuntoSerie {
  etiqueta: string;
  detalle?: string;
  /** `null` = aún no ocurre (p. ej. días que faltan del mes): la serie principal se corta ahí. */
  valor: number | null;
  /** Valor del periodo de comparación en la misma posición. */
  anterior?: number;
  /** Valor de referencia en esa posición (p. ej. el ritmo ideal). */
  ideal?: number;
}

export function AreaComparada({
  titulo,
  resumen,
  datos,
  nombre = "Este periodo",
  nombreAnterior = "Periodo anterior",
  alto = 220,
  formato = formatoPorDefecto,
  limite,
  nombreIdeal = "Ritmo ideal",
}: {
  titulo: string;
  resumen?: string;
  datos: PuntoSerie[];
  nombre?: string;
  nombreAnterior?: string;
  alto?: number;
  formato?: Formato;
  /** Línea horizontal de referencia (p. ej. el límite del presupuesto). */
  limite?: { valor: number; etiqueta: string };
  nombreIdeal?: string;
}) {
  const medida = useAncho<HTMLDivElement>();
  const { Defs, area } = useDefs();
  const ancho = medida.ancho;
  const n = datos.length;
  const conAnterior = datos.some((d) => d.anterior !== undefined);
  const conIdeal = datos.some((d) => d.ideal !== undefined);
  const valores = datos.flatMap((d) =>
    [d.valor, d.anterior, d.ideal].filter((v): v is number => v !== undefined && v !== null),
  );
  if (limite) valores.push(limite.valor);
  const marcas = marcasEjeConSigno(Math.min(0, ...valores), Math.max(0, ...valores));
  const tope = marcas.at(-1) ?? 1;
  const piso = marcas[0] ?? 0;
  const x = (i: number) => IZQ + 8 + (n <= 1 ? 0 : (i / (n - 1)) * (ancho - IZQ - 16));
  const y = (v: number) => ARRIBA + (1 - (v - piso) / (tope - piso || 1)) * (alto - ARRIBA - ABAJO);
  const puntos = datos.flatMap((d, i) => (d.valor === null ? [] : [[x(i), y(d.valor)] as [number, number]]));
  const linea = rutaSuave(puntos);
  const base = y(Math.max(piso, 0));
  const ultimoX = puntos.at(-1)?.[0] ?? x(0);
  const relleno = puntos.length > 1 ? `${linea} L${ultimoX} ${base} L${puntos[0]?.[0] ?? x(0)} ${base} Z` : "";
  const lineaIdeal = conIdeal
    ? rutaSuave(datos.flatMap((d, i) => (d.ideal !== undefined ? [[x(i), y(d.ideal)] as [number, number]] : [])))
    : "";
  const lineaAnterior = conAnterior
    ? rutaSuave(datos.flatMap((d, i) => (d.anterior !== undefined ? [[x(i), y(d.anterior)] as [number, number]] : [])))
    : "";
  const { activo, interactuando, props } = useActivo(
    n,
    datos.map((_, i) => x(i)),
  );
  const d = activo !== null ? datos[activo] : undefined;
  const pocos = n <= 12;
  return (
    <MarcoGrafico
      titulo={titulo}
      resumen={resumen}
      alto={alto}
      medir={medida.medir}
      pie={
        <Leyenda
          series={
            conAnterior
              ? [
                  { nombre, color: "var(--chart-1)" },
                  { nombre: nombreAnterior, color: "var(--ink-subtle)", linea: true },
                  ...(conIdeal ? [{ nombre: nombreIdeal, color: "var(--ink-muted)", linea: true }] : []),
                  ...(limite ? [{ nombre: limite.etiqueta, color: "var(--ink)", linea: true }] : []),
                ]
              : []
          }
        />
      }
    >
      <svg width={ancho} height={alto} role="group" aria-label={`${titulo}. Usa las flechas para recorrer.`} {...props}>
        <Defs />
        <Cuadricula marcas={marcas} y={y} izquierda={IZQ} derecha={ancho} />
        {activo !== null && pocos && (
          <rect
            x={x(activo) - Math.min(22, (ancho - IZQ) / n / 2)}
            y={ARRIBA}
            width={Math.min(44, (ancho - IZQ) / n)}
            height={alto - ARRIBA - ABAJO}
            rx={6}
            className="banda-activa"
          />
        )}
        {relleno && <path d={relleno} fill={`url(#${area})`} />}
        {lineaAnterior && <path d={lineaAnterior} className="linea-anterior" />}
        {lineaIdeal && <path d={lineaIdeal} className="linea-ideal" />}
        {limite && (
          <g className="linea-limite">
            <line x1={IZQ} x2={ancho} y1={y(limite.valor)} y2={y(limite.valor)} />
            <text x={ancho - 4} y={y(limite.valor) - 5} textAnchor="end">
              {limite.etiqueta} {formato(limite.valor)}
            </text>
          </g>
        )}
        <path d={linea} className="linea-principal" pathLength={1} />
        {activo !== null && !pocos && (
          <line x1={x(activo)} x2={x(activo)} y1={ARRIBA} y2={alto - ABAJO} className="guia-activa" />
        )}
        {d && d.valor !== null && activo !== null && (
          <g className="punto-activo">
            <circle cx={x(activo)} cy={y(d.valor)} r={9} className="halo" />
            <circle cx={x(activo)} cy={y(d.valor)} r={4.5} />
          </g>
        )}
        <EjeX
          etiquetas={datos.map((p) => p.etiqueta)}
          x={x}
          y={alto - ABAJO / 2}
          activo={activo}
          cada={Math.max(1, Math.ceil(n / Math.max(2, Math.floor((ancho - IZQ) / 56))))}
        />
      </svg>
      {interactuando && d && activo !== null && (
        <Globo x={x(activo)} ancho={ancho}>
          <span>{d.detalle ?? d.etiqueta}</span>
          <span className="globo-fila">
            <i style={{ background: "var(--chart-1)" }} aria-hidden />
            {nombre}
            <b>{d.valor === null ? "—" : formato(d.valor)}</b>
          </span>
          {d.anterior !== undefined && (
            <span className="globo-fila">
              <i className="linea" aria-hidden />
              {nombreAnterior}
              <b>{formato(d.anterior)}</b>
            </span>
          )}
          {d.ideal !== undefined && (
            <span className="globo-fila">
              {nombreIdeal}
              <b>{formato(d.ideal)}</b>
            </span>
          )}
          {d.valor !== null && d.ideal !== undefined && (
            <small>
              {d.valor > d.ideal
                ? `${formato(d.valor - d.ideal)} por encima del ritmo`
                : `${formato(d.ideal - d.valor)} por debajo del ritmo`}
            </small>
          )}
        </Globo>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={conAnterior ? ["Periodo", nombre, nombreAnterior] : ["Periodo", nombre]}
        filas={datos.map((p) => [
          p.detalle ?? p.etiqueta,
          p.valor === null ? "—" : formato(p.valor),
          ...(conAnterior ? [p.anterior !== undefined ? formato(p.anterior) : "—"] : []),
        ])}
      />
    </MarcoGrafico>
  );
}
