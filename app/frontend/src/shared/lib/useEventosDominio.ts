/** Escucha /api/v1/events (SSE) e invalida solo las consultas afectadas por cada cambio. */
import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import type { EventoCambio } from "@/shared/api/tipos";

import { clavesAInvalidar } from "./queryKeys";

export type EstadoConexion = "conectando" | "en-vivo" | "sin-conexion";

export function useEventosDominio(): EstadoConexion {
  const cliente = useQueryClient();
  const [estado, setEstado] = useState<EstadoConexion>("conectando");

  useEffect(() => {
    const fuente = new EventSource("/api/v1/events");
    fuente.onopen = () => setEstado("en-vivo");
    fuente.onerror = () => setEstado(fuente.readyState === EventSource.CLOSED ? "sin-conexion" : "conectando");
    fuente.addEventListener("cambio", (mensaje) => {
      const evento = JSON.parse((mensaje as MessageEvent<string>).data) as EventoCambio;
      for (const clave of clavesAInvalidar(evento.entidades)) {
        void cliente.invalidateQueries({ queryKey: clave });
      }
    });
    return () => fuente.close();
  }, [cliente]);

  return estado;
}
