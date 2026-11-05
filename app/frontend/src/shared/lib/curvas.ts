/** Curva suave para gráficos de línea (cúbica monótona de Fritsch-Carlson): pasa por todos los puntos, sin
 * inventar picos ni cruzar por debajo de cero entre dos valores positivos. */
export function rutaSuave(puntos: [number, number][]): string {
  const p = puntos.filter((q, i) => i === 0 || q[0] > (puntos[i - 1]?.[0] ?? -Infinity));
  const n = p.length;
  const primero = p[0];
  if (!primero) return "";
  const texto = (v: number) => v.toFixed(1);
  let ruta = `M${texto(primero[0])} ${texto(primero[1])}`;
  const pendientes = p.slice(1).map((q, i) => {
    const a = p[i] ?? q;
    return (q[1] - a[1]) / (q[0] - a[0]);
  });
  const tangente = (i: number): number => {
    const antes = pendientes[i - 1];
    const despues = pendientes[i];
    if (antes === undefined) return despues ?? 0;
    if (despues === undefined) return antes;
    return antes * despues <= 0 ? 0 : (2 * antes * despues) / (antes + despues);
  };
  for (let i = 0; i < n - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    if (!a || !b) continue;
    const h = (b[0] - a[0]) / 3;
    ruta += ` C${texto(a[0] + h)} ${texto(a[1] + tangente(i) * h)} ${texto(b[0] - h)} ${texto(b[1] - tangente(i + 1) * h)} ${texto(b[0])} ${texto(b[1])}`;
  }
  return ruta;
}

/** Marcas de un eje proporcional al tiempo: repartidas por fecha y sin repetir etiqueta. Devuelve [texto, índice]. */
export function marcasPorTiempo(
  fechas: string[],
  etiqueta: (fecha: string) => string,
  cuantas = 6,
): [string, number][] {
  const tiempos = fechas.map((f) => Date.parse(f));
  const inicio = tiempos[0] ?? 0;
  const tramo = Math.max(1, (tiempos.at(-1) ?? 0) - inicio);
  const marcas = new Map<string, number>();
  for (let k = 0; k < cuantas; k++) {
    const objetivo = inicio + (tramo * k) / (cuantas - 1);
    const i = tiempos.reduce((m, t, j) => (Math.abs(t - objetivo) < Math.abs((tiempos[m] ?? t) - objetivo) ? j : m), 0);
    marcas.set(etiqueta(fechas[i] ?? ""), i);
  }
  return [...marcas.entries()];
}
