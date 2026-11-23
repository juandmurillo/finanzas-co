/** Secciones de Caudal: un solo catálogo para la barra lateral, la barra inferior del celular y la pantalla «Más». */
import type { NombreIcono } from "@/shared/ui/Icono";

export interface ItemNav {
  a: string;
  etiqueta: string;
  /** Nombre corto para la barra inferior (cabe en un quinto de 360 px). */
  corta?: string;
  icono: NombreIcono;
}

export const SECCIONES = {
  inicio: { a: "/", etiqueta: "Inicio", icono: "inicio" },
  movimientos: { a: "/movimientos", etiqueta: "Movimientos", icono: "movimientos" },
  presupuesto: { a: "/presupuesto", etiqueta: "Presupuesto", icono: "presupuesto" },
  deudas: { a: "/deudas", etiqueta: "Deudas", icono: "deudas" },
  prestamos: { a: "/prestamos", etiqueta: "Préstamos", icono: "persona" },
  activos: { a: "/activos", etiqueta: "Activos", icono: "activos" },
  recurrentes: { a: "/recurrentes", etiqueta: "Recurrentes", icono: "recurrentes" },
  metas: { a: "/metas", etiqueta: "Metas y hábitos", corta: "Metas", icono: "meta" },
  flujo: { a: "/flujo", etiqueta: "Flujo de caja", corta: "Flujo", icono: "flujo" },
  categorias: { a: "/categorias", etiqueta: "Categorías", icono: "categorias" },
  revision: { a: "/revision", etiqueta: "Revisión mensual", corta: "Revisión", icono: "documento" },
  impuestos: { a: "/impuestos", etiqueta: "Renta y aportes", corta: "Renta", icono: "escudo" },
  asistente: { a: "/asistente", etiqueta: "Asistente", icono: "info" },
  cuentas: { a: "/cuentas", etiqueta: "Cuentas", icono: "cuentas" },
  configuracion: { a: "/configuracion", etiqueta: "Configuración", corta: "Ajustes", icono: "ajustes" },
} satisfies Record<string, ItemNav>;

export type IdSeccion = keyof typeof SECCIONES;

export const GRUPOS_ESCRITORIO: { etiqueta: string; items: ItemNav[] }[] = [
  {
    etiqueta: "Menú",
    items: [
      SECCIONES.inicio,
      SECCIONES.movimientos,
      SECCIONES.presupuesto,
      SECCIONES.deudas,
      SECCIONES.prestamos,
      SECCIONES.activos,
      SECCIONES.recurrentes,
      SECCIONES.metas,
    ],
  },
  {
    etiqueta: "Análisis",
    items: [
      SECCIONES.flujo,
      SECCIONES.categorias,
      SECCIONES.revision,
      SECCIONES.impuestos,
      SECCIONES.asistente,
      SECCIONES.cuentas,
      SECCIONES.configuracion,
    ],
  },
];

/** Grupos de la pantalla «Más», por tarea. Configuración va aparte, en «Ajustes». */
export const GRUPOS_MAS: { etiqueta: string; ids: IdSeccion[] }[] = [
  { etiqueta: "Día a día", ids: ["inicio", "movimientos", "presupuesto", "recurrentes", "cuentas"] },
  { etiqueta: "Deudas y préstamos", ids: ["deudas", "prestamos"] },
  { etiqueta: "Patrimonio y metas", ids: ["activos", "metas"] },
  { etiqueta: "Análisis", ids: ["flujo", "categorias", "revision", "impuestos", "asistente"] },
];

/** Destinos que se pueden poner en la barra inferior (todas las secciones). */
export const DESTINOS_MENU = Object.keys(SECCIONES) as IdSeccion[];
