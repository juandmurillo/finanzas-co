/** Crear la categoría que falta desde el selector: devuelve la elegida y no duplica nombres. */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { CategoriaNodo } from "@/shared/api/tipos";

import { SelectorCategoria } from "./SelectorCategoria";

const nodo = (id: number, nombre: string, nivel: number, hijos: CategoriaNodo[] = []): CategoriaNodo => ({
  id,
  nombre,
  nivel,
  grupo: "gasto_vida",
  es_fijo: false,
  hijos,
});

const ARBOL: CategoriaNodo[] = [
  nodo(1, "Gastos de vida", 1, [nodo(10, "Transporte", 2, [nodo(100, "Uber", 3)]), nodo(11, "Mercado", 2)]),
];

function Prueba({ alElegir }: { alElegir: (id: number) => void }) {
  const [valor, setValor] = useState<number | null>(null);
  return (
    <SelectorCategoria
      arbol={ARBOL}
      grupos={["gasto_vida"]}
      valor={valor}
      permitirCrear
      alCambiar={(id) => {
        setValor(id);
        alElegir(id);
      }}
    />
  );
}

function montar(alElegir = vi.fn()) {
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <Prueba alElegir={alElegir} />
    </QueryClientProvider>,
  );
  return alElegir;
}

/** Responde /sistema como cualquier instalación y registra el resto de llamadas. */
function api(creada?: number) {
  const creaciones = vi.fn();
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (url.includes("/sistema")) return new Response(JSON.stringify({ modulos: { apuestas: false } }));
      creaciones(url, init);
      return new Response(JSON.stringify({ id: creada }), { status: 201 });
    }),
  );
  return creaciones;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("crear categoría desde el selector", () => {
  it("crea «Transporte › Bicicleta» con el texto buscado y la deja elegida", async () => {
    const fetchFalso = api(555);
    const alElegir = montar();
    const u = userEvent.setup();

    await u.click(screen.getByRole("button", { name: /Elegir categoría/ }));
    await u.type(screen.getByLabelText("Buscar categoría"), "Bicicleta");
    await u.click(screen.getByRole("button", { name: "Crear categoría «Bicicleta»" }));

    expect(screen.getByLabelText("Nombre")).toHaveValue("Bicicleta");
    await u.click(screen.getByRole("combobox", { name: "Va en" }));
    await u.click(screen.getByRole("option", { name: "Subcategoría de Transporte" }));
    await u.click(screen.getByRole("button", { name: "Crear categoría" }));

    await waitFor(() => expect(alElegir).toHaveBeenCalledWith(555));
    const [url, init] = fetchFalso.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/categorias");
    expect(JSON.parse(init.body as string)).toMatchObject({ padre_id: 10, nombre: "Bicicleta" });
  });

  it("si el nombre ya existe bajo el mismo padre, elige esa sin crear otra", async () => {
    const fetchFalso = api();
    const alElegir = montar();
    const u = userEvent.setup();

    await u.click(screen.getByRole("button", { name: /Elegir categoría/ }));
    await u.click(screen.getByRole("button", { name: /Transporte/ }));
    await u.click(screen.getByRole("button", { name: /Subcategoría de Transporte/ }));
    await u.type(screen.getByLabelText("Nombre"), "uber");
    await u.click(screen.getByRole("button", { name: "Usar la existente" }));

    await waitFor(() => expect(alElegir).toHaveBeenCalledWith(100));
    expect(fetchFalso).not.toHaveBeenCalled();
  });

  it("«Volver a la lista» conserva lo buscado", async () => {
    api();
    montar();
    const u = userEvent.setup();
    await u.click(screen.getByRole("button", { name: /Elegir categoría/ }));
    await u.type(screen.getByLabelText("Buscar categoría"), "Bici");
    await u.click(screen.getByRole("button", { name: "Crear categoría «Bici»" }));
    await u.click(screen.getByRole("button", { name: "Volver a la lista" }));
    expect(screen.getByLabelText("Buscar categoría")).toHaveValue("Bici");
  });
});
