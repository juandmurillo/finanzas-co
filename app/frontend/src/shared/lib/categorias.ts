/** Opciones de categoría para selects y el selector visual: hojas del árbol con su ruta, filtradas por grupo. */
import type { CategoriaNodo } from "@/shared/api/tipos";

export interface OpcionCategoria {
  id: number;
  etiqueta: string;
}

/** `hojas`: solo categorías sin hijos y subcategorías; si es false, también la categoría completa. */
export function opcionesCategoria(nodos: CategoriaNodo[], grupos: string[], hojas = true): OpcionCategoria[] {
  const salida: OpcionCategoria[] = [];
  for (const raiz of nodos.filter((n) => grupos.includes(n.grupo))) {
    for (const cat of raiz.hijos) {
      if (cat.hijos.length === 0 || !hojas) {
        salida.push({
          id: cat.id,
          etiqueta: cat.hijos.length ? `${cat.nombre} (toda)` : `${raiz.nombre} › ${cat.nombre}`,
        });
      }
      for (const sub of cat.hijos) salida.push({ id: sub.id, etiqueta: `${cat.nombre} › ${sub.nombre}` });
    }
  }
  return salida.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
}

const plano = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export interface GrupoVisible {
  raiz: CategoriaNodo;
  categoria: CategoriaNodo;
  subcategorias: CategoriaNodo[];
}

/** Categorías (nivel 2) de los grupos pedidos que coinciden con el texto, por su nombre o el de una
 * subcategoría; si coincide una subcategoría, solo se muestran las que coinciden. */
export function filtrarCategorias(nodos: CategoriaNodo[], grupos: string[], texto: string): GrupoVisible[] {
  const buscado = plano(texto);
  const salida: GrupoVisible[] = [];
  for (const raiz of nodos.filter((n) => grupos.includes(n.grupo))) {
    for (const categoria of raiz.hijos) {
      if (!buscado || plano(categoria.nombre).includes(buscado)) {
        salida.push({ raiz, categoria, subcategorias: categoria.hijos });
        continue;
      }
      const subs = categoria.hijos.filter((s) => plano(s.nombre).includes(buscado));
      if (subs.length) salida.push({ raiz, categoria, subcategorias: subs });
    }
  }
  return salida.sort((a, b) => a.categoria.nombre.localeCompare(b.categoria.nombre, "es"));
}

/** Busca un id en el árbol y devuelve su ruta legible ("Factura › Streaming"). */
export function rutaDe(nodos: CategoriaNodo[], id: number | null): { categoria: CategoriaNodo; ruta: string[] } | null {
  if (id === null) return null;
  for (const raiz of nodos)
    for (const cat of raiz.hijos) {
      if (cat.id === id) return { categoria: cat, ruta: [raiz.nombre, cat.nombre] };
      for (const sub of cat.hijos)
        if (sub.id === id) return { categoria: sub, ruta: [raiz.nombre, cat.nombre, sub.nombre] };
    }
  return null;
}
