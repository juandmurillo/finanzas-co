/** Atrás (Android) cierra la capa de arriba primero; el periodo siempre rotula el intervalo aplicado. */
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { etiquetaIntervalo } from "@/features/analisis/Periodo";

import { capasAbiertas, cerrarCapaSuperior, useCapa } from "./capas";

function Capa({ abierta, cerrar }: { abierta: boolean; cerrar: () => void }) {
  useCapa(abierta, cerrar);
  return null;
}

afterEach(cleanup);

describe("capas", () => {
  it("cierra de la más reciente a la más antigua y avisa cuando no hay ninguna", () => {
    const captura = vi.fn();
    const hoja = vi.fn();
    render(
      <>
        <Capa abierta cerrar={captura} />
        <Capa abierta cerrar={hoja} />
      </>,
    );
    expect(window.caudalAtras?.()).toBe(true);
    expect(hoja).toHaveBeenCalledOnce();
    expect(captura).not.toHaveBeenCalled();
    cleanup();
    expect(capasAbiertas()).toBe(0);
    expect(cerrarCapaSuperior()).toBe(false);
  });

  it("una capa cerrada no se registra", () => {
    render(<Capa abierta={false} cerrar={vi.fn()} />);
    expect(capasAbiertas()).toBe(0);
  });
});

describe("etiquetaIntervalo", () => {
  it("rotula mes, rango del mismo año, entre años y todo", () => {
    expect(etiquetaIntervalo({ desde: "2026-10", hasta: "2026-10" })).toBe("octubre 2026");
    expect(etiquetaIntervalo({ desde: "2026-06", hasta: "2026-11" })).toBe("Jun – Nov 2026");
    expect(etiquetaIntervalo({ desde: "2025-12", hasta: "2026-11" })).toBe("Dic 2025 – Nov 2026");
    expect(etiquetaIntervalo({})).toBe("Todo el historial");
  });
});
