/** Claves de TanStack Query y qué claves refresca cada entidad de un evento de dominio (ADR-0003). */
import type { FiltroTransacciones, Periodo } from "./api";

export const claves = {
  sistema: ["sistema"] as const,
  cuentas: ["cuentas"] as const,
  transacciones: (f?: FiltroTransacciones) => (f ? (["transacciones", f] as const) : (["transacciones"] as const)),
  categorias: ["categorias"] as const,
  sugerencias: (texto: string) => ["sugerencias", texto] as const,
  frecuentes: (tipo: string) => ["sugerencias", "frecuentes", tipo] as const,
  dashboard: ["dashboard"] as const,
  flujo: ["reportes", "flujo"] as const,
  creditos: ["creditos"] as const,
  amortizacion: (id: number) => ["creditos", "amortizacion", id] as const,
  simulacion: (extra: number, estrategia: string) => ["creditos", "simulacion", extra, estrategia] as const,
  presupuesto: (mes: string) => ["presupuesto", mes] as const,
  prestamos: (estado?: string) => ["prestamos", estado ?? "todos"] as const,
  resumenPrestamos: ["prestamos", "resumen"] as const,
  // Todo lo de análisis cuelga de "reportes": un movimiento nuevo los refresca a todos.
  reporteMensual: (p: Periodo) => ["reportes", "mensual", p] as const,
  sankey: (p: Periodo) => ["reportes", "sankey", p] as const,
  reporteCategorias: (p: Periodo, grupo: string) => ["reportes", "categorias", p, grupo] as const,
  descripciones: (p: Periodo, grupo?: string) => ["reportes", "descripciones", p, grupo ?? "todos"] as const,
  apuestas: (p: Periodo) => ["reportes", "apuestas", p] as const,
  revision: (mes: string) => ["reportes", "revision", mes] as const,
  clasificar: (descripcion: string, signo: number) => ["sugerencias", "clasificar", descripcion, signo] as const,
  precision: ["sugerencias", "precision"] as const,
  reglas: ["reglas"] as const,
  recurrentes: ["recurrentes"] as const,
  detectados: ["recurrentes", "detectar"] as const,
  calendario: (dias: number) => ["calendario", dias] as const,
  metas: ["metas"] as const,
  alertas: ["alertas"] as const,
  respaldos: ["respaldos"] as const,
  parametros: ["parametros"] as const,
  trm: (fecha: string) => ["parametros", "trm", fecha] as const,
  termometro: (anio: number) => ["reportes", "termometro", anio] as const,
  asistente: ["asistente"] as const,
  historicoPresupuesto: (desde: string, hasta: string, grupo?: number) =>
    ["presupuesto", "historico", desde, hasta, grupo ?? "todos"] as const,
};

/** Entidad del evento → prefijos de claves a invalidar. */
export const INVALIDACIONES: Record<string, readonly (readonly string[])[]> = {
  // Todo movimiento puede cambiar el calendario, las metas y las alertas.
  transacciones: [["transacciones"], ["sugerencias"], ["presupuesto"], ["calendario"], ["metas"], ["alertas"]],
  sistema: [["sistema"]],
  cuentas: [["cuentas"]],
  dashboard: [["dashboard"]],
  reportes: [["reportes"], ["dashboard"]],
  presupuesto: [["presupuesto"], ["alertas"]],
  categorias: [["categorias"], ["presupuesto"], ["reportes"], ["metas"]],
  creditos: [["creditos"], ["dashboard"]],
  prestamos: [["prestamos"], ["calendario"], ["alertas"]],
  recurrentes: [["recurrentes"], ["calendario"], ["alertas"]],
  metas: [["metas"], ["alertas"]],
  reglas: [["reglas"], ["sugerencias"]],
  parametros: [["parametros"], ["reportes"], ["creditos"]],
};

export function clavesAInvalidar(entidades: readonly string[]): (readonly string[])[] {
  const vistos = new Set<string>();
  const salida: (readonly string[])[] = [];
  for (const entidad of entidades) {
    for (const clave of INVALIDACIONES[entidad] ?? []) {
      const id = clave.join("|");
      if (!vistos.has(id)) {
        vistos.add(id);
        salida.push(clave);
      }
    }
  }
  return salida;
}
