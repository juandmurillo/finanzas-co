/** Estado global del editor único de movimientos (fase 8, D1): se abre con "Registrar", el "+" móvil, la tecla N
 * o al tocar cualquier movimiento de cualquier vista (editar, confirmar un pago programado o eliminar). */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { Transaccion } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";

import { CapturaRapida, type Edicion } from "./CapturaRapida";
import type { Borrador } from "./modelo";

export type TipoMovimiento = "gasto" | "ingreso" | "transferencia";

interface ContextoCaptura {
  /** Nuevo movimiento; `inicial` precarga campos (p. ej., un abono a capital con su categoría y cuenta). */
  abrir: (tipo?: TipoMovimiento, inicial?: Partial<Borrador>) => void;
  /** Abre un movimiento existente (o su id) para verlo, editarlo, confirmarlo si está programado o eliminarlo. */
  abrirMovimiento: (tx: Transaccion | number) => void;
  cerrar: () => void;
}

type Apertura = { tipo: TipoMovimiento; inicial?: Partial<Borrador> } | { edicion: Edicion };

const Contexto = createContext<ContextoCaptura | null>(null);

const esCampoDeTexto = (objetivo: EventTarget | null) =>
  objetivo instanceof HTMLElement &&
  (objetivo.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(objetivo.tagName));

export function CapturaProvider({ children }: { children: ReactNode }) {
  const [apertura, setApertura] = useState<Apertura | null>(null);

  const abrir = useCallback((tipo: TipoMovimiento = "gasto", inicial?: Partial<Borrador>) => {
    setApertura({ tipo, inicial });
  }, []);
  const abrirMovimiento = useCallback((tx: Transaccion | number) => {
    void (async () => {
      try {
        const actual = typeof tx === "number" ? await api.transaccion(tx) : tx;
        const par = actual.transferencia_id ? await api.transaccion(actual.transferencia_id) : null;
        setApertura({ edicion: { tx: actual, par } });
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "No se pudo abrir el movimiento");
      }
    })();
  }, []);
  const cerrar = useCallback(() => setApertura(null), []);

  useEffect(() => {
    const alPresionar = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "n" && !e.ctrlKey && !e.metaKey && !e.altKey && !esCampoDeTexto(e.target)) {
        e.preventDefault();
        abrir();
      }
    };
    window.addEventListener("keydown", alPresionar);
    return () => window.removeEventListener("keydown", alPresionar);
  }, [abrir]);

  const valor = useMemo(() => ({ abrir, abrirMovimiento, cerrar }), [abrir, abrirMovimiento, cerrar]);
  return (
    <Contexto.Provider value={valor}>
      {children}
      {apertura &&
        ("edicion" in apertura ? (
          <CapturaRapida
            key={`e-${apertura.edicion.tx.id}`}
            tipoInicial="gasto"
            edicion={apertura.edicion}
            onCerrar={cerrar}
          />
        ) : (
          <CapturaRapida key="nuevo" tipoInicial={apertura.tipo} inicial={apertura.inicial} onCerrar={cerrar} />
        ))}
    </Contexto.Provider>
  );
}

export function useCaptura(): ContextoCaptura {
  const contexto = useContext(Contexto);
  if (!contexto) throw new Error("useCaptura debe usarse dentro de CapturaProvider");
  return contexto;
}
