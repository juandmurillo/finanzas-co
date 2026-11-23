/** Rutas (TanStack Router, definidas en código). Cada pantalla se carga cuando se abre. Los filtros de Movimientos viven en la URL. */
import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";

import type { BusquedaMovimientos } from "@/features/transacciones";

import { ErrorVista } from "@/shared/ui/Estados";

import { Layout } from "./Layout";

const raiz = createRootRoute({ component: Layout });

const rutas = [
  createRoute({
    getParentRoute: () => raiz,
    path: "/",
    component: lazyRouteComponent(() => import("@/features/dashboard/DashboardPage"), "DashboardPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/movimientos",
    component: lazyRouteComponent(() => import("@/features/transacciones"), "TransaccionesPage"),
    validateSearch: (s: Record<string, unknown>): BusquedaMovimientos => ({
      grupo: typeof s.grupo === "string" ? s.grupo : undefined,
      cuenta: Number.isFinite(Number(s.cuenta)) && s.cuenta !== undefined ? Number(s.cuenta) : undefined,
      vista: s.vista === "programadas" ? "programadas" : undefined,
      categoria: Number.isFinite(Number(s.categoria)) && s.categoria !== undefined ? Number(s.categoria) : undefined,
      etiqueta: typeof s.etiqueta === "string" ? s.etiqueta : undefined,
      desde: typeof s.desde === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.desde) ? s.desde : undefined,
      hasta: typeof s.hasta === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.hasta) ? s.hasta : undefined,
      todo: s.todo === true || s.todo === "true" || undefined,
    }),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/cuentas",
    component: lazyRouteComponent(() => import("@/features/cuentas/CuentasPage"), "CuentasPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/deudas",
    component: lazyRouteComponent(() => import("@/features/deudas/DeudasPage"), "DeudasPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/presupuesto",
    component: lazyRouteComponent(() => import("@/features/presupuesto/PresupuestoPage"), "PresupuestoPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/prestamos",
    component: lazyRouteComponent(() => import("@/features/prestamos/PrestamosPage"), "PrestamosPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/activos",
    component: lazyRouteComponent(() => import("@/features/activos/ActivosPage"), "ActivosPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/flujo",
    component: lazyRouteComponent(() => import("@/features/analisis/FlujoPage"), "FlujoPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/categorias",
    component: lazyRouteComponent(() => import("@/features/analisis/CategoriasPage"), "CategoriasPage"),
    validateSearch: (s: Record<string, unknown>): { grupo?: string } => ({
      grupo: typeof s.grupo === "string" ? s.grupo : undefined,
    }),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/revision",
    component: lazyRouteComponent(() => import("@/features/analisis/RevisionPage"), "RevisionPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/recurrentes",
    component: lazyRouteComponent(() => import("@/features/automatizacion/RecurrentesPage"), "RecurrentesPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/metas",
    component: lazyRouteComponent(() => import("@/features/automatizacion/MetasPage"), "MetasPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/configuracion",
    component: lazyRouteComponent(() => import("@/features/automatizacion/ConfiguracionPage"), "ConfiguracionPage"),
    validateSearch: (s: Record<string, unknown>): { seccion?: string } => ({
      seccion: typeof s.seccion === "string" ? s.seccion : undefined,
    }),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/impuestos",
    component: lazyRouteComponent(() => import("@/features/extras/ImpuestosPage"), "ImpuestosPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/muestrario",
    component: lazyRouteComponent(() => import("@/features/sistema/Muestrario"), "Muestrario"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/mas",
    component: lazyRouteComponent(() => import("@/features/mas/MasPage"), "MasPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/mas/menu",
    component: lazyRouteComponent(() => import("@/features/mas/PersonalizarMenu"), "PersonalizarMenuPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/mas/legal",
    component: lazyRouteComponent(() => import("@/features/mas/MasPage"), "LegalPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/asistente",
    component: lazyRouteComponent(() => import("@/features/extras/AsistentePage"), "AsistentePage"),
  }),
];

export const arbolDeRutas = raiz.addChildren(rutas);

export const router = createRouter({
  routeTree: arbolDeRutas,
  defaultPreload: "intent",
  // Si una pantalla falla, el error queda dentro de su página (con «Reintentar») y la navegación sigue en pie.
  defaultErrorComponent: ({ error, reset }) => <ErrorVista error={error} reintentar={reset} />,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
