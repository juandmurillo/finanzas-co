/** Selector de periodo compartido por los gráficos (presets, rango personalizado y ‹ ›) y botón de exportar
 * a Excel con el mismo rango. Cada gráfico recuerda su última elección (fase 8, punto 1.6). */
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";

import { api, type Periodo } from "@/shared/lib/api";
import { hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";
import { Icono } from "@/shared/ui/Icono";

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
}

/** Periodo de un gráfico. Con `clave`, la elección se recuerda entre sesiones (por navegador). */
export function usePeriodo(inicial: Exclude<Preset, "rango">, clave?: string) {
  const hoy = hoyISO().slice(0, 7);
  const [e, setE] = useFiltroRecordado<EstadoPeriodo>(clave ? `periodo:${clave}` : null, {
    preset: inicial,
    pasos: 0,
    desde: moverMes(hoy, -5),
    hasta: hoy,
  });
  const periodo =
    e.preset === "rango" ? desplazarRango(e.desde, e.hasta, e.pasos) : desplazarPeriodo(e.preset, e.pasos);
  return {
    preset: e.preset,
    setPreset: (p: Preset) => setE((x) => ({ ...x, preset: p, pasos: 0 })),
    pasos: e.pasos,
    anterior: () => setE((x) => ({ ...x, pasos: x.pasos + 1 })),
    siguiente: () => setE((x) => ({ ...x, pasos: Math.max(0, x.pasos - 1) })),
    periodo,
    rango: { desde: e.desde, hasta: e.hasta },
    setRango: (desde: string, hasta: string) =>
      setE((x) => ({
        ...x,
        preset: "rango",
        pasos: 0,
        desde: desde <= hasta ? desde : hasta,
        hasta: desde <= hasta ? hasta : desde,
      })),
  };
}

export type NavPeriodo = ReturnType<typeof usePeriodo>;

/** Selector completo: presets, rango personalizado (desde/hasta) y ‹ › para moverse entre periodos. */
export function ControlPeriodo({ nav, opciones }: { nav: NavPeriodo; opciones?: Preset[] }) {
  return (
    <div className="cd-row" style={{ gap: 6 }}>
      <SelectorPeriodo valor={nav.preset} alCambiar={nav.setPreset} opciones={opciones} />
      {nav.preset === "rango" && (
        <span className="cd-row" style={{ gap: 4, flexWrap: "nowrap" }}>
          <input
            type="month"
            aria-label="Desde"
            className="cd-input"
            style={{ height: 40, width: 165 }}
            value={nav.rango.desde}
            max={nav.rango.hasta}
            onChange={(ev) => ev.target.value && nav.setRango(ev.target.value, nav.rango.hasta)}
          />
          <span className="cd-delta-note">a</span>
          <input
            type="month"
            aria-label="Hasta"
            className="cd-input"
            style={{ height: 40, width: 165 }}
            value={nav.rango.hasta}
            min={nav.rango.desde}
            onChange={(ev) => ev.target.value && nav.setRango(nav.rango.desde, ev.target.value)}
          />
        </span>
      )}
      <NavegadorPeriodo {...nav} />
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
