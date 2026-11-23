/**
 * Un préstamo dentro del detalle de una persona: condiciones, abonar, prestar más, editar con vista
 * previa del impacto, recordatorio, condonar e historial de entregas y abonos.
 */
import { Circulo } from "@/shared/charts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { esMovil } from "@/shared/lib/dispositivo";
import { toast } from "sonner";

import type { CambiosPrestamo, Prestamo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, mascaraMonto, parseMonto, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { useRefrescar } from "@/shared/lib/useRefrescar";
import { Hoja } from "@/shared/ui/Hoja";
import { MenuAcciones } from "@/shared/ui/MenuAcciones";

import { Desplegable } from "@/shared/ui/Desplegable";
import { CampoFecha } from "@/shared/ui/CampoFecha";
export const ORIGEN: Record<Prestamo["origen"], string> = {
  amigo: "Amigo",
  familia: "Familia",
  companero: "Compañero",
  otra_fuente: "Otra fuente",
};

const PLAN: Record<Prestamo["plan"], string> = {
  fecha_unica: "Un solo pago",
  cuotas: "En cuotas",
  libre: "Pago libre",
};

export function estadoVisible(p: Prestamo): { texto: string; clase: string } {
  if (p.estado === "pagado") return { texto: "Pagado", clase: "cd-badge--positive" };
  if (p.estado === "condonado") return { texto: "Condonado", clase: "cd-badge--neutral" };
  if (p.dias_vencido > 0)
    return {
      texto: `Vencido hace ${p.dias_vencido} ${p.dias_vencido === 1 ? "día" : "días"}`,
      clase: "cd-badge--negative",
    };
  if (p.proxima_cuota) {
    const dias = Math.round((new Date(`${p.proxima_cuota.fecha}T12:00:00`).getTime() - Date.now()) / 86_400_000);
    if (dias <= 7)
      return {
        texto: dias <= 0 ? "Vence hoy" : `Vence en ${dias} ${dias === 1 ? "día" : "días"}`,
        clase: "cd-badge--warning",
      };
  }
  return { texto: "Al día", clase: "cd-badge--positive" };
}

function recordatorio(p: Prestamo): string {
  const monto = formatoCOP(p.proxima_cuota?.monto ?? p.pendiente);
  const cuando = p.proxima_cuota ? ` del ${fechaCorta(p.proxima_cuota.fecha)}` : "";
  return `Hola ${p.persona}, te recuerdo los ${monto}${cuando} del préstamo. Gracias.`;
}

/** Monto + cuenta + fecha, para abonar o para prestar más. */
function FormDinero({
  titulo,
  ayuda,
  boton,
  sugerido,
  alGuardar,
  alCancelar,
  ocupado,
}: {
  titulo: string;
  ayuda?: string;
  boton: string;
  sugerido?: number;
  alGuardar: (d: { monto: number; cuenta_id: number; fecha: string }) => void;
  alCancelar: () => void;
  ocupado: boolean;
}) {
  const id = useId();
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas() });
  const deDinero = (cuentas.data ?? []).filter((c) => !["por_cobrar", "por_pagar", "credito"].includes(c.tipo));
  const [monto, setMonto] = useState("");
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [fecha, setFecha] = useState(hoyISO());
  const cuenta = cuentaId ?? deDinero[0]?.id;
  const centavos = parseMonto(monto);
  return (
    <form
      className="form-dinero"
      aria-label={titulo}
      onSubmit={(e) => {
        e.preventDefault();
        if (centavos && cuenta !== undefined && !ocupado) alGuardar({ monto: centavos, cuenta_id: cuenta, fecha });
      }}
    >
      <b className="form-dinero-titulo">{titulo}</b>
      {ayuda && <span className="cd-delta-note">{ayuda}</span>}
      <div className="form-dinero-campos">
        <label className="cd-stack campo-etiqueta" htmlFor={`${id}-monto`}>
          Monto
          <input
            id={`${id}-monto`}
            className="cd-input cd-num"
            inputMode="decimal"
            autoFocus
            placeholder={sugerido ? formatoCOP(sugerido) : "$ 0"}
            value={monto}
            onChange={(e) => setMonto(mascaraMonto(e.target.value))}
          />
        </label>
        <label className="cd-stack campo-etiqueta" htmlFor={`${id}-cuenta`}>
          Cuenta
          <Desplegable
            id={`${id}-cuenta`}
            className="cd-input"
            value={cuenta ?? ""}
            onChange={(e) => setCuentaId(Number(e.target.value))}
          >
            {deDinero.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </Desplegable>
        </label>
        <label className="cd-stack campo-etiqueta" htmlFor={`${id}-fecha`}>
          Fecha
          <CampoFecha
            id={`${id}-fecha`}
            type="date"
            className="cd-input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
      </div>
      <div className="form-dinero-pie">
        <button type="button" className="cd-btn cd-btn--ghost cd-btn--sm" onClick={alCancelar}>
          Cancelar
        </button>
        <button className="cd-btn cd-btn--primary cd-btn--sm" disabled={!centavos || cuenta === undefined || ocupado}>
          {ocupado ? "Guardando…" : boton}
        </button>
      </div>
    </form>
  );
}

const ETIQUETA_MOV: Record<string, string> = {
  entrega: "Entrega",
  abono: "Abono",
  interes: "Interés",
  condonacion: "Condonación",
};

function Historial({ id }: { id: number }) {
  const detalle = useQuery({ queryKey: [...claves.prestamos(), "detalle", id], queryFn: () => api.prestamo(id) });
  const movs = detalle.data?.movimientos ?? [];
  if (detalle.isPending) return <span className="cd-delta-note">Cargando historial…</span>;
  if (detalle.isError) return <span className="cd-delta-note">No se pudo cargar el historial.</span>;
  return (
    <ol className="historial-prestamo" aria-label="Historial del préstamo">
      {movs.map((m) => (
        <li key={m.id}>
          <span className={`historial-tipo historial-tipo--${m.tipo}`}>{ETIQUETA_MOV[m.tipo] ?? m.tipo}</span>
          <span className="historial-texto">
            {m.descripcion}
            <small>
              {fechaCorta(m.fecha, true)} · {m.cuenta}
            </small>
          </span>
          <b className={`cd-num ${m.monto > 0 ? "texto-ingreso" : ""}`}>
            {m.monto > 0 ? "+" : "−"} {formatoCOP(Math.abs(m.monto))}
          </b>
        </li>
      ))}
      {movs.length === 0 && <li className="cd-delta-note">Sin movimientos.</li>}
    </ol>
  );
}

type Modo = null | "abonar" | "mas";

export function TarjetaPrestamo({ p }: { p: Prestamo }) {
  const refrescar = useRefrescar();
  const [modo, setModo] = useState<Modo>(null);
  const [editando, setEditando] = useState(false);
  const [confirmarCondonar, setConfirmarCondonar] = useState(false);
  const [verHistorial, setVerHistorial] = useState(false);
  const presteYo = p.direccion === "presto_yo";

  const abonar = useMutation({
    mutationFn: (d: { monto: number; cuenta_id: number; fecha: string }) => api.abonar(p.id, d),
    onSuccess: () => {
      toast.success(`Abono registrado · ${p.persona}`);
      setModo(null);
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const prestarMas = useMutation({
    mutationFn: (d: { monto: number; cuenta_id: number; fecha: string }) => api.prestarMas(p.id, d),
    onSuccess: (_r, d) => {
      toast.success(`${presteYo ? "Entregaste" : "Recibiste"} ${formatoCOP(d.monto)} más · ${p.persona}`);
      setModo(null);
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const condonar = useMutation({
    mutationFn: () => api.condonar(p.id),
    onSuccess: () => toast(`Préstamo con ${p.persona} condonado`),
    onError: (e) => toast.error(e.message),
    onSettled: () => {
      setConfirmarCondonar(false);
      refrescar();
    },
  });
  const estado = estadoVisible(p);
  const activo = p.estado === "activo";
  const movil = esMovil();

  return (
    <article className="tarjeta-prestamo" aria-label={`Préstamo del ${fechaCorta(p.fecha, true)}`}>
      <header className="tarjeta-prestamo-cabeza">
        <div>
          <b>
            {presteYo ? "Le prestaste" : "Te prestó"} {formatoCOP(p.monto)}
          </b>
          <small>
            Desde el {fechaCorta(p.fecha, true)} · {ORIGEN[p.origen]} · {PLAN[p.plan]} ·{" "}
            {p.interes_total ? `interés ${porcentaje(p.tasa_ea, 1)} E.A.` : "sin interés"}
          </small>
        </div>
        <span className="cd-row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <span className={`cd-badge ${estado.clase}`}>{estado.texto}</span>
          <MenuAcciones
            etiqueta="Más acciones del préstamo"
            acciones={[
              { texto: "Editar préstamo", alElegir: () => setEditando(true) },
              ...(activo && presteYo
                ? [
                    {
                      texto: "Copiar recordatorio",
                      alElegir: () =>
                        void navigator.clipboard
                          .writeText(recordatorio(p))
                          .then(() => toast.success("Recordatorio copiado: pégalo en WhatsApp"))
                          .catch(() => toast.error("No pude copiar al portapapeles")),
                    },
                  ]
                : []),
              ...(activo
                ? [{ texto: "Condonar lo pendiente", peligro: true, alElegir: () => setConfirmarCondonar(true) }]
                : []),
            ]}
          />
        </span>
      </header>

      {movil ? (
        // Celular: el saldo pendiente y la acción que lo cambia, juntos arriba; el resto en una línea.
        <div className="prestamo-movil">
          <div className="prestamo-saldo">
            <span>
              <small>Pendiente</small>
              <b className={`cd-num ${presteYo && p.pendiente ? "texto-ingreso" : ""}`}>{formatoCOP(p.pendiente)}</b>
            </span>
            {activo && modo === null && (
              <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => setModo("abonar")}>
                Registrar abono
              </button>
            )}
          </div>
          <p className="prestamo-resumen cd-num">
            <span>
              {presteYo ? "Te han pagado" : "Has pagado"} <b>{formatoCOP(p.abonado)}</b> ({Math.round(p.pagado_pct)} %)
            </span>
            <span>
              Próximo:{" "}
              <b>
                {p.proxima_cuota
                  ? `${formatoCOP(p.proxima_cuota.monto)} · ${fechaCorta(p.proxima_cuota.fecha)}`
                  : activo
                    ? "sin fecha"
                    : "—"}
              </b>
            </span>
          </p>
        </div>
      ) : (
        <div className="tarjeta-prestamo-cuerpo">
          <dl className="tarjeta-prestamo-datos">
            <div>
              <dt>Pendiente</dt>
              <dd className={`cd-num ${presteYo && p.pendiente ? "texto-ingreso" : ""}`}>{formatoCOP(p.pendiente)}</dd>
            </div>
            <div>
              <dt>{presteYo ? "Te han pagado" : "Has pagado"}</dt>
              <dd className="cd-num">{formatoCOP(p.abonado)}</dd>
            </div>
            <div>
              <dt>Próximo pago</dt>
              <dd className="cd-num">
                {p.proxima_cuota
                  ? `${formatoCOP(p.proxima_cuota.monto)} · ${fechaCorta(p.proxima_cuota.fecha)}`
                  : activo
                    ? "Sin fecha"
                    : "—"}
              </dd>
            </div>
          </dl>
          <Circulo titulo="Pagado" fraccion={p.pagado_pct / 100} tamano={84} grosor={8} />
        </div>
      )}
      {p.nota && <p className="tarjeta-prestamo-nota">{p.nota}</p>}

      {confirmarCondonar && (
        <div className="aviso-condonar" role="alert">
          <span>
            {presteYo
              ? `Condonar ${formatoCOP(p.capital_pendiente)} lo registra como regalo (gasto).`
              : `Si ${p.persona} te condona ${formatoCOP(p.capital_pendiente)}, cuenta como ingreso.`}
          </span>
          <span className="cd-row" style={{ gap: 6 }}>
            <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setConfirmarCondonar(false)}>
              Cancelar
            </button>
            <button
              className="cd-btn cd-btn--peligro cd-btn--sm"
              disabled={condonar.isPending}
              onClick={() => condonar.mutate()}
            >
              Condonar
            </button>
          </span>
        </div>
      )}

      {modo === "abonar" && (
        <FormDinero
          titulo={presteYo ? `${p.persona} te pagó` : `Le pagaste a ${p.persona}`}
          ayuda="Se aplica primero al interés y luego al capital."
          boton="Guardar abono"
          sugerido={p.proxima_cuota?.monto ?? p.pendiente}
          ocupado={abonar.isPending}
          alGuardar={(d) => abonar.mutate(d)}
          alCancelar={() => setModo(null)}
        />
      )}
      {modo === "mas" && (
        <FormDinero
          titulo={presteYo ? `Prestarle más a ${p.persona}` : `${p.persona} te prestó más`}
          ayuda="Se suma a este préstamo con las mismas condiciones. Si cambian el interés o el plazo, crea otro préstamo."
          boton={presteYo ? "Registrar entrega" : "Registrar lo recibido"}
          ocupado={prestarMas.isPending}
          alGuardar={(d) => prestarMas.mutate(d)}
          alCancelar={() => setModo(null)}
        />
      )}

      {modo === null && (
        <div className="tarjeta-prestamo-acciones">
          {activo && !movil && (
            <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => setModo("abonar")}>
              Registrar abono
            </button>
          )}
          {p.estado !== "condonado" && (
            <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={() => setModo("mas")}>
              {presteYo ? "Prestar más" : "Me prestó más"}
            </button>
          )}
          <button
            className="cd-btn cd-btn--ghost cd-btn--sm"
            aria-expanded={verHistorial}
            onClick={() => setVerHistorial((v) => !v)}
          >
            {verHistorial ? "Ocultar historial" : "Historial"}
          </button>
        </div>
      )}
      {verHistorial && <Historial id={p.id} />}
      {editando && <EditarPrestamo p={p} alCerrar={() => setEditando(false)} />}
    </article>
  );
}

/** Solo lo que cambió respecto al préstamo, para enviar y para la vista previa. */
function diferencias(p: Prestamo, inicial: number, f: FormEdicion): CambiosPrestamo {
  const c: CambiosPrestamo = {};
  if (f.persona.trim() && f.persona.trim() !== p.persona) c.persona = f.persona.trim();
  if (f.origen !== p.origen) c.origen = f.origen;
  if (f.nota.trim() !== p.nota) c.nota = f.nota.trim();
  if (f.fecha && f.fecha !== p.fecha.slice(0, 10)) c.fecha = f.fecha;
  const monto = parseMonto(f.monto);
  if (monto && monto !== inicial) c.monto_inicial = monto;
  if (f.interes !== p.tipo_interes) c.tipo_interes = f.interes;
  if (f.interes === "fijo") {
    const fijo = parseMonto(f.valorInteres) ?? 0;
    if (fijo !== p.interes_total || f.interes !== p.tipo_interes) c.interes_fijo = fijo;
  }
  if (f.interes === "simple_mensual") {
    const tasa = Number(f.valorInteres.replace(",", ".")) / 100;
    if (Number.isFinite(tasa) && (tasa !== p.tasa_mensual || f.interes !== p.tipo_interes)) c.tasa_mensual = tasa;
  }
  if (f.plan !== p.plan) c.plan = f.plan;
  if (f.plan === "cuotas") {
    const n = Math.max(1, Number(f.numCuotas) || 1);
    if (n !== p.cuotas.length || f.plan !== p.plan) c.num_cuotas = n;
    if (f.frecuencia !== (p.frecuencia ?? "mensual") || f.plan !== p.plan) c.frecuencia = f.frecuencia;
  }
  if (f.plan === "fecha_unica" && f.fechaLimite && f.fechaLimite !== p.cuotas.at(-1)?.fecha)
    c.fecha_limite = f.fechaLimite;
  return c;
}

interface FormEdicion {
  persona: string;
  origen: Prestamo["origen"];
  nota: string;
  fecha: string;
  monto: string;
  interes: Prestamo["tipo_interes"];
  valorInteres: string;
  plan: Prestamo["plan"];
  numCuotas: string;
  frecuencia: NonNullable<CambiosPrestamo["frecuencia"]>;
  fechaLimite: string;
}

/** Centavos → texto editable como lo escribe la persona ("100.000" o "100.000,50"). */
const aTexto = (centavos: number) =>
  mascaraMonto(
    centavos % 100
      ? `${Math.floor(centavos / 100)},${String(centavos % 100).padStart(2, "0")}`
      : String(centavos / 100),
  );

const DESCRIPTIVOS = new Set(["persona", "origen", "nota"]);

function EditarPrestamo({ p, alCerrar }: { p: Prestamo; alCerrar: () => void }) {
  const id = useId();
  const refrescar = useRefrescar();
  const detalle = useQuery({ queryKey: [...claves.prestamos(), "detalle", p.id], queryFn: () => api.prestamo(p.id) });
  // El capital inicial es la primera entrega; las demás quedan como entregas adicionales.
  const entregas = (detalle.data?.movimientos ?? []).filter((m) => m.tipo === "entrega");
  const inicial = entregas[0] ? Math.abs(entregas[0].monto) : p.monto;
  const adicionales = p.monto - inicial;
  const [f, setF] = useState<FormEdicion | null>(null);
  const actual: FormEdicion = f ?? {
    persona: p.persona,
    origen: p.origen,
    nota: p.nota,
    fecha: p.fecha.slice(0, 10),
    monto: aTexto(inicial),
    interes: p.tipo_interes,
    valorInteres:
      p.tipo_interes === "fijo"
        ? aTexto(p.interes_total)
        : p.tipo_interes === "simple_mensual"
          ? String(((p.tasa_mensual ?? 0) * 100).toLocaleString("es-CO"))
          : "",
    plan: p.plan,
    numCuotas: String(p.cuotas.length || 1),
    frecuencia: (p.frecuencia as FormEdicion["frecuencia"]) ?? "mensual",
    fechaLimite: p.cuotas.at(-1)?.fecha ?? "",
  };
  const cambiar = <K extends keyof FormEdicion>(k: K, v: FormEdicion[K]) => setF({ ...actual, [k]: v });
  const cambios = detalle.data ? diferencias(p, inicial, actual) : {};
  const tocaSaldo = Object.keys(cambios).some((k) => !DESCRIPTIVOS.has(k));
  const cambiosDemorados = useDebounce(cambios, 300);
  const clavePrevia = JSON.stringify(cambiosDemorados);
  const previa = useQuery({
    queryKey: ["prestamos", "edicion", p.id, clavePrevia],
    queryFn: () => api.vistaPreviaEdicion(p.id, cambiosDemorados),
    enabled: tocaSaldo && Object.keys(cambiosDemorados).some((k) => !DESCRIPTIVOS.has(k)),
    retry: false,
  });
  const guardar = useMutation({
    mutationFn: () => api.editarPrestamo(p.id, cambios),
    onSuccess: () => {
      toast.success("Préstamo actualizado");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const sinCambios = Object.keys(cambios).length === 0;
  const condonado = p.estado === "condonado";
  const campo = (k: string, t: string) => (
    <label className="campo-etiqueta" htmlFor={`${id}-${k}`}>
      {t}
    </label>
  );

  return (
    <Hoja
      titulo={`Editar préstamo con ${p.persona}`}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="cd-btn cd-btn--primary"
            disabled={sinCambios || guardar.isPending || (tocaSaldo && (previa.isError || previa.isFetching))}
            onClick={() => guardar.mutate()}
          >
            {guardar.isPending ? "Guardando…" : "Guardar cambios"}
          </button>
        </>
      }
    >
      <div className="edicion-grid">
        <div className="cd-stack" style={{ gap: 6 }}>
          {campo("persona", "Persona")}
          <input
            id={`${id}-persona`}
            className="cd-input"
            value={actual.persona}
            onChange={(e) => cambiar("persona", e.target.value)}
          />
        </div>
        <div className="cd-stack" style={{ gap: 6 }}>
          {campo("origen", "Origen")}
          <Desplegable
            id={`${id}-origen`}
            className="cd-input"
            value={actual.origen}
            onChange={(e) => cambiar("origen", e.target.value as FormEdicion["origen"])}
          >
            {Object.entries(ORIGEN).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Desplegable>
        </div>
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        {campo("nota", "Nota")}
        <input
          id={`${id}-nota`}
          className="cd-input"
          value={actual.nota}
          onChange={(e) => cambiar("nota", e.target.value)}
        />
      </div>

      <fieldset className="edicion-condiciones" disabled={condonado || detalle.isPending}>
        <legend>Monto y condiciones</legend>
        {condonado && (
          <p className="cd-delta-note">Un préstamo condonado solo admite cambios de nombre, origen o nota.</p>
        )}
        <div className="edicion-grid">
          <div className="cd-stack" style={{ gap: 6 }}>
            {campo("monto", "Monto inicial")}
            <input
              id={`${id}-monto`}
              className="cd-input cd-num"
              inputMode="decimal"
              value={actual.monto}
              onChange={(e) => cambiar("monto", mascaraMonto(e.target.value))}
            />
            {adicionales > 0 && (
              <span className="cd-delta-note">Más {formatoCOP(adicionales)} en entregas adicionales.</span>
            )}
          </div>
          <div className="cd-stack" style={{ gap: 6 }}>
            {campo("fecha", "Fecha del préstamo")}
            <CampoFecha
              id={`${id}-fecha`}
              type="date"
              className="cd-input"
              value={actual.fecha}
              onChange={(e) => cambiar("fecha", e.target.value)}
            />
          </div>
          <div className="cd-stack" style={{ gap: 6 }}>
            {campo("interes", "Interés")}
            <Desplegable
              id={`${id}-interes`}
              className="cd-input"
              value={actual.interes}
              onChange={(e) => cambiar("interes", e.target.value as FormEdicion["interes"])}
            >
              <option value="ninguno">Sin interés</option>
              <option value="fijo">Valor fijo</option>
              <option value="simple_mensual">% mensual</option>
            </Desplegable>
          </div>
          {actual.interes !== "ninguno" && (
            <div className="cd-stack" style={{ gap: 6 }}>
              {campo("valor", actual.interes === "fijo" ? "Interés total" : "Tasa mensual (%)")}
              <input
                id={`${id}-valor`}
                className="cd-input cd-num"
                inputMode="decimal"
                value={actual.valorInteres}
                onChange={(e) =>
                  cambiar("valorInteres", actual.interes === "fijo" ? mascaraMonto(e.target.value) : e.target.value)
                }
              />
            </div>
          )}
          <div className="cd-stack" style={{ gap: 6 }}>
            {campo("plan", "Forma de pago")}
            <Desplegable
              id={`${id}-plan`}
              className="cd-input"
              value={actual.plan}
              onChange={(e) => cambiar("plan", e.target.value as FormEdicion["plan"])}
            >
              {Object.entries(PLAN).map(([v, t]) => (
                <option key={v} value={v}>
                  {t}
                </option>
              ))}
            </Desplegable>
          </div>
          {actual.plan === "fecha_unica" && (
            <div className="cd-stack" style={{ gap: 6 }}>
              {campo("limite", "Fecha de pago")}
              <CampoFecha
                id={`${id}-limite`}
                type="date"
                className="cd-input"
                value={actual.fechaLimite}
                onChange={(e) => cambiar("fechaLimite", e.target.value)}
              />
            </div>
          )}
          {actual.plan === "cuotas" && (
            <>
              <div className="cd-stack" style={{ gap: 6 }}>
                {campo("cuotas", "Número de cuotas")}
                <input
                  id={`${id}-cuotas`}
                  className="cd-input cd-num"
                  inputMode="numeric"
                  value={actual.numCuotas}
                  onChange={(e) => cambiar("numCuotas", e.target.value.replace(/\D/g, ""))}
                />
              </div>
              <div className="cd-stack" style={{ gap: 6 }}>
                {campo("frecuencia", "Cada")}
                <Desplegable
                  id={`${id}-frecuencia`}
                  className="cd-input"
                  value={actual.frecuencia}
                  onChange={(e) => cambiar("frecuencia", e.target.value as FormEdicion["frecuencia"])}
                >
                  <option value="diaria">Día</option>
                  <option value="semanal">Semana</option>
                  <option value="quincenal">Quincena</option>
                  <option value="mensual">Mes</option>
                </Desplegable>
              </div>
            </>
          )}
        </div>
      </fieldset>

      <div className="impacto" role="status" aria-live="polite">
        {!tocaSaldo ? (
          <span>
            {sinCambios ? "Sin cambios todavía." : "Estos cambios no tocan el saldo: quedan "}
            {!sinCambios && <b className="cd-num">{formatoCOP(p.pendiente)}</b>}
            {!sinCambios && " pendientes y se conserva el historial."}
          </span>
        ) : previa.isError ? (
          <span className="texto-error">{previa.error.message}</span>
        ) : previa.data ? (
          <>
            <span>
              Pendiente: <b className="cd-num">{formatoCOP(previa.data.pendiente_antes)}</b> →{" "}
              <b className="cd-num">{formatoCOP(previa.data.pendiente_despues)}</b>
            </span>
            <small>
              Capital {formatoCOP(previa.data.capital_despues)} · interés por pagar{" "}
              {formatoCOP(previa.data.interes_despues)}
              {previa.data.cuotas.length > 0 &&
                ` · ${previa.data.cuotas.length === 1 ? "un pago" : `${previa.data.cuotas.length} cuotas`} desde ${fechaCorta(previa.data.cuotas[0]?.fecha ?? "")}`}
              . Los abonos ya registrados se conservan.
            </small>
          </>
        ) : (
          <span>Calculando el impacto…</span>
        )}
      </div>
    </Hoja>
  );
}
