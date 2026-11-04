import { describe, expect, it } from "vitest";

import { desplazarPeriodo } from "@/features/analisis/Periodo";
import type { CategoriaNodo } from "@/shared/api/tipos";
import { textoDias } from "@/shared/ui/DiasRestantes";

import { filtrarCategorias } from "./categorias";

const nodo = (id: number, nombre: string, grupo: string, hijos: CategoriaNodo[] = []): CategoriaNodo => ({
  id,
  nombre,
  nivel: hijos.length ? 2 : 3,
  grupo,
  es_fijo: false,
  icono: null,
  color: null,
  hijos,
});

describe("fase 7: componentes base", () => {
  it("desplaza el periodo por ventanas completas y cruza de año", () => {
    expect(desplazarPeriodo("6m", 0, "2026-10")).toEqual({ desde: "2026-05", hasta: "2026-10" });
    expect(desplazarPeriodo("6m", 1, "2026-10")).toEqual({ desde: "2025-11", hasta: "2026-04" });
    expect(desplazarPeriodo("mes", 10, "2026-10")).toEqual({ desde: "2025-12", hasta: "2025-12" });
    expect(desplazarPeriodo("todo", 3, "2026-10")).toEqual({});
  });

  it("dice cuántos días faltan o hace cuánto venció", () => {
    expect([0, 1, 5, -1, -14].map(textoDias)).toEqual([
      "hoy",
      "mañana",
      "en 5 días",
      "venció ayer",
      "vencido hace 14 días",
    ]);
  });

  it("filtra categorías por nombre o subcategoría, sin tildes y por grupo", () => {
    const arbol = [
      nodo(1, "Gasto de vida", "gasto_vida", [
        nodo(2, "Transporte", "gasto_vida", [nodo(3, "Uber", "gasto_vida"), nodo(4, "Moto", "gasto_vida")]),
        nodo(5, "Factura", "gasto_vida", [nodo(6, "Internet hogar", "gasto_vida")]),
      ]),
      nodo(7, "Ingreso", "ingreso", [nodo(8, "Trabajo independiente", "ingreso", [nodo(9, "Diseño", "ingreso")])]),
    ];
    const uber = filtrarCategorias(arbol, ["gasto_vida"], "úber");
    expect(uber.map((g) => [g.categoria.nombre, g.subcategorias.map((s) => s.nombre)])).toEqual([
      ["Transporte", ["Uber"]],
    ]);
    expect(filtrarCategorias(arbol, ["gasto_vida"], "")).toHaveLength(2);
    expect(filtrarCategorias(arbol, ["gasto_vida"], "diseño")).toHaveLength(0); // es de ingresos
  });
});
