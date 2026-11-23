/** Cuentas: saldo calculado de cada una (nunca se edita a mano; RF-CU-02), crear, editar, archivar y elegir
 * cuáles suman al saldo total (fase 8, puntos 3 y 15). Sistema compacto: total con su reparto, saldo de la
 * cuenta elegida en el tiempo y rejilla de tarjetas de cuenta. */
import { useRefrescar } from "@/shared/lib/useRefrescar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState, type CSSProperties } from "react";
import { toast } from "sonner";

import { ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";
import type { Cuenta, CuentaNueva } from "@/shared/api/tipos";
import { AreaTemporal, CabeceraSerie } from "@/shared/charts";
import { api } from "@/shared/lib/api";
import { formatoCOP, mascaraMonto, parseMonto } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Icono, type NombreIcono } from "@/shared/ui/Icono";
import { CabeceraTarjeta } from "@/shared/ui/Kpi";
import { Hoja } from "@/shared/ui/Hoja";
import { ICONO_TIPO, LogoCuenta } from "@/shared/ui/SelectorCuenta";
import { SelectorSimbolo } from "@/shared/ui/Simbolo";

import "./cuentas.css";

import { Desplegable } from "@/shared/ui/Desplegable";
const ICONOS_CUENTA: NombreIcono[] = [
  "cuentas",
  "bolsa",
  "meta",
  "flujo",
  "telefono",
  "escudo",
  "corazon",
  "inicio",
  "regalo",
  "ruta",
];
/** Color de la tarjeta: el elegido o uno fijo por cuenta. */
const tinte = (c: Cuenta) => `var(--${c.color ?? `cat-${(c.id % 8) + 1}`})`;

/** Aspecto de la tarjeta según el tipo de cuenta. */
const ESTILO_TIPO: Record<string, "caja" | "billetera" | "tarjeta"> = {
  ahorro: "caja",
  efectivo: "billetera",
};

const TIPOS: Record<CuentaNueva["tipo"] & string, string> = {
  billetera: "Billetera digital",
  ahorro: "Ahorro",
  efectivo: "Efectivo",
  tarjeta_credito: "Tarjeta de crédito",
  inversion: "Inversión",
};
/** Logos propios opcionales: `public/cuentas/logos.json` con [{ ruta, nombre }]. El repositorio no incluye marcas. */
async function cargarLogos(): Promise<{ ruta: string; nombre: string }[]> {
  try {
    const r = await fetch("/cuentas/logos.json");
    return r.ok ? ((await r.json()) as { ruta: string; nombre: string }[]) : [];
  } catch {
    return [];
  }
}

function FormCuenta({ cuenta, alCerrar }: { cuenta: Cuenta | null; alCerrar: () => void }) {
  const refrescar = useRefrescar();
  const logos = useQuery({ queryKey: ["logos-cuentas"], queryFn: cargarLogos, staleTime: Infinity });
  const [f, setF] = useState({
    nombre: cuenta?.nombre ?? "",
    tipo: (cuenta?.tipo ?? "billetera") as NonNullable<CuentaNueva["tipo"]>,
    institucion: cuenta?.institucion ?? "",
    icono: cuenta?.icono ?? null,
    color: cuenta?.color ?? null,
    saldo: "",
    incluir: cuenta?.incluir_en_total ?? true,
  });
  const guardar = useMutation({
    mutationFn: async () => {
      if (!f.nombre.trim()) throw new Error("Escribe el nombre de la cuenta");
      const base = {
        nombre: f.nombre.trim(),
        tipo: f.tipo,
        institucion: f.institucion.trim() || null,
        icono: f.icono,
        color: f.color,
        incluir_en_total: f.incluir,
      };
      if (cuenta) await api.editarCuenta(cuenta.id, base);
      else await api.crearCuenta({ ...base, saldo_inicial: parseMonto(f.saldo) ?? 0 });
    },
    onSuccess: () => {
      toast.success(cuenta ? "Cuenta actualizada" : "Cuenta creada");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const archivar = useMutation({
    mutationFn: () => api.editarCuenta(cuenta?.id ?? 0, { archivada: true }),
    onSuccess: () => {
      toast(`${cuenta?.nombre} archivada: sus movimientos se conservan`);
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const etiqueta = { fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" } as const;
  return (
    <Hoja
      titulo={cuenta ? `Editar ${cuenta.nombre}` : "Nueva cuenta"}
      onCerrar={alCerrar}
      pie={
        <>
          {cuenta && (
            <button
              className="cd-btn cd-btn--ghost izquierda"
              disabled={archivar.isPending || cuenta.saldo !== 0}
              title={
                cuenta.saldo !== 0
                  ? "Deja el saldo en cero (con un ajuste o transferencia) antes de archivarla"
                  : undefined
              }
              onClick={() => archivar.mutate()}
            >
              Archivar
            </button>
          )}
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--primary" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
            {cuenta ? "Guardar cambios" : "Crear cuenta"}
          </button>
        </>
      }
    >
      <label className="cd-stack" style={{ gap: 6 }}>
        <span style={etiqueta}>Nombre</span>
        <input className="cd-input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Tipo</span>
          <Desplegable
            className="cd-input"
            value={f.tipo}
            onChange={(e) => {
              const tipo = e.target.value as typeof f.tipo;
              setF({ ...f, tipo, incluir: tipo === "inversion" ? false : f.incluir });
            }}
          >
            {Object.entries(TIPOS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Desplegable>
        </label>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Entidad (opcional)</span>
          <input
            className="cd-input"
            value={f.institucion}
            onChange={(e) => setF({ ...f, institucion: e.target.value })}
          />
        </label>
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        <span style={etiqueta}>Color y símbolo de la tarjeta</span>
        <SelectorSimbolo
          icono={f.icono}
          color={f.color}
          alCambiar={(v) => setF({ ...f, ...v })}
          iconos={ICONOS_CUENTA}
          logos={logos.data ?? []}
          respaldo={ICONO_TIPO[f.tipo] ?? "cuentas"}
        />
      </div>
      {!cuenta && (
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Saldo de hoy</span>
          <input
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={f.saldo}
            onChange={(e) => setF({ ...f, saldo: mascaraMonto(e.target.value) })}
          />
          <span className="cd-delta-note">Desde aquí el saldo se calcula con cada movimiento.</span>
        </label>
      )}
      <label className="cd-row" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={f.incluir} onChange={(e) => setF({ ...f, incluir: e.target.checked })} />
        Sumar al saldo total (Inicio, Cuentas y saldo proyectado)
      </label>
    </Hoja>
  );
}

/** Saldo de una cuenta en el tiempo, con su periodo recordado. */
function SaldoCuenta({ cuenta }: { cuenta: Cuenta }) {
  const nav = usePeriodo("6m", "cuentas-saldo");
  const datos = useQuery({
    queryKey: ["reportes", "valor-neto", nav.periodo.desde, nav.periodo.hasta, "movimiento", cuenta.id],
    queryFn: () => api.valorNeto(nav.periodo, "movimiento", cuenta.id),
  });
  const puntos = (datos.data?.puntos ?? []).map((p) => ({ fecha: p.fecha, valor: p.saldo }));
  return (
    <section className="cd-card span-12 cuenta-detalle">
      <CabeceraTarjeta
        titulo={cuenta.nombre}
        rango={`${(TIPOS as Record<string, string>)[cuenta.tipo] ?? cuenta.tipo} · ${cuenta.incluir_en_total ? "suma al saldo total" : "no suma al total"}`}
        accion={<ControlPeriodo nav={nav} opciones={["3m", "6m", "12m", "todo", "rango"]} />}
      />
      <CabeceraSerie
        etiqueta="Saldo hoy"
        valor={cuenta.saldo}
        inicial={puntos.length > 1 ? puntos[0]?.valor : undefined}
        accion={
          <Link className="cd-link" to="/movimientos" search={{ cuenta: cuenta.id }}>
            Ver movimientos →
          </Link>
        }
      />
      {datos.isPending && <TarjetaCargando filas={3} />}
      {datos.isError && <ErrorVista error={datos.error} reintentar={() => void datos.refetch()} />}
      {datos.isSuccess && (
        <AreaTemporal titulo={`Saldo de ${cuenta.nombre}`} nombreSerie="Saldo" puntos={puntos} alto={240} />
      )}
    </section>
  );
}

export function CuentasPage() {
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: api.cuentas });
  const refrescar = useRefrescar();
  const [editando, setEditando] = useState<Cuenta | "nueva" | null>(null);
  const [elegida, setElegida] = useFiltroRecordado<{ id: number | null }>("cuentas-elegida", { id: null });
  const incluir = useMutation({
    mutationFn: (c: Cuenta) => api.editarCuenta(c.id, { incluir_en_total: !c.incluir_en_total }),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  if (cuentas.isPending) return <TarjetaCargando />;
  if (cuentas.isError) return <ErrorVista error={cuentas.error} reintentar={() => void cuentas.refetch()} />;
  const incluidas = cuentas.data.filter((c) => c.incluir_en_total);
  const total = incluidas.reduce((t, c) => t + c.saldo, 0);
  const todas = cuentas.data.reduce((t, c) => t + c.saldo, 0);
  const seleccionada = cuentas.data.find((c) => c.id === elegida.id) ?? incluidas[0] ?? cuentas.data[0];

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Cuentas</h1>
          <p>El saldo se calcula con cada movimiento. Elige una cuenta para ver su saldo en el tiempo.</p>
        </div>
        <button className="cd-btn cd-btn--primary" onClick={() => setEditando("nueva")}>
          + Cuenta
        </button>
      </div>
      {editando && (
        <FormCuenta
          key={editando === "nueva" ? "nueva" : editando.id}
          cuenta={editando === "nueva" ? null : editando}
          alCerrar={() => setEditando(null)}
        />
      )}
      <div className="cd-bento">
        <section className="cd-balance span-4 cuentas-total" aria-labelledby="cuentas-total">
          <div className="cd-balance-top">
            <span id="cuentas-total" className="cd-balance-label">
              Saldo total
            </span>
            <span className="cd-chip-glass">
              {incluidas.length} de {cuentas.data.length} cuentas
            </span>
          </div>
          <div className="cd-balance-value">
            <Dinero centavos={total} />
          </div>
          <ul className="inicio-cuentas">
            {[...incluidas]
              .sort((a, b) => b.saldo - a.saldo)
              .slice(0, 4)
              .map((c) => (
                <li key={c.id}>
                  <LogoCuenta cuenta={c} tam={18} />
                  <span>{c.nombre}</span>
                  <b className="cd-num">
                    {formatoCOP(c.saldo)} · {total > 0 ? Math.round((c.saldo / total) * 100) : 0}%
                  </b>
                </li>
              ))}
          </ul>
          {total !== todas && (
            <div className="cd-balance-foot">
              <span style={{ opacity: 0.85 }}>Con todas las cuentas: {formatoCOP(todas)}</span>
            </div>
          )}
        </section>
        <section className="span-8 tus-cuentas" aria-label="Tus cuentas">
          <div className="cuentas-rejilla">
            {cuentas.data.map((c) => {
              const activa = seleccionada?.id === c.id;
              return (
                <article
                  key={c.id}
                  className={`tarjeta-cuenta tarjeta-cuenta--${ESTILO_TIPO[c.tipo] ?? "tarjeta"} ${activa ? "activa" : ""} ${c.incluir_en_total ? "" : "fuera"}`}
                  style={{ "--tinte": tinte(c) } as CSSProperties}
                >
                  <button
                    type="button"
                    className="tarjeta-cuenta-elegir"
                    aria-pressed={activa}
                    aria-label={`Ver el saldo de ${c.nombre}`}
                    onClick={() => setElegida(() => ({ id: c.id }))}
                  >
                    <span className="tarjeta-cuenta-logo" aria-hidden>
                      <LogoCuenta cuenta={c} tam={40} />
                    </span>
                    {c.tipo === "ahorro" && <span className="caja-dial" aria-hidden />}
                    <span className={`tarjeta-cuenta-saldo cd-num ${c.saldo < 0 ? "negativo" : ""}`}>
                      {formatoCOP(c.saldo)}
                    </span>
                    <span className="tarjeta-cuenta-nombre">
                      <b>{c.nombre}</b>
                      <small>
                        {(TIPOS as Record<string, string>)[c.tipo] ?? c.tipo}
                        {c.institucion ? ` · ${c.institucion}` : ""}
                      </small>
                    </span>
                  </button>
                  <div className="tarjeta-cuenta-pie">
                    <label className="casilla-suma" title="Incluir en el saldo total">
                      <input
                        type="checkbox"
                        checked={c.incluir_en_total}
                        disabled={incluir.isPending}
                        onChange={() => incluir.mutate(c)}
                      />
                      Suma al total
                    </label>
                    <button
                      type="button"
                      className="tarjeta-cuenta-editar"
                      aria-label={`Editar ${c.nombre}`}
                      title="Editar"
                      onClick={() => setEditando(c)}
                    >
                      <Icono nombre="lapiz" pequeno />
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        {seleccionada ? (
          <SaldoCuenta key={seleccionada.id} cuenta={seleccionada} />
        ) : (
          <section className="cd-card span-12">
            <Vacio titulo="Aún no tienes cuentas" texto="Crea una con «+ Cuenta»." />
          </section>
        )}
      </div>
    </>
  );
}
