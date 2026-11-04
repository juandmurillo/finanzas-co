/** Fase 6 (RF-DE-05): abono único (reducir plazo vs. cuota) y simulador de compra de cartera. */
import { useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";

import type { CreditoDetalle, OpcionAbono } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { formatoCOP, mascaraMonto, parseMonto, porcentaje } from "@/shared/lib/formato";
import { useDebounce } from "@/shared/lib/useDebounce";

const etiquetaEstilo = { fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" } as const;

function Opcion({
  titulo,
  o,
  base,
  destacada,
}: {
  titulo: string;
  o: OpcionAbono;
  base: OpcionAbono;
  destacada?: boolean;
}) {
  return (
    <div
      className="cd-stack"
      style={{
        gap: 4,
        padding: 14,
        borderRadius: "var(--radius-md)",
        border: `1px solid ${destacada ? "var(--brand)" : "var(--border)"}`,
        background: destacada ? "var(--brand-soft)" : undefined,
      }}
    >
      <span className="cd-kpi-label">{titulo}</span>
      <span className="cd-amt" style={{ fontSize: 18 }}>
        Ahorras {formatoCOP(o.ahorro)}
      </span>
      <span className="cd-delta-note cd-num">
        cuota {formatoCOP(o.cuota)} · {o.meses} meses
        {o.meses < base.meses && ` (${base.meses - o.meses} menos)`}
      </span>
    </div>
  );
}

export function AbonoUnico({ creditos }: { creditos: CreditoDetalle[] }) {
  const id = useId();
  const [creditoId, setCreditoId] = useState<number | null>(null);
  const [monto, setMonto] = useState("");
  const credito = creditoId ?? creditos[0]?.id ?? null; // por defecto, la prioridad avalancha
  const abono = useDebounce(parseMonto(monto) ?? 0, 350);
  const r = useQuery({
    queryKey: ["creditos", "abono-unico", credito, abono],
    queryFn: () => api.abonoUnico(credito as number, abono),
    enabled: credito !== null && abono > 0,
  });
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <div className="cd-card-head">
        <h3 className="cd-card-title">Si abonas una vez</h3>
        <span className="cd-delta-note">pide siempre «abono a capital»</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 10 }}>
        <div className="cd-stack" style={{ gap: 6 }}>
          <label htmlFor={`${id}-credito`} style={etiquetaEstilo}>
            Crédito
          </label>
          <select
            id={`${id}-credito`}
            className="cd-input"
            value={credito ?? ""}
            onChange={(e) => setCreditoId(Number(e.target.value))}
          >
            {creditos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre} · {porcentaje(c.tasa_ea, 1)}
              </option>
            ))}
          </select>
        </div>
        <div className="cd-stack" style={{ gap: 6 }}>
          <label htmlFor={`${id}-monto`} style={etiquetaEstilo}>
            Abono
          </label>
          <input
            id={`${id}-monto`}
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 200.000"
            value={monto}
            onChange={(e) => setMonto(mascaraMonto(e.target.value))}
          />
        </div>
      </div>
      {r.data && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
            <Opcion titulo="Reducir plazo" o={r.data.reducir_plazo} base={r.data.sin_abono} destacada />
            <Opcion titulo="Reducir cuota" o={r.data.reducir_cuota} base={r.data.sin_abono} />
          </div>
          <span className="cd-delta-note">
            Reducir plazo ahorra {formatoCOP(r.data.reducir_plazo.ahorro - r.data.reducir_cuota.ahorro)} más en
            intereses y seguro. Reducir cuota solo conviene si necesitas liberar flujo cada mes.
          </span>
        </>
      )}
    </section>
  );
}

export function CompraCartera() {
  const id = useId();
  const [tasa, setTasa] = useState("24");
  const [plazo, setPlazo] = useState("24");
  const [costos, setCostos] = useState("");
  const [seguro, setSeguro] = useState("");
  const entrada = useDebounce(
    {
      tasa_ea: Number(tasa.replace(",", ".")) / 100,
      plazo_meses: Number(plazo) || 0,
      costos_iniciales: parseMonto(costos) ?? 0,
      seguro_mensual: parseMonto(seguro) ?? 0,
    },
    400,
  );
  const valido = entrada.tasa_ea > 0 && entrada.tasa_ea < 3 && entrada.plazo_meses >= 1 && entrada.plazo_meses <= 120;
  const r = useQuery({
    queryKey: ["creditos", "compra-cartera", entrada],
    queryFn: () => api.compraCartera(entrada),
    enabled: valido,
  });
  const campo = (clave: string, texto: string, valor: string, cambiar: (v: string) => void, placeholder: string) => (
    <div className="cd-stack" style={{ gap: 6 }}>
      <label htmlFor={`${id}-${clave}`} style={etiquetaEstilo}>
        {texto}
      </label>
      <input
        id={`${id}-${clave}`}
        className="cd-input cd-num"
        inputMode="decimal"
        placeholder={placeholder}
        value={valor}
        onChange={(e) => cambiar(e.target.value)}
      />
    </div>
  );
  const c = r.data;
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <div className="cd-card-head">
        <h3 className="cd-card-title">¿Y si compras la cartera?</h3>
        <span className="cd-delta-note">recoge todos tus créditos en uno nuevo</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10 }}>
        {campo("tasa", "Tasa E.A. ofrecida (%)", tasa, (v) => setTasa(v.replace(/[^\d,.]/g, "")), "24")}
        {campo("plazo", "Plazo (meses)", plazo, (v) => setPlazo(v.replace(/\D/g, "").slice(0, 3)), "24")}
        {campo("costos", "Costos de apertura", costos, (v) => setCostos(mascaraMonto(v)), "$ 0")}
        {campo("seguro", "Seguro mensual", seguro, (v) => setSeguro(mascaraMonto(v)), "$ 0")}
      </div>
      {c && (
        <>
          {c.supera_usura && (
            <div role="alert" className="cd-badge cd-badge--negative" style={{ alignSelf: "flex-start" }}>
              Esa tasa supera la usura de consumo ({porcentaje(c.usura_consumo ?? 0, 2)}): ningún banco puede cobrarla
            </div>
          )}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
            <div className="cd-stack" style={{ gap: 2 }}>
              <span className="cd-delta-note">Cuota</span>
              <span className="cd-amt" style={{ fontSize: 18 }}>
                {formatoCOP(c.cuota_nueva)}
              </span>
              <span className="cd-delta-note cd-num">hoy pagas {formatoCOP(c.cuota_actual)}</span>
            </div>
            <div className="cd-stack" style={{ gap: 2 }}>
              <span className="cd-delta-note">Te falta pagar</span>
              <span className="cd-amt" style={{ fontSize: 18 }}>
                {formatoCOP(c.pagos_total_nuevo)}
              </span>
              <span className="cd-delta-note cd-num">
                hoy {formatoCOP(c.pagos_restantes_actual)} en {c.meses_actual} meses
              </span>
            </div>
            <div className="cd-stack" style={{ gap: 2 }}>
              <span className="cd-delta-note">Costo real</span>
              <span className="cd-amt" style={{ fontSize: 18 }}>
                {porcentaje(c.costo_real_ea_nuevo, 1)} E.A.
              </span>
              <span className="cd-delta-note cd-num">en {c.meses_nuevo} meses</span>
            </div>
          </div>
          <span
            className={`cd-badge ${c.conviene ? "cd-badge--positive" : "cd-badge--warning"}`}
            style={{ alignSelf: "flex-start" }}
          >
            {c.conviene
              ? `Conviene: pagarías ${formatoCOP(c.diferencia)} menos en total`
              : `No conviene: pagarías ${formatoCOP(-c.diferencia)} más en total${
                  c.cuota_nueva < c.cuota_actual ? ", aunque la cuota baje" : ""
                }`}
          </span>
        </>
      )}
    </section>
  );
}
