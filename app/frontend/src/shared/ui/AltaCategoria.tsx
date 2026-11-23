/**
 * Crear la categoría que falta sin salir de lo que se está registrando. Usa la misma API que
 * Administrar categorías. Si ya existe una con ese nombre bajo el mismo padre, la reutiliza.
 * Guardar aquí solo crea la categoría; el movimiento se guarda aparte.
 */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import type { CategoriaNodo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { plano } from "@/shared/lib/categorias";
import { claves } from "@/shared/lib/queryKeys";

import { Desplegable } from "@/shared/ui/Desplegable";
interface Props {
  arbol: CategoriaNodo[];
  grupos: string[];
  nombreInicial: string;
  padreInicial?: number;
  alCrear: (id: number) => void;
  alCancelar: () => void;
}

/** Hijo con el mismo nombre (sin tildes ni mayúsculas) bajo el padre, si existe. */
export function existenteBajo(padre: CategoriaNodo | undefined, nombre: string): CategoriaNodo | undefined {
  const buscado = plano(nombre);
  return padre?.hijos.find((h) => plano(h.nombre) === buscado);
}

export function AltaCategoria({ arbol, grupos, nombreInicial, padreInicial, alCrear, alCancelar }: Props) {
  const id = useId();
  const cliente = useQueryClient();
  const raices = useMemo(() => arbol.filter((r) => grupos.includes(r.grupo)), [arbol, grupos]);
  const [nombre, setNombre] = useState(nombreInicial.trim());
  const [padreId, setPadreId] = useState<number | undefined>(padreInicial ?? raices[0]?.id);

  const padre = useMemo(() => {
    for (const r of raices) {
      if (r.id === padreId) return r;
      const c = r.hijos.find((h) => h.id === padreId);
      if (c) return c;
    }
    return undefined;
  }, [raices, padreId]);
  const repetida = existenteBajo(padre, nombre);

  const crear = useMutation({
    mutationFn: async () => {
      if (repetida) return { id: repetida.id, nueva: false };
      const r = await api.crearCategoria({ padre_id: padreId as number, nombre: nombre.trim() });
      return { id: r.id, nueva: true };
    },
    onSuccess: async (r) => {
      await cliente.invalidateQueries({ queryKey: claves.categorias });
      toast.success(
        r.nueva ? `Categoría «${nombre.trim()}» creada` : `«${repetida?.nombre}» ya existía: quedó elegida`,
      );
      alCrear(r.id);
    },
    onError: (e) => toast.error(e.message),
  });

  const listo = nombre.trim() !== "" && padreId !== undefined && !crear.isPending;
  const enviar = () => listo && crear.mutate();

  return (
    <div
      className="alta-categoria cd-stack"
      role="group"
      aria-labelledby={`${id}-titulo`}
      // Enter crea la categoría y no llega a la captura (que lo usaría para guardar el movimiento).
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.stopPropagation();
          enviar();
        }
      }}
    >
      <h4 id={`${id}-titulo`} className="alta-titulo">
        {padre && padre.nivel > 1 ? `Nueva subcategoría de ${padre.nombre}` : "Nueva categoría"}
      </h4>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Nombre</span>
        <input
          className="cd-input"
          value={nombre}
          maxLength={60}
          autoFocus
          onChange={(e) => setNombre(e.target.value)}
        />
      </label>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Va en</span>
        <Desplegable className="cd-input" value={padreId ?? ""} onChange={(e) => setPadreId(Number(e.target.value))}>
          {raices.map((r) => (
            <optgroup key={r.id} label={r.nombre}>
              <option value={r.id}>Categoría principal de {r.nombre}</option>
              {r.hijos.map((c) => (
                <option key={c.id} value={c.id}>
                  Subcategoría de {c.nombre}
                </option>
              ))}
            </optgroup>
          ))}
        </Desplegable>
      </label>
      {repetida && (
        <p className="cd-delta-note" style={{ margin: 0 }} role="status">
          Ya tienes «{repetida.nombre}» aquí: se elegirá esa en lugar de crear otra.
        </p>
      )}
      <div className="alta-pie">
        <button type="button" className="cd-btn cd-btn--ghost" onClick={alCancelar}>
          Volver a la lista
        </button>
        <button type="button" className="cd-btn cd-btn--primary" disabled={!listo} onClick={enviar}>
          {repetida ? "Usar la existente" : "Crear categoría"}
        </button>
      </div>
      <p className="cd-delta-note" style={{ margin: 0 }}>
        Esto solo crea la categoría. Lo que llevas del movimiento sigue igual hasta que lo guardes.
      </p>
    </div>
  );
}
