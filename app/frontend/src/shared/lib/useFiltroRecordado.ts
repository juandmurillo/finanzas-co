/** Estado de un filtro que se recuerda entre sesiones en este navegador (periodo, tipo, presupuesto…).
 * Sin clave se comporta como un useState normal. Si el almacenamiento no está disponible, no pasa nada. */
import { useCallback, useState } from "react";

export function useFiltroRecordado<T>(clave: string | null, inicial: T): [T, (cambio: (actual: T) => T) => void] {
  const [valor, setValor] = useState<T>(() => {
    if (!clave) return inicial;
    try {
      const guardado = localStorage.getItem(`caudal:${clave}`);
      return guardado ? { ...inicial, ...(JSON.parse(guardado) as T) } : inicial;
    } catch {
      return inicial;
    }
  });
  const cambiar = useCallback(
    (cambio: (actual: T) => T) =>
      setValor((actual) => {
        const nuevo = cambio(actual);
        if (clave) {
          try {
            localStorage.setItem(`caudal:${clave}`, JSON.stringify(nuevo));
          } catch {
            // modo privado o almacenamiento bloqueado: el filtro solo dura esta visita
          }
        }
        return nuevo;
      }),
    [clave],
  );
  return [valor, cambiar];
}
