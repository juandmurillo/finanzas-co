/** Mapa de calor de gasto e ingreso por día: una columna por semana y una fila por día (lunes a domingo).
 * Rojo donde se gastó más, verde donde entró más; la intensidad crece con el monto (pedido del usuario,
 * excepción a «gastar no es rojo»). Periodo configurable y recordado. */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";
import { TarjetaCargando } from "@/shared/ui/Estados";

const DIAS = ["L", "M", "X", "J", "V", "S", "D"];

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

export function MapaCalor() {
  const nav = usePeriodo("12m", "inicio-calor");
  const datos = useQuery({
    queryKey: ["reportes", "calor", nav.periodo.desde, nav.periodo.hasta],
    queryFn: () => api.calor(nav.periodo),
  });
  const [activo, setActivo] = useState<string | null>(null);
  const d = datos.data;
  const porDia = useMemo(() => new Map((d?.dias ?? []).map((x) => [x.fecha, x])), [d]);
  const semanas = useMemo(() => {
    const primero = nav.periodo.desde ? `${nav.periodo.desde}-01` : (d?.dias[0]?.fecha ?? hoyISO());
    const ultimoMes = nav.periodo.hasta ?? hoyISO().slice(0, 7);
    const finMes = sumarDias(`${moverMes(ultimoMes, 1)}-01`, -1);
    const fin = finMes < hoyISO() ? finMes : hoyISO();
    const desfase = (new Date(`${primero}T12:00:00`).getDay() + 6) % 7; // lunes = 0
    let dia = sumarDias(primero, -desfase);
    const salida: { fecha: string; dentro: boolean }[][] = [];
    while (dia <= fin) {
      const semana = Array.from({ length: 7 }, (_, i) => {
        const f = sumarDias(dia, i);
        return { fecha: f, dentro: f >= primero && f <= fin };
      });
      salida.push(semana);
      dia = sumarDias(dia, 7);
    }
    return salida;
  }, [nav.periodo.desde, nav.periodo.hasta, d]);

  const color = (fecha: string) => {
    const x = porDia.get(fecha);
    if (!x || !d || (x.gasto === 0 && x.ingreso === 0)) return undefined;
    if (x.ingreso >= x.gasto) {
      const t = Math.sqrt(x.ingreso / Math.max(1, d.max_ingreso));
      return `color-mix(in srgb, var(--positive) ${Math.round(20 + t * 80)}%, var(--card))`;
    }
    const t = Math.sqrt(x.gasto / Math.max(1, d.max_gasto));
    return `color-mix(in srgb, var(--negative) ${Math.round(20 + t * 80)}%, var(--card))`;
  };
  const sel = activo ? porDia.get(activo) : undefined;
  const totalGasto = (d?.dias ?? []).reduce((t, x) => t + x.gasto, 0);
  const totalIngreso = (d?.dias ?? []).reduce((t, x) => t + x.ingreso, 0);

  return (
    <section className="cd-card cd-stack span-12" style={{ gap: 12 }}>
      <div className="cd-card-head" style={{ flexWrap: "wrap", gap: 8, margin: 0 }}>
        <div className="cd-stack" style={{ gap: 2 }}>
          <h3 className="cd-card-title">Días de gasto e ingreso</h3>
          <span className="cd-delta-note cd-num" aria-live="polite">
            {sel && activo
              ? `${fechaCorta(activo, true)}: salió ${formatoCOP(sel.gasto)} · entró ${formatoCOP(sel.ingreso)} · ${sel.n} movimientos`
              : activo
                ? `${fechaCorta(activo, true)}: sin movimientos`
                : `En el periodo salió ${formatoCOP(totalGasto)} y entró ${formatoCOP(totalIngreso)}`}
          </span>
        </div>
        <ControlPeriodo nav={nav} opciones={["3m", "6m", "12m", "rango"]} />
      </div>
      {datos.isPending ? (
        <TarjetaCargando filas={3} />
      ) : (
        <div className="mapa-calor" onMouseLeave={() => setActivo(null)}>
          <div className="mapa-calor-dias" aria-hidden>
            {DIAS.map((x, i) => (
              <span key={x}>{i % 2 === 0 ? x : ""}</span>
            ))}
          </div>
          <div className="mapa-calor-rejilla" role="grid" aria-label="Gasto e ingreso por día">
            {semanas.map((s) => (
              <div key={s[0]?.fecha} className="mapa-calor-semana" role="row">
                <span className="mapa-calor-mes" aria-hidden>
                  {(() => {
                    const inicioMes = s.find((x) => x.dentro && x.fecha.endsWith("-01"));
                    return inicioMes ? nombreMes(inicioMes.fecha.slice(0, 7), true) : "";
                  })()}
                </span>
                {s.map((c) => (
                  <span
                    key={c.fecha}
                    role="gridcell"
                    aria-label={c.fecha}
                    className={`mapa-calor-celda ${c.dentro ? "" : "fuera"} ${activo === c.fecha ? "activa" : ""}`}
                    style={{ background: c.dentro ? color(c.fecha) : undefined }}
                    onMouseEnter={() => c.dentro && setActivo(c.fecha)}
                    onClick={() => c.dentro && setActivo(c.fecha)}
                  />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
      <div className="cd-legend">
        <span>
          <i className="cd-sw" style={{ background: "color-mix(in srgb, var(--negative) 85%, var(--card))" }} />
          Más gasto
        </span>
        <span>
          <i className="cd-sw" style={{ background: "color-mix(in srgb, var(--positive) 85%, var(--card))" }} />
          Más ingreso
        </span>
        <span>
          <i className="cd-sw" style={{ background: "var(--chart-track)" }} />
          Sin movimientos
        </span>
      </div>
    </section>
  );
}
