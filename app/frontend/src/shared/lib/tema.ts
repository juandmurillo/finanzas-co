/** Tema claro/oscuro de Caudal: `data-theme` en <html>, recordado por navegador. */
export type Tema = "light" | "dark";

const CLAVE = "caudal-tema";

export function temaInicial(): Tema {
  try {
    const guardado = localStorage.getItem(CLAVE);
    if (guardado === "light" || guardado === "dark") return guardado;
  } catch {
    /* almacenamiento no disponible */
  }
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export function aplicarTema(tema: Tema): void {
  document.documentElement.dataset.theme = tema;
  try {
    localStorage.setItem(CLAVE, tema);
  } catch {
    /* almacenamiento no disponible */
  }
}
