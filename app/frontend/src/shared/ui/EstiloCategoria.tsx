/**
 * Color e ícono de cada categoría, los mismos en todas las pantallas y gráficas y en cualquier tema: salen de
 * Categorías › Administrar (la base guarda `color` = `cat-n` e `icono`). Una subcategoría sin estilo propio
 * hereda el de su categoría; sin nada guardado, el color se fija por el id (no por la posición en la lista).
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type { CategoriaNodo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { claves } from "@/shared/lib/queryKeys";
import { iconoCategoria, type NombreIcono } from "./Icono";
import { SimboloVista } from "./Simbolo";

export interface EstiloCategoria {
  /** Color CSS listo para usar (`var(--cat-3)`). */
  color: string;
  /** Ícono, emoji o imagen guardados; `null` si se usa el ícono automático. */
  icono: string | null;
}

interface Ref {
  id?: number | null;
  /** Ruta grupo › categoría › subcategoría o solo el nombre. */
  ruta?: readonly string[];
  nombre?: string | null;
}

const normal = (t: string) => t.trim().toLowerCase();

function colorPorClave(clave: string | number): string {
  const n = typeof clave === "number" ? clave : [...clave].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  return `cat-${(n % 8) + 1}`;
}

interface Nodo {
  color: string | null;
  icono: string | null;
  padre: Nodo | null;
  id: number;
}

/** Devuelve `estilo(ref)` para resolver el color y el ícono de una categoría por id, ruta o nombre. */
export function useEstiloCategorias(): (ref: Ref) => EstiloCategoria {
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias, staleTime: 60_000 });
  return useMemo(() => {
    const porId = new Map<number, Nodo>();
    const porNombre = new Map<string, Nodo>();
    const recorrer = (c: CategoriaNodo, padre: Nodo | null) => {
      const nodo: Nodo = {
        id: c.id,
        color: c.color ?? null,
        icono: c.icono ?? null,
        padre: c.nivel > 1 ? padre : null,
      };
      porId.set(c.id, nodo);
      // Por nombre gana la categoría (nivel 2) sobre una subcategoría homónima.
      if (c.nivel > 1 && (c.nivel === 2 || !porNombre.has(normal(c.nombre)))) porNombre.set(normal(c.nombre), nodo);
      c.hijos.forEach((h) => recorrer(h, c.nivel > 1 ? nodo : null));
    };
    (arbol.data ?? []).forEach((r) => recorrer(r, null));
    return (ref: Ref) => {
      const nombre = ref.nombre ?? ref.ruta?.at(-1) ?? "";
      const nodo =
        (ref.id != null ? porId.get(ref.id) : undefined) ??
        (nombre ? porNombre.get(normal(nombre)) : undefined) ??
        (ref.ruta && ref.ruta.length > 2 ? porNombre.get(normal(ref.ruta[ref.ruta.length - 2] ?? "")) : undefined);
      const color = nodo?.color ?? nodo?.padre?.color ?? colorPorClave(nodo?.padre?.id ?? nodo?.id ?? nombre);
      const icono = nodo?.icono ?? nodo?.padre?.icono ?? null;
      return { color: `var(--${color})`, icono };
    };
  }, [arbol.data]);
}

/** Ícono de la categoría (el guardado, o el automático por su ruta). */
export function IconoCategoria({
  estilo,
  ruta,
  grupo,
  tam = 20,
}: {
  estilo: EstiloCategoria;
  ruta: readonly string[];
  grupo?: string | null;
  tam?: number;
}) {
  const respaldo: NombreIcono = iconoCategoria(ruta, grupo);
  return <SimboloVista valor={estilo.icono} respaldo={respaldo} tam={tam} />;
}

/** Fondo suave y tinta para la burbuja de una categoría. */
export function tonosCategoria(estilo: EstiloCategoria): { background: string; color: string } {
  return { background: `color-mix(in srgb, ${estilo.color} 18%, transparent)`, color: estilo.color };
}
