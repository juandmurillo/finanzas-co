import { describe, expect, it } from "vitest";

import { abreviar, moverMes } from "@/shared/lib/formato";

import { aPeriodo } from "./Periodo";

describe("periodos de los reportes", () => {
  it("los presets cuentan el mes actual y cruzan de año", () => {
    expect(aPeriodo("mes", "2026-10")).toEqual({ desde: "2026-10", hasta: "2026-10" });
    expect(aPeriodo("3m", "2026-02")).toEqual({ desde: "2025-12", hasta: "2026-02" });
    expect(aPeriodo("12m", "2026-10")).toEqual({ desde: "2025-11", hasta: "2026-10" });
    expect(aPeriodo("todo", "2026-10")).toEqual({});
  });
  it("moverMes y abreviar", () => {
    expect(moverMes("2026-01", -1)).toBe("2025-12");
    expect(abreviar(125_000_000)).toBe("1,3M");
    expect(abreviar(-8_500_000)).toBe("-85k");
  });
});
