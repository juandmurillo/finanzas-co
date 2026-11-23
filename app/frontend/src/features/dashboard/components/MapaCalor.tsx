/** Mapa de calor de gasto e ingreso por día: una columna por semana y una fila por día (lunes a domingo).
 * Rojo donde se gastó más, verde donde entró más; la intensidad crece con el monto (pedido del usuario,
 * excepción a «gastar no es rojo»). Siempre dibuja el periodo completo: los días que aún no pasan van más
 * claros y las semanas se rellenan hasta un número fijo, así el gráfico no cambia de tamaño al moverse entre
 * periodos del mismo largo. Etiquetas completas de días y meses; detalle flotante al pasar o enfocar. */
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";

import { ControlPeriodo, mesesEntre, usePeriodo } from "@/features/analisis/Periodo";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";
import { TarjetaCargando } from "@/shared/ui/Estados";
import { CabeceraTarjeta, FilaMetricas } from "@/shared/ui/Kpi";

import { ZonaPeriodo } from "@/features/analisis/ZonaPeriodo";
import { keepPreviousData } from "@tanstack/react-query";
const DIAS = ["Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

function sumarDias(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

interface Celda {
  fecha: string;
  dentro: boolean;
  futuro: boolean;
}

export function MapaCalor() {
  const nav = usePeriodo("6m", "inicio-calor");
  const datos = useQuery({
    queryKey: ["reportes", "calor", nav.periodo.desde, nav.periodo.hasta],
    queryFn: () => api.calor(nav.periodo),
    placeholderData: keepPreviousData,
  });
  const [activo, setActivo] = useState<string | null>(null);
  const [pos, setPos] = useState<{ x: number; y: number; derecha: boolean } | null>(null);
  const d = datos.data;
  const hoy = hoyISO();
  const porDia = useMemo(() => new Map((d?.dias ?? []).map((x) => [x.fecha, x])), [d]);
  const semanas = useMemo(() => {
    const ultimoMes = nav.periodo.hasta ?? hoy.slice(0, 7);
    const primerMes = nav.periodo.desde ?? d?.dias[0]?.fecha.slice(0, 7) ?? moverMes(ultimoMes, -5);
    const primero = `${primerMes}-01`;
    const fin = sumarDias(`${moverMes(ultimoMes, 1)}-01`, -1); // fin del último mes, aunque no haya pasado
    const desfase = (new Date(`${primero}T12:00:00`).getDay() + 6) % 7; // lunes = 0
    let dia = sumarDias(primero, -desfase);
    const salida: Celda[][] = [];
    while (dia <= fin) {
      salida.push(
        Array.from({ length: 7 }, (_, i) => {
          const f = sumarDias(dia, i);
          return { fecha: f, dentro: f >= primero && f <= fin, futuro: f > hoy };
        }),
      );
      dia = sumarDias(dia, 7);
    }
    // Tamaño fijo para el mismo largo de periodo: el máximo de semanas que pueden caber en esos meses.
    const meses = mesesEntre(primerMes, ultimoMes);
    const maximo = Math.ceil((meses * 31 + 6) / 7);
    // Semanas de relleno: se cuentan desde la última fecha real (las de relleno llevan el prefijo «relleno-»,
    // que no es una fecha; antes, con dos o más semanas de relleno, la fecha quedaba inválida y la página caía).
    let siguiente = sumarDias(salida.at(-1)?.[6]?.fecha ?? fin, 1);
    while (salida.length < maximo) {
      const base = siguiente;
      salida.push(
        Array.from({ length: 7 }, (_, i) => ({ fecha: `relleno-${sumarDias(base, i)}`, dentro: false, futuro: false })),
      );
      siguiente = sumarDias(base, 7);
    }
    return salida;
  }, [nav.periodo.desde, nav.periodo.hasta, d, hoy]);

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
  const dias = d?.dias ?? [];
  const totalGasto = dias.reduce((t, x) => t + x.gasto, 0);
  const totalIngreso = dias.reduce((t, x) => t + x.ingreso, 0);
  const pico = dias.reduce<(typeof dias)[number] | undefined>((m, x) => (!m || x.gasto > m.gasto ? x : m), undefined);
  const sel = activo ? porDia.get(activo) : undefined;
  /** Ubica el globo junto a la celda (relativo al lienzo del mapa). */
  const enfocar = (el: HTMLElement, fecha: string) => {
    const lienzo = el.closest(".calor-lienzo");
    if (!lienzo) return;
    const c = el.getBoundingClientRect();
    const l = lienzo.getBoundingClientRect();
    const x = c.left - l.left + c.width / 2;
    setActivo(fecha);
    setPos({ x, y: c.bottom - l.top + 6, derecha: x > l.width * 0.6 });
  };

  return (
    <section className="cd-card span-12 calor">
      <CabeceraTarjeta
        titulo="Días de gasto e ingreso"
        rangoSoloEscritorio
        rango={
          nav.periodo.desde && nav.periodo.hasta
            ? `${nombreMes(nav.periodo.desde)} – ${nombreMes(nav.periodo.hasta)}`
            : "Todo el historial"
        }
        accion={<ControlPeriodo nav={nav} opciones={["3m", "6m", "12m", "rango"]} />}
      />
      {datos.isPending ? (
        <TarjetaCargando filas={3} />
      ) : (
        <>
          <FilaMetricas
            etiqueta="Resumen del periodo"
            metricas={[
              { etiqueta: "Salió", valor: totalGasto },
              { etiqueta: "Entró", valor: totalIngreso, tono: "ingreso" },
              {
                etiqueta: "Día con más gasto",
                valor: pico && pico.gasto > 0 ? formatoCOP(pico.gasto) : "—",
                nota: pico && pico.gasto > 0 ? fechaCorta(pico.fecha, true) : undefined,
              },
            ]}
          />
          <ZonaPeriodo nav={nav} cargando={datos.isPlaceholderData}>
            <div className="calor-lienzo" onMouseLeave={() => setActivo(null)}>
              <div className="mapa-calor">
                <div className="mapa-calor-dias" aria-hidden>
                  <span />
                  {DIAS.map((x) => (
                    <span key={x}>
                      <span className="dia-largo">{x}</span>
                      <span className="dia-corto">{x.slice(0, 3)}</span>
                    </span>
                  ))}
                </div>
                <div className="mapa-calor-rejilla capa-desliza" role="grid" aria-label="Gasto e ingreso por día">
                  {semanas.map((s) => (
                    <div key={s[0]?.fecha} className="mapa-calor-semana" role="row">
                      <span className="mapa-calor-mes" aria-hidden>
                        {(() => {
                          const inicioMes = s.find((x) => x.dentro && x.fecha.endsWith("-01"));
                          return inicioMes ? nombreMes(inicioMes.fecha.slice(0, 7)).split(" ")[0] : "";
                        })()}
                      </span>
                      {s.map((c) => {
                        const x = porDia.get(c.fecha);
                        const texto = c.futuro
                          ? `${fechaCorta(c.fecha, true)}: aún no pasa`
                          : `${fechaCorta(c.fecha, true)}: salió ${formatoCOP(x?.gasto ?? 0)}, entró ${formatoCOP(x?.ingreso ?? 0)}`;
                        return (
                          <span
                            key={c.fecha}
                            role="gridcell"
                            aria-label={c.dentro ? texto : undefined}
                            className={`mapa-calor-celda ${c.dentro ? "" : "fuera"} ${c.futuro && c.dentro ? "futuro" : ""} ${activo === c.fecha ? "activa" : ""}`}
                            style={{ background: c.dentro && !c.futuro ? color(c.fecha) : undefined }}
                            onMouseEnter={(e) => c.dentro && enfocar(e.currentTarget, c.fecha)}
                            onClick={(e) => c.dentro && enfocar(e.currentTarget, c.fecha)}
                          />
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
              {activo && pos && (
                <div
                  className="grafico-globo calor-globo"
                  role="status"
                  style={pos.derecha ? { right: `calc(100% - ${pos.x}px)`, top: pos.y } : { left: pos.x, top: pos.y }}
                >
                  <span>{fechaCorta(activo, true)}</span>
                  {activo > hoy ? (
                    <small>Aún no pasa</small>
                  ) : (
                    <>
                      <span className="globo-fila">
                        Salió
                        <b>{formatoCOP(sel?.gasto ?? 0)}</b>
                      </span>
                      <span className="globo-fila">
                        Entró
                        <b>{formatoCOP(sel?.ingreso ?? 0)}</b>
                      </span>
                      <small>{sel?.n ? `${sel.n} movimientos` : "Sin movimientos"}</small>
                    </>
                  )}
                </div>
              )}
            </div>
          </ZonaPeriodo>
        </>
      )}
      <div className="calor-leyenda" aria-hidden>
        <span>Más gasto</span>
        {[85, 55, 25].map((p) => (
          <i key={`g${p}`} style={{ background: `color-mix(in srgb, var(--negative) ${p}%, var(--card))` }} />
        ))}
        <i style={{ background: "var(--chart-track)" }} />
        {[25, 55, 85].map((p) => (
          <i key={`i${p}`} style={{ background: `color-mix(in srgb, var(--positive) ${p}%, var(--card))` }} />
        ))}
        <span>Más ingreso</span>
        <i className="futuro-muestra" />
        <span>Aún no pasa</span>
      </div>
    </section>
  );
}
