/** Vista móvil (celular, tableta angosta y la app Android): el mismo corte que usa la barra inferior. */
export const CONSULTA_MOVIL = "(max-width: 860px)";

export function esMovil(): boolean {
  try {
    return typeof window !== "undefined" && Boolean(window.matchMedia?.(CONSULTA_MOVIL).matches);
  } catch {
    return false;
  }
}
