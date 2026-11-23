/** Menú «⋮» de una tarjeta: acciones secundarias (editar, cerrar, eliminar…). Escape o un clic fuera lo cierran. */
import { useEffect, useRef, useState } from "react";

import { useCapa } from "@/shared/lib/capas";

import { dentroDeFlotante } from "@/shared/ui/Flotante";
export interface AccionMenu {
  texto: string;
  alElegir: () => void;
  peligro?: boolean;
}

export function MenuAcciones({ acciones, etiqueta = "Más acciones" }: { acciones: AccionMenu[]; etiqueta?: string }) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  useCapa(abierto, () => setAbierto(false));
  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) =>
      !dentroDeFlotante(e.target) && !caja.current?.contains(e.target as Node) && setAbierto(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      window.removeEventListener("keydown", escape);
    };
  }, [abierto]);
  return (
    <div ref={caja} className="menu-acciones">
      <button
        type="button"
        className="cd-icon-btn"
        aria-label={etiqueta}
        aria-haspopup="menu"
        aria-expanded={abierto}
        style={{ width: 32, height: 32, fontSize: 18, lineHeight: 1 }}
        onClick={() => setAbierto((x) => !x)}
      >
        ⋮
      </button>
      {abierto && (
        <ul role="menu" className="menu-acciones-lista">
          {acciones.map((a) => (
            <li key={a.texto} role="none">
              <button
                type="button"
                role="menuitem"
                className={a.peligro ? "peligro" : undefined}
                onClick={() => {
                  setAbierto(false);
                  a.alElegir();
                }}
              >
                {a.texto}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
