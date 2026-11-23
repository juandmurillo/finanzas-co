/** Rango de fechas de Movimientos (AAAA-MM-DD, ambos incluidos): rótulo con ‹ ›, periodos rápidos y desde/hasta
 * con día. Sin rango se ve todo el historial. Usa el mismo panel compacto que los gráficos. */
import { useId, useRef, useState } from "react";

import "@/features/analisis/periodo.css";
import { fechaCorta, hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";
import { Icono } from "@/shared/ui/Icono";

import { CampoFecha } from "@/shared/ui/CampoFecha";
import { Flotante } from "@/shared/ui/Flotante";
export interface RangoDias {
  desde?: string;
  hasta?: string;
}

const finDeMes = (mes: string) =>
  `${mes}-${String(new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate()).padStart(2, "0")}`;

/** Meses completos de `desde` a `hasta` (AAAA-MM). */
export const rangoMeses = (desde: string, hasta: string): RangoDias => ({
  desde: `${desde}-01`,
  hasta: finDeMes(hasta),
});

function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(a ?? 2026, (m ?? 1) - 1, (d ?? 1) + dias);
  return `${f.getFullYear()}-${String(f.getMonth() + 1).padStart(2, "0")}-${String(f.getDate()).padStart(2, "0")}`;
}

const diasEntre = (desde: string, hasta: string) =>
  Math.round((Date.parse(hasta) - Date.parse(desde)) / 86_400_000) + 1;

/** El mismo rango movido `pasos` veces su largo: por meses si son meses completos, si no por días. */
export function desplazar(r: Required<RangoDias>, pasos: number): Required<RangoDias> {
  const mesesCompletos = r.desde.endsWith("-01") && r.hasta === finDeMes(r.hasta.slice(0, 7));
  if (mesesCompletos) {
    const n =
      (Number(r.hasta.slice(0, 4)) - Number(r.desde.slice(0, 4))) * 12 +
      Number(r.hasta.slice(5, 7)) -
      Number(r.desde.slice(5, 7)) +
      1;
    return rangoMeses(
      moverMes(r.desde.slice(0, 7), n * pasos),
      moverMes(r.hasta.slice(0, 7), n * pasos),
    ) as Required<RangoDias>;
  }
  const n = diasEntre(r.desde, r.hasta);
  return { desde: sumarDias(r.desde, n * pasos), hasta: sumarDias(r.hasta, n * pasos) };
}

/** «nov 2026», «sep – nov 2026», «3 nov – 21 nov 2026» o «Todo el historial». */
export function etiquetaRango(r: RangoDias): string {
  if (!r.desde || !r.hasta) return "Todo el historial";
  const mesD = r.desde.slice(0, 7);
  const mesH = r.hasta.slice(0, 7);
  if (r.desde === `${mesD}-01` && r.hasta === finDeMes(mesH)) {
    if (mesD === mesH) return nombreMes(mesD);
    return mesD.slice(0, 4) === mesH.slice(0, 4)
      ? `${nombreMes(mesD, true)} – ${nombreMes(mesH, true)} ${mesH.slice(0, 4)}`
      : `${nombreMes(mesD, true)} ${mesD.slice(0, 4)} – ${nombreMes(mesH, true)} ${mesH.slice(0, 4)}`;
  }
  if (r.desde === r.hasta) return fechaCorta(r.desde, true);
  return `${fechaCorta(r.desde, r.desde.slice(0, 4) !== r.hasta.slice(0, 4))} – ${fechaCorta(r.hasta, true)}`;
}

function rapidos(futuro: boolean): [string, RangoDias][] {
  const hoy = hoyISO();
  const mes = hoy.slice(0, 7);
  // Pagos programados: también hacia adelante.
  if (futuro)
    return [
      ["Este mes", rangoMeses(mes, mes)],
      ["Próximos 30 días", { desde: hoy, hasta: sumarDias(hoy, 30) }],
      ["Próximo mes", rangoMeses(moverMes(mes, 1), moverMes(mes, 1))],
      ["3 meses", rangoMeses(moverMes(mes, -1), moverMes(mes, 1))],
      ["Todo", {}],
    ];
  return [
    ["Este mes", rangoMeses(mes, mes)],
    ["Mes pasado", rangoMeses(moverMes(mes, -1), moverMes(mes, -1))],
    ["3 meses", rangoMeses(moverMes(mes, -2), mes)],
    ["6 meses", rangoMeses(moverMes(mes, -5), mes)],
    ["Este año", rangoMeses(`${mes.slice(0, 4)}-01`, mes)],
    ["Últimos 30 días", { desde: sumarDias(hoy, -29), hasta: hoy }],
    ["Todo", {}],
  ];
}

export function FiltroFechas({
  valor,
  alCambiar,
  futuro = false,
}: {
  valor: RangoDias;
  alCambiar: (r: RangoDias) => void;
  /** Permite fechas futuras (pagos programados): sin tope en hoy y con periodos hacia adelante. */
  futuro?: boolean;
}) {
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const ancla = useRef<HTMLButtonElement>(null);
  const id = useId();
  const completo = valor.desde && valor.hasta ? { desde: valor.desde, hasta: valor.hasta } : null;
  const etiqueta = etiquetaRango(valor);
  const hoy = hoyISO();
  const siguiente = completo ? desplazar(completo, 1) : null;
  const opciones = rapidos(futuro);
  return (
    <div ref={caja} className="periodo">
      {completo && (
        <button
          type="button"
          className="cd-icon-btn periodo-flecha"
          aria-label="Periodo anterior"
          onClick={() => alCambiar(desplazar(completo, -1))}
        >
          ‹
        </button>
      )}
      <button
        type="button"
        ref={ancla}
        className="periodo-boton"
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-controls={id}
        aria-label={`Fechas: ${etiqueta}. Cambiar`}
        onClick={() => setAbierto((x) => !x)}
      >
        <Icono nombre="calendario" pequeno />
        <span className="cd-num" aria-live="polite">
          {etiqueta}
        </span>
        <span aria-hidden className="cd-muted">
          ▾
        </span>
      </button>
      {completo && siguiente && (
        <button
          type="button"
          className="cd-icon-btn periodo-flecha"
          aria-label="Periodo siguiente"
          disabled={!futuro && siguiente.desde > hoy}
          onClick={() => alCambiar(siguiente)}
        >
          ›
        </button>
      )}
      {abierto && (
        <Flotante
          ancla={ancla}
          alCerrar={() => setAbierto(false)}
          id={id}
          role="dialog"
          aria-label="Elegir fechas"
          className="periodo-pop"
          atrapar
        >
          <span className="cd-kpi-label">Periodos rápidos</span>
          <div className="filtro-fechas-rapidos">
            {opciones.map(([nombre, r]) => (
              <button
                key={nombre}
                type="button"
                className="mov-chip"
                aria-pressed={r.desde === valor.desde && r.hasta === valor.hasta}
                onClick={() => {
                  alCambiar(r);
                  setAbierto(false);
                }}
              >
                {nombre}
              </button>
            ))}
          </div>
          <span className="cd-kpi-label">Rango</span>
          <span className="cd-row" style={{ gap: 6, flexWrap: "nowrap" }}>
            <CampoFecha
              type="date"
              aria-label="Desde"
              className="cd-input"
              value={valor.desde ?? ""}
              max={valor.hasta ?? (futuro ? undefined : hoy)}
              onChange={(e) => e.target.value && alCambiar({ desde: e.target.value, hasta: valor.hasta ?? hoy })}
            />
            <span className="cd-delta-note">a</span>
            <CampoFecha
              type="date"
              aria-label="Hasta"
              className="cd-input"
              value={valor.hasta ?? ""}
              min={valor.desde}
              onChange={(e) =>
                e.target.value && alCambiar({ desde: valor.desde ?? e.target.value, hasta: e.target.value })
              }
            />
          </span>
        </Flotante>
      )}
    </div>
  );
}
