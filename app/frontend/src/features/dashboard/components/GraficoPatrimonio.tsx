/** Patrimonio neto: lo que tienes (cuentas, lo que te deben y activos) menos lo que debes (créditos y préstamos).
 * Como en el saldo disponible: un punto por cada día con movimientos, en un eje proporcional al tiempo, con la
 * cifra actual y su variación arriba y el desglose de hoy debajo. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import type { Patrimonio } from "@/shared/api/tipos";
import { AreaTemporal, CabeceraSerie } from "@/shared/charts";
import { api, type Periodo } from "@/shared/lib/api";
import { formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { FilaMetricas } from "@/shared/ui/Kpi";

export function GraficoPatrimonio({ periodo, actual }: { periodo: Periodo; actual: Patrimonio }) {
  const datos = useQuery({
    queryKey: [...claves.patrimonio, periodo.desde, periodo.hasta, "movimiento"],
    queryFn: () => api.patrimonio(periodo, "movimiento"),
  });
  const partes = [
    { etiqueta: "Cuentas", valor: actual.cuentas },
    { etiqueta: "Te deben", valor: actual.por_cobrar },
    { etiqueta: "Activos", valor: actual.activos },
    { etiqueta: "Créditos", valor: -actual.creditos },
    { etiqueta: "Debes a personas", valor: -actual.por_pagar },
  ].filter((p) => p.valor !== 0);
  const crudos = datos.data?.puntos ?? [];
  const puntos = crudos.map((p) => ({ fecha: p.fecha, valor: p.neto }));
  return (
    <>
      <CabeceraSerie
        etiqueta="Patrimonio neto hoy"
        valor={actual.neto}
        inicial={puntos.length > 1 ? puntos[0]?.valor : undefined}
        accion={
          <Link to="/activos" className="cd-link">
            Ver activos →
          </Link>
        }
      />
      {datos.isPending && <TarjetaCargando filas={3} />}
      {datos.isError && <ErrorVista error={datos.error} reintentar={() => void datos.refetch()} />}
      {datos.isSuccess && (
        <AreaTemporal
          titulo="Patrimonio neto en el tiempo"
          nombreSerie="Patrimonio"
          puntos={puntos}
          extraGlobo={(i) => {
            const p = crudos[i];
            if (!p) return null;
            return (
              <>
                <span className="globo-fila">
                  Activos
                  <b>{formatoCOP(p.activos)}</b>
                </span>
                <span className="globo-fila">
                  Créditos
                  <b>{formatoCOP(p.deuda)}</b>
                </span>
              </>
            );
          }}
        />
      )}
      {partes.length > 0 && (
        <div className="patrimonio-desglose">
          <FilaMetricas
            etiqueta="Desglose del patrimonio hoy"
            metricas={partes.map((p) => ({
              etiqueta: p.etiqueta,
              valor: `${p.valor < 0 ? "− " : ""}${formatoCOP(Math.abs(p.valor))}`,
            }))}
          />
        </div>
      )}
    </>
  );
}
