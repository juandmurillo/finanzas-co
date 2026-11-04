import { useEffect, useState } from "react";

/** Devuelve `valor` solo después de `ms` sin cambios (búsquedas y simulaciones mientras se escribe). */
export function useDebounce<T>(valor: T, ms: number): T {
  const [demorado, setDemorado] = useState(valor);
  useEffect(() => {
    const t = setTimeout(() => setDemorado(valor), ms);
    return () => clearTimeout(t);
  }, [valor, ms]);
  return demorado;
}
