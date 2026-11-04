/** «En 3 días», «hoy», «vencido hace 2 días» como insignia; rojo solo para lo vencido (regla de Caudal). */

export function textoDias(dias: number): string {
  if (dias === 0) return "hoy";
  if (dias === 1) return "mañana";
  if (dias > 1) return `en ${dias} días`;
  if (dias === -1) return "venció ayer";
  return `vencido hace ${-dias} días`;
}

export function DiasRestantes({ dias }: { dias: number }) {
  const clase = dias < 0 ? "cd-badge--negative" : dias <= 3 ? "cd-badge--warning" : "cd-badge--neutral";
  return <span className={`cd-badge ${clase}`}>{textoDias(dias)}</span>;
}
