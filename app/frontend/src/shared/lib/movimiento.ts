/**
 * Intensidad de animación de toda la app (Configuración › Apariencia): un solo lugar que fija `data-movimiento`
 * en <html>. Páginas, componentes y gráficos la obedecen desde `styles/movimiento.css` (duraciones, curvas y qué
 * se mueve), sin leerla cada uno por su lado.
 *
 * - ninguna: todo instantáneo, sin movimiento ni efectos.
 * - reducida: transiciones breves y discretas (opacidad, sin desplazamientos).
 * - maxima: todas las transiciones, microinteracciones y efectos de los gráficos.
 *
 * En la primera visita vale «reducida» si el sistema pide menos movimiento y «maxima» si no; después manda la
 * elección guardada.
 */
import { useSyncExternalStore } from "react";

export type Intensidad = "ninguna" | "reducida" | "maxima";

export const INTENSIDADES: { id: Intensidad; nombre: string; detalle: string }[] = [
  { id: "ninguna", nombre: "Ninguna", detalle: "Cambios instantáneos, sin movimiento" },
  { id: "reducida", nombre: "Reducidas", detalle: "Breves y discretas, solo para orientarte" },
  { id: "maxima", nombre: "Máximo", detalle: "Todas las transiciones y efectos" },
];

const CLAVE = "caudal-movimiento";
const oyentes = new Set<() => void>();
let actual: Intensidad | null = null;

function inicial(): Intensidad {
  try {
    const guardada = localStorage.getItem(CLAVE);
    if (guardada === "ninguna" || guardada === "reducida" || guardada === "maxima") return guardada;
  } catch {
    /* almacenamiento no disponible */
  }
  try {
    return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "reducida" : "maxima";
  } catch {
    return "maxima";
  }
}

function pintar(i: Intensidad): void {
  if (typeof document !== "undefined") document.documentElement.dataset.movimiento = i;
}

/** Lee (y aplica en <html>) la intensidad vigente. Se llama al arrancar, antes del primer render. */
export function intensidadActual(): Intensidad {
  if (actual === null) {
    actual = inicial();
    pintar(actual);
  }
  return actual;
}

export function guardarIntensidad(i: Intensidad): void {
  actual = i;
  pintar(i);
  try {
    localStorage.setItem(CLAVE, i);
  } catch {
    /* solo dura esta visita */
  }
  oyentes.forEach((o) => o());
}

export function useIntensidad(): Intensidad {
  return useSyncExternalStore((o) => {
    oyentes.add(o);
    return () => oyentes.delete(o);
  }, intensidadActual);
}

/** Duraciones por intensidad (ms). Las mismas que `styles/movimiento.css` expone como variables CSS. */
const DURACION: Record<Intensidad, Record<"rapida" | "media" | "grafico", number>> = {
  ninguna: { rapida: 0, media: 0, grafico: 0 },
  reducida: { rapida: 90, media: 140, grafico: 160 },
  maxima: { rapida: 140, media: 240, grafico: 420 },
};
export const CURVA_SALIDA = "cubic-bezier(0.23, 1, 0.32, 1)";

/**
 * Anima un elemento con WAAPI según la intensidad vigente: «ninguna» no anima, «reducida» conserva solo la
 * opacidad (sin desplazamientos) y «maxima» aplica los fotogramas completos. Cancela la animación anterior del
 * mismo elemento, así una serie de cambios rápidos termina en el último.
 */
export function animar(
  el: HTMLElement | null,
  fotogramas: Keyframe[],
  ritmo: "rapida" | "media" | "grafico" = "media",
): void {
  const i = intensidadActual();
  if (!el || i === "ninguna" || typeof el.animate !== "function") return;
  el.getAnimations?.().forEach((a) => a.cancel());
  const cuadros =
    i === "reducida"
      ? fotogramas.map((f) => Object.fromEntries(Object.entries(f).filter(([k]) => k !== "transform")) as Keyframe)
      : fotogramas;
  el.animate(cuadros, { duration: DURACION[i][ritmo], easing: CURVA_SALIDA });
}
