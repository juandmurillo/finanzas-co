/**
 * Gráficos de barras del sistema compacto (§5.2–5.4, 5.8, 5.9). Una sola serie en color y el resto neutro;
 * lo proyectado va rayado. Presentacionales: reciben datos ya calculados.
 */
import { useId, useState, type ReactNode, type CSSProperties } from "react";

import {
  DefsDegradado,
  Cuadricula,
  EjeX,
  formatoPorDefecto,
  Globo,
  Leyenda,
  MarcoGrafico,
  marcasEje,
  marcasEjeConSigno,
  rutaBarraH,
  rutaColumna,
  TablaAlternativa,
  useActivo,
  useAncho,
  useDefs,
  type Formato,
  type SerieLeyenda,
  CapaDesliza,
} from "./base";

const IZQ = 48; // espacio del eje Y
const ABAJO = 26; // espacio del eje X
const ARRIBA = 18; // aire para la etiqueta de la barra activa

interface Base {
  /** Nombre accesible del gráfico. */
  titulo: string;
  resumen?: string;
  alto?: number;
  formato?: Formato;
}

// ---------- 5.2 Barras con la activa resaltada ----------

export interface PuntoBarra {
  etiqueta: string;
  /** Etiqueta larga para el globo y la tabla («noviembre 2026»). */
  detalle?: string;
  valor: number;
  /** Valor aún no ocurrido (proyección): se dibuja rayado. */
  proyectado?: boolean;
}

export function BarrasActivas({
  titulo,
  resumen,
  datos,
  activo: fijo = null,
  alElegir,
  alto = 200,
  formato = formatoPorDefecto,
  nombreSerie = "Valor",
}: Base & {
  datos: PuntoBarra[];
  /** Barra resaltada sin interacción (p. ej. el mes elegido); por defecto la última real. */
  activo?: number | null;
  alElegir?: (i: number) => void;
  nombreSerie?: string;
}) {
  const medida = useAncho<HTMLDivElement>();
  const { Defs, barra, rayado } = useDefs();
  const ancho = medida.ancho;
  const n = datos.length;
  const minimo = Math.min(0, ...datos.map((d) => d.valor));
  const maximo = Math.max(0, ...datos.map((d) => d.valor));
  const marcas = marcasEjeConSigno(minimo, maximo);
  const tope = marcas.at(-1) ?? 1;
  const piso = marcas[0] ?? 0;
  const banda = (ancho - IZQ) / Math.max(1, n);
  const grosor = Math.min(24, Math.max(4, banda * 0.56));
  const xc = (i: number) => IZQ + banda * i + banda / 2;
  const y = (v: number) => ARRIBA + (1 - (v - piso) / (tope - piso || 1)) * (alto - ARRIBA - ABAJO);
  const ultimoReal = datos.map((d) => !d.proyectado).lastIndexOf(true);
  const { activo, interactuando, props } = useActivo(
    n,
    datos.map((_, i) => xc(i)),
    fijo ?? ultimoReal,
  );
  const d = activo !== null ? datos[activo] : undefined;
  const reales = datos.filter((p) => !p.proyectado);
  const promedio = reales.length > 1 ? reales.reduce((t, p) => t + p.valor, 0) / reales.length : null;
  return (
    <MarcoGrafico titulo={titulo} resumen={resumen} alto={alto} medir={medida.medir}>
      <svg
        width={ancho}
        height={alto}
        role="group"
        aria-label={`${titulo}. Usa las flechas para recorrer los valores.`}
        {...props}
        onClick={() => activo !== null && alElegir?.(activo)}
      >
        <Defs />
        <Cuadricula marcas={marcas} y={y} izquierda={IZQ} derecha={ancho} />
        {datos.map((p, i) => {
          const esActivo = i === activo;
          const ruta = rutaColumna(xc(i) - grosor / 2, grosor, y(p.valor), y(0));
          return (
            <path
              key={i}
              d={ruta}
              style={{ "--i": i } as CSSProperties}
              className="barra columna"
              fill={p.proyectado ? `url(#${rayado})` : esActivo ? `url(#${barra})` : "var(--chart-track)"}
            />
          );
        })}
        {d && activo !== null && !d.proyectado && (
          <text
            x={xc(activo)}
            y={d.valor >= 0 ? y(d.valor) - 6 : y(d.valor) + 13}
            textAnchor="middle"
            className="grafico-valor"
          >
            {formato(d.valor)}
          </text>
        )}
        <EjeX
          etiquetas={datos.map((p) => p.etiqueta)}
          x={xc}
          y={alto - ABAJO / 2}
          activo={activo}
          cada={banda < 34 ? Math.ceil(34 / banda) : 1}
        />
      </svg>
      {d && activo !== null && (interactuando || d.proyectado) && (
        <Globo x={xc(activo)} ancho={ancho}>
          <span>{d.detalle ?? d.etiqueta}</span>
          <span className="globo-fila">
            {nombreSerie}
            <b>{formato(d.valor)}</b>
          </span>
          {d.proyectado && <small>Proyectado: aún no ocurre</small>}
          {!d.proyectado && promedio !== null && (
            <small>
              {d.valor >= promedio ? "+" : "−"} {formato(Math.abs(d.valor - promedio))} frente al promedio
            </small>
          )}
        </Globo>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Periodo", nombreSerie]}
        filas={datos.map((p) => [p.detalle ?? p.etiqueta, `${formato(p.valor)}${p.proyectado ? " (proyectado)" : ""}`])}
      />
    </MarcoGrafico>
  );
}

// ---------- 5.3 Barras agrupadas en dos tonos ----------

export interface SerieBarras extends SerieLeyenda {
  valores: number[];
}

export function BarrasAgrupadas({
  titulo,
  resumen,
  etiquetas,
  detalles,
  series,
  alto = 200,
  formato = formatoPorDefecto,
  relativo = false,
  desvanecer = true,
}: Base & {
  etiquetas: string[];
  detalles?: string[];
  series: SerieBarras[];
  /** Barras que llenan su espacio (grosor proporcional al ancho disponible) en vez del máximo de 12 px. */
  relativo?: boolean;
  /** Degradado que se funde con el fondo hacia la base de cada barra. */
  desvanecer?: boolean;
}) {
  const medida = useAncho<HTMLDivElement>();
  const idBase = useId().replace(/:/g, "");
  const ancho = medida.ancho;
  const n = etiquetas.length;
  const maximo = Math.max(0, ...series.flatMap((s) => s.valores));
  const marcas = marcasEje(maximo);
  const tope = marcas.at(-1) || 1;
  const banda = (ancho - IZQ) / Math.max(1, n);
  const grosor = relativo
    ? Math.min(56, Math.max(3, (banda * 0.8 - 3 * (series.length - 1)) / series.length))
    : Math.min(12, Math.max(3, (banda * 0.6 - 2 * (series.length - 1)) / series.length));
  const aire = relativo ? 3 : 2;
  const grupo = grosor * series.length + aire * (series.length - 1);
  const xc = (i: number) => IZQ + banda * i + banda / 2;
  const y = (v: number) => ARRIBA + (1 - v / tope) * (alto - ARRIBA - ABAJO);
  const { activo, interactuando, props } = useActivo(
    n,
    etiquetas.map((_, i) => xc(i)),
  );
  return (
    <MarcoGrafico titulo={titulo} resumen={resumen} alto={alto} medir={medida.medir} pie={<Leyenda series={series} />}>
      <svg width={ancho} height={alto} role="group" aria-label={titulo} {...props}>
        {desvanecer && (
          <defs>
            {series.map((s, k) => (
              <linearGradient key={k} id={`${idBase}-s${k}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" style={{ stopColor: s.color, stopOpacity: 1 }} />
                <stop offset="55%" style={{ stopColor: s.color, stopOpacity: 0.85 }} />
                <stop offset="100%" style={{ stopColor: s.color, stopOpacity: 0.16 }} />
              </linearGradient>
            ))}
          </defs>
        )}
        <Cuadricula marcas={marcas} y={y} izquierda={IZQ} derecha={ancho} />
        <CapaDesliza izquierda={IZQ} ancho={ancho} alto={alto}>
          {activo !== null && (
            <rect
              x={xc(activo) - banda / 2 + 2}
              y={ARRIBA}
              width={banda - 4}
              height={alto - ARRIBA - ABAJO}
              rx={6}
              className="banda-activa"
            />
          )}
          {etiquetas.map((_, i) =>
            series.map((s, k) => {
              const x = xc(i) - grupo / 2 + k * (grosor + aire);
              const v = s.valores[i] ?? 0;
              return (
                <path
                  key={`${i}-${k}`}
                  className="columna"
                  style={{ "--i": i } as CSSProperties}
                  d={rutaColumna(x, grosor, y(v), y(0), relativo ? 5 : 3)}
                  fill={desvanecer ? `url(#${idBase}-s${k})` : s.color}
                  opacity={activo === null || activo === i ? 1 : 0.55}
                />
              );
            }),
          )}
          <EjeX
            etiquetas={etiquetas}
            x={xc}
            y={alto - ABAJO / 2}
            activo={activo}
            cada={banda < 34 ? Math.ceil(34 / banda) : 1}
          />
        </CapaDesliza>
      </svg>
      {interactuando && activo !== null && (
        <Globo x={xc(activo)} ancho={ancho}>
          <span>{detalles?.[activo] ?? etiquetas[activo]}</span>
          {series.map((s) => (
            <span key={s.nombre} className="globo-fila">
              <i style={{ background: s.color }} aria-hidden />
              {s.nombre}
              <b>{formato(s.valores[activo] ?? 0)}</b>
            </span>
          ))}
          {series.length === 2 && (
            <span className="globo-fila globo-total">
              Diferencia
              <b>{formato((series[0]?.valores[activo] ?? 0) - (series[1]?.valores[activo] ?? 0))}</b>
            </span>
          )}
        </Globo>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Periodo", ...series.map((s) => s.nombre)]}
        filas={etiquetas.map((e, i) => [detalles?.[i] ?? e, ...series.map((s) => formato(s.valores[i] ?? 0))])}
      />
    </MarcoGrafico>
  );
}

// ---------- 5.4 Barras finas (series largas) ----------

export function BarrasFinas({
  titulo,
  resumen,
  datos,
  activo: fijo = null,
  alto = 140,
  formato = formatoPorDefecto,
  pieValor,
  relativo = false,
}: Base & {
  datos: PuntoBarra[];
  activo?: number | null;
  /** Cifra grande opcional abajo a la izquierda («$ 135,9 k de $ 17,8 M»). */
  pieValor?: ReactNode;
  /** Barras que ocupan su espacio (hasta 22 px) en vez de tiras de 2–5 px. */
  relativo?: boolean;
}) {
  const medida = useAncho<HTMLDivElement>();
  const ancho = medida.ancho;
  const n = datos.length;
  const maximo = Math.max(1, ...datos.map((d) => Math.abs(d.valor)));
  const banda = ancho / Math.max(1, n);
  const grosor = relativo ? Math.max(3, Math.min(22, banda * 0.8)) : Math.max(2, Math.min(5, banda * 0.45));
  const xc = (i: number) => banda * i + banda / 2;
  const base = alto - 4;
  const y = (v: number) => base - (Math.abs(v) / maximo) * (alto - 34);
  const { activo, interactuando, props } = useActivo(
    n,
    datos.map((_, i) => xc(i)),
    fijo ?? n - 1,
  );
  const d = activo !== null ? datos[activo] : undefined;
  const promedio = n ? datos.reduce((t, p) => t + p.valor, 0) / n : 0;
  const idFinas = useId().replace(/:/g, "");
  return (
    <MarcoGrafico titulo={titulo} resumen={resumen} alto={alto} medir={medida.medir} pie={pieValor}>
      <svg width={ancho} height={alto} role="group" aria-label={titulo} {...props}>
        <DefsDegradado id={idFinas} colores={["var(--chart-1)"]} />
        {datos.map((p, i) => (
          <rect
            key={i}
            x={xc(i) - grosor / 2}
            y={y(p.valor)}
            width={grosor}
            height={Math.max(2, base - y(p.valor))}
            rx={relativo ? Math.min(4, grosor / 2) : grosor / 2}
            fill={i === activo ? `url(#${idFinas}-0)` : "var(--chart-track)"}
          />
        ))}
      </svg>
      {d && activo !== null && interactuando && (
        <Globo x={xc(activo)} ancho={ancho} y={alto - 8}>
          <span>{d.detalle ?? d.etiqueta}</span>
          <b>{formato(d.valor)}</b>
          <small>
            {d.valor >= promedio ? "+" : "−"} {formato(Math.abs(d.valor - promedio))} frente al promedio
          </small>
        </Globo>
      )}
      {d && activo !== null && !interactuando && (
        <span
          className="grafico-etiqueta-flotante"
          style={{ left: Math.min(Math.max(xc(activo), 40), ancho - 40), top: Math.max(0, y(d.valor) - 26) }}
        >
          {formato(d.valor)}
        </span>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Periodo", "Valor"]}
        filas={datos.map((p) => [p.detalle ?? p.etiqueta, formato(p.valor)])}
      />
    </MarcoGrafico>
  );
}

// ---------- 5.8 Barras apiladas por categoría ----------

export function BarrasApiladas({
  titulo,
  resumen,
  etiquetas,
  detalles,
  series,
  alto = 200,
  formato = formatoPorDefecto,
}: Base & { etiquetas: string[]; detalles?: string[]; series: SerieBarras[] }) {
  const medida = useAncho<HTMLDivElement>();
  const ancho = medida.ancho;
  const n = etiquetas.length;
  const totales = etiquetas.map((_, i) => series.reduce((t, s) => t + Math.max(0, s.valores[i] ?? 0), 0));
  const idApiladas = useId().replace(/:/g, "");
  const marcas = marcasEje(Math.max(0, ...totales));
  const tope = marcas.at(-1) || 1;
  const banda = (ancho - IZQ) / Math.max(1, n);
  const grosor = Math.min(24, Math.max(6, banda * 0.5));
  const xc = (i: number) => IZQ + banda * i + banda / 2;
  const alturaUtil = alto - ARRIBA - ABAJO;
  const y = (v: number) => ARRIBA + (1 - v / tope) * alturaUtil;
  const { activo, interactuando, props } = useActivo(
    n,
    etiquetas.map((_, i) => xc(i)),
  );
  return (
    <MarcoGrafico titulo={titulo} resumen={resumen} alto={alto} medir={medida.medir} pie={<Leyenda series={series} />}>
      <svg width={ancho} height={alto} role="group" aria-label={titulo} {...props}>
        <DefsDegradado id={idApiladas} colores={series.map((s) => s.color)} minimo={0.35} />
        <Cuadricula marcas={marcas} y={y} izquierda={IZQ} derecha={ancho} />
        <CapaDesliza izquierda={IZQ} ancho={ancho} alto={alto}>
          {etiquetas.map((_, i) => {
            let acumulado = 0;
            const tramos = series.map((s, k) => ({ s, k, v: Math.max(0, s.valores[i] ?? 0) })).filter((t) => t.v > 0);
            return (
              <g
                key={i}
                className="columna"
                style={{ "--i": i } as CSSProperties}
                opacity={activo === null || activo === i ? 1 : 0.55}
              >
                {tramos.map((t, j) => {
                  const y1 = y(acumulado);
                  acumulado += t.v;
                  const y2 = y(acumulado);
                  const ultimo = j === tramos.length - 1;
                  // 2 px de aire entre tramos (color de la superficie)
                  const alto = Math.max(0, y1 - y2 - (j > 0 ? 2 : 0));
                  return ultimo ? (
                    <path
                      key={t.k}
                      d={rutaColumna(xc(i) - grosor / 2, grosor, y2, y2 + alto, 4)}
                      fill={`url(#${idApiladas}-${t.k})`}
                    />
                  ) : (
                    <rect
                      key={t.k}
                      x={xc(i) - grosor / 2}
                      y={y2}
                      width={grosor}
                      height={alto}
                      fill={`url(#${idApiladas}-${t.k})`}
                    />
                  );
                })}
              </g>
            );
          })}
          <EjeX
            etiquetas={etiquetas}
            x={xc}
            y={alto - ABAJO / 2}
            activo={activo}
            cada={banda < 34 ? Math.ceil(34 / banda) : 1}
          />
        </CapaDesliza>
      </svg>
      {interactuando && activo !== null && (
        <Globo x={xc(activo)} ancho={ancho}>
          <span>{detalles?.[activo] ?? etiquetas[activo]}</span>
          {series
            .filter((s) => (s.valores[activo] ?? 0) > 0)
            .map((s) => (
              <span key={s.nombre} className="globo-fila">
                <i style={{ background: s.color }} aria-hidden />
                {s.nombre}
                <b>{formato(s.valores[activo] ?? 0)}</b>
              </span>
            ))}
          <span className="globo-fila globo-total">
            Total <b>{formato(totales[activo] ?? 0)}</b>
          </span>
        </Globo>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Periodo", ...series.map((s) => s.nombre), "Total"]}
        filas={etiquetas.map((e, i) => [
          detalles?.[i] ?? e,
          ...series.map((s) => formato(s.valores[i] ?? 0)),
          formato(totales[i] ?? 0),
        ])}
      />
    </MarcoGrafico>
  );
}

// ---------- 5.9 Barras horizontales comparativas ----------

export function BarrasHorizontales({
  titulo,
  resumen,
  datos,
  formato = formatoPorDefecto,
  resaltar,
}: Omit<Base, "alto"> & {
  datos: { etiqueta: string; valor: number; color?: string }[];
  /** Índice de la barra en color; las demás van neutras. Sin él, todas van en `chart-1`. */
  resaltar?: number;
}) {
  const medida = useAncho<HTMLDivElement>();
  const ancho = medida.ancho;
  const fila = 30;
  const grosor = 14;
  const etiquetaAncho = Math.min(140, ancho * 0.32);
  const alto = datos.length * fila;
  const maximo = Math.max(1, ...datos.map((d) => d.valor));
  const largoUtil = ancho - etiquetaAncho - 8;
  const total = datos.reduce((t, d) => t + Math.max(0, d.valor), 0);
  const [encima, setEncima] = useState<number | null>(null);
  const sel = encima !== null ? datos[encima] : undefined;
  const idHoriz = useId().replace(/:/g, "");
  const colores = datos.map((d, i) =>
    resaltar === undefined ? (d.color ?? "var(--chart-1)") : i === resaltar ? "var(--chart-1)" : "var(--chart-track)",
  );
  return (
    <MarcoGrafico titulo={titulo} resumen={resumen} alto={alto} medir={medida.medir}>
      <svg width={ancho} height={alto} role="img" aria-label={titulo} onPointerLeave={() => setEncima(null)}>
        <DefsDegradado id={idHoriz} colores={colores} horizontal minimo={0.22} />
        {datos.map((d, i) => {
          const largo = (Math.max(0, d.valor) / maximo) * largoUtil;
          const texto = formato(d.valor);
          const cabeDentro = largo > texto.length * 6.6 + 16;
          const yb = i * fila + (fila - grosor) / 2;
          const color =
            resaltar === undefined
              ? (d.color ?? "var(--chart-1)")
              : i === resaltar
                ? "var(--chart-1)"
                : "var(--chart-track)";
          return (
            <g
              key={d.etiqueta}
              onPointerEnter={() => setEncima(i)}
              opacity={encima === null || encima === i ? 1 : 0.55}
            >
              <rect x={0} y={i * fila} width={ancho} height={fila} fill="transparent" />
              <text x={0} y={yb + grosor / 2} dy="0.34em" className="grafico-etiqueta-h">
                {d.etiqueta.length > 18 ? `${d.etiqueta.slice(0, 17)}…` : d.etiqueta}
              </text>
              <path
                d={rutaBarraH(etiquetaAncho, yb, largo, grosor)}
                fill={color === "var(--chart-track)" ? color : `url(#${idHoriz}-${i})`}
              />
              <text
                x={cabeDentro ? etiquetaAncho + largo - 8 : etiquetaAncho + largo + 6}
                y={yb + grosor / 2}
                dy="0.34em"
                textAnchor={cabeDentro ? "end" : "start"}
                className={`grafico-valor ${cabeDentro && color !== "var(--chart-track)" ? "dentro" : ""}`}
              >
                {texto}
              </text>
            </g>
          );
        })}
      </svg>
      {sel && encima !== null && (
        <Globo x={etiquetaAncho + (Math.max(0, sel.valor) / maximo) * largoUtil} ancho={ancho} y={encima * fila + fila}>
          <span>{sel.etiqueta}</span>
          <b>{formato(sel.valor)}</b>
          {total > 0 && <small>{Math.round((Math.max(0, sel.valor) / total) * 100)} % del total</small>}
        </Globo>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Concepto", "Valor"]}
        filas={datos.map((d) => [d.etiqueta, formato(d.valor)])}
      />
    </MarcoGrafico>
  );
}
