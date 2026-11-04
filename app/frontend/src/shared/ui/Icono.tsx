/** Iconos de trazo estilo Lucide (24×24, trazo 1.75) según Caudal. Siempre decorativos salvo que se pase etiqueta. */
const RUTAS = {
  inicio: "M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  movimientos: "M4 7h16l-4-4M20 17H4l4 4",
  presupuesto: "M21 12A9 9 0 1 1 12 3v9zM15 3.3A9 9 0 0 1 20.7 9H15z",
  deudas: "M3 10h18M5 10v8M9.5 10v8M14.5 10v8M19 10v8M3 21h18M12 3l9 5H3z",
  persona: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  recurrentes: "M17 2l4 4-4 4M3 11V9a3 3 0 0 1 3-3h15M7 22l-4-4 4-4M21 13v2a3 3 0 0 1-3 3H3",
  meta: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
  flujo: "M4 20V11M10 20V4M16 20v-7M2 20h20",
  categorias: "M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8zM7.5 7.5h.01",
  documento: "M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4",
  cuentas: "M3 6h18v14H3zM3 10h18M16 15h2",
  ajustes: "M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6",
  mas: "M12 5v14M5 12h14",
  buscar: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-3.5-3.5",
  cerrar: "M6 6l12 12M18 6 6 18",
  luna: "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z",
  sol: "M12 17a5 5 0 1 0 0-10 5 5 0 0 0 0 10zM12 1v2M12 21v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M1 12h2M21 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4",
  alerta: "M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 16v-5M12 8h.01",
  check: "M5 12l5 5L20 7",
  entra: "M12 4v14M6 12l6 6 6-6",
  sale: "M12 20V6M6 12l6-6 6 6",
  corazon: "M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.7l-1-1.1a5.5 5.5 0 0 0-7.8 7.8L12 21l8.8-8.6a5.5 5.5 0 0 0 0-7.8z",
  dado: "M4 4h16v16H4zM8.5 8.5h.01M15.5 15.5h.01M15.5 8.5h.01M8.5 15.5h.01",
  ruta: "M6 19a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM9 16h6a3 3 0 0 0 0-6h-3",
  telefono: "M7 2h10v20H7zM11 18h2",
  bolsa: "M5 7h14l-1 14H6zM9 7a3 3 0 0 1 6 0",
  comida: "M7 3v8M5 3v4a2 2 0 0 0 4 0V3M7 11v10M17 3c-2 0-3 2-3 5s1 4 3 4v9",
  regalo: "M3 8h18v4H3zM5 12v9h14v-9M12 8v13M12 8c-2-4-6-4-6-1s6 1 6 1zm0 0c2-4 6-4 6-1s-6 1-6 1z",
  balon: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7l4 3-1.5 4.5h-5L8 10z",
  escudo: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z",
  basura: "M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3",
  calendario: "M3 5h18v16H3zM3 10h18M8 3v4M16 3v4",
  wifi: "M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 19.5h.01M2 9a15 15 0 0 1 20 0",
  menu: "M4 6h16M4 12h16M4 18h16",
  descargar: "M12 4v12M6 10l6 6 6-6M4 20h16",
  campana: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0",
  pausa: "M8 5v14M16 5v14",
} as const;

export type NombreIcono = keyof typeof RUTAS;

export function Icono({ nombre, pequeno, etiqueta }: { nombre: NombreIcono; pequeno?: boolean; etiqueta?: string }) {
  return (
    <svg
      className={pequeno ? "cd-ico cd-ico-sm" : "cd-ico"}
      viewBox="0 0 24 24"
      aria-hidden={etiqueta ? undefined : true}
      role={etiqueta ? "img" : undefined}
      aria-label={etiqueta}
    >
      <path d={RUTAS[nombre]} />
    </svg>
  );
}

/** Icono representativo de una categoría (por su ruta grupo › categoría › subcategoría). */
export function iconoCategoria(ruta: readonly string[], grupo?: string | null): NombreIcono {
  const texto = ruta.join(" ").toLowerCase();
  if (grupo === "ingreso") return "entra";
  if (grupo === "apuestas") return "dado";
  if (grupo === "servicio_deuda" || grupo === "financiacion") return "deudas";
  if (grupo === "prestamos_personales") return "persona";
  if (grupo === "transferencia") return "movimientos";
  if (/pareja|social|celebrac/.test(texto)) return "corazon";
  if (/transporte|moto|uber|transmilenio/.test(texto)) return "ruta";
  if (/casa|hogar/.test(texto)) return "inicio";
  if (/internet/.test(texto)) return "wifi";
  if (/celular|móvil|movil/.test(texto)) return "telefono";
  if (/comida|snack/.test(texto)) return "comida";
  if (/regalo|madre|cumple/.test(texto)) return "regalo";
  if (/salud|gym|fútbol|futbol|natación/.test(texto)) return "balon";
  if (/compra|ropa|tecnolog/.test(texto)) return "bolsa";
  return "categorias";
}
