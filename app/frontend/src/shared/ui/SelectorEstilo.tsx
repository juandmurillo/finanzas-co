/** Elegir ícono (del set de Caudal) y color (paleta chart-1…6) para categorías y presupuestos. */
import { Icono, type NombreIcono } from "./Icono";

export const ICONOS_ELEGIBLES: NombreIcono[] = [
  "inicio",
  "comida",
  "ruta",
  "telefono",
  "wifi",
  "bolsa",
  "regalo",
  "corazon",
  "balon",
  "dado",
  "deudas",
  "persona",
  "meta",
  "documento",
  "categorias",
  "cuentas",
  "calendario",
  "escudo",
  "flujo",
  "entra",
];
export const COLORES = ["chart-1", "chart-2", "chart-3", "chart-4", "chart-5", "chart-6"] as const;

export function SelectorEstilo({
  icono,
  color,
  alCambiar,
}: {
  icono: string | null;
  color: string | null;
  alCambiar: (v: { icono: string | null; color: string | null }) => void;
}) {
  return (
    <div className="cd-stack" style={{ gap: 10 }}>
      <div
        role="radiogroup"
        aria-label="Ícono"
        style={{ display: "grid", gridTemplateColumns: "repeat(10, 1fr)", gap: 6 }}
      >
        {ICONOS_ELEGIBLES.map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={icono === n}
            aria-label={n}
            className="cd-icon-btn"
            style={{
              width: "100%",
              aspectRatio: "1",
              height: "auto",
              borderColor: icono === n ? "var(--brand)" : undefined,
              background: icono === n ? "var(--brand-soft)" : undefined,
            }}
            onClick={() => alCambiar({ icono: icono === n ? null : n, color })}
          >
            <Icono nombre={n} pequeno />
          </button>
        ))}
      </div>
      <div className="cd-row" role="radiogroup" aria-label="Color" style={{ gap: 8 }}>
        {COLORES.map((c) => (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={color === c}
            aria-label={`Color ${c.slice(-1)}`}
            onClick={() => alCambiar({ icono, color: color === c ? null : c })}
            style={{
              width: 28,
              height: 28,
              borderRadius: 999,
              background: `var(--${c})`,
              border: color === c ? "3px solid var(--ink)" : "2px solid var(--border)",
              cursor: "pointer",
            }}
          />
        ))}
        <span className="cd-delta-note">Sin elegir: ícono y color automáticos</span>
      </div>
    </div>
  );
}
