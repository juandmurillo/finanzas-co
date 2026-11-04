/** Préstamos personales (RF-PP): me deben / debo, abonos, recordatorio y condonación. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { Prestamo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, mascaraMonto, parseMonto, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";

import { NuevoPrestamo } from "./NuevoPrestamo";

type Filtro = "activos" | "me_deben" | "debo" | "cerrados";
const ORIGEN: Record<Prestamo["origen"], string> = {
  amigo: "Amigo",
  familia: "Familia",
  companero: "Compañero",
  otra_fuente: "Otra fuente",
};

function estadoVisible(p: Prestamo): { texto: string; clase: string } {
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

function TarjetaPrestamo({ p }: { p: Prestamo }) {
  const cliente = useQueryClient();
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas() });
  const [abonando, setAbonando] = useState(false);
  const [monto, setMonto] = useState("");
  const [cuentaId, setCuentaId] = useState<number | null>(null);
  const [confirmarCondonar, setConfirmarCondonar] = useState(false);
  const refrescar = () => {
    void cliente.invalidateQueries({ queryKey: ["prestamos"] });
    void cliente.invalidateQueries({ queryKey: claves.cuentas });
  };
  const abonar = useMutation({
    mutationFn: () => {
      const centavos = parseMonto(monto);
      const cuenta = cuentaId ?? cuentas.data?.[0]?.id;
      if (!centavos || cuenta === undefined) throw new Error("Escribe el monto del abono");
      return api.abonar(p.id, { monto: centavos, cuenta_id: cuenta });
    },
    onSuccess: () => {
      toast.success(`Abono registrado · ${p.persona}`);
      setAbonando(false);
      setMonto("");
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const condonar = useMutation({
    mutationFn: () => api.condonar(p.id),
    onSuccess: () => toast(`Préstamo con ${p.persona} condonado`),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const estado = estadoVisible(p);
  const iniciales = p.persona
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
  const activo = p.estado === "activo";

  return (
    <article className="cd-card cd-stack" style={{ gap: 16 }}>
      <div className="cd-who" style={{ gap: 14 }}>
        <span
          className="cd-avatar"
          style={{ width: 44, height: 44, background: "var(--brand-soft)", color: "var(--on-brand-soft)" }}
        >
          {iniciales}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{p.persona}</b>
          <small>
            {ORIGEN[p.origen]} · {p.direccion === "presto_yo" ? "le prestaste" : "te prestó"} el{" "}
            {fechaCorta(p.fecha, true)}
          </small>
        </div>
        <span className={`cd-badge ${estado.clase}`}>{estado.texto}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
        <div className="cd-stack" style={{ gap: 2 }}>
          <span className="cd-delta-note">{p.direccion === "presto_yo" ? "Prestaste" : "Te prestó"}</span>
          <span className="cd-amt" style={{ fontSize: 17 }}>
            {formatoCOP(p.monto)}
          </span>
        </div>
        <div className="cd-stack" style={{ gap: 2 }}>
          <span className="cd-delta-note">Pendiente</span>
          <span
            className="cd-amt"
            style={{ fontSize: 17, color: p.direccion === "presto_yo" && p.pendiente ? "var(--positive)" : undefined }}
          >
            {formatoCOP(p.pendiente)}
          </span>
        </div>
        <div className="cd-stack" style={{ gap: 2 }}>
          <span className="cd-delta-note">Interés</span>
          <span className="cd-amt" style={{ fontSize: 17 }}>
            {p.interes_total ? `${formatoCOP(p.interes_total)} · ${porcentaje(p.tasa_ea, 1)} E.A.` : "Sin interés"}
          </span>
        </div>
      </div>
      <div
        className="cd-progress"
        role="progressbar"
        aria-label="Pagado"
        aria-valuenow={p.pagado_pct}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <i style={{ width: `${p.pagado_pct}%` }} />
      </div>
      <span className="cd-delta-note cd-num">
        {p.cuotas.length === 0
          ? "Pago libre, sin fecha"
          : p.cuotas.map((c) => `${fechaCorta(c.fecha)} ${formatoCOP(c.capital + c.interes)}`).join(" · ")}
      </span>
      {activo && abonando && (
        <div className="cd-row" style={{ gap: 8 }}>
          <input
            aria-label="Monto del abono"
            className="cd-input cd-num"
            style={{ flex: "1 1 140px", width: "auto" }}
            inputMode="decimal"
            placeholder={formatoCOP(p.proxima_cuota?.monto ?? p.pendiente)}
            value={monto}
            onChange={(e) => setMonto(mascaraMonto(e.target.value))}
          />
          <select
            aria-label="Cuenta"
            className="cd-input"
            style={{ flex: "1 1 140px", width: "auto" }}
            value={cuentaId ?? cuentas.data?.[0]?.id ?? ""}
            onChange={(e) => setCuentaId(Number(e.target.value))}
          >
            {(cuentas.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
          <button
            className="cd-btn cd-btn--primary cd-btn--sm"
            disabled={abonar.isPending}
            onClick={() => abonar.mutate()}
          >
            Guardar abono
          </button>
          <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setAbonando(false)}>
            Cancelar
          </button>
        </div>
      )}
      {activo && !abonando && (
        <div className="cd-row" style={{ gap: 8 }}>
          <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => setAbonando(true)}>
            Registrar abono
          </button>
          {p.direccion === "presto_yo" && (
            <button
              className="cd-btn cd-btn--secondary cd-btn--sm"
              onClick={() =>
                void navigator.clipboard
                  .writeText(recordatorio(p))
                  .then(() => toast.success("Recordatorio copiado: pégalo en WhatsApp"))
                  .catch(() => toast.error("No pude copiar al portapapeles"))
              }
            >
              Copiar recordatorio
            </button>
          )}
          {confirmarCondonar ? (
            <button
              className="cd-btn cd-btn--sm"
              style={{ background: "var(--negative)", color: "var(--card)" }}
              onClick={() => condonar.mutate()}
            >
              Confirmar: condonar {formatoCOP(p.capital_pendiente)}
            </button>
          ) : (
            <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setConfirmarCondonar(true)}>
              Condonar
            </button>
          )}
        </div>
      )}
    </article>
  );
}

export function PrestamosPage() {
  const [filtro, setFiltro] = useState<Filtro>("activos");
  const resumen = useQuery({ queryKey: claves.resumenPrestamos, queryFn: api.resumenPrestamos });
  const lista = useQuery({ queryKey: claves.prestamos(), queryFn: () => api.prestamos() });
  const visibles = (lista.data ?? []).filter((p) =>
    filtro === "activos"
      ? p.estado === "activo"
      : filtro === "me_deben"
        ? p.estado === "activo" && p.direccion === "presto_yo"
        : filtro === "debo"
          ? p.estado === "activo" && p.direccion === "me_prestaron"
          : p.estado !== "activo",
  );
  const cerrados = (lista.data ?? []).filter((p) => p.estado !== "activo").length;
  const r = resumen.data;

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Préstamos personales</h1>
          <p>Con amigos, familia u otras fuentes. Sin interés, salvo que lo pactes.</p>
        </div>
      </div>
      {r && (
        <div className="cd-bento">
          <div className="span-3 cd-balance">
            <div className="cd-balance-top">
              <span className="cd-balance-label">Me deben</span>
              <span className="cd-chip-glass">{r.activos} activos</span>
            </div>
            <div className="cd-balance-value">
              <Dinero centavos={r.me_deben} />
            </div>
            <div className="cd-balance-foot">
              <span className="cd-delta">{formatoCOP(r.proximos_7_dias)} en 7 días</span>
            </div>
          </div>
          {[
            { etiqueta: "Debo", valor: r.debo, insignia: "incluye intereses", clase: "cd-badge--neutral" },
            {
              etiqueta: "Próximos 7 días",
              valor: r.proximos_7_dias,
              insignia: "por cobrar o pagar",
              clase: "cd-badge--warning",
            },
          ].map((k) => (
            <div key={k.etiqueta} className="cd-card cd-kpi span-3">
              <span className="cd-kpi-label">{k.etiqueta}</span>
              <span className="cd-kpi-value">
                <Dinero centavos={k.valor} />
              </span>
              <span className={`cd-badge ${k.clase}`} style={{ alignSelf: "flex-start" }}>
                {k.insignia}
              </span>
            </div>
          ))}
          <div className="cd-card cd-kpi span-3">
            <span className="cd-kpi-label">Vencidos</span>
            <span className="cd-kpi-value">{r.vencidos}</span>
            <span
              className={`cd-badge ${r.vencidos ? "cd-badge--negative" : "cd-badge--positive"}`}
              style={{ alignSelf: "flex-start" }}
            >
              {r.vencidos ? "Revisar" : "Al día"}
            </span>
          </div>
        </div>
      )}
      <div className="cd-bento">
        <div className="span-8 cd-stack" style={{ gap: 16 }}>
          <div className="cd-seg cd-seg--brand" role="tablist" aria-label="Filtro" style={{ alignSelf: "flex-start" }}>
            {(
              [
                ["activos", "Activos"],
                ["me_deben", "Me deben"],
                ["debo", "Debo"],
                ["cerrados", "Pagados"],
              ] as [Filtro, string][]
            ).map(([v, t]) => (
              <button key={v} role="tab" aria-selected={filtro === v} onClick={() => setFiltro(v)}>
                {t}
                {v === "cerrados" && cerrados > 0 && <span className="count">{cerrados}</span>}
              </button>
            ))}
          </div>
          {lista.isPending && <TarjetaCargando />}
          {lista.isError && <ErrorVista error={lista.error} reintentar={() => void lista.refetch()} />}
          {lista.isSuccess && visibles.length === 0 && (
            <section className="cd-card">
              <Vacio
                titulo={filtro === "cerrados" ? "Aún no hay préstamos cerrados" : "No tienes préstamos activos"}
                texto="Registra uno con el formulario."
              />
            </section>
          )}
          {visibles.map((p) => (
            <TarjetaPrestamo key={p.id} p={p} />
          ))}
        </div>
        <div className="span-4">
          <NuevoPrestamo />
        </div>
      </div>
    </>
  );
}
