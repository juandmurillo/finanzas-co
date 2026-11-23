/** Selector de periodo compartido por los gráficos (presets, rango personalizado y ‹ ›) y botón de exportar
 * a Excel con el mismo rango. Cada gráfico recuerda su última elección (fase 8, punto 1.6). */
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";

import { api, type Periodo } from "@/shared/lib/api";
import "./periodo.css";
import { hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";
import { useId, useRef, useState } from "react";

import { esMovil } from "@/shared/lib/dispositivo";
import { useSistema } from "@/shared/lib/useSistema";
import { Icono } from "@/shared/ui/Icono";

import { CampoFecha } from "@/shared/ui/CampoFecha";
import { Flotante } from "@/shared/ui/Flotante";
export type Preset = "mes" | "3m" | "6m" | "12m" | "todo" | "rango";

const ETIQUETAS: [Preset, string][] = [
  ["mes", "Mes"],
  ["3m", "3 m"],
  ["6m", "6 m"],
  ["12m", "12 m"],
  ["todo", "Todo"],
  ["rango", "Rango"],
];

const MESES: Record<Exclude<Preset, "rango">, number | null> = { mes: 1, "3m": 3, "6m": 6, "12m": 12, todo: null };

export function aPeriodo(preset: Exclude<Preset, "rango">, hasta = hoyISO().slice(0, 7)): Periodo {
  const n = MESES[preset];
  return n === null ? {} : { desde: moverMes(hasta, -(n - 1)), hasta };
}

/** El mismo rango desplazado `pasos` ventanas hacia atrás (‹): 6 m desplazado 1 = los 6 meses anteriores. */
export function desplazarPeriodo(preset: Exclude<Preset, "rango">, pasos: number, hoy = hoyISO().slice(0, 7)): Periodo {
  const n = MESES[preset];
  return n === null ? {} : aPeriodo(preset, moverMes(hoy, -n * pasos));
}

/** Meses entre dos AAAA-MM, contando ambos extremos. */
export function mesesEntre(desde: string, hasta: string): number {
  return (
    (Number(hasta.slice(0, 4)) - Number(desde.slice(0, 4))) * 12 + Number(hasta.slice(5)) - Number(desde.slice(5)) + 1
  );
}

/** Un rango personalizado desplazado `pasos` veces su propio largo hacia atrás. */
export function desplazarRango(desde: string, hasta: string, pasos: number): Periodo {
  const n = mesesEntre(desde, hasta);
  return { desde: moverMes(desde, -n * pasos), hasta: moverMes(hasta, -n * pasos) };
}

interface EstadoPeriodo {
  preset: Preset;
  pasos: number;
  desde: string;
  hasta: string;
  /** Sentido del último cambio (-1 hacia atrás, 1 hacia el actual): orienta la animación del gráfico. */
  dir?: -1 | 0 | 1;
}

/** Periodo con el que arranca un filtro: en la vista móvil siempre «3 meses»; en escritorio, el de cada gráfico. */
export function periodoInicial(inicial: Exclude<Preset, "rango">): Exclude<Preset, "rango"> {
  return esMovil() ? "3m" : inicial;
}

/**
 * Periodo de un gráfico. Con `clave`, la elección se recuerda entre sesiones (por navegador). La vista móvil
 * guarda su propia elección (clave «…:movil»), así el escritorio conserva sus valores.
 */
export function usePeriodo(inicial: Exclude<Preset, "rango">, clave?: string) {
  const hoy = hoyISO().slice(0, 7);
  const movil = esMovil();
  const base = periodoInicial(inicial);
  const vacio: EstadoPeriodo = { preset: base, pasos: 0, desde: moverMes(hoy, -5), hasta: hoy, dir: 0 };
  const [e, setE] = useFiltroRecordado<EstadoPeriodo>(clave ? `periodo:${clave}${movil ? ":movil" : ""}` : null, vacio);
  const periodo =
    e.preset === "rango" ? desplazarRango(e.desde, e.hasta, e.pasos) : desplazarPeriodo(e.preset, e.pasos);
  return {
    preset: e.preset,
    setPreset: (p: Preset) => setE((x) => ({ ...x, preset: p, pasos: 0, dir: 0 })),
    pasos: e.pasos,
    dir: e.dir ?? 0,
    anterior: () => setE((x) => ({ ...x, pasos: x.pasos + 1, dir: -1 })),
    siguiente: () => setE((x) => ({ ...x, pasos: Math.max(0, x.pasos - 1), dir: 1 })),
    /** El periodo con el que arranca este filtro (3 meses en la vista móvil). */
    base,
    restablecer: () => setE(() => vacio),
    periodo,
    rango: { desde: e.desde, hasta: e.hasta },
    setRango: (desde: string, hasta: string) =>
      setE((x) => ({
        ...x,
        preset: "rango",
        pasos: 0,
        dir: 0,
        desde: desde <= hasta ? desde : hasta,
        hasta: desde <= hasta ? hasta : desde,
      })),
  };
}

export type NavPeriodo = ReturnType<typeof usePeriodo>;

/** ¿Ya no hay datos antes de este periodo? (su primer mes es el del movimiento más antiguo o anterior). */
export function usePrimerMes(): string | null {
  return useSistema().data?.primer_mes ?? null;
}

export function enLimiteAtras(nav: NavPeriodo, primerMes: string | null): boolean {
  return Boolean(primerMes && nav.periodo.desde && nav.periodo.desde <= primerMes);
}

/** En la vista móvil, todo filtro que admite rango ofrece «3 meses» (con el que arranca). */
function opcionesVisibles(opciones?: Preset[]): Preset[] | undefined {
  if (!opciones || !esMovil() || opciones.includes("3m") || !opciones.includes("rango")) return opciones;
  return [...opciones, "3m"];
}

const NOMBRE_PRESET: Record<Preset, string> = {
  mes: "Este mes",
  "3m": "3 meses",
  "6m": "6 meses",
  "12m": "12 meses",
  todo: "Todo",
  rango: "Rango",
};

/** «nov 2026», «dic 2025 – nov 2026» o «Todo el historial»: el intervalo que de verdad se aplica. */
export function etiquetaIntervalo(periodo: Periodo): string {
  if (!periodo.desde || !periodo.hasta) return "Todo el historial";
  if (periodo.desde === periodo.hasta) return nombreMes(periodo.desde);
  const mismoAnio = periodo.desde.slice(0, 4) === periodo.hasta.slice(0, 4);
  return mismoAnio
    ? `${nombreMes(periodo.desde, true)} – ${nombreMes(periodo.hasta, true)} ${periodo.hasta.slice(0, 4)}`
    : `${nombreMes(periodo.desde, true)} ${periodo.desde.slice(0, 4)} – ${nombreMes(periodo.hasta, true)} ${periodo.hasta.slice(0, 4)}`;
}

/**
 * Selector compacto: un botón que rotula el intervalo aplicado, con ‹ › a los lados. Al pulsarlo se
 * despliegan los periodos rápidos y el rango personalizado.
 */
export function ControlPeriodo({ nav, opciones: pedidas }: { nav: NavPeriodo; opciones?: Preset[] }) {
  const opciones = opcionesVisibles(pedidas);
  const [abierto, setAbierto] = useState(false);
  const primerMes = usePrimerMes();
  const limite = enLimiteAtras(nav, primerMes);
  const caja = useRef<HTMLDivElement>(null);
  const ancla = useRef<HTMLButtonElement>(null);
  const id = useId();
  const navegable = nav.preset !== "todo" && Boolean(nav.periodo.desde);
  const intervalo = etiquetaIntervalo(nav.periodo);
  // En el celular: la etiqueta del periodo y un botón de ícono en la esquina; ‹ › viven en el panel.
  const movil = esMovil();
  const flechaAnterior = (
    <button
      type="button"
      className="cd-icon-btn periodo-flecha"
      aria-label={limite ? "Periodo anterior: no hay datos antes" : "Periodo anterior"}
      title={limite ? "No hay datos antes de este periodo" : undefined}
      disabled={limite}
      onClick={nav.anterior}
    >
      ‹
    </button>
  );
  const flechaSiguiente = (
    <button
      type="button"
      className="cd-icon-btn periodo-flecha"
      aria-label={nav.pasos === 0 ? "Periodo siguiente: ya es el actual" : "Periodo siguiente"}
      title={nav.pasos === 0 ? "Ya estás en el periodo actual" : undefined}
      disabled={nav.pasos === 0}
      onClick={nav.siguiente}
    >
      ›
    </button>
  );
  return (
    <div ref={caja} className={`periodo ${movil ? "periodo--movil" : ""}`}>
      {movil && (
        <>
          <span className="periodo-etiqueta cd-num" aria-hidden="true">
            {intervalo}
          </span>
          <button
            type="button"
            ref={ancla}
            className="cd-icon-btn periodo-icono"
            aria-haspopup="dialog"
            aria-expanded={abierto}
            aria-controls={id}
            aria-label={`Periodo: ${intervalo}${nav.preset === "todo" ? "" : ` (${NOMBRE_PRESET[nav.preset].toLowerCase()})`}. Cambiar`}
            onClick={() => setAbierto((x) => !x)}
          >
            <Icono nombre="calendario" pequeno />
          </button>
        </>
      )}
      {!movil && navegable && flechaAnterior}
      {!movil && (
        <button
          type="button"
          ref={ancla}
          className="periodo-boton"
          aria-haspopup="dialog"
          aria-expanded={abierto}
          aria-controls={id}
          aria-label={`Periodo: ${intervalo}. Cambiar`}
          onClick={() => setAbierto((x) => !x)}
        >
          <Icono nombre="calendario" pequeno />
          <span className="cd-num" aria-live="polite">
            {intervalo}
          </span>
          <small>{nav.preset === "todo" ? "" : NOMBRE_PRESET[nav.preset]}</small>
          <span aria-hidden className="cd-muted">
            ▾
          </span>
        </button>
      )}
      {!movil && navegable && flechaSiguiente}
      {abierto && (
        <Flotante
          ancla={ancla}
          alCerrar={() => setAbierto(false)}
          id={id}
          role="dialog"
          aria-label="Elegir periodo"
          className="periodo-pop"
          atrapar
        >
          {movil && navegable && (
            <div className="periodo-pop-nav">
              {flechaAnterior}
              <span className="cd-num" aria-live="polite">
                {intervalo}
              </span>
              {flechaSiguiente}
            </div>
          )}
          <span className="cd-kpi-label">Periodos rápidos</span>
          <SelectorPeriodo
            valor={nav.preset}
            opciones={opciones}
            alCambiar={(p) => {
              nav.setPreset(p);
              if (p !== "rango") setAbierto(false);
            }}
          />
          {(!opciones || opciones.includes("rango")) && (
            <>
              <span className="cd-kpi-label">Rango</span>
              <span className="cd-row" style={{ gap: 6, flexWrap: "nowrap" }}>
                <CampoFecha
                  type="month"
                  aria-label="Desde"
                  className="cd-input"
                  value={nav.rango.desde}
                  max={nav.rango.hasta}
                  onChange={(ev) => ev.target.value && nav.setRango(ev.target.value, nav.rango.hasta)}
                />
                <span className="cd-delta-note">a</span>
                <CampoFecha
                  type="month"
                  aria-label="Hasta"
                  className="cd-input"
                  value={nav.rango.hasta}
                  min={nav.rango.desde}
                  onChange={(ev) => ev.target.value && nav.setRango(nav.rango.desde, ev.target.value)}
                />
              </span>
            </>
          )}
          {(nav.preset !== nav.base || nav.pasos > 0) && (
            <button
              type="button"
              className="cd-btn cd-btn--ghost cd-btn--sm periodo-restablecer"
              onClick={() => {
                nav.restablecer();
                setAbierto(false);
              }}
            >
              Restablecer ({NOMBRE_PRESET[nav.base].toLowerCase()})
            </button>
          )}
        </Flotante>
      )}
    </div>
  );
}

/** ‹ etiqueta › para ir a periodos anteriores (no aplica a «Todo»). */
export function NavegadorPeriodo({
  preset,
  periodo,
  pasos,
  anterior,
  siguiente,
}: {
  preset: Preset;
  periodo: Periodo;
  pasos: number;
  anterior: () => void;
  siguiente: () => void;
}) {
  if (preset === "todo" || !periodo.desde || !periodo.hasta) return null;
  const etiqueta =
    periodo.desde === periodo.hasta
      ? nombreMes(periodo.desde)
      : `${nombreMes(periodo.desde, true)} ${periodo.desde.slice(0, 4)} – ${nombreMes(periodo.hasta, true)} ${periodo.hasta.slice(0, 4)}`;
  return (
    <div className="cd-row" style={{ gap: 4, flexWrap: "nowrap" }}>
      <button type="button" className="cd-icon-btn" aria-label="Periodo anterior" onClick={anterior}>
        ‹
      </button>
      <span
        className="cd-select cd-num"
        aria-live="polite"
        style={{
          height: 40,
          minWidth: 150,
          justifyContent: "center",
          textTransform: "capitalize",
          whiteSpace: "nowrap",
        }}
      >
        {etiqueta}
      </span>
      <button
        type="button"
        className="cd-icon-btn"
        aria-label="Periodo siguiente"
        disabled={pasos === 0}
        onClick={siguiente}
      >
        ›
      </button>
    </div>
  );
}

export function SelectorPeriodo({
  valor,
  alCambiar,
  opciones,
}: {
  valor: Preset;
  alCambiar: (p: Preset) => void;
  opciones?: Preset[];
}) {
  return (
    <div className="cd-seg" role="radiogroup" aria-label="Periodo">
      {ETIQUETAS.filter(([p]) => !opciones || opciones.includes(p)).map(([p, texto]) => (
        <button
          key={p}
          title={
            p === "mes"
              ? "Este mes"
              : p === "todo"
                ? "Todo el historial"
                : p === "rango"
                  ? "Elige desde y hasta"
                  : `Últimos ${p.replace("m", "")} meses`
          }
          role="radio"
          aria-checked={valor === p}
          aria-selected={valor === p}
          onClick={() => alCambiar(p)}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

export function BotonExcel({ periodo }: { periodo: Periodo }) {
  return (
    <a className="cd-btn cd-btn--secondary cd-btn--sm" href={api.urlExcel(periodo)} download>
      <Icono nombre="descargar" />
      Exportar Excel
    </a>
  );
}
