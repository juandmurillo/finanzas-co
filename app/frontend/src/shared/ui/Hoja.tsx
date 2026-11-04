/** Hoja emergente: centrada en escritorio y desde abajo en el celular. Escape la cierra sin cerrar lo que
 * haya debajo (p. ej. la captura rápida). Regla de la app (fase 8): el panel no tiene scroll propio en
 * escritorio (se desplaza el fondo, como en la captura) y las acciones van en `pie`, en una sola fila:
 * secundaria o eliminar a la izquierda, principal a la derecha. */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { Icono } from "./Icono";

export function Hoja({
  titulo,
  onCerrar,
  children,
  pie,
}: {
  titulo: string;
  onCerrar: () => void;
  children: ReactNode;
  pie?: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>("input, button")?.focus();
  }, []);
  // Portal al body: dentro de un panel con transform/overflow (la captura) un fixed quedaría recortado.
  return createPortal(
    <div
      className="hoja-fondo"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCerrar();
        }
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-label={titulo} className="hoja-panel cd-stack">
        <div className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap" }}>
          <h3 className="cd-card-title">{titulo}</h3>
          <button
            type="button"
            className="cd-icon-btn"
            aria-label="Cerrar"
            style={{ width: 32, height: 32, border: 0 }}
            onClick={onCerrar}
          >
            <Icono nombre="cerrar" pequeno />
          </button>
        </div>
        {children}
        {pie && <div className="hoja-pie">{pie}</div>}
      </div>
    </div>,
    document.body,
  );
}
