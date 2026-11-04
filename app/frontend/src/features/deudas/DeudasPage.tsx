/** Deudas (RF-DE): créditos con saldo del último extracto, costo real vs usura, simulador y amortización. */
import { rutaSuave } from "@/shared/lib/curvas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useCaptura } from "@/features/captura";
import type { CreditoDetalle, Simulacion } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import {
  diasHasta,
  fechaCorta,
  formatoCOP,
  hoyISO,
  mascaraMonto,
  nombreMes,
  parseMonto,
  porcentaje,
} from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { DiasRestantes } from "@/shared/ui/DiasRestantes";
import { Carrusel } from "@/shared/ui/Carrusel";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { MenuAcciones } from "@/shared/ui/MenuAcciones";

import { AbonoUnico, CompraCartera } from "./ExtrasDeuda";
import { FormCredito } from "./FormCredito";

type Accion =
  | { tipo: "nuevo" }
  | { tipo: "editar"; credito: CreditoDetalle }
  | { tipo: "eliminar" | "pagado"; credito: CreditoDetalle };

/** «Nov 26» para el mes `i` contado desde el actual. */
function etiquetaMes(i: number): string {
  const d = new Date();
  d.setDate(1);
  d.setMonth(d.getMonth() + i);
  return `${nombreMes(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, true)} ${String(d.getFullYear()).slice(2)}`;
}

function TarjetaCredito({
  c,
  usura,
  activo,
  onSeleccionar,
  onAccion,
}: {
  c: CreditoDetalle;
  usura: number;
  activo: boolean;
  onSeleccionar: () => void;
  onAccion: (a: Accion) => void;
}) {
  const p = c.proximo_pago;
  const { abrir, abrirMovimiento } = useCaptura();
  return (
    <article
      className="cd-card cd-stack"
      style={{ gap: 14, outline: activo ? "2px solid var(--focus-ring)" : undefined }}
    >
      <div className="cd-card-head" style={{ margin: 0 }}>
        <div>
          <h3 className="cd-card-title">{c.nombre}</h3>
          <span className="cd-delta-note">{c.entidad}</span>
        </div>
        <span className="cd-row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <span className={`cd-badge ${c.prioridad_avalancha === 1 ? "cd-badge--warning" : "cd-badge--neutral"}`}>
            {c.prioridad_avalancha === 1 ? "Prioridad 1 · más cara" : `Prioridad ${c.prioridad_avalancha}`}
          </span>
          <MenuAcciones
            etiqueta={`Acciones de ${c.nombre}`}
            acciones={[
              { texto: "Editar", alElegir: () => onAccion({ tipo: "editar", credito: c }) },
              { texto: "Marcar como pagado", alElegir: () => onAccion({ tipo: "pagado", credito: c }) },
              { texto: "Eliminar crédito", peligro: true, alElegir: () => onAccion({ tipo: "eliminar", credito: c }) },
            ]}
          />
        </span>
      </div>
      <div className="cd-stack" style={{ gap: 2 }}>
        <span className="cd-kpi-label">Saldo al {fechaCorta(c.fecha_saldo, true)}</span>
        <span style={{ fontSize: 28, lineHeight: "34px", fontWeight: 700 }}>
          <Dinero centavos={c.saldo} decimales />
        </span>
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        <div className="cd-goal-meta">
          <span>Capital pagado</span>
          <b>{porcentaje(c.avance, 0)}</b>
        </div>
        <div className="cd-progress" role="img" aria-label={`Has pagado el ${porcentaje(c.avance, 0)} del capital`}>
          <i style={{ width: `${Math.max(0, Math.min(100, c.avance * 100))}%` }} />
        </div>
      </div>
      <div className="cuotas-credito" role="group" aria-label="Cuotas">
        <span>
          <b className="cd-num">{c.cuotas_pagadas}</b>
          <small>pagadas</small>
        </span>
        <span>
          <b className="cd-num">{c.cuotas_pendientes}</b>
          <small>por pagar</small>
        </span>
        <span>
          <b className="cd-num">{c.cuotas_pagadas + c.cuotas_pendientes}</b>
          <small>en total</small>
        </span>
      </div>
      {p && (
        <div
          className="cd-stack"
          style={{ gap: 6, padding: 12, borderRadius: "var(--radius-md)", background: "var(--surface-2, var(--bg))" }}
        >
          <div className="cd-row" style={{ justifyContent: "space-between", gap: 8 }}>
            <span className="cd-kpi-label">Próximo pago{p.fecha && ` · ${fechaCorta(p.fecha)}`}</span>
            {p.fecha && <DiasRestantes dias={diasHasta(p.fecha)} />}
          </div>
          <b className="cd-num" style={{ fontSize: 20 }}>
            {formatoCOP(p.total)}
          </b>
          <div
            className="cd-delta-note cd-num"
            style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 4 }}
          >
            {(
              [
                ["Capital", p.capital],
                ["Interés", p.interes],
                ["Seguro", p.seguro],
              ] as const
            ).map(([t, v]) => (
              <span key={t} className="cd-stack" style={{ gap: 0 }}>
                {t}
                <b style={{ color: "var(--ink)" }}>{formatoCOP(v)}</b>
              </span>
            ))}
          </div>
        </div>
      )}
      <div className="cd-stack" style={{ gap: 6 }}>
        <div className="cd-goal-meta">
          <span>Tasa pactada · usura {porcentaje(usura, 1)}</span>
          <b>{porcentaje(c.tasa_ea)} E.A.</b>
        </div>
        <div
          className={`cd-progress ${c.tasa_ea >= usura * 0.9 ? "cd-progress--warn" : ""}`}
          role="img"
          aria-label={`Tasa ${porcentaje(c.tasa_ea)} frente a usura ${porcentaje(usura)}`}
        >
          <i style={{ width: `${Math.min(100, (c.tasa_ea / usura) * 100)}%` }} />
        </div>
      </div>
      <ul className="cd-list">
        <li>
          <div className="grow">
            Cuota
            <small>
              incluye seguro {formatoCOP(c.seguro_mensual)} · día {c.dia_pago}
            </small>
          </div>
          <span className="cd-amt">{formatoCOP(c.cuota)}</span>
        </li>
        <li>
          <div className="grow">
            Costo real<small>sobre los {formatoCOP(c.monto_recibido)} recibidos</small>
          </div>
          <span className="cd-amt">{porcentaje(c.costo_real_ea, 1)} E.A.</span>
        </li>
        <li>
          <div className="grow">
            Intereses y seguro por pagar<small>termina en {nombreMes(c.fecha_fin.slice(0, 7))}</small>
          </div>
          <span className="cd-amt">{formatoCOP(c.intereses_por_pagar)}</span>
        </li>
      </ul>
      <div className="cd-row" style={{ gap: 6 }}>
        {p?.transaccion_id != null && (
          <button
            className="cd-btn cd-btn--primary cd-btn--sm"
            onClick={() => p.transaccion_id && abrirMovimiento(p.transaccion_id)}
          >
            Pagué la cuota
          </button>
        )}
        <button
          className="cd-btn cd-btn--secondary cd-btn--sm"
          onClick={() =>
            abrir("gasto", {
              categoriaId: c.categoria_abono_id,
              cuentaId: c.cuenta_pago_id,
              descripcion: `Abono a capital ${c.nombre}`,
            })
          }
        >
          Abonar a capital
        </button>
        <button className="cd-btn cd-btn--ghost cd-btn--sm" aria-expanded={activo} onClick={onSeleccionar}>
          {activo ? "Ocultar detalle" : "Pagos y amortización"}
        </button>
      </div>
    </article>
  );
}

function ConfirmarCredito({
  accion,
  alCerrar,
}: {
  accion: { tipo: "eliminar" | "pagado"; credito: CreditoDetalle };
  alCerrar: () => void;
}) {
  const cliente = useQueryClient();
  const c = accion.credito;
  const eliminar = accion.tipo === "eliminar";
  const [texto, setTexto] = useState("");
  const hacer = useMutation({
    mutationFn: async () => {
      if (eliminar) {
        const r = await api.eliminarCredito(c.id);
        return `${c.nombre} eliminado con ${r.movimientos} movimientos (hay respaldo de la base)`;
      }
      const r = await api.marcarCreditoPagado(c.id);
      return `${c.nombre} quedó pagado: se quitaron ${r.programadas_quitadas} cuotas programadas`;
    },
    onSuccess: (mensaje) => {
      toast.success(mensaje);
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => {
      for (const k of [
        ["creditos"],
        ["recurrentes"],
        ["calendario"],
        ["transacciones"],
        ["cuentas"],
        ["dashboard"],
        ["categorias"],
      ])
        void cliente.invalidateQueries({ queryKey: k });
    },
  });
  return (
    <Hoja
      titulo={eliminar ? `Eliminar ${c.nombre}` : `Marcar ${c.nombre} como pagado`}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Volver
          </button>
          <button
            className={`cd-btn ${eliminar ? "cd-btn--peligro" : "cd-btn--primary"}`}
            disabled={hacer.isPending || (eliminar && texto.trim() !== c.nombre)}
            onClick={() => hacer.mutate()}
          >
            {eliminar ? "Eliminar crédito y sus movimientos" : "Marcar como pagado"}
          </button>
        </>
      }
    >
      {eliminar ? (
        <>
          <p style={{ margin: 0, fontSize: 14 }}>Se borra todo lo asociado a este crédito:</p>
          <ul className="cd-delta-note" style={{ margin: 0, paddingLeft: 18 }}>
            <li>el desembolso, las cuotas pagadas y los abonos (cambian tus saldos y el gasto de esos meses);</li>
            <li>las cuotas programadas y su pago recurrente;</li>
            <li>los extractos cargados y su categoría, si nada más la usa.</li>
          </ul>
          <p className="cd-delta-note" style={{ margin: 0 }}>
            Antes se guarda un respaldo de la base. Escribe <b>{c.nombre}</b> para confirmar.
          </p>
          <input
            className="cd-input"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            aria-label="Nombre del crédito"
          />
        </>
      ) : (
        <p className="cd-delta-note" style={{ margin: 0 }}>
          El crédito pasa al historial aunque el saldo calculado sea {formatoCOP(c.saldo)}. Los pagos que ya hiciste se
          conservan; se quitan las cuotas programadas y se cancela su pago recurrente.
        </p>
      )}
    </Hoja>
  );
}

function Historial() {
  const cerrados = useQuery({ queryKey: [...claves.creditos, "cerrados"], queryFn: api.creditosCerrados });
  if (!cerrados.data?.length) return null;
  return (
    <section className="cd-card">
      <div className="cd-card-head">
        <h3 className="cd-card-title">Historial de créditos</h3>
        <span className="cd-delta-note">pagados o cerrados</span>
      </div>
      <ul className="cd-list">
        {cerrados.data.map((c) => (
          <li key={c.id}>
            <div className="grow">
              {c.nombre}
              <small>
                {c.entidad} · {fechaCorta(c.fecha_desembolso, true)}
                {c.ultimo_pago && ` → ${fechaCorta(c.ultimo_pago, true)}`} · recibiste {formatoCOP(c.monto_recibido)}
              </small>
            </div>
            <span className="cd-stack" style={{ alignItems: "flex-end", gap: 0 }}>
              <span className="cd-amt">{formatoCOP(c.total_pagado)} pagados</span>
              {c.costo > 0 && <span className="cd-delta-note cd-num">te costó {formatoCOP(c.costo)}</span>}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function GraficoSimulacion({ s }: { s: Simulacion }) {
  const n = Math.max(s.saldos_base.length, 2);
  const maximo = Math.max(1, ...s.saldos_base);
  const x = (i: number) => 50 + (i / (n - 1)) * 580;
  const y = (v: number) => 190 - (v / maximo) * 170;
  const paso = Math.max(1, Math.ceil((n - 1) / 6));
  const marcas = Array.from({ length: Math.floor((n - 1) / paso) + 1 }, (_, k) => k * paso);
  const linea = (serie: number[]) => rutaSuave(serie.map((v, i): [number, number] => [x(i), y(v)]));
  const area = `${linea(s.saldos_con_abono)} L${x(s.saldos_con_abono.length - 1).toFixed(1)} 190 L50 190 Z`;
  return (
    <svg
      className="cd-chart"
      viewBox="0 0 640 222"
      role="img"
      aria-label={`Saldo total mes a mes: ${s.meses_base} meses pagando solo la cuota y ${s.meses_con_abono} con el abono`}
    >
      <line className="grid" x1="44" x2="640" y1="20" y2="20" />
      <line className="grid" x1="44" x2="640" y1="190" y2="190" />
      <text x="40" y="24" textAnchor="end">
        {formatoCOP(maximo).replace("$ ", "")}
      </text>
      <text x="40" y="194" textAnchor="end">
        0
      </text>
      {marcas.map((i) => (
        <text key={i} x={x(i)} y="212" textAnchor={i === 0 ? "start" : "middle"}>
          {etiquetaMes(i)}
        </text>
      ))}
      <path className="area1" d={area} />
      <path className="l3" d={linea(s.saldos_base)} />
      <path className="l1" d={linea(s.saldos_con_abono)} />
    </svg>
  );
}

function Simulador() {
  const [texto, setTexto] = useState("50.000");
  const [estrategia, setEstrategia] = useState<"avalancha" | "bola_de_nieve">("avalancha");
  const extra = useDebounce(parseMonto(texto) ?? 0, 350);
  const sim = useQuery({
    queryKey: claves.simulacion(extra, estrategia),
    queryFn: () => api.simulacion(extra, estrategia),
    placeholderData: (p) => p,
  });
  return (
    <section className="cd-card cd-stack" aria-label="Simulador de abonos" style={{ gap: 16 }}>
      <div className="cd-card-head" style={{ margin: 0 }}>
        <h3 className="cd-card-title">Simulador de abonos</h3>
        <div className="cd-legend">
          <span>
            <i className="cd-sw c1" />
            Con abono
          </span>
          <span>
            <i className="cd-sw c3" />
            Solo la cuota
          </span>
        </div>
      </div>
      <div className="cd-row">
        <label className="cd-select cd-num" style={{ height: 40, gap: 6 }}>
          <span className="cd-muted">Abono extra / mes $</span>
          <input
            aria-label="Abono extra mensual"
            inputMode="decimal"
            value={texto}
            onChange={(e) => setTexto(mascaraMonto(e.target.value))}
            style={{
              width: 100,
              border: 0,
              outline: "none",
              background: "transparent",
              color: "var(--ink)",
              font: "700 15px var(--font-sans)",
            }}
          />
        </label>
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Estrategia">
          <button
            role="radio"
            aria-checked={estrategia === "avalancha"}
            aria-selected={estrategia === "avalancha"}
            onClick={() => setEstrategia("avalancha")}
          >
            Avalancha
          </button>
          <button
            role="radio"
            aria-checked={estrategia === "bola_de_nieve"}
            aria-selected={estrategia === "bola_de_nieve"}
            onClick={() => setEstrategia("bola_de_nieve")}
          >
            Bola de nieve
          </button>
        </div>
      </div>
      {sim.isError && <ErrorVista error={sim.error} />}
      {sim.data && (
        <div className="simulador-cuerpo">
          <div className="cd-stack" style={{ gap: 12 }}>
            <ul
              className="cd-list"
              style={{ padding: "4px 16px", borderRadius: "var(--radius-md)", background: "var(--positive-soft)" }}
            >
              <li>
                <div className="grow">
                  Terminas
                  <small>
                    {nombreMes(sim.data.fecha_fin_con_abono)} en lugar de {nombreMes(sim.data.fecha_fin_base)}
                  </small>
                </div>
                <span className="cd-amt" style={{ color: "var(--positive)" }}>
                  {sim.data.meses_ahorrados} meses antes
                </span>
              </li>
              <li>
                <div className="grow">
                  Ahorras<small>intereses y seguro</small>
                </div>
                <span className="cd-amt" style={{ color: "var(--positive)" }}>
                  {formatoCOP(sim.data.ahorro)}
                </span>
              </li>
              <li>
                <div className="grow">Orden de pago</div>
                <span className="cd-amt">{sim.data.orden.join(" → ")}</span>
              </li>
            </ul>
            <p className="cd-delta-note" style={{ margin: 0 }}>
              En cada abono pide al banco <b>abono a capital</b> con <b>reducción de plazo</b>.
            </p>
          </div>
          <GraficoSimulacion s={sim.data} />
        </div>
      )}
    </section>
  );
}

function DetalleCredito({ id }: { id: number }) {
  const cliente = useQueryClient();
  const datos = useQuery({ queryKey: claves.amortizacion(id), queryFn: () => api.amortizacion(id) });
  const [form, setForm] = useState({ fecha: hoyISO(), saldo: "", cuotas: "" });
  const cargar = useMutation({
    mutationFn: () => {
      const saldo = parseMonto(form.saldo);
      if (saldo === null) throw new Error("Escribe el saldo del extracto");
      return api.cargarExtracto(id, { fecha_corte: form.fecha, saldo, cuotas_pendientes: Number(form.cuotas) || 0 });
    },
    onSuccess: () => {
      toast.success("Extracto cargado: la proyección se recalculó desde ese saldo");
      setForm({ fecha: hoyISO(), saldo: "", cuotas: "" });
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: claves.creditos }),
  });
  if (datos.isPending) return <TarjetaCargando filas={6} />;
  if (datos.isError) return <ErrorVista error={datos.error} reintentar={() => void datos.refetch()} />;
  const d = datos.data;
  return (
    <div className="cd-bento">
      <section className="cd-card span-8 cd-stack" style={{ gap: 20 }}>
        <div>
          <div className="cd-card-head">
            <h3 className="cd-card-title">Pagos registrados · {d.nombre}</h3>
            <span className="cd-delta-note">cada pago repartido en capital, interés y seguro</span>
          </div>
          {d.pagos.length === 0 ? (
            <Vacio titulo="Aún no hay pagos" texto="Al marcar una cuota o un abono aparece aquí." />
          ) : (
            <div style={{ overflowX: "auto", maxHeight: 320 }}>
              <table className="cd-table">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Pagado</th>
                    <th>Capital</th>
                    <th>Interés</th>
                    <th>Seguro</th>
                    <th>Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {[...d.pagos].reverse().map((p) => (
                    <tr key={p.transaccion_id}>
                      <td className="cd-muted">{fechaCorta(p.fecha, true)}</td>
                      <td>{p.tipo === "abono" ? "Abono" : "Cuota"}</td>
                      <td className="cd-amt">{formatoCOP(p.monto)}</td>
                      <td className="cd-amt">{formatoCOP(p.capital)}</td>
                      <td className="cd-amt">{formatoCOP(p.interes)}</td>
                      <td className="cd-amt cd-muted">{formatoCOP(p.seguro)}</td>
                      <td className="cd-amt">{formatoCOP(p.saldo_despues)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
        <div>
          <div className="cd-card-head">
            <h3 className="cd-card-title">Amortización proyectada · {d.nombre}</h3>
            <span className="cd-delta-note">desde el extracto del {fechaCorta(d.fecha_saldo, true)}</span>
          </div>
          <div style={{ overflowX: "auto", maxHeight: 420 }}>
            <table className="cd-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Fecha</th>
                  <th>Interés</th>
                  <th>Seguro</th>
                  <th>Capital</th>
                  <th>Saldo</th>
                </tr>
              </thead>
              <tbody>
                {d.tabla.map((f) => (
                  <tr key={f.numero}>
                    <td className="cd-num">{f.numero}</td>
                    <td className="cd-muted">{fechaCorta(f.fecha, true)}</td>
                    <td className="cd-amt">{formatoCOP(f.interes)}</td>
                    <td className="cd-amt cd-muted">{formatoCOP(f.seguro)}</td>
                    <td className="cd-amt">{formatoCOP(f.capital)}</td>
                    <td className="cd-amt">{formatoCOP(f.saldo)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>
      <section className="cd-card span-4 cd-stack" style={{ gap: 14, alignSelf: "start" }}>
        <h3 className="cd-card-title">Cargar extracto</h3>
        <p className="cd-delta-note" style={{ margin: 0 }}>
          El extracto del banco es la fuente de verdad del saldo.
        </p>
        <label className="cd-stack" style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
          Fecha de corte
          <input
            type="date"
            className="cd-input"
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
          />
        </label>
        <label className="cd-stack" style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
          Nuevo saldo
          <input
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={form.saldo}
            onChange={(e) => setForm({ ...form, saldo: mascaraMonto(e.target.value) })}
          />
        </label>
        <label className="cd-stack" style={{ gap: 6, fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
          Cuotas pendientes
          <input
            className="cd-input cd-num"
            inputMode="numeric"
            value={form.cuotas}
            onChange={(e) => setForm({ ...form, cuotas: e.target.value.replace(/\D/g, "") })}
          />
        </label>
        <button className="cd-btn cd-btn--primary" disabled={cargar.isPending} onClick={() => cargar.mutate()}>
          Guardar extracto
        </button>
        <h4 className="cd-nav-group" style={{ padding: 0, margin: "8px 0 0" }}>
          Historial
        </h4>
        <ul className="cd-list">
          {d.extractos.map((e) => (
            <li key={e.fecha_corte}>
              <div className="grow">
                {fechaCorta(e.fecha_corte, true)}
                <small>{e.cuotas_pendientes} cuotas pendientes</small>
              </div>
              <span className="cd-amt">{formatoCOP(e.saldo)}</span>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

export function DeudasPage() {
  const creditos = useQuery({ queryKey: claves.creditos, queryFn: api.creditos });
  const usura = useQuery({ queryKey: ["parametros", "usura"], queryFn: api.usura, staleTime: 3_600_000 });
  const [seleccionado, setSeleccionado] = useState<number | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  if (creditos.isPending) return <TarjetaCargando />;
  if (creditos.isError) return <ErrorVista error={creditos.error} reintentar={() => void creditos.refetch()} />;
  const lista = creditos.data;
  const total = lista.reduce((t, c) => t + c.saldo, 0);
  const cuotas = lista.reduce((t, c) => t + c.cuota, 0);
  const intereses = lista.reduce((t, c) => t + c.intereses_por_pagar, 0);
  const tasaUsura = usura.data?.consumo_bajo_monto ?? 0.6666;
  const capitalInicial = lista.reduce((t, c) => t + c.capital_inicial, 0);
  const avance = capitalInicial ? 1 - total / capitalInicial : 0;
  const costoMes = lista.reduce((t, c) => t + (c.proximo_pago ? c.proximo_pago.interes + c.proximo_pago.seguro : 0), 0);
  const proxima = lista
    .filter((c) => c.proximo_pago?.fecha)
    .map((c) => ({ nombre: c.nombre, fecha: c.proximo_pago?.fecha ?? "" }))
    .sort((a, b) => a.fecha.localeCompare(b.fecha))[0];

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Deudas</h1>
          <p>Saldos según tus extractos. Abona primero a la de mayor tasa (avalancha).</p>
        </div>
        <button className="cd-btn cd-btn--primary" onClick={() => setAccion({ tipo: "nuevo" })}>
          + Crédito
        </button>
      </div>
      {accion?.tipo === "nuevo" && <FormCredito credito={null} alCerrar={() => setAccion(null)} />}
      {accion?.tipo === "editar" && <FormCredito credito={accion.credito} alCerrar={() => setAccion(null)} />}
      {(accion?.tipo === "eliminar" || accion?.tipo === "pagado") && (
        <ConfirmarCredito
          key={`${accion.tipo}-${accion.credito.id}`}
          accion={accion}
          alCerrar={() => setAccion(null)}
        />
      )}
      {lista.length === 0 ? (
        <section className="cd-card">
          <Vacio titulo="No tienes créditos activos" />
        </section>
      ) : (
        <>
          <div className="cd-bento">
            <div className="span-3 cd-balance">
              <div className="cd-balance-top">
                <span className="cd-balance-label">Deuda total</span>
                <span className="cd-chip-glass">{lista.length} créditos</span>
              </div>
              <div className="cd-balance-value">
                <Dinero centavos={total} />
              </div>
              <div className="cd-balance-foot">
                <span style={{ opacity: 0.85 }}>{formatoCOP(intereses)} en intereses y seguro por pagar</span>
              </div>
            </div>
            <div className="cd-card cd-kpi span-3">
              <span className="cd-kpi-label">Cuotas al mes</span>
              <span className="cd-kpi-value">
                <Dinero centavos={cuotas} />
              </span>
              <span className="cd-delta-note">
                {proxima ? `la próxima: ${proxima.nombre} el ${fechaCorta(proxima.fecha)}` : "sin cuotas programadas"}
              </span>
            </div>
            <div className="cd-card cd-kpi span-3">
              <span className="cd-kpi-label">Capital pagado</span>
              <span className="cd-kpi-value">{porcentaje(avance, 0)}</span>
              <div className="cd-progress" role="img" aria-label={`Has pagado el ${porcentaje(avance, 0)} del capital`}>
                <i style={{ width: `${Math.max(0, Math.min(100, avance * 100))}%` }} />
              </div>
              <span className="cd-delta-note">de {formatoCOP(capitalInicial)} prestados</span>
            </div>
            <div className="cd-card cd-kpi span-3">
              <span className="cd-kpi-label">Costo de este mes</span>
              <span className="cd-kpi-value">
                <Dinero centavos={costoMes} />
              </span>
              <span className="cd-delta-note">
                intereses y seguro de las próximas cuotas · {porcentaje(cuotas ? costoMes / cuotas : 0, 0)} de lo que
                pagas
              </span>
            </div>
          </div>
          <Carrusel etiqueta="Tus créditos">
            {lista.map((c) => (
              <div key={c.id}>
                <TarjetaCredito
                  c={c}
                  usura={tasaUsura}
                  activo={seleccionado === c.id}
                  onSeleccionar={() => setSeleccionado(seleccionado === c.id ? null : c.id)}
                  onAccion={setAccion}
                />
              </div>
            ))}
          </Carrusel>
          {seleccionado !== null && <DetalleCredito id={seleccionado} />}
          <Simulador />
          <div className="cd-bento">
            <div className="span-6">
              <AbonoUnico creditos={lista} />
            </div>
            <div className="span-6">
              <CompraCartera />
            </div>
          </div>
        </>
      )}
      <Historial />
    </>
  );
}
