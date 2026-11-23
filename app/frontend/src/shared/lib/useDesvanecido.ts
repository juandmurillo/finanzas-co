/**
 * Fila con desplazamiento horizontal: marca en el elemento si queda contenido por descubrir a la izquierda
 * (`data-mas-izq`) o a la derecha (`data-mas-der`). La clase `.desvanece-lados` usa esas marcas para fundir el
 * contenido con el fondo solo en ese lado (máscara: se adapta a cualquier tema y no bloquea los toques).
 * Devuelve una ref callback con limpieza (React 19).
 */
import { useCallback, type RefCallback } from "react";

export function useDesvanecido<T extends HTMLElement>(): RefCallback<T> {
  return useCallback((el: T | null) => {
    if (!el) return;
    const medir = () => {
      el.setAttribute("data-mas-izq", el.scrollLeft > 2 ? "1" : "0");
      el.setAttribute("data-mas-der", el.scrollLeft + el.clientWidth < el.scrollWidth - 2 ? "1" : "0");
    };
    medir();
    el.addEventListener("scroll", medir, { passive: true });
    const obs = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(medir);
    obs?.observe(el);
    return () => {
      el.removeEventListener("scroll", medir);
      obs?.disconnect();
    };
  }, []);
}
