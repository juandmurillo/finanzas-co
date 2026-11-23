/** Primitivas del sistema compacto: contenido, estados y accesibilidad. */
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  RouterProvider,
} from "@tanstack/react-router";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BarraLimite, EstadoPunto, ListaDensa, MiniTarjeta, TablaDensa } from "./Datos";
import { CabeceraTarjeta, FilaMetricas, KpiCompacto, PildoraDelta, TarjetaInsight } from "./Kpi";

/** Monta dentro de un router mínimo (los enlaces usan `Link`). */
async function montar(ui: ReactNode) {
  const raiz = createRootRoute({ component: () => <>{ui}</> });
  const rutas = ["/", "/flujo", "/metas"].map((path) =>
    createRoute({ getParentRoute: () => raiz, path, component: () => null }),
  );
  const router = createRouter({
    routeTree: raiz.addChildren(rutas),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  render(<RouterProvider router={router} />);
  await router.load();
}

// El router intenta restaurar el scroll; jsdom no lo implementa.
window.scrollTo = vi.fn() as unknown as typeof window.scrollTo;

afterEach(cleanup);

describe("KpiCompacto", () => {
  it("muestra cifra, nota, variación con texto y pie navegable", async () => {
    await montar(
      <KpiCompacto
        etiqueta="Ingresos"
        icono="entra"
        valor={52_000_000}
        nota="vs oct"
        delta={{ valor: 0.12, sentido: "mejora" }}
        pie={{ texto: "Ver detalle", a: "/flujo" }}
      />,
    );
    const kpi = await screen.findByRole("region", { name: "Ingresos" });
    expect(kpi).toHaveTextContent("520.000");
    expect(kpi).toHaveTextContent("vs oct");
    expect(kpi).toHaveTextContent(/sube \+12,0%/);
    expect(screen.getByRole("link", { name: /Ver detalle/ })).toHaveAttribute("href", "/flujo");
  });

  it("mientras carga no afirma cifra ni variación", async () => {
    await montar(<KpiCompacto etiqueta="Gastos" valor={0} delta={{ valor: -0.1 }} cargando />);
    const kpi = await screen.findByRole("region", { name: "Gastos" });
    expect(kpi).toHaveAttribute("aria-busy", "true");
    expect(kpi).not.toHaveTextContent("$");
    expect(kpi).not.toHaveTextContent("baja");
  });
});

describe("PildoraDelta", () => {
  it("una baja se anuncia con texto, no solo con color", async () => {
    await montar(<PildoraDelta delta={{ valor: -0.05, sentido: "alerta" }} />);
    expect(await screen.findByText(/baja/)).toBeInTheDocument();
  });
});

describe("Cabecera, métricas y hallazgo", () => {
  it("rotula el rango aplicado y las métricas", async () => {
    await montar(
      <>
        <CabeceraTarjeta titulo="Flujo de caja" rango="1–21 nov 2026" />
        <FilaMetricas
          metricas={[
            { etiqueta: "Ingresos", valor: 100_000_00, tono: "ingreso" },
            { etiqueta: "Ahorro", valor: "18 %" },
          ]}
        />
      </>,
    );
    expect(await screen.findByRole("heading", { name: "Flujo de caja" })).toBeInTheDocument();
    expect(screen.getByText("1–21 nov 2026")).toBeInTheDocument();
    expect(screen.getByText("$ 100.000")).toHaveClass("tono-ingreso");
    expect(screen.getByText("18 %")).toBeInTheDocument();
  });

  it("resalta la cifra dentro de la frase y pagina entre hallazgos", async () => {
    const alCambiar = vi.fn();
    await montar(
      <TarjetaInsight
        frase="Gastaste {cifra} más en domicilios los viernes"
        cifra="32 %"
        actual={0}
        total={3}
        alCambiar={alCambiar}
      />,
    );
    expect(await screen.findByText("32 %")).toHaveClass("insight-cifra");
    await userEvent.click(screen.getByRole("button", { name: "Hallazgo 2 de 3" }));
    expect(alCambiar).toHaveBeenCalledWith(1);
  });
});

describe("ListaDensa", () => {
  it("firma los montos, limita las filas y ofrece ver todas", async () => {
    const filas = Array.from({ length: 7 }, (_, i) => ({
      clave: i,
      titulo: `Mov ${i}`,
      monto: i === 0 ? 5_000_00 : -2_500_00,
    }));
    await montar(<ListaDensa filas={filas} max={5} verTodas={{ a: "/flujo" }} />);
    expect(await screen.findAllByRole("listitem")).toHaveLength(5);
    expect(screen.getByText("+ $ 5.000")).toHaveClass("tono-ingreso");
    expect(screen.getAllByText("− $ 2.500")[0]).not.toHaveClass("tono-ingreso");
    expect(screen.getByRole("link", { name: /Ver las 7/ })).toBeInTheDocument();
  });

  it("vacía, explica", async () => {
    await montar(<ListaDensa filas={[]} vacio="Sin movimientos este mes." />);
    expect(await screen.findByText("Sin movimientos este mes.")).toBeInTheDocument();
  });
});

describe("TablaDensa", () => {
  const filas = [
    { id: 1, nombre: "Mercado", monto: -86_500_00, estado: "Pagado" },
    { id: 2, nombre: "Arriendo", monto: -1_200_000_00, estado: "Vencido" },
  ];
  const columnas = [
    { clave: "n", titulo: "Concepto", render: (f: (typeof filas)[number]) => f.nombre },
    {
      clave: "e",
      titulo: "Estado",
      secundaria: true,
      render: (f: (typeof filas)[number]) => (
        <EstadoPunto tono={f.estado === "Vencido" ? "negativo" : "positivo"} texto={f.estado} />
      ),
    },
    { clave: "m", titulo: "Monto", alinear: "fin" as const, render: (f: (typeof filas)[number]) => f.monto },
  ];

  it("se elige con teclado y marca la seleccionada", async () => {
    const alElegir = vi.fn();
    await montar(
      <TablaDensa
        titulo="Pagos"
        columnas={columnas}
        filas={filas}
        claveFila={(f) => f.id}
        seleccionada={2}
        alElegir={alElegir}
      />,
    );
    const filasDom = await screen.findAllByRole("row");
    expect(filasDom[2]).toHaveAttribute("aria-selected", "true");
    filasDom[1]?.focus();
    await userEvent.keyboard("{Enter}");
    expect(alElegir).toHaveBeenCalledWith(filas[0]);
    expect(screen.getByText("Vencido")).toBeInTheDocument();
  });

  it("sin filas muestra el vacío", async () => {
    await montar(
      <TablaDensa titulo="Pagos" columnas={columnas} filas={[]} claveFila={(f) => f.id} vacio={{ titulo: "Nada" }} />,
    );
    expect(await screen.findByText("Nada")).toBeInTheDocument();
  });
});

describe("MiniTarjeta y BarraLimite", () => {
  it("la mini tarjeta muestra el avance hacia la meta", async () => {
    await montar(<MiniTarjeta titulo="Moto" icono="meta" valor={12_567_00} meta={25_000_00} a="/metas" />);
    expect(await screen.findByRole("progressbar", { name: "Avance de Moto" })).toHaveAttribute("aria-valuenow", "50");
    expect(screen.getByRole("link")).toHaveTextContent("de $ 25.000");
  });

  it("la barra pasa a aviso al 80 % y a excedido con texto", async () => {
    await montar(
      <>
        <BarraLimite etiqueta="Comida" gastado={85_00} limite={100_00} />
        <BarraLimite etiqueta="Ocio" gastado={130_00} limite={100_00} ritmo={0.7} segmentos={6} />
      </>,
    );
    const comida = await screen.findByRole("meter", { name: "Comida" });
    expect(comida.parentElement).toHaveClass("barra-limite--aviso");
    const ocio = screen.getByRole("meter", { name: "Ocio" });
    expect(ocio.parentElement).toHaveClass("barra-limite--excedido");
    expect(ocio).toHaveAttribute("aria-valuetext", expect.stringMatching(/130\s*% usado/));
    expect(screen.getByText(/Te pasaste \$ 30/)).toBeInTheDocument();
  });
});
