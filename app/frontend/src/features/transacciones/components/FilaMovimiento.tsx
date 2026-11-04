import { useCaptura } from "@/features/captura";
import type { Transaccion } from "@/shared/api/tipos";
import { fechaCorta, formatoCOP, horaCorta } from "@/shared/lib/formato";
import { Icono, iconoCategoria } from "@/shared/ui/Icono";
import { CuentaEtiqueta } from "@/shared/ui/SelectorCuenta";

/** Fila de movimiento. Gastos en tinta, ingresos en `positive`, transferencias atenuadas. Al tocarla abre el
 * editor único (fase 8, D1) salvo que la vista pase su propio `onSeleccionar`. */
export function FilaMovimiento({
  tx,
  mostrarFecha,
  seleccionada,
  onSeleccionar,
}: {
  tx: Transaccion;
  mostrarFecha?: boolean;
  seleccionada?: boolean;
  onSeleccionar?: (tx: Transaccion) => void;
}) {
  const { abrirMovimiento } = useCaptura();
  const alTocar = onSeleccionar ?? abrirMovimiento;
  const ruta = tx.categoria_ruta.slice(1);
  const esTransferencia = tx.grupo === "transferencia";
  const claseMonto = esTransferencia ? "cd-amt cd-muted" : tx.monto > 0 ? "cd-amt cd-amt--in" : "cd-amt";
  const titulo = tx.descripcion || ruta.at(-1) || "Sin descripción";
  const contenido = (
    <>
      <span
        className="cd-avatar cd-avatar--sq"
        style={{ background: "var(--brand-soft)", color: "var(--on-brand-soft)" }}
      >
        <Icono nombre={iconoCategoria(tx.categoria_ruta, tx.grupo)} />
      </span>
      <div className="grow" style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {titulo}
        </span>
        <small style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {ruta.join(" › ") || "Sin categoría"} · <CuentaEtiqueta nombre={tx.cuenta} id={tx.cuenta_id} tam={14} />
          {mostrarFecha ? ` · ${fechaCorta(tx.fecha)}` : ""}
          {horaCorta(tx.fecha) && ` · ${horaCorta(tx.fecha)}`}
        </small>
      </div>
      {tx.estado === "pendiente" && <span className="cd-badge cd-badge--info">Programado</span>}
      {tx.etiquetas.includes("reclamo") && <span className="cd-badge cd-badge--warning">En reclamo</span>}
      <span className={claseMonto}>{formatoCOP(tx.monto, { signo: true })}</span>
    </>
  );
  return (
    <li style={{ padding: 0 }}>
      <button
        type="button"
        className="fila-boton cd-row"
        aria-pressed={seleccionada}
        style={{
          padding: "10px 8px",
          gap: 12,
          flexWrap: "nowrap",
          background: seleccionada ? "var(--brand-soft)" : undefined,
        }}
        onClick={() => alTocar(tx)}
      >
        {contenido}
      </button>
    </li>
  );
}

/** Grupos que no son ingreso ni gasto (transferencias, préstamos con personas, desembolsos, ajustes). */
const GRUPOS_NEUTROS = new Set(["transferencia", "prestamos_personales", "financiacion", "ajuste"]);

/** Agrupa por día (YYYY-MM-DD) conservando el orden; el total solo suma ingresos y gastos. */
export function agruparPorDia(items: Transaccion[]): { dia: string; total: number; items: Transaccion[] }[] {
  const grupos: { dia: string; total: number; items: Transaccion[] }[] = [];
  for (const tx of items) {
    const dia = tx.fecha.slice(0, 10);
    let grupo = grupos.at(-1);
    if (!grupo || grupo.dia !== dia) {
      grupo = { dia, total: 0, items: [] };
      grupos.push(grupo);
    }
    grupo.items.push(tx);
    if (!GRUPOS_NEUTROS.has(tx.grupo ?? "")) grupo.total += tx.monto;
  }
  return grupos;
}
