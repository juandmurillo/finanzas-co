/** Formulario de préstamo personal con vista previa en vivo (cuotas, interés, E.A.) y alerta de costo. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { PrestamoNuevo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, mascaraMonto, parseMonto, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { Icono } from "@/shared/ui/Icono";

type Interes = "ninguno" | "fijo" | "simple_mensual";
type Plan = "fecha_unica" | "cuotas" | "libre";

interface Formulario {
  direccion: "presto_yo" | "me_prestaron";
  persona: string;
  origen: "amigo" | "familia" | "companero" | "otra_fuente";
  monto: string;
  cuentaId: number | null;
  fecha: string;
  interes: Interes;
  valorInteres: string; // $ si es fijo, % mensual si es simple
  plan: Plan;
  fechaLimite: string;
  numCuotas: string;
  frecuencia: "diaria" | "semanal" | "quincenal" | "mensual";
  nota: string;
}

const inicial = (): Formulario => ({
  direccion: "presto_yo",
  persona: "",
  origen: "amigo",
  monto: "",
  cuentaId: null,
  fecha: hoyISO(),
  interes: "ninguno",
  valorInteres: "",
  plan: "fecha_unica",
  fechaLimite: "",
  numCuotas: "2",
  frecuencia: "quincenal",
  nota: "",
});

function aPeticion(f: Formulario, cuentaId: number | null): PrestamoNuevo | null {
  const monto = parseMonto(f.monto);
  if (!monto || cuentaId === null || !f.persona.trim()) return null;
  const porcentajeMensual = Number(f.valorInteres.replace(",", ".")) / 100;
  return {
    direccion: f.direccion,
    persona: f.persona.trim(),
    origen: f.origen,
    monto,
    cuenta_id: cuentaId,
    fecha: f.fecha,
    tipo_interes: f.interes,
    interes_fijo: f.interes === "fijo" ? (parseMonto(f.valorInteres) ?? 0) : 0,
    tasa_mensual: f.interes === "simple_mensual" && Number.isFinite(porcentajeMensual) ? porcentajeMensual : 0,
    plan: f.plan,
    frecuencia: f.frecuencia,
    num_cuotas: f.plan === "cuotas" ? Math.max(1, Number(f.numCuotas) || 1) : 1,
    fecha_limite: f.plan === "fecha_unica" && f.fechaLimite ? f.fechaLimite : null,
    nota: f.nota,
  };
}

export function NuevoPrestamo() {
  const id = useId();
  const cliente = useQueryClient();
  const [f, setF] = useState<Formulario>(inicial);
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas() });
  const cuentaId = f.cuentaId ?? cuentas.data?.[0]?.id ?? null;
  const peticion = aPeticion(f, cuentaId);
  const peticionDemorada = useDebounce(peticion, 300);
  const previa = useQuery({
    queryKey: ["prestamos", "simular", peticionDemorada],
    queryFn: () => api.simularPrestamo(peticionDemorada as PrestamoNuevo),
    enabled: peticionDemorada !== null,
  });
  const crear = useMutation({
    mutationFn: () => {
      if (!peticion) throw new Error("Completa persona, monto y cuenta");
      return api.crearPrestamo(peticion);
    },
    onSuccess: () => {
      toast.success(
        f.direccion === "presto_yo" ? `Préstamo a ${f.persona} registrado` : `Préstamo de ${f.persona} registrado`,
      );
      setF(inicial());
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => {
      void cliente.invalidateQueries({ queryKey: ["prestamos"] });
      void cliente.invalidateQueries({ queryKey: claves.cuentas });
    },
  });

  const cambiar = <K extends keyof Formulario>(k: K, v: Formulario[K]) => setF((x) => ({ ...x, [k]: v }));
  const etiqueta = (campo: string, texto: string) => (
    <label htmlFor={`${id}-${campo}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
      {texto}
    </label>
  );
  const seg = <T extends string>(
    nombre: string,
    opciones: [T, string][],
    valor: T,
    alCambiar: (v: T) => void,
    marca = true,
  ) => (
    <div
      className={`cd-seg ${marca ? "cd-seg--brand" : ""}`}
      role="radiogroup"
      aria-label={nombre}
      style={{ display: "flex" }}
    >
      {opciones.map(([v, t]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          aria-selected={valor === v}
          style={{ flex: 1, justifyContent: "center", padding: "0 8px" }}
          onClick={() => alCambiar(v)}
        >
          {t}
        </button>
      ))}
    </div>
  );

  return (
    <aside className="cd-card cd-stack" aria-label="Nuevo préstamo" style={{ gap: 14, alignSelf: "start" }}>
      <h3 className="cd-card-title">Nuevo préstamo</h3>
      {seg(
        "Dirección",
        [
          ["presto_yo", "Presté"],
          ["me_prestaron", "Me prestaron"],
        ],
        f.direccion,
        (v) => cambiar("direccion", v),
      )}
      <div className="cd-stack" style={{ gap: 6 }}>
        {etiqueta("persona", f.direccion === "presto_yo" ? "¿A quién?" : "¿Quién te prestó?")}
        <input
          id={`${id}-persona`}
          className="cd-input"
          value={f.persona}
          placeholder="Nombre"
          onChange={(e) => cambiar("persona", e.target.value)}
        />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("origen", "Origen")}
          <select
            id={`${id}-origen`}
            className="cd-input"
            value={f.origen}
            onChange={(e) => cambiar("origen", e.target.value as Formulario["origen"])}
          >
            <option value="amigo">Amigo</option>
            <option value="familia">Familia</option>
            <option value="companero">Compañero</option>
            <option value="otra_fuente">Otra fuente</option>
          </select>
        </div>
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
          {etiqueta("cuenta", f.direccion === "presto_yo" ? "Sale de" : "Llega a")}
          <select
            id={`${id}-cuenta`}
            className="cd-input"
            value={cuentaId ?? ""}
            onChange={(e) => cambiar("cuentaId", Number(e.target.value))}
          >
            {(cuentas.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("fecha", "Fecha")}
          <input
            id={`${id}-fecha`}
            type="date"
            className="cd-input"
            value={f.fecha}
            onChange={(e) => cambiar("fecha", e.target.value)}
          />
        </div>
      </div>

      <div className="cd-stack" style={{ gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>Interés</span>
        {seg(
          "Tipo de interés",
          [
            ["ninguno", "Sin interés"],
            ["fijo", "Fijo $"],
            ["simple_mensual", "% mensual"],
          ],
          f.interes,
          (v) => cambiar("interes", v),
          false,
        )}
        {f.interes !== "ninguno" && (
          <input
            aria-label={f.interes === "fijo" ? "Interés total en pesos" : "Tasa mensual en porcentaje"}
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder={f.interes === "fijo" ? "$ 5.000" : "1 (% mensual)"}
            value={f.valorInteres}
            onChange={(e) =>
              cambiar(
                "valorInteres",
                f.interes === "fijo" ? mascaraMonto(e.target.value) : e.target.value.replace(/[^\d,.]/g, ""),
              )
            }
          />
        )}
      </div>

      <div className="cd-stack" style={{ gap: 8 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>Plan de pago</span>
        {seg(
          "Plan de pago",
          [
            ["fecha_unica", "Fecha única"],
            ["cuotas", "Cuotas"],
            ["libre", "Libre"],
          ],
          f.plan,
          (v) => cambiar("plan", v),
          false,
        )}
        {f.plan === "fecha_unica" && (
          <input
            aria-label="Fecha de pago"
            type="date"
            className="cd-input"
            min={f.fecha}
            value={f.fechaLimite}
            onChange={(e) => cambiar("fechaLimite", e.target.value)}
          />
        )}
        {f.plan === "cuotas" && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
            <input
              aria-label="Número de cuotas"
              className="cd-input cd-num"
              inputMode="numeric"
              value={f.numCuotas}
              onChange={(e) => cambiar("numCuotas", e.target.value.replace(/\D/g, ""))}
            />
            <select
              aria-label="Frecuencia"
              className="cd-input"
              value={f.frecuencia}
              onChange={(e) => cambiar("frecuencia", e.target.value as Formulario["frecuencia"])}
            >
              <option value="semanal">Semanales</option>
              <option value="quincenal">Quincenales</option>
              <option value="mensual">Mensuales</option>
              <option value="diaria">Diarias</option>
            </select>
          </div>
        )}
      </div>

      {previa.data?.alerta && (
        <div
          role="alert"
          className="cd-row"
          style={{
            padding: "12px 14px",
            borderRadius: "var(--radius-md)",
            background: "var(--negative-soft)",
            color: "var(--negative)",
            flexWrap: "nowrap",
            alignItems: "flex-start",
          }}
        >
          <Icono nombre="alerta" />
          <span style={{ fontSize: 13, fontWeight: 600 }}>{previa.data.alerta}</span>
        </div>
      )}
      {previa.data && peticion && (
        <div className="cd-goal" style={{ borderStyle: "dashed" }}>
          <span className="cd-goal-name">Vista previa</span>
          <span className="cd-delta-note cd-num">
            {previa.data.cuotas.length === 0
              ? "Sin fecha de pago."
              : `${previa.data.cuotas.length === 1 ? "Un pago" : `${previa.data.cuotas.length} cuotas`} de ${formatoCOP(previa.data.cuotas[0]?.total ?? 0)} · primera ${fechaCorta(previa.data.cuotas[0]?.fecha ?? f.fecha)}`}
            {" · "}interés total {formatoCOP(previa.data.interes_total)}
            {previa.data.interes_total > 0 && ` (${porcentaje(previa.data.tasa_ea, 1)} E.A.)`}
          </span>
        </div>
      )}
      <button className="cd-btn cd-btn--primary" disabled={!peticion || crear.isPending} onClick={() => crear.mutate()}>
        {previa.data?.alerta ? "Guardar igual" : "Guardar préstamo"}
      </button>
    </aside>
  );
}
