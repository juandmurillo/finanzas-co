/** Vista por categoría o subcategoría y clic hacia los movimientos. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CategoriaNodo, CategoriaReporte } from "@/shared/api/tipos";
import { Distribucion } from "@/shared/charts";

import { idPorNombre, partesPorNivel } from "./CategoriasMes";

afterEach(cleanup);

const CATS = [
  {
    categoria: "Comida",
    id: 5,
    total: 1000,
    subcategorias: [
      { subcategoria: "Mercado", id: 51, total: 600 },
      { subcategoria: "Restaurantes", id: 52, total: 300 },
    ],
  },
  { categoria: "Créditos", id: 9, total: 500, subcategorias: [{ subcategoria: "Banco Uno", id: 91, total: 500 }] },
] as unknown as CategoriaReporte[];

describe("partesPorNivel", () => {
  it("por categoría usa el total y el id de cada categoría", () => {
    expect(partesPorNivel(CATS, "categoria")).toEqual([
      { nombre: "Comida", valor: 1000, id: 5 },
      { nombre: "Créditos", valor: 500, id: 9 },
    ]);
  });
  it("por subcategoría deja lo que no tiene subcategoría con el nombre de su categoría", () => {
    expect(partesPorNivel(CATS, "subcategoria")).toEqual([
      { nombre: "Mercado", valor: 600, id: 51 },
      { nombre: "Restaurantes", valor: 300, id: 52 },
      { nombre: "Comida", valor: 100, id: 5 },
      { nombre: "Banco Uno", valor: 500, id: 91 },
    ]);
  });
});

describe("Distribucion", () => {
  it("al hacer clic en una fila entrega la parte elegida", () => {
    const alElegir = vi.fn();
    render(<Distribucion titulo="Gastos" partes={partesPorNivel(CATS, "subcategoria")} alElegir={alElegir} />);
    fireEvent.click(screen.getByRole("button", { name: /Banco Uno.*Ver sus movimientos/ }));
    expect(alElegir).toHaveBeenCalledWith({ nombre: "Banco Uno", valor: 500, id: 91 });
  });
});

describe("idPorNombre", () => {
  const nodo = (id: number, nombre: string, nivel: number, grupo: string, hijos: CategoriaNodo[] = []) =>
    ({ id, nombre, nivel, grupo, es_fijo: false, hijos }) as CategoriaNodo;
  const ARBOL = [
    nodo(1, "Servicio de deuda", 1, "servicio_deuda", [
      nodo(9, "Créditos", 2, "servicio_deuda", [nodo(91, "Crédito Banco Uno", 3, "servicio_deuda")]),
    ]),
    nodo(2, "Ingresos", 1, "ingreso", [nodo(20, "Salario", 2, "ingreso")]),
  ];
  it("resuelve categoría o subcategoría dentro de los grupos del lado", () => {
    expect(idPorNombre(ARBOL, ["servicio_deuda"], "Créditos", "categoria")).toBe(9);
    expect(idPorNombre(ARBOL, ["servicio_deuda"], "Crédito Banco Uno", "subcategoria")).toBe(91);
    expect(idPorNombre(ARBOL, ["servicio_deuda"], "Salario", "categoria")).toBeNull();
  });
});

describe("Distribucion sin «Otras»", () => {
  it("la barra muestra todas las partes aunque la lista solo enseñe las primeras", () => {
    const partes = Array.from({ length: 11 }, (_, i) => ({ nombre: `C${i}`, valor: 100 - i }));
    const { container } = render(<Distribucion titulo="Gastos" partes={partes} visibles={5} />);
    expect(container.querySelectorAll(".distribucion-parte")).toHaveLength(11);
    expect(container.querySelectorAll(".distribucion-lista li")).toHaveLength(5);
    expect(screen.queryByText("Otras")).toBeNull();
  });
});

describe("Distribucion: selección por toque y teclado", () => {
  const PARTES = [
    { nombre: "Mantenimiento y reparaciones del apartamento compartido", valor: 12_345_678_900, id: 1 },
    { nombre: "Comida", valor: 55_600_000, id: 2 },
    { nombre: "Transporte", valor: 12_600_000, id: 3 },
  ];

  it("con el teclado, varias flechas seguidas terminan en la última parte y Enter la abre", () => {
    const alElegir = vi.fn();
    render(<Distribucion titulo="Gastos" partes={PARTES} alElegir={alElegir} />);
    const barra = screen.getByRole("listbox");
    barra.focus();
    fireEvent.keyDown(barra, { key: "ArrowRight" });
    fireEvent.keyDown(barra, { key: "ArrowRight" });
    fireEvent.keyDown(barra, { key: "ArrowRight" });
    fireEvent.keyDown(barra, { key: "ArrowLeft" });
    const elegida = screen.getByRole("option", { selected: true });
    expect(elegida).toHaveAccessibleName(/^Comida: \$ 556\.000/);
    expect(barra).toHaveAttribute("aria-activedescendant", elegida.id);
    fireEvent.keyDown(barra, { key: "Enter" });
    expect(alElegir).toHaveBeenCalledWith(expect.objectContaining({ nombre: "Comida" }));
  });

  it("con el dedo, el toque muestra el importe completo al instante y no navega", () => {
    const alElegir = vi.fn();
    const { container } = render(<Distribucion titulo="Gastos" partes={PARTES} alElegir={alElegir} />);
    const parte = container.querySelector(".distribucion-parte");
    if (!parte) throw new Error("sin partes");
    fireEvent.pointerDown(parte, { pointerType: "touch" });
    fireEvent.click(parte);
    expect(alElegir).not.toHaveBeenCalled();
    const detalle = container.querySelector(".distribucion-detalle");
    expect(detalle).not.toHaveAttribute("hidden");
    expect(detalle).toHaveTextContent("$ 123.456.789");
    expect(detalle).toHaveTextContent("Mantenimiento y reparaciones del apartamento compartido");
    fireEvent.click(screen.getByRole("button", { name: /Ver movimientos/ }));
    expect(alElegir).toHaveBeenCalledWith(expect.objectContaining({ id: 1 }));
  });
});
