import type { Session } from "@supabase/supabase-js";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";

const unirLibro = vi.fn();
const pasar = vi.fn();
vi.mock("@/shared/lib/syncCaudal", () => ({
  situacionUnion: async () => ({
    caso: "elegir",
    decisiones: ["combinar", "cuenta", "equipo"],
    equipo: { cuentas: 3, movimientos: 12 },
    cuenta: { cuentas: 5, movimientos: 240, guardada_en: "2026-11-22 23:10:00" },
  }),
  unirLibro: (...args: unknown[]) => unirLibro(...args),
  pasar: (...args: unknown[]) => pasar(...args),
}));

const RESULTADO = {
  decision: "combinar",
  respaldo: "finanzas-20261123-010000.db",
  combinado: { cuentas: 1, categorias: 2, movimientos: 9, repetidos: 3, sueltos: 1 },
};

it("compara los dos libros y combina solo tras elegir y aplicar", async () => {
  unirLibro.mockResolvedValue(RESULTADO);
  const onHecho = vi.fn();
  const { UnirLibro } = await import("./UnirLibro");
  const sesion = { user: { id: "persona" } } as Session;
  render(
    <QueryClientProvider client={new QueryClient()}>
      <UnirLibro sesion={sesion} onHecho={onHecho} />
    </QueryClientProvider>,
  );
  expect(await screen.findByText("12 movimientos · 3 cuentas")).toBeInTheDocument();
  expect(screen.getByText(/240 movimientos · 5 cuentas · copia del/)).toBeInTheDocument();
  const aplicar = screen.getByRole("button", { name: "Aplicar" });
  expect(aplicar).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /Combinar los dos/ }));
  expect(unirLibro).not.toHaveBeenCalled();
  fireEvent.click(aplicar);
  await waitFor(() => expect(onHecho).toHaveBeenCalledWith(RESULTADO));
  expect(unirLibro).toHaveBeenCalledWith("combinar");
  expect(pasar).toHaveBeenCalledWith(sesion);
});

it("el resumen dice qué se sumó y dónde quedó la versión anterior", async () => {
  const { Hecho } = await import("./UnirLibro");
  const cerrar = vi.fn();
  render(<Hecho resultado={RESULTADO as never} cerrar={cerrar} />);
  expect(screen.getByText(/Se sumaron 9 movimientos, 1 cuentas y 2 categorías; 3 ya estaban/)).toBeInTheDocument();
  expect(screen.getByText(/finanzas-20261123-010000\.db/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Entendido" }));
  expect(cerrar).toHaveBeenCalled();
});
