/**
 * Apariencia de Caudal: modo claro u oscuro (`data-theme`) y color de acento (`data-acento`)
 * en <html>, recordados por navegador. El acento cambia la interfaz; el logotipo conserva sus colores.
 */
import { useSyncExternalStore } from "react";

export type Tema = "light" | "dark";
/** Tema de color. «verde» es el original de Caudal (antes se guardaba como «lima»). */
export type Acento =
  | "verde"
  | "mandarina"
  | "azul"
  | "violeta"
  | "menta"
  | "grises"
  | "vinotinto"
  | "amarillo"
  | "negro"
  | "rosado"
  | "crema"
  | "terracota"
  | "oceano"
  | "lavanda"
  | "bosque"
  | "cielo"
  | "coral"
  | "ciruela";

/** `muestra` es la marca y `realce` el acento de cada tema, para la vista previa del selector. */
export const ACENTOS: { id: Acento; nombre: string; muestra: string; realce: string }[] = [
  { id: "verde", nombre: "Verde (original)", muestra: "#1e4d3b", realce: "#b9f046" },
  { id: "mandarina", nombre: "Mandarina", muestra: "#252521", realce: "#fb6337" },
  { id: "azul", nombre: "Azul", muestra: "#1d3f6e", realce: "#7fb2ff" },
  { id: "violeta", nombre: "Violeta", muestra: "#3d2a78", realce: "#c4b2ff" },
  { id: "menta", nombre: "Menta", muestra: "#0f5a4a", realce: "#5fe0b5" },
  { id: "grises", nombre: "Escala de grises", muestra: "#4b4b4b", realce: "#a8a8a8" },
  { id: "vinotinto", nombre: "Rojo vinotinto", muestra: "#6b1626", realce: "#ff5a6e" },
  { id: "amarillo", nombre: "Amarillo", muestra: "#3d3511", realce: "#ffd23f" },
  { id: "negro", nombre: "Negro puro", muestra: "#000000", realce: "#ffffff" },
  { id: "rosado", nombre: "Rosado", muestra: "#8a2457", realce: "#ff8cc0" },
  { id: "crema", nombre: "Crema", muestra: "#5a4a2e", realce: "#e9c46a" },
  { id: "terracota", nombre: "Terracota", muestra: "#8a3b1e", realce: "#e2794d" },
  { id: "oceano", nombre: "Océano", muestra: "#0b4f63", realce: "#3fc1c9" },
  { id: "lavanda", nombre: "Lavanda", muestra: "#5b4a91", realce: "#b9a7f0" },
  { id: "bosque", nombre: "Bosque", muestra: "#2d4a24", realce: "#8fbf6a" },
  { id: "cielo", nombre: "Cielo", muestra: "#1f5f99", realce: "#6ab7f5" },
  { id: "coral", nombre: "Coral", muestra: "#8f2f3a", realce: "#ff8a6e" },
  { id: "ciruela", nombre: "Ciruela", muestra: "#5e2752", realce: "#d47fc0" },
];

/** Estilo de apariencia: formas y patrones, independiente del tema de color. */
export type Estilo = "clasico" | "suave" | "recto" | "futurista" | "vidrio" | "neomorfismo" | "minimalista";

export const ESTILOS: { id: Estilo; nombre: string; detalle: string }[] = [
  { id: "clasico", nombre: "Clásico", detalle: "El de siempre" },
  { id: "suave", nombre: "Suave", detalle: "Todo muy redondeado y sombras amplias" },
  { id: "recto", nombre: "Geométrico", detalle: "Sin redondeos, ni en los gráficos" },
  { id: "futurista", nombre: "Futurista", detalle: "Brutalista: retícula, bordes gruesos y sombras duras" },
  { id: "vidrio", nombre: "Vidrio", detalle: "Liquid Glass: capas translúcidas con brillo" },
  { id: "neomorfismo", nombre: "Neomorfismo", detalle: "Relieve suave del mismo color del fondo" },
  { id: "minimalista", nombre: "Minimalista", detalle: "Sin sombras ni rellenos, solo líneas finas" },
];

const CLAVE_TEMA = "caudal-tema";
const CLAVE_ESTILO = "caudal-estilo";
const CLAVE_ACENTO = "caudal-acento";

function leer(clave: string): string | null {
  try {
    return localStorage.getItem(clave);
  } catch {
    return null;
  }
}

function guardar(clave: string, valor: string): void {
  try {
    localStorage.setItem(clave, valor);
  } catch {
    /* almacenamiento no disponible */
  }
}

export function temaInicial(): Tema {
  const guardado = leer(CLAVE_TEMA);
  if (guardado === "light" || guardado === "dark") return guardado;
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function acentoInicial(): Acento {
  const guardado = leer(CLAVE_ACENTO);
  if (guardado === "lima") return "verde";
  return ACENTOS.some((a) => a.id === guardado) ? (guardado as Acento) : "verde";
}

export function estiloInicial(): Estilo {
  const guardado = leer(CLAVE_ESTILO);
  // «Puntos» se reemplazó por «Futurista».
  if (guardado === "puntos") return "futurista";
  return ESTILOS.some((e) => e.id === guardado) ? (guardado as Estilo) : "clasico";
}

/** Pinta en <html> sin guardar: sirve para previsualizar en Apariencia. */
export function pintarApariencia(tema: Tema, acento: Acento, estilo: Estilo = estiloInicial()): void {
  document.documentElement.dataset.theme = tema;
  document.documentElement.dataset.acento = acento;
  document.documentElement.dataset.estilo = estilo;
}

// Estado compartido para que el botón de la barra superior y Apariencia vean lo mismo.
let actual = { tema: "light" as Tema, acento: "verde" as Acento, estilo: "clasico" as Estilo };
let iniciado = false;
const oyentes = new Set<() => void>();

function iniciar(): void {
  if (iniciado) return;
  iniciado = true;
  actual = { tema: temaInicial(), acento: acentoInicial(), estilo: estiloInicial() };
  pintarApariencia(actual.tema, actual.acento, actual.estilo);
}

export function guardarApariencia(cambio: Partial<{ tema: Tema; acento: Acento; estilo: Estilo }>): void {
  iniciar();
  actual = { ...actual, ...cambio };
  guardar(CLAVE_TEMA, actual.tema);
  guardar(CLAVE_ACENTO, actual.acento);
  guardar(CLAVE_ESTILO, actual.estilo);
  pintarApariencia(actual.tema, actual.acento, actual.estilo);
  oyentes.forEach((o) => o());
}

export function useApariencia(): { tema: Tema; acento: Acento; estilo: Estilo } {
  iniciar();
  return useSyncExternalStore(
    (o) => {
      oyentes.add(o);
      return () => oyentes.delete(o);
    },
    () => actual,
  );
}

/** Compatibilidad con llamadas anteriores. */
export function aplicarTema(tema: Tema): void {
  guardarApariencia({ tema });
}
