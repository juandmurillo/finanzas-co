/** KPIs estratégicos de la revisión (fase 7, punto 9): seis indicadores claros, sin gráficos dentro, y su
 * tendencia de 6 meses en un gráfico aparte. */
import type { KpiRevision, KpisRevision, RevisionMensual } from "@/shared/api/tipos";
import { AreaSeries } from "@/shared/charts";
import { formatoCOP, nombreMes, porcentaje } from "@/shared/lib/formato";
import { CabeceraTarjeta, FilaMetricas, KpiCompacto, type SentidoDelta } from "@/shared/ui/Kpi";
import type { NombreIcono } from "@/shared/ui/Icono";

const ESTADOS: Record<NonNullable<KpiRevision["estado"]>, [SentidoDelta, string]> = {
  bien: ["mejora", "En meta"],
  atencion: ["neutro", "Cerca"],
  alerta: ["alerta", "Lejos de la meta"],
  sin_datos: ["neutro", "Sin datos"],
};

export function valorKpi(k: Pick<KpiRevision, "valor" | "formato"> & { clave?: string }): string {
  const v = k.valor;
  if (v === null) return "—";
  // Con ingresos muy bajos, «−840 %» no dice nada: mejor cuántas veces salió lo que entró.
  if (k.clave === "tasa_ahorro" && v < -1) return `Salió ${(1 - v).toFixed(1).replace(".", ",")} veces lo que entró`;
  switch (k.formato) {
    case "pct":
      return porcentaje(v, 0);
    case "veces":
      return `${v.toFixed(2).replace(".", ",")}×`;
    case "meses":
      return `${v.toFixed(1).replace(".", ",")} ${v === 1 ? "mes" : "meses"}`;
    case "dias":
      return `${v} ${v === 1 ? "día" : "días"}`;
    default:
      return formatoCOP(v);
  }
}

/** Título y texto en palabras simples para cada indicador principal. */
const CLAROS: Record<string, { titulo: string; icono: NombreIcono; valor: (k: KpiRevision) => string; nota: string }> =
  {
    tasa_ahorro: {
      titulo: "Ahorraste",
      icono: "meta",
      valor: (k) =>
        k.valor === null
          ? "—"
          : k.valor < 0
            ? k.valor < -1
              ? valorKpi(k)
              : "Gastaste más de lo que entró"
            : `${porcentaje(k.valor, 0)} de lo que entró`,
      nota: "meta: guardar al menos el 10 %",
    },
    carga_deuda: {
      titulo: "Cuotas de deudas",
      icono: "deudas",
      valor: (k) => (k.valor === null ? "—" : `${porcentaje(k.valor, 0)} de tu ingreso`),
      nota: "meta: máximo el 30 %",
    },
    cobertura_fijos: {
      titulo: "Tu ingreso cubre los fijos",
      icono: "recurrentes",
      valor: (k) => (k.valor === null ? "—" : `${k.valor.toFixed(1).replace(".", ",")} veces`),
      nota: "meta: 1,5 veces o más",
    },
    meses_colchon: {
      titulo: "Colchón",
      icono: "cuentas",
      valor: (k) =>
        k.valor === null ? "—" : `${k.valor.toFixed(1).replace(".", ",")} ${k.valor === 1 ? "mes" : "meses"}`,
      nota: "de gastos con lo que tienes disponible · meta: 3",
    },
  };

export function KpisEstrategicos({
  kpis,
  flujo,
  mes,
}: {
  kpis: KpisRevision;
  flujo: RevisionMensual["indicadores"][number];
  mes: string;
}) {
  const presupuesto = kpis.secundarios.find((k) => k.clave === "presupuesto_cumplido");
  const apoyo = kpis.secundarios.filter((k) => k.clave !== "presupuesto_cumplido");
  const ahorro = kpis.principales.find((k) => k.clave === "tasa_ahorro");
  const carga = kpis.principales.find((k) => k.clave === "carga_deuda");
  const conTendencia = [
    ahorro && { k: ahorro, color: "var(--positive)", nombre: "Ahorraste" },
    carga && { k: carga, color: "var(--chart-2)", nombre: "Cuotas de deudas" },
  ].filter((x): x is { k: KpiRevision; color: string; nombre: string } => Boolean(x?.k.tendencia));
  return (
    <>
      <div className="revision-kpis">
        <KpiCompacto
          inversa
          etiqueta="Te quedó este mes"
          icono="flujo"
          valor={formatoCOP(flujo.actual, { signo: true })}
          nota={`lo que entró menos lo que salió · tu promedio ${formatoCOP(flujo.promedio, { signo: true })}`}
        />
        {kpis.principales.map((k) => {
          const [sentido, texto] = ESTADOS[k.estado ?? "sin_datos"];
          const claro = CLAROS[k.clave];
          return (
            <KpiCompacto
              key={k.clave}
              etiqueta={claro?.titulo ?? k.nombre}
              icono={claro?.icono}
              valor={claro ? claro.valor(k) : valorKpi(k)}
              delta={{ valor: 0, sentido, texto }}
              nota={claro?.nota ?? k.texto_meta}
            />
          );
        })}
        {presupuesto && (
          <KpiCompacto
            etiqueta="Presupuestos cumplidos"
            icono="presupuesto"
            valor={presupuesto.valor === null ? "—" : porcentaje(presupuesto.valor, 0)}
            nota={presupuesto.detalle}
          />
        )}
      </div>
      <div className="cd-bento">
        {conTendencia.length > 0 && (
          <section className="cd-card span-7">
            <CabeceraTarjeta titulo="Cómo vienes" rango={`últimos 6 meses hasta ${nombreMes(mes)}`} />
            <AreaSeries
              titulo="Ahorro y cuotas de deudas, últimos 6 meses"
              alto={220}
              fechas={kpis.meses.map((m) => `${m}-01`)}
              rotulo={(f) => nombreMes(f.slice(0, 7))}
              formato={(v) => porcentaje(v, 0)}
              formatoEje={(v) => porcentaje(v, 0)}
              series={conTendencia.map(({ k, color, nombre }) => ({
                clave: k.clave,
                nombre,
                color,
                valores: (k.tendencia ?? []).map((v) => Math.max(-1, v ?? 0)),
              }))}
            />
          </section>
        )}
        <section
          className={`cd-card revision-apoyo ${conTendencia.length > 0 ? "span-5" : "span-12"}`}
          aria-label="Datos de apoyo"
        >
          <CabeceraTarjeta titulo="Datos de apoyo" rango={nombreMes(mes)} />
          <FilaMetricas
            etiqueta="Datos de apoyo"
            metricas={apoyo.map((k) => ({ etiqueta: k.nombre, valor: valorKpi(k), nota: k.detalle }))}
          />
        </section>
      </div>
    </>
  );
}
