/** Gastos e ingresos por categoría en una sola tarjeta: un mismo filtro de periodo para ambos, vista por categoría
 * o por subcategoría, y cada parte lleva a sus movimientos filtrados (categoría + periodo). */
import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";
import type { CategoriaNodo, CategoriaReporte } from "@/shared/api/tipos";
import { Distribucion, type Parte } from "@/shared/charts";
import { api, type Periodo } from "@/shared/lib/api";
import { formatoCOP, hoyISO, nombreMes } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { useEstiloCategorias } from "@/shared/ui/EstiloCategoria";
import { CabeceraTarjeta } from "@/shared/ui/Kpi";

type Nivel = "categoria" | "subcategoria";

/** Partes por categoría, o por subcategoría (lo que no tiene subcategoría queda con el nombre de su categoría). */
export function partesPorNivel(categorias: CategoriaReporte[], nivel: Nivel): Parte[] {
  if (nivel === "categoria") return categorias.map((c) => ({ nombre: c.categoria, valor: c.total, id: c.id }));
  return categorias.flatMap((c) => {
    const subs = c.subcategorias.map((s) => ({ nombre: s.subcategoria, valor: s.total, id: s.id }));
    const resto = c.total - subs.reduce((t, s) => t + s.valor, 0);
    return resto > 0 ? [...subs, { nombre: c.categoria, valor: resto, id: c.id }] : subs;
  });
}

/** Grupos de cada lado, para resolver nombres a ids cuando el reporte no los trae. */
const GRUPOS: Record<"gastos" | "ingresos", string[]> = {
  gastos: ["gasto_vida", "servicio_deuda", "apuestas", "ahorro_inversion"],
  ingresos: ["ingreso"],
};

/** Busca el id por nombre en el árbol (subcategoría primero si se pide; si no, categoría). */
export function idPorNombre(arbol: CategoriaNodo[], grupos: string[], nombre: string, nivel: Nivel): number | null {
  const raices = arbol.filter((r) => grupos.includes(r.grupo));
  const categorias = raices.flatMap((r) => r.hijos);
  if (nivel === "subcategoria") {
    const sub = categorias.flatMap((c) => c.hijos).find((h) => h.nombre === nombre);
    if (sub) return sub.id;
  }
  return categorias.find((c) => c.nombre === nombre)?.id ?? null;
}

/** Del periodo en meses (AAAA-MM) al rango de fechas que entiende Movimientos. */
/** Fechas de inicio y fin (días) de un periodo en meses, para filtrar Movimientos. */
export function rangoFechas(p: Periodo): { desde?: string; hasta?: string } {
  const hasta = p.hasta ?? hoyISO().slice(0, 7);
  const finMes = new Date(Number(hasta.slice(0, 4)), Number(hasta.slice(5, 7)), 0).getDate();
  return { desde: p.desde ? `${p.desde}-01` : undefined, hasta: `${hasta}-${String(finMes).padStart(2, "0")}` };
}

function Lado({
  conjunto,
  titulo,
  periodo,
  nivel,
}: {
  conjunto: "gastos" | "ingresos";
  titulo: string;
  periodo: Periodo;
  nivel: Nivel;
}) {
  const navegar = useNavigate();
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias, staleTime: 60_000 });
  const consulta = useQuery({
    queryKey: claves.reporteCategorias(periodo, conjunto),
    queryFn: () => api.reporteConjunto(periodo, conjunto),
  });
  const estilo = useEstiloCategorias();
  const partes = partesPorNivel(consulta.data?.categorias ?? [], nivel).map((p) => ({
    ...p,
    color: estilo({ id: p.id, nombre: p.nombre }).color,
  }));
  const total = partes.reduce((t, p) => t + Math.max(0, p.valor), 0);
  const elegir = (p: Parte) => {
    // El reporte trae el id; si no (API sin actualizar), se busca por nombre en el árbol de categorías.
    const id = p.id ?? idPorNombre(arbol.data ?? [], GRUPOS[conjunto], p.nombre, nivel);
    if (id == null) return;
    const rango = rangoFechas(periodo);
    const cuando = periodo.desde === periodo.hasta && periodo.desde ? nombreMes(periodo.desde) : undefined;
    void navegar({
      to: "/movimientos",
      search: { categoria: id, etiqueta: cuando ? `${p.nombre} · ${cuando}` : p.nombre, ...rango },
    });
  };
  return (
    <section className="categorias-lado" aria-label={titulo}>
      <div className="categorias-lado-cabeza">
        <span>{titulo}</span>
        {consulta.isSuccess && (
          <b className={`cd-num ${conjunto === "ingresos" ? "tono-ingreso" : ""}`}>{formatoCOP(total)}</b>
        )}
      </div>
      {consulta.isPending && <TarjetaCargando filas={3} />}
      {consulta.isError && <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />}
      {consulta.isSuccess && (
        <Distribucion
          titulo={`${titulo} por ${nivel === "categoria" ? "categoría" : "subcategoría"}`}
          partes={partes}
          alElegir={elegir}
          vacio={conjunto === "gastos" ? "Sin gastos en este periodo." : "Sin ingresos en este periodo."}
        />
      )}
    </section>
  );
}

export function CategoriasMes() {
  const nav = usePeriodo("mes", "inicio-categorias");
  const [vista, setVista] = useFiltroRecordado("inicio-categorias-nivel", { nivel: "categoria" as Nivel });
  const periodo = nav.periodo;
  return (
    <section className="cd-card categorias-mes">
      <CabeceraTarjeta
        titulo="Gastos e ingresos por categoría"
        rango="El periodo aplica a ambos · toca una para ver sus movimientos"
        rangoSoloEscritorio
        accion={<ControlPeriodo nav={nav} opciones={["mes", "3m", "6m", "12m", "rango"]} />}
      />
      <div className="cd-seg categorias-nivel" role="radiogroup" aria-label="Ver por">
        {(
          [
            ["categoria", "Categorías"],
            ["subcategoria", "Subcategorías"],
          ] as const
        ).map(([v, t]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={vista.nivel === v}
            aria-selected={vista.nivel === v}
            onClick={() => setVista(() => ({ nivel: v }))}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="categorias-lados">
        <Lado conjunto="gastos" titulo="Gastos" periodo={periodo} nivel={vista.nivel} />
        <Lado conjunto="ingresos" titulo="Ingresos" periodo={periodo} nivel={vista.nivel} />
      </div>
    </section>
  );
}
