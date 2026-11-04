import { describe, expect, it } from "vitest";

import { clavesAInvalidar } from "./queryKeys";

describe("clavesAInvalidar", () => {
  it("un movimiento nuevo refresca lista, saldos, dashboard y sugerencias sin duplicar", () => {
    const claves = clavesAInvalidar(["transacciones", "cuentas", "reportes", "dashboard"]).map((c) => c.join("|"));
    expect(claves).toEqual([
      "transacciones",
      "sugerencias",
      "presupuesto",
      "calendario",
      "metas",
      "alertas",
      "cuentas",
      "reportes",
      "dashboard",
    ]);
  });
  it("ignora entidades desconocidas", () => {
    expect(clavesAInvalidar(["algo-nuevo"])).toEqual([]);
  });
});
