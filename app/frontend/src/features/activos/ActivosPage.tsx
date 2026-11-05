/** Activos e inversiones: cuánto vale lo que tienes, cuánto pusiste y cuánto ganaste. Aportar o vender mueve dinero
 * entre una cuenta y el activo, así que no cuenta como gasto ni como ingreso. La app informa; no recomienda productos
 * ni ejecuta operaciones. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Activo, ActivoNuevo, MovimientoActivo, TipoMovimientoActivo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { rutaSuave } from "@/shared/lib/curvas";
import {
  abreviar,
  fechaCorta,
  formatoCOP,
  hoyISO,
  mascaraMonto,
  nombreMes,
  parseMonto,
  porcentaje,
} from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { DiasRestantes } from "@/shared/ui/DiasRestantes";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { MenuAcciones } from "@/shared/ui/MenuAcciones";
import { SensorContinuo, TooltipGrafico, ZonaGrafico } from "@/shared/ui/TooltipGrafico";

const CLASES: Record<string, string> = {
  cdt: "CDT",
  fondo: "Fondo",
  acciones: "Acciones o ETF",
  cripto: "Cripto",
  cesantias_pension: "Cesantías o pensión",
  inmueble: "Inmueble",
  vehiculo: "Vehículo",
  negocio: "Negocio",
  otro: "Otro",
};
const SERIES = ["c1", "c2", "c3", "c4", "c5", "c6"] as const;
const TITULOS: Record<TipoMovimientoActivo, string> = {
  aporte: "Aportar",
  retiro: "Retirar",
  rendimiento: "Registrar rendimiento",
  venta: "Vender",
};
const NOMBRE_TIPO: Record<TipoMovimientoActivo, string> = {
  aporte: "Aporte",
  retiro: "Retiro",
  rendimiento: "Rendimiento",
  venta: "Venta",
};
const AYUDA: Record<TipoMovimientoActivo, string> = {
  aporte: "Sale de la cuenta y sube el valor del activo. No cuenta como gasto.",
  retiro: "Entra a la cuenta y baja el valor del activo. No cuenta como ingreso.",
  rendimiento: "Si llega a una cuenta es un ingreso. Si se reinvirtió, solo sube el valor del activo.",
  venta: "El dinero entra a la cuenta y el activo pasa a vendidos. La ganancia se calcula aparte.",
};
const etiqueta = { fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" } as const;

function useGuardar<T>(accion: (d: T) => Promise<unknown>, mensaje: string, alCerrar: () => void) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: accion,
    onSuccess: () => {
      toast.success(mensaje);
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries(),
  });
}

function SelectorDeCuenta({
  valor,
  alCambiar,
  vacio,
}: {
  valor: number | null;
  alCambiar: (v: number | null) => void;
  vacio?: string;
}) {
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas() });
  return (
    <select
      className="cd-input"
      value={valor ?? ""}
      onChange={(e) => alCambiar(e.target.value ? Number(e.target.value) : null)}
    >
      {vacio && <option value="">{vacio}</option>}
      {!vacio && valor === null && <option value="">Elige una cuenta</option>}
      {(cuentas.data ?? []).map((c) => (
        <option key={c.id} value={c.id}>
          {c.nombre}
        </option>
      ))}
    </select>
  );
}

function FormActivo({ activo, alCerrar }: { activo: Activo | null; alCerrar: () => void }) {
  const [f, setF] = useState({
    nombre: activo?.nombre ?? "",
    clase: activo?.clase ?? "cdt",
    moneda: (activo?.moneda ?? "COP") as "COP" | "USD",
    fecha: activo?.fecha_compra ?? hoyISO(),
    costo: "",
    valor: "",
    cuenta: null as number | null,
    tasa: activo?.tasa_ea ? String(Math.round(activo.tasa_ea * 10000) / 100).replace(".", ",") : "",
    vencimiento: activo?.vencimiento ?? "",
    nota: activo?.nota ?? "",
  });
  const guardar = useGuardar(
    async () => {
      if (!f.nombre.trim()) throw new Error("Escribe el nombre del activo");
      const tasa = f.tasa.trim() ? Number(f.tasa.replace(",", ".")) / 100 : null;
      if (tasa !== null && !Number.isFinite(tasa)) throw new Error("Escribe la tasa como un número, por ejemplo 9,5");
      const comunes = {
        nombre: f.nombre.trim(),
        clase: f.clase,
        tasa_ea: tasa,
        vencimiento: f.vencimiento || null,
        nota: f.nota.trim(),
      };
      if (activo) {
        await api.editarActivo(activo.id, comunes);
        return;
      }
      const nuevo: ActivoNuevo = {
        ...comunes,
        moneda: f.moneda,
        fecha_compra: f.fecha,
        costo: parseMonto(f.costo) ?? 0,
        valor_actual: f.valor.trim() ? parseMonto(f.valor) : null,
        cuenta_id: f.cuenta,
      };
      await api.crearActivo(nuevo);
    },
    activo ? "Activo actualizado" : "Activo creado",
    alCerrar,
  );
  return (
    <Hoja
      titulo={activo ? `Editar ${activo.nombre}` : "Nuevo activo"}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="cd-btn cd-btn--primary"
            disabled={guardar.isPending}
            onClick={() => guardar.mutate(undefined)}
          >
            {activo ? "Guardar cambios" : "Crear activo"}
          </button>
        </>
      }
    >
      <label className="cd-stack" style={{ gap: 6 }}>
        <span style={etiqueta}>Nombre</span>
        <input
          className="cd-input"
          maxLength={120}
          value={f.nombre}
          onChange={(e) => setF({ ...f, nombre: e.target.value })}
        />
      </label>
      <div className="activos-doble">
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Clase</span>
          <select className="cd-input" value={f.clase} onChange={(e) => setF({ ...f, clase: e.target.value })}>
            {Object.entries(CLASES).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        {!activo && (
          <label className="cd-stack" style={{ gap: 6 }}>
            <span style={etiqueta}>Moneda del valor</span>
            <select
              className="cd-input"
              value={f.moneda}
              onChange={(e) => setF({ ...f, moneda: e.target.value as "COP" | "USD" })}
            >
              <option value="COP">Pesos (COP)</option>
              <option value="USD">Dólares (USD)</option>
            </select>
          </label>
        )}
      </div>
      {!activo && (
        <>
          <div className="activos-doble">
            <label className="cd-stack" style={{ gap: 6 }}>
              <span style={etiqueta}>Fecha de compra</span>
              <input
                className="cd-input"
                type="date"
                max={hoyISO()}
                value={f.fecha}
                onChange={(e) => setF({ ...f, fecha: e.target.value })}
              />
            </label>
            <label className="cd-stack" style={{ gap: 6 }}>
              <span style={etiqueta}>Lo que pagaste (pesos)</span>
              <input
                className="cd-input cd-num"
                inputMode="decimal"
                placeholder="$ 0"
                value={f.costo}
                onChange={(e) => setF({ ...f, costo: mascaraMonto(e.target.value) })}
              />
            </label>
          </div>
          <label className="cd-stack" style={{ gap: 6 }}>
            <span style={etiqueta}>Cuánto vale hoy ({f.moneda}, opcional)</span>
            <input
              className="cd-input cd-num"
              inputMode="decimal"
              placeholder="Igual a lo que pagaste"
              value={f.valor}
              onChange={(e) => setF({ ...f, valor: mascaraMonto(e.target.value) })}
            />
          </label>
          <label className="cd-stack" style={{ gap: 6 }}>
            <span style={etiqueta}>¿De dónde salió el dinero?</span>
            <SelectorDeCuenta
              valor={f.cuenta}
              alCambiar={(cuenta) => setF({ ...f, cuenta })}
              vacio="Ya lo tenía: no mover ninguna cuenta"
            />
          </label>
        </>
      )}
      <div className="activos-doble">
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Tasa E.A. % (opcional)</span>
          <input
            className="cd-input cd-num"
            inputMode="decimal"
            value={f.tasa}
            onChange={(e) => setF({ ...f, tasa: e.target.value })}
          />
        </label>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Vencimiento (opcional)</span>
          <input
            className="cd-input"
            type="date"
            value={f.vencimiento}
            onChange={(e) => setF({ ...f, vencimiento: e.target.value })}
          />
        </label>
      </div>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span style={etiqueta}>Nota (opcional)</span>
        <input
          className="cd-input"
          maxLength={300}
          value={f.nota}
          onChange={(e) => setF({ ...f, nota: e.target.value })}
        />
      </label>
    </Hoja>
  );
}

function FormMovimiento({
  activo,
  tipo,
  alCerrar,
}: {
  activo: Activo;
  tipo: TipoMovimientoActivo;
  alCerrar: () => void;
}) {
  const [monto, setMonto] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const [cuenta, setCuenta] = useState<number | null>(null);
  const guardar = useGuardar(
    async () => {
      const valor = parseMonto(monto);
      if (!valor) throw new Error("Escribe el monto");
      if ((tipo === "retiro" || tipo === "venta") && cuenta === null) throw new Error("Elige la cuenta que recibe");
      await api.moverActivo(activo.id, { tipo, monto: valor, fecha, cuenta_id: cuenta });
    },
    `${NOMBRE_TIPO[tipo]} registrado`,
    alCerrar,
  );
  return (
    <Hoja
      titulo={`${TITULOS[tipo]}: ${activo.nombre}`}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="cd-btn cd-btn--primary"
            disabled={guardar.isPending}
            onClick={() => guardar.mutate(undefined)}
          >
            Registrar
          </button>
        </>
      }
    >
      <p className="cd-delta-note" style={{ margin: 0 }}>
        {AYUDA[tipo]}
      </p>
      <div className="activos-doble">
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Monto en pesos</span>
          <input
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={monto}
            onChange={(e) => setMonto(mascaraMonto(e.target.value))}
          />
        </label>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Fecha</span>
          <input
            className="cd-input"
            type="date"
            max={hoyISO()}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
      </div>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span style={etiqueta}>{tipo === "aporte" ? "Cuenta de donde sale" : "Cuenta que recibe"}</span>
        <SelectorDeCuenta
          valor={cuenta}
          alCambiar={setCuenta}
          vacio={
            tipo === "aporte"
              ? "No mover ninguna cuenta"
              : tipo === "rendimiento"
                ? "Se reinvirtió: no llegó a ninguna cuenta"
                : undefined
          }
        />
      </label>
    </Hoja>
  );
}

function FormValor({ activo, alCerrar }: { activo: Activo; alCerrar: () => void }) {
  const [valor, setValor] = useState("");
  const [fecha, setFecha] = useState(hoyISO());
  const guardar = useGuardar(
    async () => {
      const v = parseMonto(valor);
      if (v === null) throw new Error("Escribe cuánto vale");
      await api.valorarActivo(activo.id, fecha, v);
    },
    "Valor actualizado",
    alCerrar,
  );
  return (
    <Hoja
      titulo={`Actualizar valor: ${activo.nombre}`}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="cd-btn cd-btn--primary"
            disabled={guardar.isPending}
            onClick={() => guardar.mutate(undefined)}
          >
            Guardar valor
          </button>
        </>
      }
    >
      <p className="cd-delta-note" style={{ margin: 0 }}>
        No mueve dinero. La diferencia aparece como ganancia o pérdida, no como ingreso ni gasto.
      </p>
      <div className="activos-doble">
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Cuánto vale ({activo.moneda})</span>
          <input
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={valor}
            onChange={(e) => setValor(mascaraMonto(e.target.value))}
          />
        </label>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Fecha</span>
          <input
            className="cd-input"
            type="date"
            max={hoyISO()}
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
      </div>
    </Hoja>
  );
}

function Confirmar({
  titulo,
  texto,
  accion,
  alConfirmar,
  alCerrar,
}: {
  titulo: string;
  texto: string;
  accion: string;
  alConfirmar: () => Promise<unknown>;
  alCerrar: () => void;
}) {
  const hacer = useGuardar(alConfirmar, "Listo", alCerrar);
  return (
    <Hoja
      titulo={titulo}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--peligro" disabled={hacer.isPending} onClick={() => hacer.mutate(undefined)}>
            {accion}
          </button>
        </>
      }
    >
      <p className="cd-delta-note" style={{ margin: 0 }}>
        {texto}
      </p>
    </Hoja>
  );
}

type Dialogo =
  | { tipo: "nuevo" }
  | { tipo: "editar" | "valor" | "eliminar"; activo: Activo }
  | { tipo: "mover"; activo: Activo; mov: TipoMovimientoActivo }
  | { tipo: "deshacer"; activo: Activo; mov: MovimientoActivo };

function TarjetaActivo({ a, abrir }: { a: Activo; abrir: (d: Dialogo) => void }) {
  const [detalle, setDetalle] = useState(false);
  const vendido = a.estado === "vendido";
  const acciones = vendido
    ? [{ texto: "Editar datos", alElegir: () => abrir({ tipo: "editar", activo: a }) }]
    : [
        { texto: "Actualizar valor", alElegir: () => abrir({ tipo: "valor", activo: a }) },
        { texto: "Aportar", alElegir: () => abrir({ tipo: "mover", activo: a, mov: "aporte" as const }) },
        { texto: "Retirar", alElegir: () => abrir({ tipo: "mover", activo: a, mov: "retiro" as const }) },
        {
          texto: "Registrar rendimiento",
          alElegir: () => abrir({ tipo: "mover", activo: a, mov: "rendimiento" as const }),
        },
        { texto: "Vender", alElegir: () => abrir({ tipo: "mover", activo: a, mov: "venta" as const }) },
        { texto: "Editar datos", alElegir: () => abrir({ tipo: "editar", activo: a }) },
      ];
  return (
    <article className="cd-card cd-stack activo-tarjeta" style={{ gap: 10, opacity: vendido ? 0.75 : 1 }}>
      <div className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
        <div className="cd-stack" style={{ gap: 2, minWidth: 0 }}>
          <b>{a.nombre}</b>
          <span className="cd-delta-note">
            {a.clase_nombre}
            {a.tasa_ea ? ` · ${porcentaje(a.tasa_ea, 2)} E.A.` : ""}
            {vendido ? " · Vendido" : ""}
          </span>
        </div>
        <MenuAcciones
          acciones={[
            ...acciones,
            { texto: "Eliminar", peligro: true, alElegir: () => abrir({ tipo: "eliminar", activo: a }) },
          ]}
        />
      </div>
      <div className="cd-kpi-value" style={{ fontSize: 24, lineHeight: "30px" }}>
        <Dinero centavos={a.valor_cop} />
      </div>
      {a.moneda === "USD" && (
        <span className="cd-delta-note cd-num">
          US$ {(a.valor / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} con la última TRM
        </span>
      )}
      <dl className="activo-cifras">
        <div>
          <dt>Aportado</dt>
          <dd className="cd-num">{formatoCOP(a.aportado)}</dd>
        </div>
        <div>
          <dt>Ganancia</dt>
          <dd className="cd-num" style={{ color: a.ganancia < 0 ? "var(--negative)" : "var(--positive)" }}>
            {formatoCOP(a.ganancia, { signo: true })}
          </dd>
        </div>
        <div>
          <dt>Rentabilidad</dt>
          <dd className="cd-num">{a.tir === null ? "—" : `${porcentaje(a.tir, 1)} E.A.`}</dd>
        </div>
      </dl>
      <div className="cd-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="cd-row" style={{ gap: 8 }}>
          {a.dias_para_vencer !== null && !vendido && <DiasRestantes dias={a.dias_para_vencer} />}
          {a.valorado_en && <span className="cd-delta-note">Valor del {fechaCorta(a.valorado_en, true)}</span>}
        </span>
        <button
          className="cd-btn cd-btn--ghost cd-btn--sm"
          aria-expanded={detalle}
          onClick={() => setDetalle((d) => !d)}
        >
          {detalle ? "Ocultar movimientos" : `Movimientos (${a.movimientos.length})`}
        </button>
      </div>
      {detalle && (
        <ul className="cd-list" style={{ margin: 0 }}>
          {a.movimientos.length === 0 && <li className="cd-delta-note">Sin movimientos.</li>}
          {[...a.movimientos].reverse().map((m) => (
            <li key={m.id} className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
              <span className="grow">
                {NOMBRE_TIPO[m.tipo]}
                <small>
                  {fechaCorta(m.fecha, true)}
                  {m.con_cuenta ? "" : " · sin mover cuentas"}
                </small>
              </span>
              <span className="cd-amt">{formatoCOP(m.monto)}</span>
              <button
                className="cd-btn cd-btn--ghost cd-btn--sm"
                onClick={() => abrir({ tipo: "deshacer", activo: a, mov: m })}
              >
                Deshacer
              </button>
            </li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Evolucion() {
  const datos = useQuery({ queryKey: claves.patrimonio, queryFn: () => api.patrimonio() });
  const [activo, setActivo] = useState<number | null>(null);
  const primero = (datos.data?.puntos ?? []).findIndex((p) => p.activos > 0);
  const puntos = primero < 0 ? [] : (datos.data?.puntos ?? []).slice(primero);
  if (puntos.length < 2) return null;
  const W = 640;
  const max = Math.max(1, ...puntos.map((p) => p.activos));
  const xs = puntos.map((_, i) => 48 + (i / (puntos.length - 1)) * (W - 58));
  const y = (v: number) => 170 - (v / max) * 150;
  const linea = rutaSuave(puntos.map((p, i): [number, number] => [xs[i] ?? 0, y(p.activos)]));
  const p0 = activo !== null ? puntos[activo] : undefined;
  const cada = Math.max(1, Math.ceil(puntos.length / 6));
  return (
    <section className="cd-card cd-stack" style={{ gap: 8 }}>
      <h3 className="cd-card-title">Evolución del valor</h3>
      <ZonaGrafico>
        <svg className="cd-chart" viewBox={`0 0 ${W} 200`} role="img" aria-label="Valor de tus activos mes a mes">
          <line className="grid" x1="44" x2={W} y1={y(max)} y2={y(max)} />
          <text x="40" y={y(max) + 4} textAnchor="end">
            {abreviar(max)}
          </text>
          <line className="grid-dash" x1="44" x2={W} y1={y(0)} y2={y(0)} />
          <path className="area1" d={`${linea} L${xs.at(-1) ?? 0} ${y(0)} L${xs[0] ?? 0} ${y(0)} Z`} />
          <path className="l1" d={linea} strokeWidth="2.5" />
          {puntos.map((p, i) =>
            i % cada === 0 ? (
              <text key={p.fecha} x={xs[i]} y="192" textAnchor={i === 0 ? "start" : "middle"}>
                {nombreMes(p.fecha, true)}
              </text>
            ) : null,
          )}
          {p0 && activo !== null && <circle cx={xs[activo]} cy={y(p0.activos)} r="5" fill="var(--chart-1)" />}
          <SensorContinuo
            xs={xs}
            izquierda={44}
            ancho={W - 44}
            arriba={10}
            alto={175}
            activo={activo}
            alCambiar={setActivo}
          />
        </svg>
        {p0 && activo !== null && (
          <TooltipGrafico izquierda={((xs[activo] ?? 0) / W) * 100}>
            <b style={{ textTransform: "capitalize" }}>{nombreMes(p0.fecha)}</b>
            <span className="fila">
              <span>Valor</span>
              {formatoCOP(p0.activos)}
            </span>
          </TooltipGrafico>
        )}
      </ZonaGrafico>
    </section>
  );
}

export function ActivosPage() {
  const consulta = useQuery({ queryKey: claves.activos, queryFn: api.activos });
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const cerrar = () => setDialogo(null);
  if (consulta.isPending) return <TarjetaCargando />;
  if (consulta.isError) return <ErrorVista error={consulta.error} reintentar={() => void consulta.refetch()} />;
  const d = consulta.data;
  const vivos = d.activos.filter((a) => a.estado === "activo");
  const vendidos = d.activos.filter((a) => a.estado === "vendido");
  const kpis = [
    {
      texto: "Valor total",
      valor: formatoCOP(d.total),
      nota: `${vivos.length} ${vivos.length === 1 ? "activo" : "activos"}`,
    },
    { texto: "Aportado", valor: formatoCOP(d.aportado), nota: `Recibido ${formatoCOP(d.recibido)}` },
    {
      texto: "Ganancia",
      valor: formatoCOP(d.ganancia, { signo: true }),
      nota: "Valor + recibido − aportado",
      color: d.ganancia < 0 ? "var(--negative)" : "var(--positive)",
    },
    {
      texto: "Rentabilidad",
      valor: d.tir === null ? "—" : `${porcentaje(d.tir, 1)} E.A.`,
      nota: "TIR de todos tus activos",
    },
  ];
  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Activos</h1>
          <p>Lo que tienes más allá de tus cuentas. Aportar o vender no cuenta como gasto ni como ingreso.</p>
        </div>
        <button className="cd-btn cd-btn--primary" onClick={() => setDialogo({ tipo: "nuevo" })}>
          + Activo
        </button>
      </div>
      {d.activos.length === 0 ? (
        <section className="cd-card">
          <Vacio titulo="Aún no registras activos" />
          <p className="cd-delta-note" style={{ textAlign: "center" }}>
            Agrega un CDT, un fondo, tus cesantías, un vehículo o un inmueble para verlos en tu patrimonio neto.
          </p>
        </section>
      ) : (
        <div className="cd-bento">
          {kpis.map((k) => (
            <div key={k.texto} className="cd-card cd-kpi kpi-compacta span-3">
              <span className="cd-kpi-label">{k.texto}</span>
              <div className="cd-kpi-value" style={k.color ? { color: k.color } : undefined}>
                {k.valor}
              </div>
              <span className="cd-delta-note kpi-nota">{k.nota}</span>
            </div>
          ))}
          <div className="span-8 cd-stack" style={{ gap: 16 }}>
            <div className="activos-rejilla">
              {vivos.map((a) => (
                <TarjetaActivo key={a.id} a={a} abrir={setDialogo} />
              ))}
            </div>
            <Evolucion />
            {vendidos.length > 0 && (
              <>
                <h3 className="cd-card-title">Vendidos</h3>
                <div className="activos-rejilla">
                  {vendidos.map((a) => (
                    <TarjetaActivo key={a.id} a={a} abrir={setDialogo} />
                  ))}
                </div>
              </>
            )}
          </div>
          <section className="cd-card cd-stack span-4" style={{ gap: 10, alignSelf: "start" }}>
            <h3 className="cd-card-title">Asignación</h3>
            {d.asignacion.length === 0 && <span className="cd-delta-note">Sin activos con valor.</span>}
            <ul className="cd-catlist">
              {d.asignacion.map((c, i) => (
                <li key={c.clase}>
                  <i className={`cd-sw ${SERIES[i % SERIES.length]}`} />
                  <span>{c.nombre}</span>
                  <span className="pct">{Math.round(c.pct * 100)}%</span>
                  <span className="amt">{formatoCOP(c.valor)}</span>
                </li>
              ))}
            </ul>
            <p className="cd-delta-note" style={{ margin: 0 }}>
              Informativo: la app no recomienda productos ni ejecuta operaciones.
            </p>
          </section>
        </div>
      )}
      {dialogo?.tipo === "nuevo" && <FormActivo activo={null} alCerrar={cerrar} />}
      {dialogo?.tipo === "editar" && <FormActivo activo={dialogo.activo} alCerrar={cerrar} />}
      {dialogo?.tipo === "valor" && <FormValor activo={dialogo.activo} alCerrar={cerrar} />}
      {dialogo?.tipo === "mover" && <FormMovimiento activo={dialogo.activo} tipo={dialogo.mov} alCerrar={cerrar} />}
      {dialogo?.tipo === "eliminar" && (
        <Confirmar
          titulo={`Eliminar ${dialogo.activo.nombre}`}
          texto="Se borra el activo y se deshacen sus movimientos: el dinero vuelve a las cuentas como si nunca se hubiera registrado."
          accion="Eliminar"
          alConfirmar={() => api.eliminarActivo(dialogo.activo.id)}
          alCerrar={cerrar}
        />
      )}
      {dialogo?.tipo === "deshacer" && (
        <Confirmar
          titulo={`Deshacer ${NOMBRE_TIPO[dialogo.mov.tipo].toLowerCase()}`}
          texto={`Se revierte este movimiento de ${formatoCOP(dialogo.mov.monto)}: su efecto en la cuenta y en el valor del activo.`}
          accion="Deshacer"
          alConfirmar={() => api.deshacerMovimientoActivo(dialogo.activo.id, dialogo.mov.id)}
          alCerrar={cerrar}
        />
      )}
    </>
  );
}
