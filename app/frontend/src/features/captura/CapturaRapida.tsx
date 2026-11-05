/**
 * Editor único de movimientos (RF-TX-02/03, fase 8 D1). Al crear: monto primero, autocompletado de la
 * descripción, chips de categorías frecuentes, Enter guarda, Shift+Enter guarda y deja abierto para otro.
 * Al abrir uno existente: se editan todos sus datos (tipo, monto, cuenta, categoría, fecha y hora, nota),
 * se confirma si está programado y se elimina; nada se guarda sin pulsar el botón.
 */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { toast } from "sonner";

import type { Sugerencia, Transaccion } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { ahoraLocal, fechaCorta, formatoCOP, hoyISO, mascaraMonto, parseMonto } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { Icono } from "@/shared/ui/Icono";
import { SelectorCategoria } from "@/shared/ui/SelectorCategoria";
import { SelectorCuenta } from "@/shared/ui/SelectorCuenta";

import type { TipoMovimiento } from "./CapturaContexto";
import { validar, type Borrador, type Errores } from "./modelo";
import { useGuardarMovimiento } from "./useGuardarMovimiento";

const GRUPOS_POR_TIPO: Record<Exclude<TipoMovimiento, "transferencia">, string[]> = {
  gasto: ["gasto_vida", "servicio_deuda", "apuestas", "prestamos_personales", "ahorro_inversion"],
  ingreso: ["ingreso", "prestamos_personales", "apuestas"],
};

const borradorVacio = (tipo: TipoMovimiento, cuentaId: number | null): Borrador => ({
  tipo,
  monto: "",
  descripcion: "",
  categoriaId: null,
  cuentaId,
  destinoId: null,
  fecha: ahoraLocal(),
  nota: "",
});

/** Movimiento abierto para editar; `par` es el otro lado si es una transferencia. */
export interface Edicion {
  tx: Transaccion;
  par: Transaccion | null;
}

const aTexto = (centavos: number) => mascaraMonto(String(Math.abs(centavos) / 100).replace(".", ","));

function desdeMovimiento({ tx, par }: Edicion): Borrador {
  const salida = par && tx.monto > 0 ? par : tx;
  const entrada = par && tx.monto > 0 ? tx : par;
  // Un programado futuro se confirma por defecto con la fecha de hoy; uno vencido, con su fecha programada.
  const fecha =
    tx.estado === "pendiente" && tx.fecha.slice(0, 16) > ahoraLocal() ? ahoraLocal() : tx.fecha.slice(0, 16);
  return {
    tipo: par ? "transferencia" : tx.monto > 0 ? "ingreso" : "gasto",
    monto: aTexto(tx.monto),
    descripcion: tx.descripcion,
    categoriaId: tx.categoria_id,
    cuentaId: salida.cuenta_id,
    destinoId: entrada?.cuenta_id ?? null,
    fecha,
    nota: tx.nota,
  };
}

function Vinculos({ tx }: { tx: Transaccion }) {
  const etiquetas = [
    tx.estado === "pendiente" && (tx.fecha.slice(0, 10) < hoyISO() ? "Vencido" : "Programado"),
    tx.transferencia_id && "Transferencia",
    tx.credito_id && (tx.categoria_ruta.at(-1) === "Abono a capital" ? "Abono a capital" : "Cuota de crédito"),
    tx.recurrente_id && !tx.credito_id && "Recurrente",
    tx.prestamo_id && "Préstamo personal",
    tx.etiquetas.includes("reclamo") && "En reclamo",
  ].filter(Boolean) as string[];
  if (etiquetas.length === 0) return null;
  return (
    <div className="cd-row" style={{ gap: 6 }}>
      {etiquetas.map((e) => (
        <span
          key={e}
          className={`cd-badge ${e === "Vencido" ? "cd-badge--negative" : e === "Programado" ? "cd-badge--info" : "cd-badge--neutral"}`}
        >
          {e}
        </span>
      ))}
    </div>
  );
}

export function CapturaRapida({
  tipoInicial,
  inicial,
  edicion,
  onCerrar,
}: {
  tipoInicial: TipoMovimiento;
  inicial?: Partial<Borrador>;
  edicion?: Edicion;
  onCerrar: () => void;
}) {
  const id = useId();
  const montoRef = useRef<HTMLInputElement>(null);
  const cliente = useQueryClient();
  const tx = edicion?.tx;
  const pendiente = tx?.estado === "pendiente";
  const [b, setB] = useState<Borrador>(() =>
    edicion ? desdeMovimiento(edicion) : { ...borradorVacio(tipoInicial, null), ...inicial },
  );
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const [errores, setErrores] = useState<Errores>({});
  const [verSugerencias, setVerSugerencias] = useState(false);
  const [verMas, setVerMas] = useState(Boolean(edicion?.tx.nota));
  const guardar = useGuardarMovimiento();

  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: api.cuentas });
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias, staleTime: 60_000 });
  const tipoCategorias = b.tipo === "ingreso" ? "ingreso" : "gasto";
  const frecuentes = useQuery({
    queryKey: claves.frecuentes(tipoCategorias),
    queryFn: () => api.categoriasFrecuentes(tipoCategorias),
    enabled: b.tipo !== "transferencia",
  });
  const texto = useDebounce(b.descripcion.trim(), 180);
  const sugerencias = useQuery({
    queryKey: claves.sugerencias(texto),
    queryFn: () => api.sugerencias(texto),
    enabled: texto.length >= 2,
  });

  // Cuenta por defecto: la primera (Nequi) mientras el usuario no elija otra.
  const cuentaId = b.cuentaId ?? cuentas.data?.[0]?.id ?? null;

  // Categoría sugerida (reglas → historial → diccionario): queda puesta mientras no elijas otra.
  const signo = b.tipo === "ingreso" ? 1 : -1;
  const clasificacion = useQuery({
    queryKey: claves.clasificar(texto, signo),
    queryFn: () => api.clasificar(texto, signo * (parseMonto(b.monto) || 1), cuentaId),
    enabled: b.tipo !== "transferencia",
    staleTime: 30_000,
  });
  const sugeridas = clasificacion.data ?? [];
  const sugerida = sugeridas[0];
  const categoriaFinal = b.categoriaId ?? sugerida?.categoria_id ?? null;

  // Multimoneda: un ingreso o gasto en dólares se guarda en pesos con la TRM del día (editable).
  const [usd, setUsd] = useState(false);
  const [trmTexto, setTrmTexto] = useState("");
  const trm = useQuery({
    queryKey: claves.trm(b.fecha.slice(0, 10)),
    queryFn: () => api.trm(b.fecha.slice(0, 10)),
    enabled: usd && b.tipo !== "transferencia",
    retry: false,
    staleTime: 3_600_000,
  });
  const trmUsada = Number((trmTexto || (trm.data ? String(trm.data.valor) : "")).replace(",", ".")) || 0;
  const montoUsd = usd ? (parseMonto(b.monto) ?? 0) : 0;

  useEffect(() => {
    montoRef.current?.focus();
    const alEscape = (e: globalThis.KeyboardEvent) => e.key === "Escape" && onCerrar();
    window.addEventListener("keydown", alEscape);
    return () => window.removeEventListener("keydown", alEscape);
  }, [onCerrar]);

  const cambiar = <K extends keyof Borrador>(campo: K, valor: Borrador[K]) => {
    setB((x) => ({ ...x, [campo]: valor }));
    setErrores((e) => ({ ...e, [campo]: undefined }));
  };

  const aplicarSugerencia = (s: Sugerencia) => {
    setB((x) => ({
      ...x,
      descripcion: s.descripcion,
      categoriaId: s.categoria_id ?? x.categoriaId,
      cuentaId: s.cuenta_id,
      monto: x.monto || mascaraMonto(String(Math.abs(s.monto) / 100)),
      tipo: x.tipo === "transferencia" ? x.tipo : s.monto > 0 ? "ingreso" : "gasto",
    }));
    setVerSugerencias(false);
  };

  const refrescar = () => {
    for (const k of [["transacciones"], ["cuentas"], ["dashboard"], ["calendario"], ["recurrentes"], ["creditos"]])
      void cliente.invalidateQueries({ queryKey: k });
  };
  const editar = useMutation({
    mutationFn: async (confirmar: boolean) => {
      if (!edicion) return;
      const r = validar({ ...b, cuentaId, categoriaId: categoriaFinal });
      if (!r.ok) {
        setErrores(r.errores);
        throw new Error("Revisa los campos marcados");
      }
      if (r.tipo === "transferencia") {
        const salida = edicion.par && edicion.tx.monto > 0 ? edicion.par : edicion.tx;
        const entrada = salida === edicion.tx ? edicion.par : edicion.tx;
        const { monto, fecha, descripcion, origen_id, destino_id } = r.datos;
        await api.editarTransaccion(salida.id, {
          monto: -monto,
          fecha,
          descripcion,
          cuenta_id: origen_id,
          nota: b.nota,
        });
        if (entrada && entrada.cuenta_id !== destino_id)
          await api.editarTransaccion(entrada.id, { cuenta_id: destino_id });
        return;
      }
      const { cuenta_id, monto, categoria_id, fecha, descripcion, nota } = r.datos;
      await api.editarTransaccion(edicion.tx.id, { cuenta_id, monto, categoria_id, fecha, descripcion, nota });
      if (confirmar) await api.pagarProgramada(edicion.tx.id, { fecha: fecha ?? undefined, monto });
    },
    onSuccess: (_, confirmar) => {
      const moviaFecha =
        !confirmar &&
        edicion?.tx.recurrente_id &&
        edicion.tx.estado === "programada" &&
        b.fecha.slice(8, 10) !== edicion.tx.fecha.slice(8, 10);
      if (moviaFecha) {
        toast.success("Cambió solo este pago", {
          description: "Los siguientes siguen en su día. Para moverlos todos, edita el recurrente.",
          action: { label: "Ir a Recurrentes", onClick: () => window.location.assign("/recurrentes") },
        });
      } else toast.success(confirmar ? "Pago confirmado" : "Cambios guardados");
      onCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const borrar = useMutation({
    mutationFn: () => api.eliminarTransaccion(edicion?.tx.id ?? 0),
    onSuccess: () => {
      toast(`Movimiento eliminado · ${formatoCOP(edicion?.tx.monto ?? 0, { signo: true })}`);
      onCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });

  const enviar = (seguir: boolean) => {
    if (edicion) {
      editar.mutate(pendiente);
      return;
    }
    const enDolares = usd && b.tipo !== "transferencia";
    if (enDolares && trmUsada <= 0) {
      setErrores({ monto: "Escribe la TRM para convertir a pesos" });
      return;
    }
    const r = validar({ ...b, cuentaId, categoriaId: categoriaFinal });
    if (!r.ok) {
      setErrores(r.errores);
      return;
    }
    // Mide RF-CA-05: ¿la categoría guardada es la que sugerimos?
    const origen = sugerida && categoriaFinal === sugerida.categoria_id ? "sugerida" : "usuario";
    guardar.mutate(
      r.tipo === "movimiento"
        ? {
            tipo: "movimiento",
            datos: {
              ...r.datos,
              origen_categoria: origen,
              ...(enDolares && {
                moneda_original: "USD" as const,
                monto_original: Math.sign(r.datos.monto) * montoUsd,
                trm: trmUsada,
                monto: Math.round(Math.sign(r.datos.monto) * montoUsd * trmUsada),
              }),
            },
          }
        : { tipo: "transferencia", datos: r.datos },
    );
    if (seguir) {
      setB(borradorVacio(b.tipo, cuentaId));
      montoRef.current?.focus();
    } else onCerrar();
  };

  const alEnviar = (e: FormEvent) => {
    e.preventDefault();
    enviar(false);
  };
  const alTeclear = (e: KeyboardEvent<HTMLFormElement>) => {
    if (e.key === "Enter" && e.shiftKey && !edicion) {
      e.preventDefault();
      enviar(true);
    }
  };

  const listaSugerencias = verSugerencias ? (sugerencias.data ?? []) : [];
  const vencido = pendiente && tx && tx.fecha.slice(0, 10) < hoyISO();
  const etiqueta = (campo: string, texto: string) => (
    <label htmlFor={`${id}-${campo}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
      {texto}
    </label>
  );
  const error = (campo: keyof Borrador) =>
    errores[campo] && (
      <span role="alert" style={{ fontSize: 12, fontWeight: 600, color: "var(--negative)" }}>
        {errores[campo]}
      </span>
    );

  const campoFecha = (
    <div className="cd-stack" style={{ gap: 6 }}>
      {etiqueta("fecha", pendiente ? "Fecha del pago" : "Fecha y hora")}
      <input
        id={`${id}-fecha`}
        type="datetime-local"
        className="cd-input"
        value={b.fecha}
        max={edicion ? undefined : `${hoyISO()}T23:59`}
        onChange={(e) => cambiar("fecha", e.target.value)}
      />
      {vencido && tx && (
        <div className="cd-row" style={{ gap: 6 }}>
          <button
            type="button"
            className="cd-btn cd-btn--sm cd-btn--ghost"
            aria-pressed={b.fecha === tx.fecha.slice(0, 16)}
            onClick={() => cambiar("fecha", tx.fecha.slice(0, 16))}
          >
            Programada · {fechaCorta(tx.fecha)}
          </button>
          <button
            type="button"
            className="cd-btn cd-btn--sm cd-btn--ghost"
            onClick={() => cambiar("fecha", ahoraLocal())}
          >
            Hoy
          </button>
        </div>
      )}
      {error("fecha")}
    </div>
  );

  return (
    <div className="captura-fondo" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-labelledby={`${id}-titulo`} className="captura-panel">
        <form onSubmit={alEnviar} onKeyDown={alTeclear} className="cd-stack" style={{ gap: 16 }} noValidate>
          <div className="cd-row" style={{ justifyContent: "space-between" }}>
            <h2 id={`${id}-titulo`} className="cd-card-title">
              {!edicion ? "Registrar movimiento" : pendiente ? "Confirmar pago" : "Editar movimiento"}
            </h2>
            <button
              type="button"
              className="cd-icon-btn"
              aria-label="Cerrar"
              style={{ width: 32, height: 32, border: 0 }}
              onClick={onCerrar}
            >
              <Icono nombre="cerrar" pequeno />
            </button>
          </div>

          {tx && <Vinculos tx={tx} />}

          <div
            className="cd-seg cd-seg--brand"
            role="tablist"
            aria-label="Tipo de movimiento"
            style={{ display: "flex" }}
          >
            {(["gasto", "ingreso", "transferencia"] as const).map((t) => (
              <button
                key={t}
                type="button"
                role="tab"
                aria-selected={b.tipo === t}
                // Un movimiento existente puede pasar de gasto a ingreso, pero no volverse transferencia (ni dejar de serlo).
                disabled={Boolean(edicion) && (t === "transferencia") !== (b.tipo === "transferencia")}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setB((x) => ({ ...x, tipo: t, categoriaId: null }))}
              >
                {t === "gasto" ? "Gasto" : t === "ingreso" ? "Ingreso" : "Transferir"}
              </button>
            ))}
          </div>

          <div className="cd-stack" style={{ gap: 6 }}>
            {etiqueta("monto", "Monto")}
            <div className="captura-monto">
              <span style={{ fontSize: 20, fontWeight: 600, color: "var(--ink-muted)" }}>$</span>
              <input
                id={`${id}-monto`}
                ref={montoRef}
                className="cd-num"
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                value={b.monto}
                aria-invalid={Boolean(errores.monto)}
                onChange={(e) => cambiar("monto", mascaraMonto(e.target.value))}
              />
              {b.tipo === "transferencia" || edicion ? (
                <span className="cd-badge cd-badge--neutral cd-badge--plain">COP</span>
              ) : (
                <button
                  type="button"
                  className="cd-badge cd-badge--neutral"
                  aria-pressed={usd}
                  title="Cambiar entre pesos y dólares"
                  style={{ cursor: "pointer", border: 0 }}
                  onClick={() => setUsd((x) => !x)}
                >
                  {usd ? "USD" : "COP"} ⇄
                </button>
              )}
            </div>
            {usd && b.tipo !== "transferencia" && (
              <div className="cd-row" style={{ gap: 8, flexWrap: "nowrap" }}>
                <label htmlFor={`${id}-trm`} className="cd-delta-note" style={{ whiteSpace: "nowrap" }}>
                  TRM
                </label>
                <input
                  id={`${id}-trm`}
                  className="cd-input cd-num"
                  inputMode="decimal"
                  style={{ height: 36, width: 120 }}
                  placeholder={trm.isPending ? "…" : "4.000,00"}
                  value={trmTexto || (trm.data ? String(trm.data.valor).replace(".", ",") : "")}
                  onChange={(e) => setTrmTexto(e.target.value.replace(/[^\d,]/g, ""))}
                />
                <span className="cd-delta-note cd-num">
                  {montoUsd && trmUsada ? `≈ ${formatoCOP(Math.round(montoUsd * trmUsada))}` : ""}
                  {trm.data?.aproximada && " · TRM sin actualizar"}
                </span>
              </div>
            )}
            {error("monto")}
          </div>

          <div className="cd-stack" style={{ gap: 6, position: "relative" }}>
            {etiqueta("desc", "Descripción")}
            <input
              id={`${id}-desc`}
              className="cd-input"
              autoComplete="off"
              placeholder="Ej.: Moto, Uber, almuerzo…"
              value={b.descripcion}
              role="combobox"
              aria-expanded={listaSugerencias.length > 0}
              aria-controls={`${id}-sug`}
              onChange={(e) => {
                cambiar("descripcion", e.target.value);
                setVerSugerencias(true);
              }}
              onBlur={() => setTimeout(() => setVerSugerencias(false), 150)}
            />
            {listaSugerencias.length > 0 && (
              <ul id={`${id}-sug`} role="listbox" aria-label="Sugerencias" className="cd-list captura-sugerencias">
                {listaSugerencias.map((s) => (
                  <li key={s.descripcion} role="option" aria-selected={false} style={{ padding: 0 }}>
                    <button
                      type="button"
                      className="fila-boton cd-row"
                      style={{ padding: "8px 12px", gap: 12 }}
                      onMouseDown={() => aplicarSugerencia(s)}
                    >
                      <div className="grow" style={{ flex: 1 }}>
                        {s.descripcion}
                        <small>
                          {s.categoria_ruta.slice(1).join(" › ")} · {s.cuenta} · {s.veces}{" "}
                          {s.veces === 1 ? "vez" : "veces"}
                        </small>
                      </div>
                      <span className="cd-amt">{formatoCOP(s.monto, { signo: true })}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {b.tipo !== "transferencia" && (
            <div className="cd-stack" style={{ gap: 8 }}>
              {etiqueta("cat", "Categoría")}
              <div className="cd-row" style={{ gap: 8 }} role="group" aria-label="Categorías sugeridas y frecuentes">
                {[
                  ...sugeridas.map((s, i) => ({ id: s.categoria_id, nombre: s.ruta.at(-1), sugerida: i === 0 })),
                  ...(frecuentes.data ?? [])
                    .filter((f) => !sugeridas.some((s) => s.categoria_id === f.categoria_id))
                    .map((f) => ({ id: f.categoria_id, nombre: f.ruta.at(-1), sugerida: false })),
                ]
                  .slice(0, 6)
                  .map((c) => {
                    const activa = categoriaFinal === c.id;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        aria-pressed={activa}
                        className="cd-btn cd-btn--sm"
                        title={c.sugerida ? "Sugerida a partir de tu historial y tus reglas" : undefined}
                        style={{
                          background: activa ? "var(--nav-active)" : "var(--card)",
                          color: activa ? "var(--on-nav-active)" : "var(--ink)",
                          borderColor: activa ? "var(--nav-active)" : "var(--border-strong)",
                        }}
                        onClick={() => cambiar("categoriaId", c.id)}
                      >
                        {c.sugerida && <span aria-hidden>✦</span>}
                        {c.nombre}
                        {c.sugerida && <span className="sr-only"> (sugerida)</span>}
                      </button>
                    );
                  })}
              </div>
              <SelectorCategoria
                id={`${id}-cat`}
                arbol={arbol.data ?? []}
                grupos={GRUPOS_POR_TIPO[b.tipo]}
                valor={categoriaFinal}
                sugerida={sugerida?.categoria_id}
                invalido={Boolean(errores.categoriaId)}
                alCambiar={(ident) => cambiar("categoriaId", ident)}
              />
              {error("categoriaId")}
            </div>
          )}

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 12 }}>
            <div className="cd-stack" style={{ gap: 6 }}>
              {etiqueta("cuenta", b.tipo === "transferencia" ? "Desde" : "Cuenta")}
              <SelectorCuenta
                id={`${id}-cuenta`}
                cuentas={cuentas.data ?? []}
                valor={cuentaId}
                alCambiar={(ident) => cambiar("cuentaId", ident)}
              />
              {error("cuentaId")}
            </div>
            {b.tipo === "transferencia" ? (
              <div className="cd-stack" style={{ gap: 6 }}>
                {etiqueta("destino", "Hacia")}
                <SelectorCuenta
                  id={`${id}-destino`}
                  titulo="Hacia qué cuenta"
                  cuentas={cuentas.data ?? []}
                  excluir={cuentaId}
                  valor={b.destinoId}
                  alCambiar={(ident) => cambiar("destinoId", ident)}
                />
                {error("destinoId")}
              </div>
            ) : (
              campoFecha
            )}
          </div>
          {b.tipo === "transferencia" && campoFecha}

          {verMas ? (
            <div className="cd-stack" style={{ gap: 6 }}>
              {etiqueta("nota", "Nota")}
              <input
                id={`${id}-nota`}
                className="cd-input"
                value={b.nota}
                onChange={(e) => cambiar("nota", e.target.value)}
              />
            </div>
          ) : (
            <button
              type="button"
              className="cd-link"
              style={{ border: 0, background: "none", padding: 0, alignSelf: "flex-start" }}
              onClick={() => setVerMas(true)}
            >
              <Icono nombre="mas" pequeno />
              Agregar nota
            </button>
          )}

          <div
            className="cd-row"
            style={{ justifyContent: "space-between", paddingTop: 14, borderTop: "1px solid var(--border)" }}
          >
            {edicion ? (
              confirmarBorrado ? (
                <button
                  type="button"
                  className="cd-btn"
                  style={{ background: "var(--negative)", color: "var(--card)" }}
                  disabled={borrar.isPending}
                  onClick={() => borrar.mutate()}
                >
                  {edicion.par ? "Eliminar los dos lados" : "Confirmar: eliminar"}
                </button>
              ) : (
                <button
                  type="button"
                  className="cd-icon-btn"
                  aria-label="Eliminar movimiento"
                  style={{ color: "var(--negative)" }}
                  onClick={() => setConfirmarBorrado(true)}
                >
                  <Icono nombre="basura" />
                </button>
              )
            ) : (
              <span className="cd-delta-note solo-escritorio">Enter guarda · Shift + Enter guarda y abre otro</span>
            )}
            <div className="cd-row" style={{ gap: 8, marginLeft: "auto" }}>
              {edicion ? (
                pendiente && (
                  <button
                    type="button"
                    className="cd-btn cd-btn--secondary"
                    disabled={editar.isPending}
                    onClick={() => editar.mutate(false)}
                  >
                    Guardar sin confirmar
                  </button>
                )
              ) : (
                <button type="button" className="cd-btn cd-btn--secondary" onClick={() => enviar(true)}>
                  Guardar y otro
                </button>
              )}
              <button type="submit" className="cd-btn cd-btn--primary" disabled={editar.isPending}>
                {!edicion
                  ? "Guardar"
                  : pendiente
                    ? b.tipo === "ingreso"
                      ? "Confirmar recibido"
                      : "Confirmar pago"
                    : "Guardar"}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
