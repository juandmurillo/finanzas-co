/**
 * Carrusel de hallazgos («Este mes» en Inicio): las diapositivas se apilan en la misma celda de la cuadrícula,
 * así la tarjeta conserva la altura de la más larga al rotar. Avanza sola cada `intervalo` ms con una
 * transición horizontal (según la intensidad de animación: deslizar en «Máximo», fundido en «Reducidas»,
 * instantáneo en «Ninguna»). Se detiene con el botón de pausa (WCAG 2.2.2), al pasar el mouse o al enfocar
 * dentro; en el celular se pasa al anterior o al siguiente deslizando, y el temporizador vuelve a empezar para
 * que un avance automático no interrumpa la lectura.
 */
import { useEffect, useId, useRef, useState } from "react";

import { Icono } from "./Icono";

export interface Hallazgo {
  frase: string;
  cifra: string;
}

const UMBRAL = 40;

export function CarruselInsight({
  items,
  chip = "Este mes",
  intervalo = 5000,
}: {
  items: Hallazgo[];
  chip?: string;
  intervalo?: number;
}) {
  const [actual, setActual] = useState(0);
  const [pausado, setPausado] = useState(false);
  const [detenido, setDetenido] = useState(false); // mouse encima o foco dentro
  const [vuelta, setVuelta] = useState(0); // reinicia el temporizador tras un gesto o un clic
  const gesto = useRef<{ x: number; y: number; eje: "h" | "v" | null } | null>(null);
  const deslizo = useRef(false);
  const id = useId();
  const n = items.length;
  const i = n ? actual % n : 0;

  useEffect(() => {
    if (n < 2 || pausado || detenido) return;
    const t = setTimeout(() => {
      if (document.visibilityState === "visible") setActual((a) => (a + 1) % n);
      else setVuelta((v) => v + 1);
    }, intervalo);
    return () => clearTimeout(t);
  }, [i, n, pausado, detenido, vuelta, intervalo]);

  if (n === 0) return null;
  const ir = (destino: number) => {
    setActual((destino + n) % n);
    setVuelta((v) => v + 1);
  };

  return (
    <section
      className="cd-card insight insight--compacta cinsight"
      aria-roledescription="carrusel"
      aria-label={chip}
      onMouseEnter={() => setDetenido(true)}
      onMouseLeave={() => setDetenido(false)}
      onFocus={() => setDetenido(true)}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget as Node) && setDetenido(false)}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return;
        gesto.current = { x: e.clientX, y: e.clientY, eje: null };
        deslizo.current = false;
      }}
      onPointerMove={(e) => {
        const g = gesto.current;
        if (!g || g.eje) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (Math.max(Math.abs(dx), Math.abs(dy)) > 10) g.eje = Math.abs(dx) > Math.abs(dy) * 1.2 ? "h" : "v";
      }}
      onPointerUp={(e) => {
        const g = gesto.current;
        gesto.current = null;
        if (g?.eje !== "h") return;
        const dx = e.clientX - g.x;
        if (Math.abs(dx) < UMBRAL) return;
        deslizo.current = true;
        ir(dx < 0 ? i + 1 : i - 1);
      }}
      onPointerCancel={() => (gesto.current = null)}
      onClickCapture={(e) => {
        if (!deslizo.current) return;
        deslizo.current = false;
        e.stopPropagation();
      }}
    >
      <div className="cinsight-cabeza">
        <span className="insight-chip">
          <Icono nombre="info" pequeno />
          {chip}
        </span>
        {n > 1 && (
          <button
            type="button"
            className="cinsight-pausa"
            aria-label={pausado ? "Reanudar la rotación" : "Pausar la rotación"}
            aria-pressed={pausado}
            title={pausado ? "Reanudar" : "Pausar"}
            onClick={() => setPausado((p) => !p)}
          >
            {pausado ? <span aria-hidden>▶</span> : <Icono nombre="pausa" pequeno />}
          </button>
        )}
      </div>
      <div className="cinsight-pista" id={`${id}-pista`} aria-live={pausado || detenido ? "polite" : "off"}>
        {items.map((h, k) => {
          const [antes, despues = ""] = h.frase.split("{cifra}");
          return (
            <div
              key={k}
              className={`cinsight-diapositiva ${k === i ? "activa" : ""}`}
              role="group"
              aria-roledescription="diapositiva"
              aria-label={`${k + 1} de ${n}`}
              aria-hidden={k !== i}
              style={{ "--desfase": k - i } as React.CSSProperties}
            >
              <p className="insight-frase">
                {antes}
                <span className="insight-cifra">{h.cifra}</span>
                {despues}
              </p>
            </div>
          );
        })}
      </div>
      {n > 1 && (
        <div className="insight-pasos" role="group" aria-label="Elegir hallazgo" aria-controls={`${id}-pista`}>
          {items.map((_, k) => (
            <button
              key={k}
              type="button"
              aria-label={`Hallazgo ${k + 1} de ${n}`}
              aria-current={k === i ? "true" : undefined}
              onClick={() => ir(k)}
            />
          ))}
        </div>
      )}
    </section>
  );
}
