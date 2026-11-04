/** Estado de la instalación: primer uso, nombre, si son datos demo y qué módulos opcionales se muestran. */
import { useQuery } from "@tanstack/react-query";

import { api } from "./api";
import { claves } from "./queryKeys";

export function useSistema() {
  return useQuery({ queryKey: claves.sistema, queryFn: api.sistema, staleTime: 60_000 });
}

/** Las secciones de apuestas solo se muestran a quien las usa. Mientras carga, no se muestran. */
export function useApuestasVisibles(): boolean {
  return useSistema().data?.modulos.apuestas ?? false;
}
