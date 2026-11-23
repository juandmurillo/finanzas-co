/**
 * Panel flotante anclado a un control (lista de un desplegable, calendario). Va en un portal al body con
 * posición fija, así ninguna tarjeta, hoja ni barra con scroll lo recorta: se abre debajo del control y, si no
 * cabe, encima; nunca sale del ancho de la pantalla. Un clic fuera o Escape lo cierran (sin cerrar la hoja de
 * debajo) y Atrás en Android también.
 */
import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

import { useCapa } from "@/shared/lib/capas";
import { useAtraparFoco } from "@/shared/lib/useAtraparFoco";

import "./selectores.css";

const MARGEN = 8;

/** Para los paneles que se cierran con un clic fuera: un clic en un flotante abierto desde ellos (el calendario
 * de su rango) no cuenta como fuera, aunque esté en otro lugar del DOM. */
export function dentroDeFlotante(t: EventTarget | null): boolean {
  return t instanceof Element && t.closest(".flotante") !== null;
}

/** Flotantes abiertos, el de encima al final: Escape cierra solo ese. */
const abiertos: HTMLElement[] = [];

export function Flotante({
  ancla,
  alCerrar,
  children,
  className = "",
  atrapar = false,
  ...resto
}: {
  ancla: RefObject<HTMLElement | null>;
  alCerrar: () => void;
  children: ReactNode;
  className?: string;
  /** Mantiene el foco del teclado dentro (calendario); una lista deja el foco en su control. */
  atrapar?: boolean;
  id?: string;
  role?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const cerrar = useRef(alCerrar);
  useEffect(() => {
    cerrar.current = alCerrar;
  });
  useCapa(true, alCerrar);
  useAtraparFoco(panel, atrapar);

  useLayoutEffect(() => {
    const ubicar = () => {
      const el = panel.current;
      const a = ancla.current;
      if (!el || !a) return;
      const r = a.getBoundingClientRect();
      // Al menos el ancho del botón, sin achicar un panel que tiene su propio ancho mínimo (periodo: 280 px).
      el.style.minWidth = "";
      const propio = parseFloat(getComputedStyle(el).minWidth) || 0;
      el.style.minWidth = `${Math.min(Math.max(r.width, propio), window.innerWidth - 2 * MARGEN)}px`;
      const alto = el.offsetHeight;
      const ancho = el.offsetWidth;
      const abajo = window.innerHeight - r.bottom - MARGEN;
      const arriba = r.top - MARGEN;
      const top = alto + 6 <= abajo || abajo >= arriba ? r.bottom + 6 : Math.max(MARGEN, r.top - alto - 6);
      el.style.top = `${top}px`;
      el.style.maxHeight = `${Math.max(160, (top > r.top ? abajo : arriba) - 6)}px`;
      el.style.left = `${Math.max(MARGEN, Math.min(r.left, window.innerWidth - ancho - MARGEN))}px`;
    };
    ubicar();
    window.addEventListener("resize", ubicar);
    window.addEventListener("scroll", ubicar, true);
    return () => {
      window.removeEventListener("resize", ubicar);
      window.removeEventListener("scroll", ubicar, true);
    };
  }, [ancla]);

  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    abiertos.push(el);
    const fuera = (e: PointerEvent) => {
      const t = e.target as Node;
      // Un clic dentro de otro flotante abierto encima (el calendario del rango) no cuenta como «fuera».
      const encima = abiertos.slice(abiertos.indexOf(el) + 1);
      if (encima.some((otro) => otro.contains(t))) return;
      if (!el.contains(t) && !ancla.current?.contains(t)) cerrar.current();
    };
    // Escape (en fase de captura, antes que nadie) cierra solo el flotante de encima: no llega a la hoja ni a
    // la captura de debajo.
    const escape = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || abiertos.at(-1) !== el) return;
      e.stopPropagation();
      e.preventDefault();
      cerrar.current();
      ancla.current?.focus();
    };
    document.addEventListener("pointerdown", fuera, true);
    window.addEventListener("keydown", escape, true);
    return () => {
      abiertos.splice(abiertos.indexOf(el), 1);
      document.removeEventListener("pointerdown", fuera, true);
      window.removeEventListener("keydown", escape, true);
    };
  }, [ancla]);

  return createPortal(
    <div ref={panel} className={`flotante ${className}`} {...resto}>
      {children}
    </div>,
    document.body,
  );
}
