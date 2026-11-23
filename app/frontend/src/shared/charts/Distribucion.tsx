/**
 * Composición de un total (§5.7): barra fina segmentada (2 px de aire entre partes) y lista con muestra,
 * nombre, porcentaje y monto. Con el mouse, pasar por una parte la resalta y muestra su globo; el clic lleva a sus
 * movimientos. Con el dedo, el primer toque fija la parte y muestra su detalle con «Ver movimientos»; con el
 * teclado, las flechas recorren las partes y Enter las abre. Un marcador se desliza a la parte elegida. La barra
 * muestra todas las partes; la lista muestra las primeras y «Ver todas».
 */
import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";

import { formatoCOP, porcentaje } from "@/shared/lib/formato";

import { Globo, TablaAlternativa, useAncho, type Formato } from "./base";

export interface Parte {
  nombre: string;
  valor: number;
  /** Identificador para navegar al elegirla (p. ej. el id de la categoría). */
  id?: number | null;
  /** Color propio (p. ej. el de la categoría); sin él, la paleta por posición. */
  color?: string;
}

const COLORES = Array.from({ length: 8 }, (_, i) => `var(--cat-${i + 1})`);

/** Las 8 primeras con la paleta de categorías; desde la 9.ª, tonos más claros de la misma paleta (pedido:
 * mostrar todas en la barra, sin juntarlas en «Otras»). */
function color(i: number): string {
  const base = COLORES[i % COLORES.length] ?? "var(--ink-subtle)";
  return i < COLORES.length ? base : `color-mix(in srgb, ${base} ${i < 16 ? 55 : 30}%, var(--card))`;
}

export function Distribucion({
  titulo,
  partes,
  formato = (v: number) => formatoCOP(v),
  visibles = 5,
  vacio = "Sin datos en este periodo.",
  alElegir,
  soloBarra = false,
  seleccionada,
  alSeleccionar,
}: {
  titulo: string;
  partes: Parte[];
  formato?: Formato;
  /** Filas de la lista antes de «Ver todas». */
  visibles?: number;
  vacio?: string;
  /** Al hacer clic en una parte (lista o barra). */
  alElegir?: (parte: Parte) => void;
  /** Solo la barra, cuando la lista de la misma pantalla ya hace de leyenda (mismos colores y orden). */
  soloBarra?: boolean;
  /** Selección compartida con otra vista (la lista de Categorías): el nombre de la parte elegida. */
  seleccionada?: string | null;
  /** Con esto, tocar una parte la elige (explorar) en vez de abrirla; «Ver movimientos» abre con `alElegir`. */
  alSeleccionar?: (parte: Parte | null) => void;
}) {
  const { medir, ancho } = useAncho<HTMLDivElement>();
  const [activa, setActiva] = useState<number | null>(null);
  /** Elegida con un toque o con el teclado: queda fija con su detalle hasta tocar fuera o pulsar Escape. */
  const [fijada, setFijada] = useState(false);
  const [todas, setTodas] = useState(false);
  const figura = useRef<HTMLElement>(null);
  const puntero = useRef<string>("mouse");
  const barra = useRef<HTMLDivElement | null>(null);
  const marcador = useRef<HTMLSpanElement>(null);
  const idBase = useId();

  // Un toque fuera de la figura suelta la parte fijada.
  useEffect(() => {
    if (!fijada) return;
    const fuera = (e: PointerEvent) => {
      if (!figura.current?.contains(e.target as Node)) {
        setFijada(false);
        setActiva(null);
      }
    };
    document.addEventListener("pointerdown", fuera);
    return () => document.removeEventListener("pointerdown", fuera);
  }, [fijada]);

  const ordenadas = [...partes].filter((p) => p.valor > 0).sort((a, b) => b.valor - a.valor);
  const firma = ordenadas.map((p) => `${p.nombre}:${p.valor}`).join("|");
  // Selección compartida: manda cuando nadie está pasando el puntero o tocando dentro de la barra.
  const iExterna = alSeleccionar && seleccionada ? ordenadas.findIndex((p) => p.nombre === seleccionada) : -1;
  const actual = activa ?? (iExterna >= 0 ? iExterna : null);
  const fija = fijada || (activa === null && iExterna >= 0);

  // El marcador se coloca con la posición real de la parte (las diminutas tienen un ancho mínimo y desplazan a
  // las demás), antes de pintar; el cambio de `transform` es lo que la transición CSS anima.
  useLayoutEffect(() => {
    const parte = actual !== null ? barra.current?.children[actual] : undefined;
    if (!(parte instanceof HTMLElement) || !marcador.current) return;
    marcador.current.style.transform = `translateX(${parte.offsetLeft + parte.offsetWidth / 2}px)`;
  }, [actual, ancho, firma]);

  const total = ordenadas.reduce((t, p) => t + p.valor, 0);
  if (ordenadas.length === 0) return <p className="cd-delta-note distribucion-vacia">{vacio}</p>;

  // Color de cada parte: el suyo propio o el de la paleta por posición (sigue a la parte, no al índice).
  const colorDe = (p: Parte, i: number) => p.color ?? color(i);
  // Centro (px) de cada segmento, descontando los 2 px de aire entre partes: para el marcador y el globo.
  const util = Math.max(0, ancho - 2 * (ordenadas.length - 1));
  const anchos = ordenadas.map((p) => (p.valor / total) * util);
  const centros = anchos.map((w, i) => anchos.slice(0, i).reduce((t, x) => t + x + 2, 0) + w / 2);
  const sel = actual !== null ? ordenadas[actual] : undefined;
  const lista = todas ? ordenadas : ordenadas.slice(0, visibles);
  const idParte = (i: number) => `${idBase}-parte-${i}`;
  const describir = (p: Parte) => `${p.nombre}: ${formato(p.valor)}, ${porcentaje(p.valor / total, 1)} del total`;

  const fijar = (i: number | null) => {
    setActiva(i);
    setFijada(i !== null);
  };
  const alTecladoBarra = (e: KeyboardEvent<HTMLDivElement>) => {
    const ultimo = ordenadas.length - 1;
    const desde = activa ?? -1;
    const destino: Record<string, number> = {
      ArrowRight: Math.min(ultimo, desde + 1),
      ArrowDown: Math.min(ultimo, desde + 1),
      ArrowLeft: Math.max(0, desde - 1),
      ArrowUp: Math.max(0, desde - 1),
      Home: 0,
      End: ultimo,
    };
    if (e.key in destino) {
      e.preventDefault();
      fijar(destino[e.key] ?? 0);
    } else if (e.key === "Enter" && sel && alElegir) {
      e.preventDefault();
      alElegir(sel);
    } else if (e.key === "Escape" && activa !== null) {
      e.stopPropagation();
      fijar(null);
    }
  };

  return (
    <figure
      ref={figura}
      className="distribucion"
      aria-label={titulo}
      onPointerLeave={(e) => {
        // El toque también dispara «leave» al levantar el dedo: solo el mouse suelta la parte al salir.
        if (e.pointerType === "mouse" && !fijada) setActiva(null);
      }}
    >
      <div className="distribucion-pista">
        <div
          ref={(el) => {
            medir(el);
            barra.current = el;
          }}
          className="distribucion-barra"
          role="listbox"
          tabIndex={0}
          aria-label={`${titulo}: ${formato(total)} en total. Flechas para recorrer las partes`}
          aria-activedescendant={actual !== null ? idParte(actual) : undefined}
          onKeyDown={alTecladoBarra}
          onBlur={(e) => {
            if (!figura.current?.contains(e.relatedTarget as Node)) fijar(null);
          }}
        >
          {ordenadas.map((p, i) => (
            <span
              key={p.nombre}
              id={idParte(i)}
              role="option"
              aria-selected={actual === i}
              aria-label={describir(p)}
              className={`distribucion-parte ${actual === i ? "activa" : ""} ${actual !== null && actual !== i ? "atenuada" : ""}`}
              style={{ flexGrow: p.valor, background: colorDe(p, i) }}
              onPointerDown={(e) => (puntero.current = e.pointerType)}
              onPointerEnter={(e) => e.pointerType === "mouse" && !fijada && setActiva(i)}
              onClick={() => {
                // Selección compartida: tocar elige la parte (explorar); abrirla es «Ver movimientos».
                if (alSeleccionar) {
                  setActiva(null);
                  alSeleccionar(seleccionada === p.nombre ? null : p);
                  return;
                }
                // Con mouse, el clic lleva a sus movimientos. Con el dedo, el primer toque muestra el detalle.
                if (puntero.current === "mouse") alElegir?.(p);
                else fijar(activa === i && fijada ? null : i);
              }}
            />
          ))}
        </div>
        {/* Marcador que viaja a la parte elegida: aparece al elegir y se desliza entre partes. */}
        {activa !== null && <span ref={marcador} className="distribucion-marcador" aria-hidden="true" />}
      </div>
      {sel && actual !== null && !fija && (
        <Globo x={centros[actual] ?? 0} ancho={ancho} y={30}>
          <span>{sel.nombre}</span>
          <b>{formato(sel.valor)}</b>
          <small>{porcentaje(sel.valor / total, 1)} del total</small>
        </Globo>
      )}
      {/* Detalle de la parte fijada (toque o teclado): el importe se lee al instante y se puede ir a sus
          movimientos sin depender del puntero. */}
      <div className="distribucion-detalle" aria-live="polite" hidden={!(sel && fija)}>
        {sel && fija && actual !== null && (
          <>
            <i style={{ background: colorDe(sel, actual) }} aria-hidden="true" />
            <span className="distribucion-detalle-nombre">{sel.nombre}</span>
            <span className="distribucion-pct">{porcentaje(sel.valor / total, 1)}</span>
            <b className="cd-num">{formato(sel.valor)}</b>
            {alElegir && (
              <button type="button" className="cd-link distribucion-detalle-ir" onClick={() => alElegir(sel)}>
                Ver movimientos ›
              </button>
            )}
          </>
        )}
      </div>
      {!soloBarra && (
        <ul className="distribucion-lista">
          {lista.map((p) => {
            const i = ordenadas.indexOf(p);
            return (
              <li key={p.nombre}>
                <button
                  type="button"
                  aria-pressed={activa === i}
                  onPointerEnter={(e) => e.pointerType === "mouse" && !fijada && setActiva(i)}
                  onFocus={() => !fijada && setActiva(i)}
                  onBlur={() => !fijada && setActiva(null)}
                  onClick={() => alElegir?.(p)}
                  className={`${alElegir ? "elegible" : ""} ${activa !== null && activa !== i ? "atenuada" : ""}`}
                  aria-label={alElegir ? `${p.nombre}: ${formato(p.valor)}. Ver sus movimientos` : undefined}
                >
                  <i style={{ background: colorDe(p, i) }} aria-hidden />
                  <span className="distribucion-nombre">{p.nombre}</span>
                  <span className="distribucion-pct">{Math.round((p.valor / total) * 100)}%</span>
                  <b className="cd-num">{formato(p.valor)}</b>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {!soloBarra && ordenadas.length > visibles && (
        <button
          type="button"
          className="cd-btn cd-btn--ghost cd-btn--sm distribucion-mas"
          onClick={() => setTodas((t) => !t)}
        >
          {todas ? "Ver menos" : `Ver todas (${ordenadas.length})`}
        </button>
      )}
      <TablaAlternativa
        titulo={titulo}
        columnas={["Categoría", "Monto", "Porcentaje"]}
        filas={ordenadas.map((p) => [p.nombre, formato(p.valor), porcentaje(p.valor / total, 1)])}
      />
    </figure>
  );
}
