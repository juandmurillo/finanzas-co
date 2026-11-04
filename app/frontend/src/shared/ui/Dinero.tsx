import { pesos } from "@/shared/lib/formato";

/**
 * Cifra grande de Caudal: `$` pequeño y elevado, decimales atenuados (`.cd-money`).
 * Para montos en listas usar `formatoCOP` dentro de `.cd-amt`.
 */
export function Dinero({ centavos, decimales, signo }: { centavos: number; decimales?: boolean; signo?: boolean }) {
  const prefijo = centavos < 0 ? "− " : signo && centavos > 0 ? "+ " : "";
  return (
    <span className="cd-money">
      {prefijo}
      <span className="cur">$</span>
      {pesos(centavos)}
      {decimales && <span className="dec">,{String(Math.abs(centavos) % 100).padStart(2, "0")}</span>}
    </span>
  );
}
