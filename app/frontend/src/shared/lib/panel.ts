/** Lleva el foco al panel de detalle y, en el celular (donde reemplaza a la lista), lo muestra arriba. */
export function mostrarPanel(selector: string): void {
  const panel = document.querySelector<HTMLElement>(selector);
  if (!panel) return;
  panel.focus({ preventScroll: true });
  const rect = panel.getBoundingClientRect();
  if (rect.top < 0 || rect.top > window.innerHeight * 0.6) {
    const quieto = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    panel.scrollIntoView({ block: "start", behavior: quieto ? "auto" : "smooth" });
  }
}
