/**
 * Avisos (sonner) con el tema de Caudal: arriba en el celular (bajo la barra de estado y el área segura, apilados
 * a lo ancho) y abajo a la izquierda en escritorio. Fondo, texto, borde e ícono salen de los tokens del tema y del
 * acento activos —no del modo del sistema—, y éxito, información, advertencia y error conservan su color.
 */
import { useSyncExternalStore } from "react";
import { Toaster } from "sonner";

import { CONSULTA_MOVIL } from "@/shared/lib/dispositivo";
import { useApariencia } from "@/shared/lib/tema";

function suscribir(aviso: () => void) {
  const mq = window.matchMedia?.(CONSULTA_MOVIL);
  mq?.addEventListener("change", aviso);
  return () => mq?.removeEventListener("change", aviso);
}
const enMovil = () => window.matchMedia?.(CONSULTA_MOVIL).matches ?? false;

export function Avisos() {
  const movil = useSyncExternalStore(suscribir, enMovil, () => false);
  const { tema } = useApariencia();
  return (
    <Toaster
      className="avisos"
      position={movil ? "top-center" : "bottom-left"}
      theme={tema}
      closeButton
      expand={movil}
      visibleToasts={movil ? 4 : 3}
      gap={8}
      offset={{ bottom: 24, left: 24 }}
      mobileOffset={{ top: "calc(env(safe-area-inset-top, 0px) + 8px)", left: 12, right: 12 }}
    />
  );
}
