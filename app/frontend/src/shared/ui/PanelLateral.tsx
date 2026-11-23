/**
 * Panel lateral que entra por la derecha (filtros en el celular). Va en un portal con fondo; Escape, Atrás en
 * Android o tocar el fondo lo cierran, y el foco del teclado queda dentro mientras está abierto. `pie` lleva las
 * acciones (p. ej. Limpiar y Aplicar) en una fila fija abajo.
 */
import { useEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";

import { useCapa } from "@/shared/lib/capas";
import { useAtraparFoco } from "@/shared/lib/useAtraparFoco";

import { Icono } from "./Icono";

export function PanelLateral({
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
  useCapa(true, onCerrar);
  useAtraparFoco(panel);
  useEffect(() => {
    const previo = document.activeElement as HTMLElement | null;
    panel.current?.querySelector<HTMLElement>(".panel-lateral-cuerpo button, .panel-lateral-cuerpo input")?.focus();
    return () => {
      if (previo?.isConnected) previo.focus({ preventScroll: true });
    };
  }, []);
  return createPortal(
    <div
      className="panel-lateral-fondo"
      onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.stopPropagation();
          onCerrar();
        }
      }}
    >
      <div ref={panel} role="dialog" aria-modal="true" aria-label={titulo} className="panel-lateral">
        <div className="panel-lateral-cabeza">
          <h2 className="cd-card-title">{titulo}</h2>
          <button type="button" className="cd-icon-btn" aria-label="Cerrar" onClick={onCerrar}>
            <Icono nombre="cerrar" pequeno />
          </button>
        </div>
        <div className="panel-lateral-cuerpo">{children}</div>
        {pie && <div className="panel-lateral-pie">{pie}</div>}
      </div>
    </div>,
    document.body,
  );
}
