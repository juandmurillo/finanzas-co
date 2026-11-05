/** Rutas (TanStack Router, definidas en código). Cada pantalla se carga cuando se abre. Los filtros de Movimientos viven en la URL. */
import { createRootRoute, createRoute, createRouter, lazyRouteComponent } from "@tanstack/react-router";

import type { BusquedaMovimientos } from "@/features/transacciones";

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
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/impuestos",
    component: lazyRouteComponent(() => import("@/features/extras/ImpuestosPage"), "ImpuestosPage"),
  }),
  createRoute({
    getParentRoute: () => raiz,
    path: "/asistente",
    component: lazyRouteComponent(() => import("@/features/extras/AsistentePage"), "AsistentePage"),
  }),
];

export const arbolDeRutas = raiz.addChildren(rutas);

export const router = createRouter({ routeTree: arbolDeRutas, defaultPreload: "intent" });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
