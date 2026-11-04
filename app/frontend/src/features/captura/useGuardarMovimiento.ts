/** Mutación de la captura: actualización optimista del saldo, toast con "Deshacer" y rollback si falla. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import type { Cuenta, Transaccion, TransaccionNueva, Transferencia } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";

type Peticion = { tipo: "movimiento"; datos: TransaccionNueva } | { tipo: "transferencia"; datos: Transferencia };

function ajustarSaldos(cuentas: Cuenta[] | undefined, p: Peticion): Cuenta[] | undefined {
  if (!cuentas) return cuentas;
  const delta = new Map<number, number>();
  if (p.tipo === "movimiento") delta.set(p.datos.cuenta_id, p.datos.monto);
  else {
    delta.set(p.datos.origen_id, -p.datos.monto);
    delta.set(p.datos.destino_id, p.datos.monto);
  }
  return cuentas.map((c) => (delta.has(c.id) ? { ...c, saldo: c.saldo + (delta.get(c.id) ?? 0) } : c));
}

export function useGuardarMovimiento() {
  const cliente = useQueryClient();

  const deshacer = useMutation({
    mutationFn: (ids: number[]) => api.eliminarTransaccion(ids[0] as number),
    onSuccess: () => toast("Movimiento deshecho"),
    onError: (e) => toast.error(`No se pudo deshacer: ${e.message}`),
    onSettled: () => cliente.invalidateQueries({ queryKey: claves.cuentas }),
  });

  return useMutation({
    mutationFn: async (p: Peticion): Promise<Transaccion[]> =>
      p.tipo === "movimiento" ? [await api.crearTransaccion(p.datos)] : api.transferir(p.datos),
    onMutate: async (p) => {
      await cliente.cancelQueries({ queryKey: claves.cuentas });
      const previas = cliente.getQueryData<Cuenta[]>(claves.cuentas);
      cliente.setQueryData<Cuenta[]>(claves.cuentas, (c) => ajustarSaldos(c, p));
      return { previas };
    },
    onError: (error, _p, contexto) => {
      cliente.setQueryData(claves.cuentas, contexto?.previas);
      toast.error(`No se guardó: ${error.message}`);
    },
    onSuccess: (creadas) => {
      const primera = creadas[0];
      if (!primera) return;
      const titulo = primera.transferencia_id
        ? `Transferencia ${formatoCOP(Math.abs(primera.monto))}`
        : `${primera.descripcion || primera.categoria_ruta.at(-1) || "Movimiento"} ${formatoCOP(primera.monto, { signo: true })}`;
      toast.success(`Guardado · ${titulo} · ${primera.cuenta}`, {
        duration: 10_000,
        action: { label: "Deshacer", onClick: () => deshacer.mutate(creadas.map((c) => c.id)) },
      });
    },
    // El evento SSE refresca todo; esto cubre el caso en que la conexión en vivo esté caída.
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: claves.cuentas });
      void cliente.invalidateQueries({ queryKey: claves.dashboard });
      void cliente.invalidateQueries({ queryKey: claves.transacciones() });
    },
  });
}
