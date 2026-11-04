import { describe, expect, it } from "vitest";

import { validar, type Borrador } from "./modelo";

const base: Borrador = {
  tipo: "gasto",
  monto: "9.000",
  descripcion: " Moto ",
  categoriaId: 7,
  cuentaId: 1,
  destinoId: null,
  fecha: "2026-10-28",
  nota: "",
};

describe("validar captura", () => {
  it("un gasto sale con monto negativo en centavos", () => {
    const r = validar(base);
    expect(r).toMatchObject({
      ok: true,
      tipo: "movimiento",
      datos: { monto: -900_000, descripcion: "Moto", categoria_id: 7 },
    });
  });
  it("un ingreso sale positivo", () => {
    expect(validar({ ...base, tipo: "ingreso" })).toMatchObject({ ok: true, datos: { monto: 900_000 } });
  });
  it("exige categoría salvo en transferencias", () => {
    expect(validar({ ...base, categoriaId: null })).toMatchObject({
      ok: false,
      errores: { categoriaId: "Elige una categoría" },
    });
  });
  it("una transferencia necesita destino distinto", () => {
    expect(validar({ ...base, tipo: "transferencia", destinoId: 1 })).toMatchObject({ ok: false });
    expect(validar({ ...base, tipo: "transferencia", destinoId: 2 })).toMatchObject({
      ok: true,
      tipo: "transferencia",
      datos: { origen_id: 1, destino_id: 2, monto: 900_000 },
    });
  });
  it("rechaza monto vacío", () => {
    expect(validar({ ...base, monto: "" })).toMatchObject({
      ok: false,
      errores: { monto: "Escribe un monto mayor que cero" },
    });
  });
});
