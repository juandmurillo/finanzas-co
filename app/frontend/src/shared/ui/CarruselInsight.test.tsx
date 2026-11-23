/** Carrusel «Este mes»: rota cada 5 s, se puede pausar y elegir un hallazgo reinicia el temporizador. */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CarruselInsight } from "./CarruselInsight";

const ITEMS = [
  { frase: "Primero {cifra}", cifra: "$ 1" },
  { frase: "Segundo {cifra}", cifra: "$ 2" },
  { frase: "Tercero {cifra}", cifra: "$ 3" },
];
const activo = () => document.querySelector(".cinsight-diapositiva.activa")?.textContent;

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("CarruselInsight", () => {
  it("rota cada 5 segundos y vuelve al primero", () => {
    render(<CarruselInsight items={ITEMS} />);
    expect(activo()).toContain("Primero");
    act(() => void vi.advanceTimersByTime(5000));
    expect(activo()).toContain("Segundo");
    act(() => void vi.advanceTimersByTime(5000));
    expect(activo()).toContain("Tercero");
    act(() => void vi.advanceTimersByTime(5000));
    expect(activo()).toContain("Primero");
  });

  it("la pausa detiene la rotación y es accesible", () => {
    render(<CarruselInsight items={ITEMS} />);
    fireEvent.click(screen.getByRole("button", { name: "Pausar la rotación" }));
    expect(screen.getByRole("button", { name: "Reanudar la rotación" })).toHaveAttribute("aria-pressed", "true");
    act(() => void vi.advanceTimersByTime(15000));
    expect(activo()).toContain("Primero");
  });

  it("elegir un hallazgo reinicia el temporizador (no salta enseguida)", () => {
    render(<CarruselInsight items={ITEMS} />);
    act(() => void vi.advanceTimersByTime(4000));
    fireEvent.click(screen.getByRole("button", { name: "Hallazgo 3 de 3" }));
    act(() => void vi.advanceTimersByTime(4000));
    expect(activo()).toContain("Tercero");
    act(() => void vi.advanceTimersByTime(1100));
    expect(activo()).toContain("Primero");
  });

  it("todas las diapositivas comparten la misma celda (la altura es la de la más larga)", () => {
    render(<CarruselInsight items={ITEMS} />);
    expect(document.querySelectorAll(".cinsight-pista > .cinsight-diapositiva")).toHaveLength(3);
    expect(document.querySelectorAll('.cinsight-diapositiva[aria-hidden="true"]')).toHaveLength(2);
  });
});
