/** Vista móvil: menú inferior configurable, intensidad de animación, periodo inicial de 3 meses y gesto de
 * deslizar entre periodos. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { usePeriodo } from "@/features/analisis/Periodo";
import { ZonaPeriodo } from "@/features/analisis/ZonaPeriodo";

import { guardarMenu, MENU_INICIAL, reiniciarMenuParaPruebas, useMenuMovil, validarMenu } from "./menuMovil";

function simularPantalla({ movil, reducir = false }: { movil: boolean; reducir?: boolean }) {
  window.matchMedia = ((consulta: string) => ({
    matches: consulta.includes("max-width") ? movil : consulta.includes("reduced-motion") ? reducir : false,
    media: consulta,
    addEventListener: () => {},
    removeEventListener: () => {},
  })) as unknown as Window["matchMedia"];
}

beforeEach(() => {
  localStorage.clear();
  reiniciarMenuParaPruebas();
});
afterEach(cleanup);

describe("menú inferior", () => {
  it("arranca con cinco accesos y «Más»; un menú guardado inválido vuelve al inicial", () => {
    expect(MENU_INICIAL).toHaveLength(5);
    expect(MENU_INICIAL).toContain("mas");
    expect(validarMenu(["inicio", "inicio", "deudas", "flujo", "mas"])).toEqual(MENU_INICIAL);
    expect(validarMenu(["inicio", "movimientos", "deudas", "flujo", "metas"])).toEqual(MENU_INICIAL); // sin «Más»
    expect(validarMenu(["mas", "flujo", "metas", "inicio", "cuentas"])).toEqual([
      "mas",
      "flujo",
      "metas",
      "inicio",
      "cuentas",
    ]);
  });

  it("la selección y el orden se guardan y se leen de nuevo (como tras recargar)", () => {
    const { result } = renderHook(() => useMenuMovil());
    act(() => guardarMenu(["flujo", "mas", "inicio", "metas", "cuentas"]));
    expect(result.current).toEqual(["flujo", "mas", "inicio", "metas", "cuentas"]);
    reiniciarMenuParaPruebas(); // olvida la memoria: lee del almacenamiento
    const otra = renderHook(() => useMenuMovil());
    expect(otra.result.current).toEqual(["flujo", "mas", "inicio", "metas", "cuentas"]);
  });
});

describe("intensidad de animación", () => {
  it("primera visita: «reducida» si el sistema lo pide, «maxima» si no; después manda la elección guardada", async () => {
    vi.resetModules();
    simularPantalla({ movil: false, reducir: true });
    let m = await import("./movimiento");
    expect(m.intensidadActual()).toBe("reducida");
    expect(document.documentElement.dataset.movimiento).toBe("reducida");

    vi.resetModules();
    simularPantalla({ movil: false, reducir: false });
    m = await import("./movimiento");
    expect(m.intensidadActual()).toBe("maxima");
    m.guardarIntensidad("ninguna");
    expect(document.documentElement.dataset.movimiento).toBe("ninguna");

    vi.resetModules();
    simularPantalla({ movil: false, reducir: true });
    m = await import("./movimiento");
    expect(m.intensidadActual()).toBe("ninguna"); // la elección explícita gana sobre el sistema
  });
});

describe("periodo inicial", () => {
  it("en la vista móvil arranca en 3 meses; en escritorio, en el del gráfico", () => {
    simularPantalla({ movil: true });
    expect(renderHook(() => usePeriodo("12m", "prueba")).result.current.preset).toBe("3m");
    simularPantalla({ movil: false });
    expect(renderHook(() => usePeriodo("12m", "prueba")).result.current.preset).toBe("12m");
  });

  it("restablecer vuelve a 3 meses en móvil y respeta los cambios manuales mientras tanto", () => {
    simularPantalla({ movil: true });
    const { result } = renderHook(() => usePeriodo("6m", "prueba-2"));
    act(() => result.current.setPreset("12m"));
    expect(result.current.preset).toBe("12m");
    act(() => result.current.restablecer());
    expect(result.current.preset).toBe("3m");
  });
});

describe("deslizar entre periodos", () => {
  // jsdom no trae PointerEvent: uno mínimo sobre MouseEvent conserva clientX, clientY y pointerType.
  beforeEach(() => {
    class EventoPuntero extends MouseEvent {
      pointerType: string;
      constructor(tipo: string, init: PointerEventInit = {}) {
        super(tipo, init);
        this.pointerType = init.pointerType ?? "mouse";
      }
    }
    window.PointerEvent ??= EventoPuntero as unknown as typeof PointerEvent;
  });

  function Grafico() {
    const nav = usePeriodo("6m");
    return (
      <ZonaPeriodo nav={nav}>
        <button type="button" onClick={() => document.body.setAttribute("data-barra", "tocada")}>
          barra
        </button>
        <output>{`${nav.periodo.desde}|${nav.pasos}`}</output>
      </ZonaPeriodo>
    );
  }
  const deslizar = (el: Element, dx: number, dy = 0) => {
    fireEvent.pointerDown(el, { pointerType: "touch", clientX: 200, clientY: 300 });
    fireEvent.pointerMove(el, { pointerType: "touch", clientX: 200 + dx / 2, clientY: 300 + dy / 2 });
    fireEvent.pointerUp(el, { pointerType: "touch", clientX: 200 + dx, clientY: 300 + dy });
    fireEvent.click(el);
    act(() => void vi.advanceTimersByTime(400)); // la serie sale, cambia el periodo y entra la nueva
  };

  it("un gesto horizontal avanza un solo periodo; vertical o corto no cambia nada ni bloquea el toque", () => {
    vi.useFakeTimers();
    simularPantalla({ movil: false });
    render(
      <QueryClientProvider client={new QueryClient()}>
        <Grafico />
      </QueryClientProvider>,
    );
    const barra = screen.getByRole("button", { name: "barra" });
    const pasos = () => document.querySelector("output")?.textContent;
    deslizar(barra, 120); // hacia la derecha: el periodo anterior
    expect(pasos()).toMatch(/\|1$/);
    expect(document.body.getAttribute("data-barra")).toBeNull(); // el clic del gesto no consulta la barra
    deslizar(barra, 10, 140); // vertical: es desplazamiento de la página
    expect(pasos()).toMatch(/\|1$/);
    deslizar(barra, -120); // hacia la izquierda: vuelve al actual
    expect(pasos()).toMatch(/\|0$/);
    deslizar(barra, -120); // ya es el actual: avisa y no cambia
    expect(pasos()).toMatch(/\|0$/);
    expect(document.querySelector(".zona-periodo-aviso")).toHaveTextContent("Ya estás en el periodo actual");
    fireEvent.click(barra); // un toque normal sigue funcionando
    expect(document.body.getAttribute("data-barra")).toBe("tocada");
    vi.useRealTimers();
  });
});
