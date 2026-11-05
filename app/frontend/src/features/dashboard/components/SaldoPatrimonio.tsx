/** Evolución en una sola sección: Saldo disponible (por defecto) o Patrimonio neto, con el mismo periodo. */
import { ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";
import type { Patrimonio } from "@/shared/api/tipos";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";

import { GraficoPatrimonio } from "./GraficoPatrimonio";
import { GraficoSaldo } from "./GraficoSaldo";

const VISTAS = [
  ["saldo", "Saldo disponible"],
  ["patrimonio", "Patrimonio neto"],
] as const;

export function SaldoPatrimonio({ patrimonio }: { patrimonio: Patrimonio }) {
  const nav = usePeriodo("12m", "inicio-valor-neto");
  const [estado, setEstado] = useFiltroRecordado("inicio-evolucion", { vista: "saldo" as "saldo" | "patrimonio" });
  return (
    <section className="cd-card cd-stack span-12" style={{ gap: 12 }}>
      <div className="cd-card-head" style={{ flexWrap: "wrap", gap: 8, margin: 0 }}>
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Qué gráfica ver">
          {VISTAS.map(([valor, texto]) => (
            <button
              key={valor}
              type="button"
              role="radio"
              aria-checked={estado.vista === valor}
              aria-selected={estado.vista === valor}
              onClick={() => setEstado(() => ({ vista: valor }))}
            >
              {texto}
            </button>
          ))}
        </div>
        <ControlPeriodo nav={nav} opciones={["3m", "6m", "12m", "todo", "rango"]} />
      </div>
      {estado.vista === "saldo" ? (
        <GraficoSaldo periodo={nav.periodo} />
      ) : (
        <GraficoPatrimonio periodo={nav.periodo} actual={patrimonio} />
      )}
    </section>
  );
}
