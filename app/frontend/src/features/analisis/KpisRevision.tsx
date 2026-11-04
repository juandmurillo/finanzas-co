/** KPIs estratégicos de la revisión (fase 7, punto 9): 4 semáforos con meta y tendencia, y datos de apoyo. */
import type { KpiRevision, KpisRevision } from "@/shared/api/tipos";
import { formatoCOP, nombreMes, porcentaje } from "@/shared/lib/formato";

const ESTADOS: Record<NonNullable<KpiRevision["estado"]>, [string, string]> = {
  bien: ["cd-badge--positive", "En meta"],
  atencion: ["cd-badge--warning", "Cerca"],
  alerta: ["cd-badge--negative", "Lejos de la meta"],
  sin_datos: ["cd-badge--plain", "Sin datos"],
};

export function valorKpi(k: Pick<KpiRevision, "valor" | "formato">): string {
  const v = k.valor;
  if (v === null) return "—";
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

function Tendencia({ k, meses }: { k: KpiRevision; meses: string[] }) {
  if (!k.tendencia) return null;
  const valores = k.tendencia;
  const maximo = Math.max(1e-9, ...valores.map((v) => Math.abs(v ?? 0)));
  return (
    <div className="cd-spark" style={{ height: 32, gap: 4 }} role="img" aria-label={`${k.nombre}, últimos 6 meses`}>
      {valores.map((v, i) => (
        <i
          key={meses[i]}
          className={v !== null && v < 0 ? "neg" : i === valores.length - 1 ? "on" : ""}
          style={{ height: `${Math.max(8, (Math.abs(v ?? 0) / maximo) * 100)}%`, width: 10 }}
          title={`${nombreMes(meses[i] ?? "")}: ${valorKpi({ valor: v, formato: k.formato })}`}
        />
      ))}
    </div>
  );
}

export function KpisEstrategicos({ kpis }: { kpis: KpisRevision }) {
  return (
    <>
      <div className="cd-bento">
        {kpis.principales.map((k) => {
          const [clase, texto] = ESTADOS[k.estado ?? "sin_datos"];
          return (
            <section key={k.clave} className="cd-card cd-kpi span-3 cd-stack" style={{ gap: 8 }}>
              <div className="cd-row" style={{ justifyContent: "space-between", gap: 6 }}>
                <span className="cd-kpi-label">{k.nombre}</span>
                <span className={`cd-badge ${clase}`}>{texto}</span>
              </div>
              <span className="cd-kpi-value cd-num">{valorKpi(k)}</span>
              <span className="cd-delta-note">{k.texto_meta}</span>
              <Tendencia k={k} meses={kpis.meses} />
            </section>
          );
        })}
      </div>
      <section className="cd-card" aria-label="Datos de apoyo">
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))", gap: 16 }}>
          {kpis.secundarios.map((k) => (
            <div key={k.clave} className="cd-stack" style={{ gap: 4 }}>
              <span className="cd-delta-note">{k.nombre}</span>
              <span className="cd-amt" style={{ fontSize: 20 }}>
                {valorKpi(k)}
              </span>
              <span className="cd-delta-note">{k.detalle}</span>
              <Tendencia k={k} meses={kpis.meses} />
            </div>
          ))}
        </div>
      </section>
    </>
  );
}
