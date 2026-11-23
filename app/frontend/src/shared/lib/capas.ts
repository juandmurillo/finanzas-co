/**
 * Pila de capas abiertas (hojas, menús, captura). Atrás en Android cierra primero la de arriba:
 * MainActivity llama `window.caudalAtras()`, que devuelve true si cerró algo; si no, navega atrás.
 */
import { useEffect, useRef } from "react";

const pila: { cerrar: () => void }[] = [];

declare global {
  interface Window {
    caudalAtras?: () => boolean;
  }
}

export function cerrarCapaSuperior(): boolean {
  const capa = pila.at(-1);
  if (!capa) return false;
  capa.cerrar();
  return true;
}

if (typeof window !== "undefined") window.caudalAtras = cerrarCapaSuperior;

/** Registra la capa mientras `abierta` sea true. `cerrar` puede cambiar entre renders. */
export function useCapa(abierta: boolean, cerrar: () => void): void {
  const ultimo = useRef(cerrar);
  useEffect(() => {
    ultimo.current = cerrar;
  });
  useEffect(() => {
    if (!abierta) return;
    const capa = { cerrar: () => ultimo.current() };
    pila.push(capa);
    return () => {
      const i = pila.indexOf(capa);
      if (i >= 0) pila.splice(i, 1);
    };
  }, [abierta]);
}

/** Solo para pruebas. */
export function capasAbiertas(): number {
  return pila.length;
}
