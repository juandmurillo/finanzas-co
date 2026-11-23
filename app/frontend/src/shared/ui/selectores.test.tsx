/** Desplegable y CampoFecha: se usan como `<select>` e `<input type="date">` (mismo `onChange`) y se manejan
 * con el teclado. */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { CampoFecha } from "./CampoFecha";
import { Desplegable } from "./Desplegable";

afterEach(cleanup);

function Lista() {
  const [v, setV] = useState("b");
  return (
    <>
      <label htmlFor="cuenta">Cuenta</label>
      <Desplegable id="cuenta" value={v} onChange={(e) => setV(e.target.value)}>
        <option value="a">Nequi</option>
        <option value="b">Daviplata</option>
        <optgroup label="Efectivo">
          <option value="c">Billetera</option>
        </optgroup>
      </Desplegable>
      <output>{v}</output>
    </>
  );
}

describe("Desplegable", () => {
  it("muestra la elegida, se abre con ↓ y elige con Enter", async () => {
    const u = userEvent.setup();
    render(<Lista />);
    const control = screen.getByRole("combobox", { name: "Cuenta" });
    expect(control).toHaveTextContent("Daviplata");
    control.focus();
    await u.keyboard("{ArrowDown}");
    expect(screen.getByRole("listbox")).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Daviplata" })).toHaveAttribute("aria-selected", "true");
    await u.keyboard("{ArrowDown}{Enter}");
    expect(screen.getByText("c", { selector: "output" })).toBeInTheDocument();
  });

  it("con clic en una opción cambia el valor y cierra", async () => {
    const u = userEvent.setup();
    render(<Lista />);
    await u.click(screen.getByRole("combobox", { name: "Cuenta" }));
    await u.click(screen.getByRole("option", { name: "Nequi" }));
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByText("a", { selector: "output" })).toBeInTheDocument();
  });

  it("Escape cierra la lista sin cambiar el valor", async () => {
    const u = userEvent.setup();
    render(<Lista />);
    await u.click(screen.getByRole("combobox", { name: "Cuenta" }));
    await u.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(screen.getByText("b", { selector: "output" })).toBeInTheDocument();
  });
});

function Fecha({ inicial = "2026-11-10" }: { inicial?: string }) {
  const [v, setV] = useState(inicial);
  return (
    <>
      <CampoFecha type="date" aria-label="Fecha" value={v} onChange={(e) => setV(e.target.value)} />
      <output>{v}</output>
    </>
  );
}

describe("CampoFecha", () => {
  it("abre el calendario en el mes elegido y elige un día con las flechas", async () => {
    const u = userEvent.setup();
    render(<Fecha />);
    await u.click(screen.getByRole("button", { name: /^Fecha:/ }));
    expect(screen.getByRole("dialog")).toHaveTextContent("Noviembre 2026");
    expect(document.activeElement).toHaveAttribute("data-dia", "2026-11-10");
    await u.keyboard("{ArrowRight}{ArrowDown}{Enter}");
    expect(screen.getByText("2026-11-18", { selector: "output" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("Av Pág pasa al mes siguiente", async () => {
    const u = userEvent.setup();
    render(<Fecha />);
    await u.click(screen.getByRole("button", { name: /^Fecha:/ }));
    await u.keyboard("{PageDown}");
    expect(screen.getByRole("dialog")).toHaveTextContent("Diciembre 2026");
  });
});

describe("calendario dentro de un panel de periodo", () => {
  it("elegir un mes no cierra el panel que lo contiene", async () => {
    const { ControlPeriodo, usePeriodo } = await import("@/features/analisis/Periodo");
    function Control() {
      const nav = usePeriodo("6m");
      return <ControlPeriodo nav={nav} />;
    }
    window.matchMedia ??= ((consulta: string) => ({
      matches: false,
      media: consulta,
    })) as unknown as Window["matchMedia"];
    const { QueryClient, QueryClientProvider } = await import("@tanstack/react-query");
    const u = userEvent.setup();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Control />
      </QueryClientProvider>,
    );
    await u.click(screen.getByRole("button", { name: /^Periodo:/ }));
    await u.click(screen.getByRole("radio", { name: "Rango" }));
    await u.click(screen.getByRole("button", { name: /^Desde:/ }));
    const [marzo] = screen.getAllByRole("button", { name: /^marzo \d{4}$/ });
    if (marzo) await u.click(marzo);
    expect(screen.getByRole("dialog", { name: "Elegir periodo" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Desde: Marzo/ })).toBeInTheDocument();
  });
});
