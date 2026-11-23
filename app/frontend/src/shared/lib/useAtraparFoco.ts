/**
 * Mantiene el foco del teclado dentro de un diálogo modal (WCAG 2.4.3): Tab y Mayús+Tab dan la vuelta dentro
 * del contenedor en vez de salir a la página de fondo. Al cerrarse, el foco vuelve a donde estaba.
 */
import { useEffect, type RefObject } from "react";

const ENFOCABLES =
  'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), ' +
  'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Diálogos abiertos, el de encima al final: solo ese atrapa el foco (una hoja sobre la captura). */
const pila: HTMLElement[] = [];

export function useAtraparFoco(ref: RefObject<HTMLElement | null>, activo = true): void {
  useEffect(() => {
    const caja = ref.current;
    if (!activo || !caja) return;
    const previo = document.activeElement as HTMLElement | null;
    pila.push(caja);
    const alTeclado = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || pila[pila.length - 1] !== caja) return;
      const lista = [...caja.querySelectorAll<HTMLElement>(ENFOCABLES)].filter((el) => {
        if (el.closest("[hidden], [inert]")) return false;
        // En el navegador, lo que no ocupa espacio (dentro de algo oculto) no recibe foco.
        if (document.body.getClientRects().length > 0 && el.getClientRects().length === 0) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && cs.visibility !== "hidden";
      });
      if (lista.length === 0) return;
      const primero = lista[0];
      const ultimo = lista[lista.length - 1];
      const dentro = caja.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === primero || !dentro)) {
        e.preventDefault();
        ultimo?.focus();
      } else if (!e.shiftKey && (document.activeElement === ultimo || !dentro)) {
        e.preventDefault();
        primero?.focus();
      }
    };
    document.addEventListener("keydown", alTeclado, true);
    return () => {
      document.removeEventListener("keydown", alTeclado, true);
      pila.splice(pila.indexOf(caja), 1);
      if (previo?.isConnected && !caja.isConnected) previo.focus({ preventScroll: true });
    };
  }, [ref, activo]);
}
