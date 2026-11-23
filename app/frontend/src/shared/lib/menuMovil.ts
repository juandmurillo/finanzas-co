/**
 * Barra inferior del celular: cinco posiciones, una de ellas «Más» (siempre presente). Las otras cuatro y el
 * orden de las cinco se eligen en «Más › Personalizar menú» y se guardan en este dispositivo. Lo que no esté en
 * la barra sigue en «Más».
 */
import { useSyncExternalStore } from "react";

import { DESTINOS_MENU, type IdSeccion } from "@/shared/lib/secciones";

export type Posicion = IdSeccion | "mas";

export const MENU_INICIAL: Posicion[] = ["inicio", "movimientos", "presupuesto", "deudas", "mas"];

const CLAVE = "caudal-menu-movil";
const oyentes = new Set<() => void>();
let actual: Posicion[] | null = null;

/** Cinco posiciones distintas, todas conocidas y con «Más» entre ellas; si no, la inicial. */
export function validarMenu(valor: unknown): Posicion[] {
  if (!Array.isArray(valor) || valor.length !== 5) return MENU_INICIAL;
  const conocidas = new Set<string>([...DESTINOS_MENU, "mas"]);
  const limpio = valor.filter((v): v is Posicion => typeof v === "string" && conocidas.has(v));
  if (limpio.length !== 5 || new Set(limpio).size !== 5 || !limpio.includes("mas")) return MENU_INICIAL;
  return limpio;
}

function leer(): Posicion[] {
  if (actual) return actual;
  try {
    const guardado = localStorage.getItem(CLAVE);
    actual = guardado ? validarMenu(JSON.parse(guardado)) : MENU_INICIAL;
  } catch {
    actual = MENU_INICIAL;
  }
  return actual;
}

export function guardarMenu(menu: Posicion[]): void {
  actual = validarMenu(menu);
  try {
    localStorage.setItem(CLAVE, JSON.stringify(actual));
  } catch {
    /* solo dura esta visita */
  }
  oyentes.forEach((o) => o());
}

export function useMenuMovil(): Posicion[] {
  return useSyncExternalStore((o) => {
    oyentes.add(o);
    return () => oyentes.delete(o);
  }, leer);
}

/** Solo para pruebas: olvida lo leído para volver a leer el almacenamiento. */
export function reiniciarMenuParaPruebas(): void {
  actual = null;
}
