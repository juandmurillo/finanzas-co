/** Formato de dinero y fechas es-CO. Los montos llegan de la API en centavos (ADR-0002). */

const MESES_CORTOS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const MESES_LARGOS = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];
const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];

const miles = (n: number) =>
  Math.trunc(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");

/** `$ 1.234.567` · con signo explícito: `- $ 25.000` / `+ $ 50.000`. */
export function formatoCOP(centavos: number, opciones: { signo?: boolean; decimales?: boolean } = {}): string {
  const absoluto = Math.abs(centavos);
  let texto = miles(absoluto / 100);
  if (opciones.decimales) texto += "," + String(absoluto % 100).padStart(2, "0");
  if (centavos < 0) return `- $ ${texto}`;
  if (opciones.signo && centavos > 0) return `+ $ ${texto}`;
  return `$ ${texto}`;
}

/** Solo los pesos con puntos de miles, sin símbolo (para `.cd-money` con `.cur`). */
export const pesos = (centavos: number) => miles(Math.abs(centavos) / 100);

/** Lee lo que el usuario escribe ("18.000", "18000", "18.500,50") y devuelve centavos positivos. */
export function parseMonto(texto: string): number | null {
  const limpio = texto.replace(/\s|\$/g, "");
  if (!limpio) return null;
  const [entera = "", decimal = ""] = limpio.split(",");
  const digitos = entera.replace(/\./g, "");
  if (!/^\d+$/.test(digitos) || (decimal && !/^\d{1,2}$/.test(decimal))) return null;
  const valor = Number(digitos) * 100 + Number(decimal.padEnd(2, "0") || 0);
  return valor > 0 ? valor : null;
}

/** Mientras se escribe: "18000" → "18.000". */
export function mascaraMonto(texto: string): string {
  const [entera = "", decimal] = texto.replace(/[^\d,]/g, "").split(",");
  const conPuntos = entera.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return decimal === undefined ? conPuntos : `${conPuntos},${decimal.slice(0, 2)}`;
}

/** "2026-10-27T..." → "27 oct" (o "27 oct 2026" con año). */
export function fechaCorta(iso: string, conAnio = false): string {
  const [a, m, d] = iso.slice(0, 10).split("-").map(Number);
  const base = `${d} ${MESES_CORTOS[(m ?? 1) - 1]}`;
  return conAnio ? `${base} ${a}` : base;
}

/** Encabezado de día: "Lunes 27 oct". */
export function encabezadoDia(iso: string): string {
  const fecha = new Date(`${iso.slice(0, 10)}T12:00:00`);
  const dia = DIAS[fecha.getDay()] ?? "";
  return `${dia.charAt(0).toUpperCase()}${dia.slice(1)} ${fechaCorta(iso)}`;
}

/** "2026-10" → "octubre 2026" · corto: "Oct". */
export function nombreMes(mes: string, corto = false): string {
  const [a, m] = mes.split("-").map(Number);
  const indice = (m ?? 1) - 1;
  if (corto) {
    const c = MESES_CORTOS[indice] ?? "";
    return c.charAt(0).toUpperCase() + c.slice(1);
  }
  return `${MESES_LARGOS[indice]} ${a}`;
}

/** "2026-10" ± n meses → "2026-09" / "2026-11". */
export function moverMes(mes: string, delta: number): string {
  const [a, m] = mes.split("-").map(Number);
  const fecha = new Date(a ?? 2026, (m ?? 1) - 1 + delta, 1);
  return `${fecha.getFullYear()}-${String(fecha.getMonth() + 1).padStart(2, "0")}`;
}

/** Montos grandes cortos para ejes y nodos: 1.250.000 → "1,3M" · 85.000 → "85k". */
export function abreviar(centavos: number): string {
  const pesos = Math.abs(centavos) / 100;
  const signo = centavos < 0 ? "-" : "";
  if (pesos >= 1_000_000) return `${signo}${(pesos / 1_000_000).toFixed(1).replace(".", ",").replace(",0", "")}M`;
  return `${signo}${Math.round(pesos / 1000)}k`;
}

/** Fecha local de hoy en YYYY-MM-DD. */
export function hoyISO(): string {
  return ahoraLocal().slice(0, 10);
}

/** Fecha y hora local para `<input type="datetime-local">`: "2026-10-31T15:45". */
export function ahoraLocal(): string {
  const ahora = new Date();
  const local = new Date(ahora.getTime() - ahora.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

/** Hora "15:45" de una fecha ISO; vacío si no la tiene (00:00, como las programadas). */
export function horaCorta(iso: string): string {
  const hora = iso.slice(11, 16);
  return hora && hora !== "00:00" ? hora : "";
}

/** Días entre hoy y una fecha ISO (negativo si ya pasó). */
export function diasHasta(iso: string): number {
  return Math.round((Date.parse(iso.slice(0, 10)) - Date.parse(hoyISO())) / 86_400_000);
}

/** Porcentaje con coma: 0.6356 → "63,56%". */
export const porcentaje = (fraccion: number, decimales = 2) =>
  `${(fraccion * 100).toFixed(decimales).replace(".", ",")}%`;
