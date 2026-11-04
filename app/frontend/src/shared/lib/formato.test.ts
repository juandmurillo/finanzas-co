import { describe, expect, it } from "vitest";

import { encabezadoDia, fechaCorta, formatoCOP, mascaraMonto, nombreMes, parseMonto, porcentaje } from "./formato";

describe("formatoCOP", () => {
  it("usa punto de miles y signo explícito como Caudal", () => {
    expect(formatoCOP(483_679_028)).toBe("$ 4.836.790");
    expect(formatoCOP(-2_500_000)).toBe("- $ 25.000");
    expect(formatoCOP(5_000_000, { signo: true })).toBe("+ $ 50.000");
    expect(formatoCOP(123_456_789, { decimales: true })).toBe("$ 1.234.567,89");
  });
});

describe("parseMonto", () => {
  it("entiende cómo escribe la gente en Colombia", () => {
    expect(parseMonto("18.000")).toBe(1_800_000);
    expect(parseMonto("18000")).toBe(1_800_000);
    expect(parseMonto("$ 1.250,5")).toBe(125_050);
  });
  it("rechaza vacíos, ceros y texto", () => {
    expect(parseMonto("")).toBeNull();
    expect(parseMonto("0")).toBeNull();
    expect(parseMonto("abc")).toBeNull();
    expect(parseMonto("1,234")).toBeNull();
  });
});

describe("mascaraMonto", () => {
  it("pone puntos mientras se escribe", () => {
    expect(mascaraMonto("18000")).toBe("18.000");
    expect(mascaraMonto("1250000,5")).toBe("1.250.000,5");
    expect(mascaraMonto("00012")).toBe("12");
  });
});

describe("fechas y porcentajes", () => {
  it("formatea en es-CO", () => {
    expect(fechaCorta("2026-10-27T10:00:00-05:00")).toBe("27 oct");
    expect(encabezadoDia("2026-10-27T10:00:00-05:00")).toBe("Martes 27 oct");
    expect(nombreMes("2026-10")).toBe("octubre 2026");
    expect(nombreMes("2026-10", true)).toBe("Oct");
    expect(porcentaje(0.6356)).toBe("63,56%");
  });
});
