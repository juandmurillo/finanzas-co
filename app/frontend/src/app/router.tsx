/** Rutas (TanStack Router, definidas en código). Los filtros de Movimientos viven en la URL. */
import { createRootRoute, createRoute, createRouter } from "@tanstack/react-router";

import { CategoriasPage } from "@/features/analisis/CategoriasPage";
import { FlujoPage } from "@/features/analisis/FlujoPage";
import { RevisionPage } from "@/features/analisis/RevisionPage";
import { ConfiguracionPage } from "@/features/automatizacion/ConfiguracionPage";
import { MetasPage } from "@/features/automatizacion/MetasPage";
import { RecurrentesPage } from "@/features/automatizacion/RecurrentesPage";
import { CuentasPage } from "@/features/cuentas/CuentasPage";
import { AsistentePage } from "@/features/extras/AsistentePage";
import { ImpuestosPage } from "@/features/extras/ImpuestosPage";
import { DashboardPage } from "@/features/dashboard/DashboardPage";
import { DeudasPage } from "@/features/deudas/DeudasPage";
import { PrestamosPage } from "@/features/prestamos/PrestamosPage";
import { PresupuestoPage } from "@/features/presupuesto/PresupuestoPage";
import { TransaccionesPage, type BusquedaMovimientos } from "@/features/transacciones";

import { Layout } from "./Layout";

const raiz = createRootRoute({ component: Layout });

const rutas = [
  createRoute({ getParentRoute: () => raiz, path: "/", component: DashboardPage }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/movimientos",
    component: TransaccionesPage,
    validateSearch: (s: Record<string, unknown>): BusquedaMovimientos => ({
      grupo: typeof s.grupo === "string" ? s.grupo : undefined,
      cuenta: Number.isFinite(Number(s.cuenta)) && s.cuenta !== undefined ? Number(s.cuenta) : undefined,
      vista: s.vista === "programadas" ? "programadas" : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => raiz, path: "/cuentas", component: CuentasPage }),
  createRoute({ getParentRoute: () => raiz, path: "/deudas", component: DeudasPage }),
  createRoute({ getParentRoute: () => raiz, path: "/presupuesto", component: PresupuestoPage }),
  createRoute({ getParentRoute: () => raiz, path: "/prestamos", component: PrestamosPage }),
  createRoute({ getParentRoute: () => raiz, path: "/flujo", component: FlujoPage }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/categorias",
    component: CategoriasPage,
    validateSearch: (s: Record<string, unknown>): { grupo?: string } => ({
      grupo: typeof s.grupo === "string" ? s.grupo : undefined,
    }),
  }),
  createRoute({ getParentRoute: () => raiz, path: "/revision", component: RevisionPage }),
  createRoute({ getParentRoute: () => raiz, path: "/recurrentes", component: RecurrentesPage }),
  createRoute({ getParentRoute: () => raiz, path: "/metas", component: MetasPage }),
  createRoute({ getParentRoute: () => raiz, path: "/configuracion", component: ConfiguracionPage }),
  createRoute({ getParentRoute: () => raiz, path: "/impuestos", component: ImpuestosPage }),
  createRoute({ getParentRoute: () => raiz, path: "/asistente", component: AsistentePage }),
];

export const router = createRouter({ routeTree: raiz.addChildren(rutas), defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
