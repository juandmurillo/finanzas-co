/** Gráficos compactos: escalas, accesibilidad (tabla alternativa, teclado, leyenda) y estados. */
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { marcasEje, marcasEjeConSigno, rutaColumna } from "./base";
import {
  AreaComparada,
  BarrasActivas,
  BarrasAgrupadas,
  BarrasApiladas,
  BarrasHorizontales,
  Gauge,
  Anillo,
  AreaSeries,
  Circulo,
} from "./index";

afterEach(cleanup);

const MESES = ["Jun", "Jul", "Ago", "Sep", "Oct", "Nov"];

describe("escalas", () => {
  it("marcas limpias que cubren el máximo", () => {
    expect(marcasEje(3_750_000_00)).toEqual([0, 1_000_000_00, 2_000_000_00, 3_000_000_00, 4_000_000_00]);
    expect(marcasEje(0)).toEqual([0]);
  });
  it("con negativos incluye el cero", () => {
    const m = marcasEjeConSigno(-362_600_00, 1_200_000_00);
    expect(m).toContain(0);
    expect(m[0]).toBeLessThanOrEqual(-362_600_00);
    expect(m.at(-1)).toBeGreaterThanOrEqual(1_200_000_00);
  });
  it("la columna tiene punta redondeada y base recta, también hacia abajo", () => {
    expect(rutaColumna(0, 20, 10, 100)).toMatch(/^M0 100 V14 Q0 10 4 10/);
    expect(rutaColumna(0, 20, 150, 100)).toMatch(/^M0 100 V146/);
    expect(rutaColumna(0, 20, 100, 100)).toBe("");
  });
});

describe("BarrasActivas", () => {
  const datos = MESES.map((m, i) => ({ etiqueta: m, valor: (i + 1) * 100_000_00, proyectado: i === 5 }));

  it("resalta la última barra real y rotula su valor", () => {
    const { container } = render(<BarrasActivas titulo="Gasto por mes" datos={datos} />);
    // la de noviembre es proyectada: el valor rotulado es el de octubre
    expect(container.querySelector(".grafico-valor")).toHaveTextContent("$ 500.000");
    expect(screen.getByRole("table", { name: "Gasto por mes" })).toHaveTextContent("$ 600.000 (proyectado)");
  });

  it("se recorre con el teclado", () => {
    const { container } = render(<BarrasActivas titulo="Gasto por mes" datos={datos} />);
    const svg = screen.getByRole("group", { name: /Gasto por mes/ });
    fireEvent.keyDown(svg, { key: "Home" });
    expect(container.querySelector(".grafico-valor")).toHaveTextContent("$ 100.000");
    fireEvent.keyDown(svg, { key: "End" });
    expect(screen.getByRole("status")).toHaveTextContent(/proyectado/i);
  });
});

describe("Series múltiples", () => {
  it("las agrupadas y apiladas llevan leyenda y tabla con total", () => {
    const series = [
      { nombre: "Comida", color: "var(--chart-1)", valores: [10_000_00, 20_000_00] },
      { nombre: "Transporte", color: "var(--chart-2)", valores: [5_000_00, 0] },
    ];
    render(
      <>
        <BarrasAgrupadas titulo="Ingresos y gastos" etiquetas={["Oct", "Nov"]} series={series} />
        <BarrasApiladas titulo="Gasto diario" etiquetas={["1", "2"]} series={series} />
      </>,
    );
    expect(screen.getAllByRole("list")).toHaveLength(2);
    const apilada = screen.getByRole("table", { name: "Gasto diario" });
    expect(within(apilada).getAllByRole("row")[1]).toHaveTextContent("$ 15.000");
  });

  it("una sola serie no muestra leyenda", () => {
    render(<AreaComparada titulo="Saldo" datos={MESES.map((m, i) => ({ etiqueta: m, valor: i * 10_00 }))} />);
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("el área con comparación nombra ambos periodos", () => {
    render(
      <AreaComparada
        titulo="Ritmo del mes"
        nombre="Noviembre"
        nombreAnterior="Octubre"
        datos={MESES.map((m, i) => ({ etiqueta: m, valor: i * 10_00, anterior: i * 8_00 }))}
      />,
    );
    expect(screen.getByRole("list")).toHaveTextContent(/Noviembre.*Octubre/);
    expect(screen.getByRole("table", { name: "Ritmo del mes" })).toHaveTextContent("Octubre");
  });
});

describe("BarrasHorizontales", () => {
  it("cada barra tiene su valor, dentro o fuera según quepa", () => {
    const { container } = render(
      <BarrasHorizontales
        titulo="Gasto por grupo"
        datos={[
          { etiqueta: "Vivienda", valor: 1_200_000_00 },
          { etiqueta: "Ocio", valor: 1_000_00 },
        ]}
      />,
    );
    const valores = container.querySelectorAll(".grafico-valor");
    expect(valores).toHaveLength(2);
    expect(valores[1]).not.toHaveClass("dentro");
  });

  it("el texto dentro de una barra neutra va en tinta, no en blanco", () => {
    const { container } = render(
      <BarrasHorizontales
        titulo="Gasto por grupo"
        resaltar={0}
        datos={[
          { etiqueta: "Vivienda", valor: 1_200_000_00 },
          { etiqueta: "Comida", valor: 1_100_000_00 },
        ]}
      />,
    );
    const valores = container.querySelectorAll(".grafico-valor");
    expect(valores[0]).toHaveClass("dentro");
    expect(valores[1]).not.toHaveClass("dentro");
  });
});

describe("Medidores", () => {
  it("el gauge anuncia valor, meta y porcentaje", () => {
    render(<Gauge titulo="Fondo de emergencia" valor={3_000_000_00} meta={6_000_000_00} />);
    expect(screen.getByRole("meter", { name: "Fondo de emergencia" })).toHaveAttribute(
      "aria-valuetext",
      "$ 3.000.000 de $ 6.000.000, 50%",
    );
  });
  it("el anillo con severidad pasa a alerta sobre el 100 %", () => {
    const { container } = render(
      <Anillo titulo="Presupuesto" fraccion={1.12} severidad subtitulo="$ 1.120 de $ 1.000" />,
    );
    expect(container.querySelector(".medidor-lleno")).toHaveAttribute("stroke", "var(--negative)");
    expect(screen.getByText("112%")).toBeInTheDocument();
  });
});

describe("Círculo y series en el tiempo", () => {
  it("el círculo completo lleva el porcentaje dentro y no pasa de 100 % en el medidor", () => {
    render(<Circulo titulo="Pagado" fraccion={1.3} />);
    const medidor = screen.getByRole("meter", { name: "Pagado" });
    expect(medidor.getAttribute("aria-valuenow")).toBe("100");
    expect(screen.getByText(/130\s?%/)).toBeTruthy();
  });

  it("varias series comparten fechas y tienen tabla alternativa con cada una", () => {
    render(
      <AreaSeries
        titulo="Ingresos y gastos"
        fechas={["2026-11-01", "2026-11-02", "2026-11-03"]}
        series={[
          { clave: "ingreso", nombre: "Ingresos", color: "var(--positive)", valores: [100, 200, 300] },
          { clave: "gasto", nombre: "Gastos", color: "var(--negative)", valores: [50, 80, 90] },
        ]}
      />,
    );
    const tabla = screen.getByRole("table", { hidden: true });
    expect(
      within(tabla)
        .getAllByRole("columnheader", { hidden: true })
        .map((c) => c.textContent),
    ).toEqual(["Fecha", "Ingresos", "Gastos"]);
  });
});

describe("marcasEjeConSigno", () => {
  it("con proporciones (paso fraccionario) no repite marcas", () => {
    const marcas = marcasEjeConSigno(-0.8, 1.7);
    expect(new Set(marcas).size).toBe(marcas.length);
    expect(marcas).toContain(0);
  });
  it("con pesos sigue dando marcas enteras e incluye el cero", () => {
    const marcas = marcasEjeConSigno(-350_000, 1_200_000);
    expect(marcas.every(Number.isInteger)).toBe(true);
    expect(marcas).toContain(0);
  });
});
