/** Recurrentes y suscripciones (RF-RE, fase 8 punto 10): una sola lista con lo programado, sus días restantes y
 * cuánto queda después de cada pago; pagar, editar (y eliminar), pausar y cancelar desde la misma fila. */
import { useRefrescar } from "@/shared/lib/useRefrescar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useMemo, useState } from "react";
import { toast } from "sonner";

import { useCaptura } from "@/features/captura";
import type {
  Detectado,
  EventoCalendario,
  FrecuenciaRecurrente,
  Recurrente,
  RecurrenteNuevo,
} from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { diasHasta, fechaCorta, formatoCOP, hoyISO, mascaraMonto, parseMonto } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { DiasRestantes } from "@/shared/ui/DiasRestantes";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { SelectorCategoria } from "@/shared/ui/SelectorCategoria";
import { CuentaEtiqueta, SelectorCuenta } from "@/shared/ui/SelectorCuenta";

const FRECUENCIAS: Record<FrecuenciaRecurrente, string> = {
  semanal: "Semanal",
  quincenal: "Quincenal",
  mensual: "Mensual",
  anual: "Anual",
};
const PALABRAS_SUSCRIPCION = ["streaming", "suscripciones ia", "nube"];

function FilaEvento({ e, vencido }: { e: EventoCalendario; vencido?: boolean }) {
  const refrescar = useRefrescar();
  const { abrirMovimiento } = useCaptura();
  const descartar = useMutation({
    // Un recurrente se salta (no vuelve a programarse); lo demás se borra.
    mutationFn: () => (e.recurrente_id != null ? api.omitirProgramada(e.id) : api.eliminarTransaccion(e.id)),
    onSuccess: () => toast(`${e.descripcion}: este pago se saltó`),
    onError: (err) => toast.error(err.message),
    onSettled: refrescar,
  });
  const ingreso = e.monto > 0;
  return (
    <li
      className="cd-row"
      style={{ flexWrap: "nowrap", gap: 12, padding: "10px 0", borderBottom: "1px solid var(--border)" }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{e.descripcion}</b>
        <span className="cd-delta-note">
          {" "}
          · {e.cuenta ? <CuentaEtiqueta nombre={e.cuenta} id={e.cuenta_id} /> : "préstamo personal"}
          {vencido && ` · ${fechaCorta(e.fecha)}`}
        </span>{" "}
        {e.dias <= 7 && <DiasRestantes dias={e.dias} />}
      </span>
      <span className="cd-stack" style={{ alignItems: "flex-end", gap: 0 }}>
        <span className={`cd-amt ${ingreso ? "cd-amt--in" : ""}`}>{formatoCOP(e.monto, { signo: ingreso })}</span>
        {e.saldo_total !== undefined && (
          <span
            className="cd-delta-note cd-num"
            style={{
              color: e.saldo_total < 0 ? "var(--negative)" : undefined,
              fontWeight: e.saldo_total < 0 ? 700 : undefined,
            }}
          >
            queda {formatoCOP(e.saldo_total)}
          </span>
        )}
      </span>
      {e.tipo === "programada" && (
        <span className="cd-row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <button
            className="cd-btn cd-btn--secondary cd-btn--sm"
            title="Revisa monto, cuenta y fecha antes de confirmar"
            onClick={() => abrirMovimiento(e.id)}
          >
            {ingreso ? "Recibido" : "Pagado"}
          </button>
          {vencido && (
            <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => descartar.mutate()}>
              {e.recurrente_id != null ? "Saltar este pago" : "Descartar"}
            </button>
          )}
        </span>
      )}
    </li>
  );
}

function Vencidos({ vencidos }: { vencidos: EventoCalendario[] }) {
  if (vencidos.length === 0) return null;
  return (
    <section className="cd-card" style={{ borderColor: "var(--negative)" }}>
      <div className="cd-card-head">
        <h3 className="cd-card-title">Vencidos sin registrar</h3>
        <span className="cd-badge cd-badge--negative">{vencidos.length}</span>
      </div>
      <p className="cd-delta-note" style={{ margin: "0 0 4px" }}>
        Si ya los pagaste, confírmalos con su fecha; si este periodo no aplica, sáltalo.
      </p>
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {vencidos.map((e) => (
          <FilaEvento key={`${e.tipo}-${e.id}-${e.fecha}`} e={e} vencido />
        ))}
      </ul>
    </section>
  );
}

function Detectados({ detectados }: { detectados: Detectado[] }) {
  const refrescar = useRefrescar();
  const agregar = useMutation({
    mutationFn: (d: Detectado) =>
      api.crearRecurrente({
        nombre: d.descripcion,
        cuenta_id: d.cuenta_id,
        monto: d.monto,
        frecuencia: d.frecuencia,
        dia: d.dia,
        inicio: d.proxima,
        categoria_id: d.categoria_id,
        es_suscripcion: PALABRAS_SUSCRIPCION.some((p) => (d.categoria_ruta ?? []).join(" ").toLowerCase().includes(p)),
      }),
    onSuccess: (_, d) => toast.success(`${d.descripcion} quedó como recurrente`),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar, // ["recurrentes"] también refresca los detectados
  });
  if (detectados.length === 0) return null;
  return (
    <section className="cd-card cd-stack" style={{ gap: 10 }}>
      <h3 className="cd-card-title">Encontré estos pagos que se repiten</h3>
      {detectados.map((d) => (
        <div key={d.descripcion} className="cd-row" style={{ flexWrap: "nowrap", gap: 10 }}>
          <span style={{ flex: 1, minWidth: 0 }}>
            <b style={{ fontSize: 14 }}>{d.descripcion}</b>
            <span className="cd-delta-note cd-num">
              {" "}
              · {FRECUENCIAS[d.frecuencia].toLowerCase()} · {d.veces} veces · próximo {fechaCorta(d.proxima)}
            </span>
          </span>
          <span className="cd-amt">{formatoCOP(d.monto)}</span>
          <button
            className="cd-btn cd-btn--primary cd-btn--sm"
            disabled={agregar.isPending}
            onClick={() => agregar.mutate(d)}
          >
            Agregar
          </button>
        </div>
      ))}
    </section>
  );
}

function FilaRecurrente({
  r,
  evento,
  alEditar,
}: {
  r: Recurrente;
  evento: EventoCalendario | undefined;
  alEditar: () => void;
}) {
  const refrescar = useRefrescar();
  const { abrirMovimiento } = useCaptura();
  const estado = useMutation({
    mutationFn: (nuevo: Recurrente["estado"]) => api.estadoRecurrente(r.id, nuevo),
    onSuccess: (_, nuevo) =>
      toast(
        nuevo === "activo"
          ? `${r.nombre} activo de nuevo`
          : nuevo === "pausado"
            ? `${r.nombre} en pausa: no se programa hasta que lo reactives`
            : `${r.nombre} cancelado: queda en el historial`,
      ),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const [confirmarCancelar, setConfirmarCancelar] = useState(false);
  const activo = r.estado === "activo";
  const proxima = evento?.fecha ?? r.proxima;
  const ingreso = r.monto > 0;
  const saltar = useMutation({
    mutationFn: () => api.omitirProgramada(evento?.id ?? 0),
    onSuccess: () => toast(`${r.nombre}: se saltó el pago de este periodo`),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  return (
    <li className="fila-recurrente" style={{ opacity: activo ? 1 : 0.65 }}>
      <span style={{ minWidth: 0 }}>
        <b className="fila-recurrente-nombre">{r.nombre}</b>
        {r.es_suscripcion && (
          <span className="cd-badge cd-badge--neutral" style={{ marginLeft: 8 }}>
            Suscripción
          </span>
        )}
        {r.credito_id !== null && (
          <span className="cd-badge cd-badge--neutral" style={{ marginLeft: 8 }}>
            Crédito
          </span>
        )}
        {!activo && (
          <span className="cd-badge cd-badge--plain" style={{ marginLeft: 8 }}>
            {r.estado === "pausado" ? "En pausa" : "Cancelado"}
          </span>
        )}
        <span className="cd-row cd-delta-note" style={{ gap: 6, marginTop: 2 }}>
          <span>{FRECUENCIAS[r.frecuencia]}</span>·
          <CuentaEtiqueta nombre={r.cuenta} id={r.cuenta_id} />
          {activo && proxima && (
            <>
              · <span>{fechaCorta(proxima)}</span>
              <DiasRestantes dias={diasHasta(proxima)} />
            </>
          )}
        </span>
      </span>
      <span className="fila-recurrente-acciones">
        {activo && evento && (
          <button
            className="cd-btn cd-btn--primary cd-btn--sm"
            title="Revisa monto, cuenta y fecha antes de confirmar"
            onClick={() => abrirMovimiento(evento.id)}
          >
            {ingreso ? "Recibir" : "Pagar"}
          </button>
        )}
        {activo && evento && r.credito_id === null && (
          <button
            className="cd-btn cd-btn--ghost cd-btn--sm"
            title="No se cobra este periodo; sigue el próximo"
            disabled={saltar.isPending}
            onClick={() => saltar.mutate()}
          >
            Saltar
          </button>
        )}
        <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={alEditar}>
          Editar
        </button>
        <button
          className="cd-btn cd-btn--ghost cd-btn--sm"
          disabled={estado.isPending}
          onClick={() => estado.mutate(activo ? "pausado" : "activo")}
        >
          {activo ? "Pausar" : "Reactivar"}
        </button>
        {r.estado !== "cancelado" &&
          (confirmarCancelar ? (
            <button className="cd-btn cd-btn--peligro cd-btn--sm" onClick={() => estado.mutate("cancelado")}>
              ¿Cancelar?
            </button>
          ) : (
            <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setConfirmarCancelar(true)}>
              Cancelar
            </button>
          ))}
      </span>
      <span className="cd-stack" style={{ alignItems: "flex-end", gap: 2 }}>
        <span className={`cd-amt ${ingreso ? "cd-amt--in" : ""}`}>{formatoCOP(r.monto, { signo: ingreso })}</span>
        {r.costo_mensual > 0 && r.frecuencia !== "mensual" && (
          <span className="cd-delta-note cd-num">{formatoCOP(r.costo_mensual)}/mes</span>
        )}
        {activo && evento?.saldo_total !== undefined && (
          <span
            className="cd-delta-note cd-num"
            style={{
              color: evento.saldo_total < 0 ? "var(--negative)" : undefined,
              fontWeight: evento.saldo_total < 0 ? 700 : undefined,
            }}
          >
            quedan {formatoCOP(evento.saldo_total)}
          </span>
        )}
      </span>
    </li>
  );
}

/** Pausado o cancelado, en la columna lateral: nombre, monto y reactivar o editar. */
function FilaInactivo({ r, alEditar }: { r: Recurrente; alEditar: () => void }) {
  const refrescar = useRefrescar();
  const reactivar = useMutation({
    mutationFn: () => api.estadoRecurrente(r.id, "activo"),
    onSuccess: () => toast(`${r.nombre} activo de nuevo: el periodo en curso queda pendiente`),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  return (
    <li
      className="cd-row"
      style={{ flexWrap: "nowrap", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--border)" }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <b className="fila-recurrente-nombre" style={{ fontSize: 13 }}>
          {r.nombre}
        </b>
        <span className="cd-delta-note" style={{ display: "block" }}>
          {r.estado === "pausado" ? "En pausa" : "Cancelado"} · {formatoCOP(r.monto, { signo: r.monto > 0 })}
        </span>
      </span>
      <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={alEditar}>
        Editar
      </button>
      <button
        className="cd-btn cd-btn--secondary cd-btn--sm"
        disabled={reactivar.isPending}
        onClick={() => reactivar.mutate()}
      >
        Reactivar
      </button>
    </li>
  );
}

interface FormRecurrente {
  nombre: string;
  ingreso: boolean;
  monto: string;
  cuentaId: number | null;
  categoriaId: number | null;
  frecuencia: FrecuenciaRecurrente;
  dia: string;
  inicio: string;
  suscripcion: boolean;
  ancla: Recurrente["ancla"];
}

const formVacio = (): FormRecurrente => ({
  nombre: "",
  ingreso: false,
  monto: "",
  cuentaId: null,
  categoriaId: null,
  frecuencia: "mensual",
  dia: String(new Date().getDate()),
  inicio: hoyISO(),
  suscripcion: false,
  ancla: "calendario",
});

function desdeRecurrente(r: Recurrente): FormRecurrente {
  return {
    nombre: r.nombre,
    ingreso: r.monto > 0,
    monto: mascaraMonto(String(Math.abs(r.monto) / 100)),
    cuentaId: r.cuenta_id,
    categoriaId: r.categoria_id,
    frecuencia: r.frecuencia,
    dia: String(r.dia),
    inicio: r.proxima ?? r.inicio,
    suscripcion: r.es_suscripcion,
    ancla: r.ancla,
  };
}

function NuevoRecurrente({ editando, alTerminar }: { editando: Recurrente | null; alTerminar: () => void }) {
  const id = useId();
  const refrescar = useRefrescar();
  const [f, setF] = useState<FormRecurrente>(() => (editando ? desdeRecurrente(editando) : formVacio()));
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas() });
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias, staleTime: 60_000 });
  const cuentaId = f.cuentaId ?? cuentas.data?.[0]?.id ?? null;
  const guardar = useMutation({
    mutationFn: () => {
      const monto = parseMonto(f.monto);
      if (!f.nombre.trim() || !monto || cuentaId === null) throw new Error("Completa nombre, monto y cuenta");
      const datos: RecurrenteNuevo = {
        nombre: f.nombre.trim(),
        cuenta_id: cuentaId,
        monto: f.ingreso ? monto : -monto,
        frecuencia: f.frecuencia,
        dia: Number(f.inicio.slice(8, 10)) || 1, // el día de cobro sale de la fecha elegida
        inicio: f.inicio,
        categoria_id: f.categoriaId,
        es_suscripcion: f.suscripcion,
        activo: editando?.activo ?? true,
        ancla: f.ancla,
      };
      return editando ? api.editarRecurrente(editando.id, datos) : api.crearRecurrente(datos);
    },
    onSuccess: () => {
      toast.success(editando ? `${f.nombre} actualizado` : `${f.nombre} programado`);
      setF(formVacio());
      alTerminar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const eliminar = useMutation({
    mutationFn: () => api.eliminarRecurrente(editando?.id ?? 0),
    onSuccess: () => {
      toast(`${editando?.nombre} eliminado con sus pagos programados`);
      alTerminar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const cambiar = <K extends keyof FormRecurrente>(k: K, v: FormRecurrente[K]) => setF((x) => ({ ...x, [k]: v }));
  const etiqueta = (campo: string, texto: string) => (
    <label htmlFor={`${id}-${campo}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
      {texto}
    </label>
  );
  return (
    <Hoja
      titulo={editando ? `Editar ${editando.nombre}` : "Nuevo recurrente"}
      onCerrar={alTerminar}
      pie={
        <>
          {editando &&
            editando.credito_id === null &&
            (confirmarBorrado ? (
              <button
                className="cd-btn cd-btn--peligro izquierda"
                disabled={eliminar.isPending}
                onClick={() => eliminar.mutate()}
              >
                Sí, eliminar
              </button>
            ) : (
              <button
                className="cd-btn cd-btn--ghost cd-btn--peligro-suave izquierda"
                onClick={() => setConfirmarBorrado(true)}
              >
                Eliminar
              </button>
            ))}
          <button className="cd-btn cd-btn--ghost" onClick={alTerminar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--primary" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
            {editando ? "Guardar cambios" : "Programar"}
          </button>
        </>
      }
    >
      <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Tipo" style={{ display: "flex" }}>
        {[
          [false, "Pago"],
          [true, "Ingreso"],
        ].map(([v, t]) => (
          <button
            key={String(v)}
            type="button"
            role="radio"
            aria-checked={f.ingreso === v}
            aria-selected={f.ingreso === v}
            style={{ flex: 1, justifyContent: "center" }}
            onClick={() => setF((x) => ({ ...x, ingreso: v as boolean, categoriaId: null }))}
          >
            {t as string}
          </button>
        ))}
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        {etiqueta("nombre", "Nombre")}
        <input
          id={`${id}-nombre`}
          className="cd-input"
          placeholder="Arriendo, Netflix…"
          value={f.nombre}
          onChange={(e) => cambiar("nombre", e.target.value)}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("monto", "Monto")}
          <input
            id={`${id}-monto`}
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={f.monto}
            onChange={(e) => cambiar("monto", mascaraMonto(e.target.value))}
          />
        </div>
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("cuenta", "Cuenta")}
          <SelectorCuenta
            id={`${id}-cuenta`}
            cuentas={cuentas.data ?? []}
            valor={cuentaId}
            alCambiar={(ident) => cambiar("cuentaId", ident)}
          />
        </div>
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("frecuencia", "Frecuencia")}
          <select
            id={`${id}-frecuencia`}
            className="cd-input"
            value={f.frecuencia}
            onChange={(e) => cambiar("frecuencia", e.target.value as FrecuenciaRecurrente)}
          >
            {Object.entries(FRECUENCIAS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </div>
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("dia", editando ? "Próximo cobro" : "Primer cobro")}
          <input
            id={`${id}-dia`}
            type="date"
            className="cd-input"
            value={f.inicio}
            onChange={(e) =>
              setF((x) => ({ ...x, inicio: e.target.value, dia: String(Number(e.target.value.slice(8))) }))
            }
          />
        </div>
      </div>
      {editando?.credito_id != null && (
        <span className="cd-delta-note">Es la cuota de un crédito: se cierra o elimina desde Deudas.</span>
      )}
      <span className="cd-delta-note" style={{ marginTop: -4 }}>
        {f.inicio
          ? `Se cobra ${f.frecuencia === "mensual" ? `el ${Number(f.inicio.slice(8))} de cada mes` : f.frecuencia === "anual" ? "cada año en esa fecha" : `cada ${f.frecuencia === "semanal" ? 7 : 15} días`}${f.inicio < hoyISO() ? "; el periodo en curso queda pendiente para pagarlo o saltarlo" : ""}.`
          : ""}
      </span>
      <div className="cd-stack" style={{ gap: 6 }}>
        {etiqueta("categoria", "Categoría")}
        <SelectorCategoria
          id={`${id}-categoria`}
          arbol={arbol.data ?? []}
          grupos={f.ingreso ? ["ingreso"] : ["gasto_vida", "servicio_deuda", "ahorro_inversion"]}
          valor={f.categoriaId}
          alCambiar={(ident) => cambiar("categoriaId", ident)}
        />
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        {etiqueta("ancla", "La siguiente fecha")}
        <select
          id={`${id}-ancla`}
          className="cd-input"
          value={f.ancla}
          onChange={(e) => cambiar("ancla", e.target.value as Recurrente["ancla"])}
        >
          <option value="calendario">Siempre en la misma fecha (arriendo, cuotas, facturas)</option>
          <option value="pago">Cuenta desde que pagas (gimnasio, planes por 30 días)</option>
        </select>
      </div>
      {!f.ingreso && (
        <label className="cd-row" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
          <input type="checkbox" checked={f.suscripcion} onChange={(e) => cambiar("suscripcion", e.target.checked)} />
          Es una suscripción (la cuento en el costo anual)
        </label>
      )}
    </Hoja>
  );
}

export function RecurrentesPage() {
  const lista = useQuery({ queryKey: claves.recurrentes, queryFn: api.recurrentes });
  const detectados = useQuery({ queryKey: claves.detectados, queryFn: api.detectarRecurrentes });
  const calendario = useQuery({ queryKey: claves.calendario(45), queryFn: () => api.calendario(45) });
  const [editando, setEditando] = useState<Recurrente | "nuevo" | null>(null);
  const l = lista.data;
  const c = calendario.data;
  // Próximo evento programado de cada recurrente (con el saldo que queda después).
  const proximos = useMemo(() => {
    const m = new Map<number, EventoCalendario>();
    for (const e of c?.eventos ?? []) if (e.recurrente_id != null && !m.has(e.recurrente_id)) m.set(e.recurrente_id, e);
    return m;
  }, [c]);
  const activos = (l?.items ?? [])
    .filter((r) => r.estado === "activo")
    .sort((a, b) =>
      (proximos.get(a.id)?.fecha ?? a.proxima ?? "9").localeCompare(proximos.get(b.id)?.fecha ?? b.proxima ?? "9"),
    );
  const inactivos = (l?.items ?? []).filter((r) => r.estado !== "activo");
  // Lo programado que no es un recurrente (cuotas de préstamos personales, pagos sueltos).
  const sueltos = (c?.eventos ?? []).filter((e) => e.recurrente_id == null);
  const hayDetectados = (detectados.data ?? []).length > 0;

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Recurrentes y suscripciones</h1>
          <p>Tus pagos fijos programados, cuánto te quedará después de cada uno y lo que se repite sin que lo notes.</p>
        </div>
        <button className="cd-btn cd-btn--primary" onClick={() => setEditando("nuevo")}>
          + Recurrente
        </button>
      </div>
      {editando && (
        <NuevoRecurrente
          key={editando === "nuevo" ? "nuevo" : editando.id}
          editando={editando === "nuevo" ? null : editando}
          alTerminar={() => setEditando(null)}
        />
      )}
      {l && c && (
        <div className="cd-bento">
          <div className="span-4 cd-balance">
            <div className="cd-balance-top">
              <span className="cd-balance-label">Te quedará en 45 días</span>
            </div>
            <div className="cd-balance-value">
              <Dinero centavos={c.saldo_final} />
            </div>
            <div className="cd-balance-foot">
              <span className="cd-delta">
                {c.primer_negativo
                  ? `en negativo desde el ${fechaCorta(c.primer_negativo.fecha)}`
                  : `mínimo ${formatoCOP(c.minimo.saldo)} el ${fechaCorta(c.minimo.fecha)}`}
              </span>
            </div>
          </div>
          <div className="cd-card cd-kpi span-4">
            <span className="cd-kpi-label">Suscripciones</span>
            <span className="cd-kpi-value">
              <Dinero centavos={l.suscripciones_mensual} />
            </span>
            <span className="cd-delta-note">
              al mes en {l.num_suscripciones} activas · {formatoCOP(l.suscripciones_anual)} al año
            </span>
          </div>
          <div className="cd-card cd-kpi span-4">
            <span className="cd-kpi-label">Pagos fijos programados</span>
            <span className="cd-kpi-value">
              <Dinero centavos={l.gasto_mensual} />
            </span>
            <span className="cd-delta-note">al mes, sin contar cuotas de créditos</span>
          </div>
        </div>
      )}
      <div className="cd-bento">
        <div className="span-8 cd-stack" style={{ gap: 16 }}>
          {c && <Vencidos vencidos={c.vencidos} />}
          <section className="cd-card">
            <div className="cd-card-head">
              <h3 className="cd-card-title">Programados</h3>
              {c && (
                <span className="cd-delta-note cd-num">hoy tienes {formatoCOP(c.saldo_inicial)} en tus cuentas</span>
              )}
            </div>
            {(lista.isPending || calendario.isPending) && <TarjetaCargando filas={4} />}
            {(lista.isError || calendario.isError) && <ErrorVista error={lista.error ?? calendario.error} />}
            {l && activos.length === 0 && sueltos.length === 0 && (
              <Vacio titulo="Aún no hay recurrentes" texto="Agrega uno o acepta los que encontré en tu historial." />
            )}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {activos.map((r) => (
                <FilaRecurrente key={r.id} r={r} evento={proximos.get(r.id)} alEditar={() => setEditando(r)} />
              ))}
              {sueltos.map((e) => (
                <FilaEvento key={`${e.tipo}-${e.id}-${e.fecha}`} e={e} />
              ))}
            </ul>
          </section>
        </div>
        <div className="span-4 cd-stack" style={{ gap: 16, alignSelf: "start" }}>
          {hayDetectados && <Detectados detectados={detectados.data ?? []} />}
          <section className="cd-card">
            <div className="cd-card-head">
              <h3 className="cd-card-title">En pausa y cancelados</h3>
              <span className="cd-badge cd-badge--plain">{inactivos.length}</span>
            </div>
            {inactivos.length === 0 && <span className="cd-delta-note">Nada en pausa.</span>}
            <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
              {inactivos.map((r) => (
                <FilaInactivo key={r.id} r={r} alEditar={() => setEditando(r)} />
              ))}
            </ul>
          </section>
        </div>
      </div>
    </>
  );
}
