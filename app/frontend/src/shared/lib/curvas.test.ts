import { describe, expect, it } from "vitest";

import { rutaSuave } from "./curvas";

const yDeControl = (ruta: string) =>
  [...ruta.matchAll(/C[\d.-]+ ([\d.-]+) [\d.-]+ ([\d.-]+) /g)].flatMap((m) => [Number(m[1]), Number(m[2])]);

describe("curva suave", () => {
  it("pasa por los puntos y empieza en el primero", () => {
    const ruta = rutaSuave([
      [0, 10],
      [10, 20],
      [20, 15],
    ]);
    expect(ruta.startsWith("M0.0 10.0")).toBe(true);
    expect(ruta.endsWith("20.0 15.0")).toBe(true);
  });
  it("no se sale del rango de los datos", () => {
    const ys = yDeControl(
      rutaSuave([
        [0, 100],
        [1, 100],
        [2, 0],
        [3, 0],
        [4, 80],
      ]),
    );
    expect(Math.max(...ys)).toBeLessThanOrEqual(100);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  });
  it("tolera listas cortas", () => {
    expect(rutaSuave([])).toBe("");
    expect(rutaSuave([[1, 2]])).toBe("M1.0 2.0");
  });
});
