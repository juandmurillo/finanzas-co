import type { RevisionSync } from "@/shared/api/tipos";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { PorRevisar } from "./PorRevisar";

const REVISIONES: RevisionSync[] = [
  {
    id: 1,
    tipo: "version",
    creada_en: "2026-11-22T10:00:00+00:00",
    entidades: [
      {
        entidad: "transaccion",
        entidad_id: "a".repeat(32),
        titulo: "Mercado",
        local_existe: true,
        remoto_existe: true,
        campos: [
          { campo: "monto", base: -2_000_000, local: -2_500_000, remoto: -3_000_000, ambos: true },
          { campo: "nota", base: "", local: "domicilio", remoto: "", ambos: false },
        ],
      },
    ],
  },
  {
    id: 2,
    tipo: "duplicado",
    creada_en: "2026-11-22T10:00:00+00:00",
    movimientos: [
      {
        id: "b".repeat(32),
        origen: "otro_equipo",
        fecha: "2026-11-21T12:00:00-05:00",
        monto: -1_800_000,
        cuenta: "Billetera",
        descripcion: "Almuerzo",
        nota: "",
        categoria: "Restaurantes",
      },
      {
        id: "c".repeat(32),
        origen: "este_equipo",
        fecha: "2026-11-21T12:30:00-05:00",
        monto: -1_800_000,
        cuenta: "Billetera",
        descripcion: "Almuerzo con Ana",
        nota: "",
        categoria: "Restaurantes",
      },
    ],
  },
];

afterEach(() => vi.unstubAllGlobals());

function montar() {
  const peticiones: { url: string; cuerpo: unknown }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        peticiones.push({ url, cuerpo: JSON.parse(String(init.body)) });
        return new Response(null, { status: 204 });
      }
      return Response.json(REVISIONES);
    }),
  );
  const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={cliente}>
      <PorRevisar />
    </QueryClientProvider>,
  );
  return peticiones;
}

it("pide elegir el campo que cambió en los dos equipos antes de combinar", async () => {
  const peticiones = montar();
  const edicion = await screen.findByRole("article", { name: "Edición en dos equipos" });
  const aplicar = within(edicion).getByRole("button", { name: "Aplicar decisión" });
  expect(aplicar).toBeDisabled();
  fireEvent.click(within(edicion).getByRole("radio", { name: "Combinar campo por campo" }));
  expect(aplicar).toBeDisabled();
  fireEvent.click(within(edicion).getByRole("radio", { name: "- $ 30.000" }));
  expect(aplicar).toBeEnabled();
  fireEvent.click(aplicar);
  await waitFor(() => expect(peticiones).toHaveLength(1));
  expect(peticiones[0]).toEqual({
    url: "/api/v1/sync/revision/1",
    cuerpo: { decision: "campos", campos: { ["a".repeat(32)]: { monto: "remoto" } } },
  });
});

it("une un duplicado conservando los datos elegidos", async () => {
  const peticiones = montar();
  const duplicado = await screen.findByRole("article", { name: "Posible duplicado" });
  expect(within(duplicado).getByText("El otro equipo")).toBeInTheDocument();
  fireEvent.click(within(duplicado).getByRole("radio", { name: "Es el mismo movimiento" }));
  const aplicar = within(duplicado).getByRole("button", { name: "Aplicar decisión" });
  expect(aplicar).toBeDisabled();
  fireEvent.click(within(duplicado).getByRole("radio", { name: "Almuerzo con Ana" }));
  fireEvent.click(aplicar);
  await waitFor(() => expect(peticiones).toHaveLength(1));
  expect(peticiones[0]?.cuerpo).toEqual({ decision: "mismo", datos: { descripcion: "c".repeat(32) } });
});
