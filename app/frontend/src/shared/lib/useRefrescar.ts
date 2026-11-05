/** Tras una acción, refresca todo lo que esté en pantalla: una sola regla en lugar de una lista de claves por página.
 * Los eventos en vivo también refrescan, pero esto no depende de que la conexión SSE esté activa. */
import { useQueryClient } from "@tanstack/react-query";

export function useRefrescar() {
  const cliente = useQueryClient();
  return () => void cliente.invalidateQueries();
}
