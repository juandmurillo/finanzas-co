/** Recurrentes y suscripciones (RF-RE, fase 8 punto 10): una sola lista con lo programado, sus días restantes y
 * cuánto queda después de cada pago; pagar, editar (y eliminar), pausar y cancelar desde la misma fila. */
import { esMovil } from "@/shared/lib/dispositivo";
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
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { AreaTemporal } from "@/shared/charts";
import { Hoja } from "@/shared/ui/Hoja";
import { Icono } from "@/shared/ui/Icono";
import { CabeceraTarjeta, KpiCompacto } from "@/shared/ui/Kpi";
import { SelectorCategoria } from "@/shared/ui/SelectorCategoria";
import { CuentaEtiqueta, SelectorCuenta } from "@/shared/ui/SelectorCuenta";

import { Desplegable } from "@/shared/ui/Desplegable";
import { CampoFecha } from "@/shared/ui/CampoFecha";
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
  const movil = esMovil();
  const [detalle, setDetalle] = useState(false);
  return (
    <tr {...filaTocable(movil, e.descripcion, () => setDetalle(true))}>
      <td data-etiqueta="Pago">
        {detalle && (
          <Hoja titulo={e.descripcion} onCerrar={() => setDetalle(false)}>
            <ResumenPago
              lineas={[
                [e.recurrente_id != null ? "Recurrente" : "Programado", e.cuenta ?? "préstamo personal"],
                [vencido ? "Venció" : "Fecha", fechaCorta(e.fecha, true)],
                ["Monto", formatoCOP(e.monto, { signo: ingreso })],
                ...(e.saldo_total !== undefined && !vencido
                  ? ([["Te quedará", formatoCOP(e.saldo_total)]] as [string, string][])
                  : []),
              ]}
            />
            {e.tipo === "programada" && (
              <div className="detalle-acciones">
                <button
                  className="cd-btn cd-btn--primary"
                  onClick={() => {
                    setDetalle(false);
                    abrirMovimiento(e.id);
                  }}
                >
                  {ingreso ? "Recibido" : "Pagado"}
                </button>
                {vencido && (
                  <button
                    className="cd-btn cd-btn--secondary"
                    disabled={descartar.isPending}
                    onClick={() => {
                      descartar.mutate();
                      setDetalle(false);
                    }}
                  >
                    {e.recurrente_id != null ? "Saltar este pago" : "Descartar"}
                  </button>
                )}
              </div>
            )}
          </Hoja>
        )}
        <b className="fila-recurrente-nombre">{e.descripcion}</b>
        <small className="tabla-rec-sub">
          {e.recurrente_id != null ? "Recurrente" : "Programado"} ·{" "}
          {e.cuenta ? <CuentaEtiqueta nombre={e.cuenta} id={e.cuenta_id} /> : "préstamo personal"}
        </small>
      </td>
      <td data-etiqueta="Fecha">
        <span className="tabla-rec-fecha">
          {fechaCorta(e.fecha)} {(vencido || e.dias <= 7) && <DiasRestantes dias={e.dias} />}
        </span>
      </td>
      <td data-etiqueta="Monto">
        <span className={`cd-amt ${ingreso ? "cd-amt--in" : ""}`}>{formatoCOP(e.monto, { signo: ingreso })}</span>
        {!vencido && e.saldo_total !== undefined && <Queda saldo={e.saldo_total} />}
      </td>
      <td data-etiqueta="Acciones">
        {e.tipo === "programada" && (
          <span className="tabla-rec-acciones">
            {vencido && (
              <span className="acciones-fila">
                <button
                  type="button"
                  aria-label={e.recurrente_id != null ? `Saltar ${e.descripcion}` : `Descartar ${e.descripcion}`}
                  title={e.recurrente_id != null ? "Saltar este pago" : "Descartar"}
                  disabled={descartar.isPending}
                  onClick={() => descartar.mutate()}
                >
                  <Icono nombre="flecha" pequeno />
                </button>
              </span>
            )}
          </span>
        )}
      </td>
      <td data-etiqueta="Registrar" className="tabla-rec-pagar">
        {e.tipo === "programada" && (
          <button
            className="cd-btn cd-btn--primary cd-btn--sm"
            title="Revisa monto, cuenta y fecha antes de confirmar"
            onClick={() => abrirMovimiento(e.id)}
          >
            {ingreso ? "Recibido" : "Pagado"}
          </button>
        )}
      </td>
    </tr>
  );
}

/** «queda $ X» bajo el monto: lo que te quedará en las cuentas después de ese pago. */
function Queda({ saldo }: { saldo: number }) {
  return (
    <span
      className="cd-num tabla-rec-queda"
      style={{ color: saldo < 0 ? "var(--negative)" : "var(--ink-muted)", fontWeight: saldo < 0 ? 700 : undefined }}
    >
      queda {formatoCOP(saldo)}
    </span>
  );
}

function Vencidos({ vencidos }: { vencidos: EventoCalendario[] }) {
  if (vencidos.length === 0) return null;
  return (
    <section className="cd-card" style={{ borderColor: "var(--negative)" }}>
      <div className="cd-card-head">
        <h2 className="cd-card-title">Vencidos sin registrar</h2>
        <span className="cd-badge cd-badge--negative">{vencidos.length}</span>
      </div>
      <p className="cd-delta-note" style={{ margin: "0 0 4px" }}>
        Si ya los pagaste, confírmalos con su fecha; si este periodo no aplica, sáltalo.
      </p>
      <div className="tabla-rec">
        <table className={`cd-table ${esMovil() ? "tabla-rec-compacta" : "tabla-apilable"}`}>
          <thead>
            <tr>
              <th>Pago</th>
              <th>Fecha</th>
              <th style={{ textAlign: "right" }}>Monto</th>
              <th aria-label="Acciones" />
              <th aria-label="Registrar" />
            </tr>
          </thead>
          <tbody>
            {vencidos.map((e) => (
              <FilaEvento key={`${e.tipo}-${e.id}-${e.fecha}`} e={e} vencido />
            ))}
          </tbody>
        </table>
      </div>
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
      <h2 className="cd-card-title">Encontré estos pagos que se repiten</h2>
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

/** Saldo de tus cuentas día a día con lo programado de los próximos 45 días. */
function SaldoProyectado({ inicial, eventos }: { inicial: number; eventos: EventoCalendario[] }) {
  const porDia = new Map<string, { saldo: number; pagos: EventoCalendario[] }>();
  porDia.set(hoyISO(), { saldo: inicial, pagos: [] });
  for (const e of eventos) {
    if (e.saldo_total === undefined) continue;
    const dia = porDia.get(e.fecha) ?? { saldo: e.saldo_total, pagos: [] };
    dia.saldo = e.saldo_total;
    dia.pagos.push(e);
    porDia.set(e.fecha, dia);
  }
  const dias = [...porDia.entries()].sort(([a], [b]) => a.localeCompare(b));
  const puntos = dias.map(([fecha, d]) => ({ fecha, valor: d.saldo }));
  const minimo = Math.min(...puntos.map((x) => x.valor));
  return (
    <section className="cd-card rec-saldo">
      <CabeceraTarjeta titulo="Saldo proyectado" rango={`Próximos 45 días · mínimo ${formatoCOP(minimo)}`} />
      {puntos.length < 2 ? (
        <p className="cd-delta-note">No hay pagos programados en los próximos 45 días.</p>
      ) : (
        <AreaTemporal
          titulo="Saldo proyectado con los pagos programados"
          nombreSerie="Saldo"
          puntos={puntos}
          alto={esMovil() ? 120 : 200}
          extraGlobo={(i) => {
            const pagos = dias[i]?.[1].pagos ?? [];
            return pagos.slice(0, 3).map((e) => (
              <span key={`${e.tipo}-${e.id}`} className="globo-fila">
                {e.descripcion}
                <b>{formatoCOP(e.monto, { signo: e.monto > 0 })}</b>
              </span>
            ));
          }}
        />
      )}
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
  const movil = esMovil();
  const [detalle, setDetalle] = useState(false);
  return (
    <tr style={{ opacity: activo ? 1 : 0.65 }} {...filaTocable(movil, r.nombre, () => setDetalle(true))}>
      <td data-etiqueta="Pago">
        {detalle && (
          <Hoja titulo={r.nombre} onCerrar={() => setDetalle(false)}>
            <ResumenPago
              lineas={[
                [
                  "Frecuencia",
                  `${FRECUENCIAS[r.frecuencia]}${r.es_suscripcion ? " · suscripción" : ""}${r.credito_id !== null ? " · crédito" : ""}`,
                ],
                ["Cuenta", r.cuenta],
                ["Próximo", activo && proxima ? fechaCorta(proxima, true) : "—"],
                ["Monto", formatoCOP(r.monto, { signo: ingreso })],
                ...(activo && evento?.saldo_total !== undefined
                  ? ([["Te quedará", formatoCOP(evento.saldo_total)]] as [string, string][])
                  : []),
              ]}
            />
            <div className="detalle-acciones">
              {activo && evento && (
                <button
                  className="cd-btn cd-btn--primary"
                  onClick={() => {
                    setDetalle(false);
                    abrirMovimiento(evento.id);
                  }}
                >
                  {ingreso ? "Recibir" : "Pagar"}
                </button>
              )}
              {activo && evento && r.credito_id === null && (
                <button
                  className="cd-btn cd-btn--secondary"
                  disabled={saltar.isPending}
                  onClick={() => {
                    saltar.mutate();
                    setDetalle(false);
                  }}
                >
                  Saltar este periodo
                </button>
              )}
              <button
                className="cd-btn cd-btn--secondary"
                onClick={() => {
                  setDetalle(false);
                  alEditar();
                }}
              >
                Editar
              </button>
              <button
                className="cd-btn cd-btn--secondary"
                disabled={estado.isPending}
                onClick={() => {
                  estado.mutate(activo ? "pausado" : "activo");
                  setDetalle(false);
                }}
              >
                {activo ? "Pausar" : "Reactivar"}
              </button>
              {r.estado !== "cancelado" &&
                (confirmarCancelar ? (
                  <button
                    className="cd-btn cd-btn--peligro"
                    onClick={() => {
                      estado.mutate("cancelado");
                      setDetalle(false);
                    }}
                  >
                    Sí, cancelar {r.nombre}
                  </button>
                ) : (
                  <button className="cd-btn cd-btn--peligro-suave" onClick={() => setConfirmarCancelar(true)}>
                    Cancelar recurrente
                  </button>
                ))}
            </div>
          </Hoja>
        )}
        <b className="fila-recurrente-nombre">{r.nombre}</b>
        <small className="tabla-rec-sub">
          {FRECUENCIAS[r.frecuencia]}
          {r.es_suscripcion && " · suscripción"}
          {r.credito_id !== null && " · crédito"}
          {r.costo_mensual > 0 && r.frecuencia !== "mensual" && ` · ${formatoCOP(r.costo_mensual)}/mes`} ·{" "}
          <CuentaEtiqueta nombre={r.cuenta} id={r.cuenta_id} />
        </small>
      </td>
      <td data-etiqueta="Fecha">
        {activo && proxima ? (
          <span className="tabla-rec-fecha">
            {fechaCorta(proxima)}
            <DiasRestantes dias={diasHasta(proxima)} />
          </span>
        ) : (
          "—"
        )}
      </td>
      <td data-etiqueta="Monto">
        <span className={`cd-amt ${ingreso ? "cd-amt--in" : ""}`}>{formatoCOP(r.monto, { signo: ingreso })}</span>
        {activo && evento?.saldo_total !== undefined && <Queda saldo={evento.saldo_total} />}
      </td>
      <td data-etiqueta="Acciones">
        <span className="tabla-rec-acciones">
          <span className="acciones-fila">
            {activo && evento && r.credito_id === null && (
              <button
                type="button"
                aria-label={`Saltar el pago de ${r.nombre} de este periodo`}
                title="Saltar este periodo"
                disabled={saltar.isPending}
                onClick={() => saltar.mutate()}
              >
                <Icono nombre="flecha" pequeno />
              </button>
            )}
            <button type="button" aria-label={`Editar ${r.nombre}`} title="Editar" onClick={alEditar}>
              <Icono nombre="lapiz" pequeno />
            </button>
            <button
              type="button"
              aria-label={`${activo ? "Pausar" : "Reactivar"} ${r.nombre}`}
              title={activo ? "Pausar" : "Reactivar"}
              disabled={estado.isPending}
              onClick={() => estado.mutate(activo ? "pausado" : "activo")}
            >
              <Icono nombre={activo ? "pausa" : "check"} pequeno />
            </button>
            {r.estado !== "cancelado" &&
              (confirmarCancelar ? (
                <button
                  type="button"
                  className="peligro confirmar"
                  aria-label={`Confirmar: cancelar ${r.nombre}`}
                  title="Confirmar cancelación"
                  onClick={() => estado.mutate("cancelado")}
                >
                  <Icono nombre="check" pequeno />
                </button>
              ) : (
                <button
                  type="button"
                  className="peligro"
                  aria-label={`Cancelar ${r.nombre}`}
                  title="Cancelar"
                  onClick={() => setConfirmarCancelar(true)}
                >
                  <Icono nombre="cerrar" pequeno />
                </button>
              ))}
          </span>
        </span>
      </td>
      <td data-etiqueta="Registrar" className="tabla-rec-pagar">
        {activo && evento && (
          <button
            className="cd-btn cd-btn--primary cd-btn--sm"
            title="Revisa monto, cuenta y fecha antes de confirmar"
            onClick={() => abrirMovimiento(evento.id)}
          >
            {ingreso ? "Recibir" : "Pagar"}
          </button>
        )}
      </td>
    </tr>
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
          <Desplegable
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
          </Desplegable>
        </div>
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("dia", editando ? "Próximo cobro" : "Primer cobro")}
          <CampoFecha
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
        <Desplegable
          id={`${id}-ancla`}
          className="cd-input"
          value={f.ancla}
          onChange={(e) => cambiar("ancla", e.target.value as Recurrente["ancla"])}
        >
          <option value="calendario">Siempre en la misma fecha (arriendo, cuotas, facturas)</option>
          <option value="pago">Cuenta desde que pagas (gimnasio, planes por 30 días)</option>
        </Desplegable>
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
      <div className="cd-bento">
        <div className="span-8 cd-stack rec-principal" style={{ gap: "var(--gap-bento)", alignSelf: "start" }}>
          {c && <Vencidos vencidos={c.vencidos} />}
          <section className="cd-card">
            <CabeceraTarjeta
              titulo="Programados"
              rango={c ? `Hoy tienes ${formatoCOP(c.saldo_inicial)} en tus cuentas` : undefined}
            />
            {(lista.isPending || calendario.isPending) && <TarjetaCargando filas={4} />}
            {(lista.isError || calendario.isError) && <ErrorVista error={lista.error ?? calendario.error} />}
            {l && activos.length === 0 && sueltos.length === 0 && (
              <Vacio titulo="Aún no hay recurrentes" texto="Agrega uno o acepta los que encontré en tu historial." />
            )}
            {(activos.length > 0 || sueltos.length > 0) && (
              <div className="tabla-rec">
                <table className={`cd-table ${esMovil() ? "tabla-rec-compacta" : "tabla-apilable"}`}>
                  <thead>
                    <tr>
                      <th>Pago</th>
                      <th>Próximo</th>
                      <th style={{ textAlign: "right" }}>Monto</th>
                      <th aria-label="Acciones" />
                      <th aria-label="Registrar" />
                    </tr>
                  </thead>
                  <tbody>
                    {activos.map((r) => (
                      <FilaRecurrente key={r.id} r={r} evento={proximos.get(r.id)} alEditar={() => setEditando(r)} />
                    ))}
                    {sueltos.map((e) => (
                      <FilaEvento key={`${e.tipo}-${e.id}-${e.fecha}`} e={e} />
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
        <div className="span-4 cd-stack rec-lado" style={{ gap: "var(--gap-bento)", alignSelf: "start" }}>
          {l && c && (
            <div className="recurrentes-kpis">
              <KpiCompacto
                inversa
                etiqueta="Te quedará en 45 días"
                icono="cuentas"
                valor={c.saldo_final}
                nota={
                  c.primer_negativo
                    ? `en negativo desde el ${fechaCorta(c.primer_negativo.fecha)}`
                    : `mínimo ${formatoCOP(c.minimo.saldo)} el ${fechaCorta(c.minimo.fecha)}`
                }
              />
              <KpiCompacto
                etiqueta="Suscripciones"
                icono="recurrentes"
                valor={l.suscripciones_mensual}
                nota={`${l.num_suscripciones} activas · ${formatoCOP(l.suscripciones_anual)} al año`}
              />
              <KpiCompacto
                etiqueta="Pagos fijos"
                icono="calendario"
                valor={l.gasto_mensual}
                nota="al mes, sin cuotas de créditos"
              />
              <KpiCompacto
                etiqueta="Vencidos"
                icono="alerta"
                valor={String(c.vencidos.length)}
                delta={c.vencidos.length ? { valor: 0, sentido: "alerta", texto: "Revísalos" } : undefined}
                nota={c.vencidos.length ? undefined : "todo al día"}
              />
            </div>
          )}
          {c && <SaldoProyectado inicial={c.saldo_inicial} eventos={c.eventos} />}
          {hayDetectados && <Detectados detectados={detectados.data ?? []} />}
          <section className="cd-card">
            <div className="cd-card-head">
              <h2 className="cd-card-title">En pausa y cancelados</h2>
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

/** En el celular la fila entera abre su detalle (con el teclado, Enter o Espacio). */
function filaTocable(movil: boolean, nombre: string, abrir: () => void) {
  if (!movil) return {};
  return {
    className: "fila-tocable",
    tabIndex: 0,
    "aria-label": `${nombre}: ver detalle y acciones`,
    // La hoja del detalle va en un portal: sus clics suben por React hasta la fila, pero no están en su DOM.
    onClick: (e: React.MouseEvent) => e.currentTarget.contains(e.target as Node) && abrir(),
    onKeyDown: (e: React.KeyboardEvent) => {
      if (!e.currentTarget.contains(e.target as Node)) return;
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        abrir();
      }
    },
  };
}

/** Datos del pago en el detalle: rótulo y valor por fila. */
function ResumenPago({ lineas }: { lineas: [string, string][] }) {
  return (
    <dl className="detalle-resumen">
      {lineas.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd className="cd-num">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
