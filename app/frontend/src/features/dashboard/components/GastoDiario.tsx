/** Gasto de los últimos 30 días agrupado por día de la semana: valor y porcentaje de cada día, con barras
 * en degradado que se desvanecen hacia el eje. */
import { useQuery } from "@tanstack/react-query";

import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, moverMes, porcentaje } from "@/shared/lib/formato";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { CabeceraTarjeta } from "@/shared/ui/Kpi";

const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = lunes … 6 = domingo. */
function diaSemana(iso: string): number {
  return (new Date(`${iso}T12:00:00`).getDay() + 6) % 7;
}

export function GastoDiario() {
  const hoy = hoyISO();
  const periodo = { desde: moverMes(hoy.slice(0, 7), -1), hasta: hoy.slice(0, 7) };
  const datos = useQuery({
    queryKey: ["reportes", "calor", periodo.desde, periodo.hasta],
    queryFn: () => api.calor(periodo),
  });
  const porDia = new Map((datos.data?.dias ?? []).map((d) => [d.fecha, d.gasto]));
  const dias = Array.from({ length: 30 }, (_, i) => sumarDias(hoy, i - 29));
  const semana = DIAS.map(() => ({ total: 0, veces: 0 }));
  for (const f of dias) {
    const s = semana[diaSemana(f)];
    if (s) {
      s.total += porDia.get(f) ?? 0;
      s.veces += 1;
    }
  }
  const total = semana.reduce((t, d) => t + d.total, 0);
  const tope = Math.max(1, ...semana.map((d) => d.total));
  const mayor = semana.reduce((m, d, i) => (d.total > (semana[m]?.total ?? 0) ? i : m), 0);
  return (
    <section className="cd-card gasto-diario">
      <CabeceraTarjeta
        titulo="Gasto por día de la semana"
        rango={`${fechaCorta(dias[0] ?? hoy)} – ${fechaCorta(hoy)}`}
      />
      {datos.isPending && <TarjetaCargando filas={2} />}
      {datos.isError && <ErrorVista error={datos.error} reintentar={() => void datos.refetch()} />}
      {datos.isSuccess && (
        <>
          <ul className="gasto-semana" aria-label="Gasto por día de la semana, últimos 30 días">
            {semana.map((d, i) => (
              <li
                key={DIAS[i]}
                className={i === mayor && total > 0 ? "mayor" : undefined}
                title={`${DIAS[i]}: ${formatoCOP(d.total)} en ${d.veces} días`}
              >
                <span className="gasto-semana-dia">{DIAS[i]?.slice(0, 3)}</span>
                <span className="gasto-semana-pista" aria-hidden>
                  <i style={{ width: `${Math.max(d.total > 0 ? 2 : 0, (d.total / tope) * 100)}%` }} />
                </span>
                <span className="gasto-semana-pct cd-num">{porcentaje(total ? d.total / total : 0, 0)}</span>
                <b className="cd-num">{formatoCOP(d.total)}</b>
              </li>
            ))}
          </ul>
          <p className="kpi-c-cifra gasto-diario-pie">
            <span className="kpi-c-valor">{formatoCOP(total)}</span>
            <span className="kpi-c-nota">
              en 30 días · gastas más los {DIAS[mayor]?.toLowerCase()}
              {DIAS[mayor]?.endsWith("s") ? "" : "s"}
            </span>
          </p>
        </>
      )}
    </section>
  );
}
