/** Deudas (RF-DE): créditos con saldo del último extracto, costo real vs usura, simulador y amortización. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { useCaptura } from "@/features/captura";
import type { CreditoDetalle, Simulacion } from "@/shared/api/tipos";
import { AreaComparada, Circulo, MedioAnillo } from "@/shared/charts";
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
import { mostrarPanel } from "@/shared/lib/panel";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { DiasRestantes } from "@/shared/ui/DiasRestantes";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { ListaDensa } from "@/shared/ui/Datos";
import { CabeceraTarjeta, FilaMetricas, KpiCompacto } from "@/shared/ui/Kpi";
import { MenuAcciones } from "@/shared/ui/MenuAcciones";

import "./deudas.css";
import { AbonoUnico, CompraCartera } from "./ExtrasDeuda";
import { FormCredito } from "./FormCredito";

import { CampoFecha } from "@/shared/ui/CampoFecha";
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

/** Fila de la lista: lo necesario para comparar créditos de un vistazo. */
function FilaCredito({ c, activo, onSeleccionar }: { c: CreditoDetalle; activo: boolean; onSeleccionar: () => void }) {
  const p = c.proximo_pago;
  return (
    <li>
      <button type="button" className="fila-credito" aria-current={activo ? "true" : undefined} onClick={onSeleccionar}>
        <Circulo titulo={`Capital pagado de ${c.nombre}`} fraccion={c.avance} tamano={48} grosor={5} />
        <span className="fila-credito-nombre">
          <b>{c.nombre}</b>
          <small>
            {c.entidad} · {porcentaje(c.tasa_ea, 1)} E.A.
          </small>
        </span>
        <span className="fila-credito-proximo">
          {p?.fecha ? (
            <>
              <b className="cd-num">{formatoCOP(p.total)}</b>
              <small>
                {fechaCorta(p.fecha)} <DiasRestantes dias={diasHasta(p.fecha)} />
              </small>
            </>
          ) : (
            <small>Sin cuota programada</small>
          )}
        </span>
        <span className="fila-credito-saldo">
          <b className="cd-num">{formatoCOP(c.saldo)}</b>
          <small>pendiente</small>
        </span>
      </button>
    </li>
  );
}

type PestanaDetalle = "pagos" | "amortizacion" | "extractos";

/** Detalle de un crédito: próxima cuota con «Registrar pago», condiciones y, debajo, sus tablas. */
function PanelCredito({
  c,
  usura,
  onAccion,
  onVolver,
}: {
  c: CreditoDetalle;
  usura: number;
  onAccion: (a: Accion) => void;
  onVolver: () => void;
}) {
  const p = c.proximo_pago;
  const { abrir, abrirMovimiento } = useCaptura();
  const [pestana, setPestana] = useState<PestanaDetalle>("pagos");
  const abonar = () =>
    abrir("gasto", {
      categoriaId: c.categoria_abono_id,
      cuentaId: c.cuenta_pago_id,
      descripcion: `Abono a capital ${c.nombre}`,
    });
  return (
    <section className="panel-credito cd-stack" aria-labelledby={`credito-${c.id}`} tabIndex={-1}>
      <button type="button" className="panel-volver" onClick={onVolver}>
        ‹ Créditos
      </button>
      <div className="panel-superior">
        <div className="panel-cuota">
          <div className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
            <div>
              <p className="panel-sobre">Próxima cuota</p>
              <h2 id={`credito-${c.id}`}>{c.nombre}</h2>
            </div>
            <MenuAcciones
              etiqueta={`Acciones de ${c.nombre}`}
              acciones={[
                { texto: "Editar crédito", alElegir: () => onAccion({ tipo: "editar", credito: c }) },
                { texto: "Marcar como pagado", alElegir: () => onAccion({ tipo: "pagado", credito: c }) },
                {
                  texto: "Eliminar crédito",
                  peligro: true,
                  alElegir: () => onAccion({ tipo: "eliminar", credito: c }),
                },
              ]}
            />
          </div>
          {p ? (
            <>
              <p className="panel-monto cd-num">{formatoCOP(p.total)}</p>
              <div className="panel-desglose cd-num">
                {(
                  [
                    ["Capital", p.capital],
                    ["Interés", p.interes],
                    ["Seguro", p.seguro],
                  ] as const
                ).map(([t, v]) => (
                  <span key={t}>
                    {t}
                    <b>{formatoCOP(v)}</b>
                  </span>
                ))}
              </div>
              <div className="panel-pie">
                <span className="cd-row" style={{ gap: 6 }}>
                  {p.fecha ? `Vence el ${fechaCorta(p.fecha, true)}` : "Sin fecha programada"}
                  {p.fecha && <DiasRestantes dias={diasHasta(p.fecha)} />}
                </span>
                <span className="cd-row" style={{ gap: 6 }}>
                  <button className="cd-btn cd-btn--sm panel-secundario" onClick={abonar}>
                    Abonar a capital
                  </button>
                  <button
                    className="cd-btn cd-btn--sm cd-btn--accent"
                    onClick={() =>
                      p.transaccion_id != null
                        ? abrirMovimiento(p.transaccion_id)
                        : abrir("gasto", { cuentaId: c.cuenta_pago_id, descripcion: `Cuota ${c.nombre}` })
                    }
                  >
                    Registrar pago
                  </button>
                </span>
              </div>
            </>
          ) : (
            <p className="panel-sobre" style={{ margin: "12px 0 0" }}>
              No hay cuotas pendientes en la proyección.
            </p>
          )}
        </div>

        <div className="panel-avance">
          <MedioAnillo
            titulo={`Has pagado el ${porcentaje(c.avance, 0)} del capital`}
            fraccion={c.avance}
            tamano={180}
            grosor={16}
            detalle="del capital"
          />
          <span>
            <b>Capital pagado</b>
            <small>
              {c.cuotas_pagadas} de {c.cuotas_pagadas + c.cuotas_pendientes} cuotas
            </small>
            <small>Termina en {nombreMes(c.fecha_fin.slice(0, 7))}</small>
          </span>
        </div>
      </div>
      <dl className="panel-datos">
        <div>
          <dt>Saldo al {fechaCorta(c.fecha_saldo, true)}</dt>
          <dd className="cd-num">
            <Dinero centavos={c.saldo} decimales />
          </dd>
        </div>
        <div>
          <dt>Cuotas pagadas</dt>
          <dd className="cd-num">
            {c.cuotas_pagadas} de {c.cuotas_pagadas + c.cuotas_pendientes}
          </dd>
        </div>
        <div>
          <dt>Cuota mensual · día {c.dia_pago}</dt>
          <dd className="cd-num">{formatoCOP(c.cuota)}</dd>
        </div>
        <div>
          <dt>Tasa · usura {porcentaje(usura, 1)}</dt>
          <dd className={c.tasa_ea >= usura * 0.9 ? "texto-aviso" : undefined}>{porcentaje(c.tasa_ea)} E.A.</dd>
        </div>
        <div>
          <dt>Costo real sobre {formatoCOP(c.monto_recibido)}</dt>
          <dd>{porcentaje(c.costo_real_ea, 1)} E.A.</dd>
        </div>
        <div>
          <dt>Intereses y seguro por pagar</dt>
          <dd className="cd-num">{formatoCOP(c.intereses_por_pagar)}</dd>
        </div>
      </dl>

      <div className="cd-seg" role="tablist" aria-label="Detalle del crédito" style={{ alignSelf: "flex-start" }}>
        {(
          [
            ["pagos", "Pagos"],
            ["amortizacion", "Amortización"],
            ["extractos", "Extractos"],
          ] as const
        ).map(([v, t]) => (
          <button key={v} role="tab" aria-selected={pestana === v} onClick={() => setPestana(v)}>
            {t}
          </button>
        ))}
      </div>
      <TablasCredito id={c.id} pestana={pestana} />
    </section>
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
      <CabeceraTarjeta titulo="Historial de créditos" rango="pagados o cerrados" />
      <ListaDensa
        etiqueta="Historial de créditos"
        max={6}
        filas={cerrados.data.map((c) => ({
          clave: c.id,
          titulo: c.nombre,
          detalle: `${c.entidad} · ${fechaCorta(c.fecha_desembolso, true)}${c.ultimo_pago ? ` → ${fechaCorta(c.ultimo_pago, true)}` : ""} · recibiste ${formatoCOP(c.monto_recibido)}`,
          fin: (
            <span className="historial-fin">
              <b className="cd-num">{formatoCOP(c.total_pagado)}</b>
              {c.costo > 0 && <small className="cd-num">te costó {formatoCOP(c.costo)}</small>}
            </span>
          ),
        }))}
      />
    </section>
  );
}

function GraficoSimulacion({ s }: { s: Simulacion }) {
  const n = Math.max(s.saldos_base.length, s.saldos_con_abono.length);
  return (
    <AreaComparada
      titulo={`Saldo total mes a mes: ${s.meses_base} meses pagando solo la cuota y ${s.meses_con_abono} con el abono`}
      nombre="Con abono"
      nombreAnterior="Solo la cuota"
      alto={240}
      datos={Array.from({ length: n }, (_, i) => ({
        etiqueta: etiquetaMes(i),
        valor: s.saldos_con_abono[i] ?? 0,
        anterior: s.saldos_base[i] ?? 0,
      }))}
    />
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
    <section className="cd-card cd-stack" aria-label="Simulador de abonos" style={{ gap: 12 }}>
      <CabeceraTarjeta titulo="Simulador de abonos" rango="Cuánto antes terminas si abonas cada mes" />
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
        <>
          <FilaMetricas
            etiqueta="Resultado del simulador"
            metricas={[
              {
                etiqueta: "Terminas",
                valor: nombreMes(sim.data.fecha_fin_con_abono),
                nota: `en vez de ${nombreMes(sim.data.fecha_fin_base)}`,
              },
              { etiqueta: "Meses antes", valor: String(sim.data.meses_ahorrados), tono: "ingreso" },
              { etiqueta: "Ahorras", valor: sim.data.ahorro, nota: "intereses y seguro", tono: "ingreso" },
              { etiqueta: "Orden de pago", valor: sim.data.orden.join(" → ") },
            ]}
          />
          <GraficoSimulacion s={sim.data} />
          <p className="cd-delta-note" style={{ margin: 0 }}>
            En cada abono pide al banco <b>abono a capital</b> con <b>reducción de plazo</b>.
          </p>
        </>
      )}
    </section>
  );
}

function TablasCredito({ id, pestana }: { id: number; pestana: PestanaDetalle }) {
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
  if (pestana === "pagos")
    return d.pagos.length === 0 ? (
      <Vacio titulo="Aún no hay pagos" texto="Al registrar una cuota o un abono aparece aquí." />
    ) : (
      <div className="tabla-desplazable">
        <table className="cd-table">
          <caption className="sr-only">Pagos registrados, repartidos en capital, interés y seguro</caption>
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
    );
  if (pestana === "amortizacion")
    return (
      <div className="cd-stack" style={{ gap: 8 }}>
        <span className="cd-delta-note">Proyectada desde el extracto del {fechaCorta(d.fecha_saldo, true)}</span>
        <div className="tabla-desplazable">
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
    );
  return (
    <div className="extractos">
      <form
        className="cd-stack"
        style={{ gap: 12 }}
        onSubmit={(e) => {
          e.preventDefault();
          cargar.mutate();
        }}
      >
        <p className="cd-delta-note" style={{ margin: 0 }}>
          El extracto del banco es la fuente de verdad del saldo.
        </p>
        <label className="cd-stack campo-etiqueta">
          Fecha de corte
          <CampoFecha
            type="date"
            className="cd-input"
            value={form.fecha}
            onChange={(e) => setForm({ ...form, fecha: e.target.value })}
          />
        </label>
        <label className="cd-stack campo-etiqueta">
          Nuevo saldo
          <input
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={form.saldo}
            onChange={(e) => setForm({ ...form, saldo: mascaraMonto(e.target.value) })}
          />
        </label>
        <label className="cd-stack campo-etiqueta">
          Cuotas pendientes
          <input
            className="cd-input cd-num"
            inputMode="numeric"
            value={form.cuotas}
            onChange={(e) => setForm({ ...form, cuotas: e.target.value.replace(/\D/g, "") })}
          />
        </label>
        <button className="cd-btn cd-btn--primary" disabled={cargar.isPending} style={{ alignSelf: "flex-end" }}>
          Guardar extracto
        </button>
      </form>
      <div>
        <h3 className="cd-nav-group" style={{ padding: 0, margin: "0 0 4px" }}>
          Cargados
        </h3>
        {d.extractos.length === 0 ? (
          <span className="cd-delta-note">Aún no hay extractos.</span>
        ) : (
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
        )}
      </div>
    </div>
  );
}

type Vista = "creditos" | "comparar";

export function DeudasPage() {
  const creditos = useQuery({ queryKey: claves.creditos, queryFn: api.creditos });
  const usura = useQuery({ queryKey: ["parametros", "usura"], queryFn: api.usura, staleTime: 3_600_000 });
  // `elegido` es el que tocó la persona; sin elección, el escritorio muestra la cuota más próxima.
  const [elegido, setElegido] = useState<number | null>(null);
  const [accion, setAccion] = useState<Accion | null>(null);
  const [vista, setVista] = useState<Vista>("creditos");
  if (creditos.isPending) return <TarjetaCargando />;
  if (creditos.isError) return <ErrorVista error={creditos.error} reintentar={() => void creditos.refetch()} />;
  const lista = [...creditos.data].sort((a, b) =>
    (a.proximo_pago?.fecha ?? "9999").localeCompare(b.proximo_pago?.fecha ?? "9999"),
  );
  const total = lista.reduce((t, c) => t + c.saldo, 0);
  const cuotas = lista.reduce((t, c) => t + c.cuota, 0);
  const intereses = lista.reduce((t, c) => t + c.intereses_por_pagar, 0);
  const tasaUsura = usura.data?.consumo_bajo_monto ?? 0.6666;
  const seleccionado = lista.find((c) => c.id === elegido) ?? lista[0];
  const proxima = lista.find((c) => c.proximo_pago?.fecha);

  const kpisDeudas = (
    <div className={`deudas-kpis ${vista === "creditos" ? "en-columna" : ""}`}>
      <KpiCompacto
        inversa
        etiqueta="Capital pendiente"
        icono="deudas"
        valor={total}
        nota={`${lista.length} ${lista.length === 1 ? "crédito" : "créditos"}`}
      />
      <KpiCompacto etiqueta="Cuotas al mes" icono="calendario" valor={cuotas} nota="suma de las cuotas" />
      <KpiCompacto etiqueta="Intereses y seguro" icono="alerta" valor={intereses} nota="por pagar hasta el final" />
      <KpiCompacto
        etiqueta="Próxima cuota"
        icono="sale"
        valor={proxima?.proximo_pago?.total ?? "—"}
        nota={
          proxima?.proximo_pago?.fecha
            ? `${proxima.nombre} · ${fechaCorta(proxima.proximo_pago.fecha)}`
            : "sin cuotas programadas"
        }
      />
    </div>
  );

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
          <div className="cd-seg" role="tablist" aria-label="Vista de deudas" style={{ alignSelf: "flex-start" }}>
            <button role="tab" aria-selected={vista === "creditos"} onClick={() => setVista("creditos")}>
              Mis créditos
            </button>
            <button role="tab" aria-selected={vista === "comparar"} onClick={() => setVista("comparar")}>
              Comparar opciones
            </button>
          </div>
          {vista === "creditos" ? (
            <div className="deudas" data-detalle={elegido !== null ? "si" : "no"}>
              <div className="deudas-lista cd-stack">
                {kpisDeudas}
                <section className="cd-card">
                  <CabeceraTarjeta titulo="Tus créditos" rango="por fecha de la próxima cuota" />

                  <ul className="lista-creditos">
                    {lista.map((c) => (
                      <FilaCredito
                        key={c.id}
                        c={c}
                        activo={seleccionado?.id === c.id}
                        onSeleccionar={() => {
                          setElegido(c.id);
                          requestAnimationFrame(() => mostrarPanel(".panel-credito"));
                        }}
                      />
                    ))}
                  </ul>
                </section>
              </div>
              {seleccionado && (
                <PanelCredito
                  key={seleccionado.id}
                  c={seleccionado}
                  usura={tasaUsura}
                  onAccion={setAccion}
                  onVolver={() => setElegido(null)}
                />
              )}
            </div>
          ) : (
            <>
              {kpisDeudas}
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
        </>
      )}
      <Historial />
    </>
  );
}
