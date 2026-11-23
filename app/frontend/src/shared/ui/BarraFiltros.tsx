/**
 * Barra con los filtros que afectan a toda la página (mes, periodo, búsqueda). Queda fija bajo la barra
 * superior al bajar, para cambiarlos sin volver arriba; al fijarse toma fondo y un borde inferior.
 */
import { useEffect, useState, type ReactNode } from "react";

export function BarraFiltros({
  children,
  etiqueta = "Filtros de la página",
  className = "",
}: {
  children: ReactNode;
  etiqueta?: string;
  className?: string;
}) {
  const [barra, setBarra] = useState<HTMLDivElement | null>(null);
  const [fijada, setFijada] = useState(false);
  useEffect(() => {
    if (!barra || typeof IntersectionObserver === "undefined") return;
    const alto = parseFloat(getComputedStyle(barra).top) || 0;
    // Al quedar pegada en `top`, su borde superior toca el margen recortado y deja de verse completa.
    const io = new IntersectionObserver(
      ([e]) => setFijada(Boolean(e && e.intersectionRatio < 1 && e.boundingClientRect.top <= alto + 1)),
      {
        rootMargin: `-${alto + 1}px 0px 0px 0px`,
        threshold: [1],
      },
    );
    io.observe(barra);
    return () => io.disconnect();
  }, [barra]);
  return (
    <div
      ref={setBarra}
      role="group"
      aria-label={etiqueta}
      className={`barra-filtros ${fijada ? "fijada" : ""} ${className}`}
    >
      {children}
    </div>
  );
}
