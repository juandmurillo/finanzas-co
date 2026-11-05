/** Prueba de humo: todas las rutas pintan con datos demo, sin errores de render. Se regenera el JSON con
 * `app/backend/scripts/generar_fixture_humo.py` cuando cambia la API. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createMemoryHistory, createRouter, RouterProvider } from "@tanstack/react-router";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { arbolDeRutas } from "@/app/router";
import { CapturaProvider, useCaptura } from "@/features/captura";

import datos from "./api-demo.json";

const API = datos as Record<string, unknown>;
const RUTAS: [string, string | RegExp][] = [
  ["/", /Hola, Laura/],
  ["/movimientos", "Movimientos"],
  ["/presupuesto", "Presupuesto"],
  ["/deudas", "Deudas"],
  ["/prestamos", /Préstamos/],
  ["/activos", "Activos"],
  ["/recurrentes", /Recurrentes|Pagos/],
  ["/metas", /Metas/],
  ["/flujo", "Flujo de caja"],
  ["/categorias", "Categorías"],
  ["/revision", /Revisión/],
  ["/impuestos", /Renta/],
  ["/asistente", "Asistente"],
  ["/cuentas", "Cuentas"],
  ["/configuracion", "Configuración"],
];

function respuestaDe(url: string): Response {
  const ruta = new URL(url, "http://localhost").pathname.replace("/api/v1", "").replace(/\d{4}-\d{2}/, "MES");
  const cuerpo = API[ruta];
  return cuerpo === undefined
    ? new Response(JSON.stringify({ title: "No encontrado", detail: ruta }), { status: 404 })
    : new Response(JSON.stringify(cuerpo), { status: 200, headers: { "Content-Type": "application/json" } });
}

class FuenteFalsa {
  static CLOSED = 2;
  readyState = 1;
  onopen: unknown = null;
  onerror: unknown = null;
  addEventListener() {}
  close() {}
}

beforeAll(() => {
  vi.stubGlobal("fetch", (url: string) => Promise.resolve(respuestaDe(url)));
  vi.stubGlobal("EventSource", FuenteFalsa);
  vi.stubGlobal(
    "matchMedia",
    (q: string) =>
      ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }) as unknown as MediaQueryList,
  );
  Element.prototype.scrollIntoView = () => {};
  window.scrollTo = () => {};
});

afterEach(cleanup);

function Abridor() {
  const { abrir } = useCaptura();
  return (
    <button type="button" onClick={() => abrir("gasto")}>
      abrir-captura
    </button>
  );
}

function montar(ruta: string) {
  const router = createRouter({
    routeTree: arbolDeRutas,
    history: createMemoryHistory({ initialEntries: [ruta] }),
  });
  const errores = vi.spyOn(console, "error").mockImplementation(() => {});
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CapturaProvider>
        <RouterProvider router={router} />
        <Abridor />
      </CapturaProvider>
    </QueryClientProvider>,
  );
  return errores;
}

describe("prueba de humo", { timeout: 20_000 }, () => {
  it.each(RUTAS)("%s pinta su pantalla", async (ruta, titulo) => {
    const errores = montar(ruta);
    expect(await screen.findByRole("heading", { level: 1, name: titulo }, { timeout: 8000 })).toBeInTheDocument();
    await waitFor(() => expect(document.querySelector(".cd-skeleton")).toBeNull(), { timeout: 3000 }).catch(() => {});
    const graves = errores.mock.calls
      .map((c) => String(c[0]))
      .filter((m) => /Cannot read|is not a function|undefined is not|Minified React|Uncaught|NaN/.test(m));
    errores.mockRestore();
    expect(graves).toEqual([]);
    expect(document.body.textContent).not.toMatch(/\bNaN\b|Something went wrong|undefined/);
  });

  it("la captura abre su formulario", async () => {
    const errores = montar("/");
    const boton = await screen.findByRole("button", { name: "abrir-captura" });
    boton.click();
    expect(await screen.findByLabelText(/Monto/i, undefined, { timeout: 5000 })).toBeInTheDocument();
    errores.mockRestore();
  });
});
