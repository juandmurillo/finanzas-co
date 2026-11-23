/** El foco del teclado no sale de un diálogo modal, y con dos abiertos solo manda el de encima. */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { useRef } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { useAtraparFoco } from "./useAtraparFoco";

function Dialogo({ nombre }: { nombre: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useAtraparFoco(ref);
  return (
    <div ref={ref} role="dialog" aria-label={nombre}>
      <button type="button">{nombre} primero</button>
      <button type="button">{nombre} último</button>
    </div>
  );
}

afterEach(cleanup);

describe("useAtraparFoco", () => {
  it("Tab en el último vuelve al primero y Mayús+Tab en el primero va al último", () => {
    render(<Dialogo nombre="A" />);
    const primero = screen.getByText("A primero");
    const ultimo = screen.getByText("A último");
    ultimo.focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(primero);
    fireEvent.keyDown(document, { key: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(ultimo);
  });

  it("con dos diálogos, solo el de encima atrapa el foco", () => {
    render(
      <>
        <Dialogo nombre="Fondo" />
        <Dialogo nombre="Encima" />
      </>,
    );
    screen.getByText("Encima último").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(document.activeElement).toBe(screen.getByText("Encima primero"));
  });
});
