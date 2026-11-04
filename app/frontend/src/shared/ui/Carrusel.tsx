/** Fila única deslizable: muestra `porVista` tarjetas y, si hay más, flechas ‹ › y desplazamiento lateral
 * (con el dedo o la rueda). Así el detalle que se abre debajo de una tarjeta queda pegado a su fila. */
import { useEffect, useRef, useState, type ReactNode } from "react";

export function Carrusel({
  children,
  etiqueta,
  porVista = 3,
}: {
  children: ReactNode[];
  etiqueta: string;
  porVista?: number;
}) {
  const pista = useRef<HTMLDivElement>(null);
  const [bordes, setBordes] = useState({ inicio: true, fin: true });
  const medir = () => {
    const el = pista.current;
    if (!el) return;
    setBordes({ inicio: el.scrollLeft <= 2, fin: el.scrollLeft + el.clientWidth >= el.scrollWidth - 2 });
  };
  useEffect(() => {
    medir();
    window.addEventListener("resize", medir);
    return () => window.removeEventListener("resize", medir);
  }, [children.length]);
  const mover = (sentido: 1 | -1) => {
    const el = pista.current;
    const tarjeta = el?.firstElementChild as HTMLElement | null;
    if (el && tarjeta) el.scrollBy({ left: sentido * (tarjeta.offsetWidth + 24), behavior: "smooth" });
  };
  const desborda = !(bordes.inicio && bordes.fin);
  return (
    <div className="carrusel" role="region" aria-label={etiqueta}>
      {desborda && (
        <button
          type="button"
          className="cd-icon-btn carrusel-flecha carrusel-flecha--izq"
          aria-label="Anteriores"
          disabled={bordes.inicio}
          onClick={() => mover(-1)}
        >
          ‹
        </button>
      )}
      <div
        ref={pista}
        className="carrusel-pista"
        style={{ "--por-vista": porVista } as React.CSSProperties}
        onScroll={medir}
      >
        {children}
      </div>
      {desborda && (
        <button
          type="button"
          className="cd-icon-btn carrusel-flecha carrusel-flecha--der"
          aria-label="Siguientes"
          disabled={bordes.fin}
          onClick={() => mover(1)}
        >
          ›
        </button>
      )}
    </div>
  );
}
