/** Evolución del saldo disponible (cuentas que suman al total), un punto por cada día con movimientos. Estilo de
 * la referencia «Revenue over time»: cifra actual y variación arriba, área que se desvanece y globo por punto. */
import { useQuery } from "@tanstack/react-query";

import { AreaTemporal, CabeceraSerie } from "@/shared/charts";
import { api, type Periodo } from "@/shared/lib/api";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";

export function GraficoSaldo({ periodo }: { periodo: Periodo }) {
  const { desde, hasta } = periodo;
  const datos = useQuery({
    queryKey: ["reportes", "valor-neto", desde, hasta, "movimiento"],
    queryFn: () => api.valorNeto(periodo, "movimiento"),
  });
  if (datos.isPending) return <TarjetaCargando filas={3} />;
  if (datos.isError) return <ErrorVista error={datos.error} reintentar={() => void datos.refetch()} />;
  const puntos = datos.data.puntos.map((p) => ({ fecha: p.fecha, valor: p.saldo }));
  if (puntos.length === 0) return <span className="cd-delta-note">Sin movimientos en este periodo.</span>;
  return (
    <>
      <CabeceraSerie
        etiqueta="Saldo disponible"
        valor={puntos.at(-1)?.valor ?? 0}
        inicial={puntos.length > 1 ? puntos[0]?.valor : undefined}
      />
      <AreaTemporal titulo="Saldo disponible en el tiempo" nombreSerie="Saldo" puntos={puntos} />
    </>
  );
}
