/** Crear o editar un crédito y registrar abonos a capital (RF-DE, fase 7 bloque E). */
import { useRefrescar } from "@/shared/lib/useRefrescar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { CreditoDetalle, CreditoNuevo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { hoyISO, mascaraMonto, parseMonto } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Hoja } from "@/shared/ui/Hoja";
import { SelectorCuenta } from "@/shared/ui/SelectorCuenta";

const aTexto = (centavos: number) => mascaraMonto(String(centavos / 100));

export function FormCredito({ credito, alCerrar }: { credito: CreditoDetalle | null; alCerrar: () => void }) {
  const id = useId();
  const refrescar = useRefrescar();
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas() });
  const [f, setF] = useState({
    nombre: credito?.nombre ?? "",
    entidad: credito?.entidad ?? "",
    fecha: credito?.fecha_desembolso ?? hoyISO(),
    capital: credito ? aTexto(credito.capital_inicial) : "",
    recibido: credito ? aTexto(credito.monto_recibido) : "",
    tasa: credito ? String(+(credito.tasa_ea * 100).toFixed(2)).replace(".", ",") : "",
    plazo: credito ? String(credito.plazo_meses) : "",
    cuota: credito ? aTexto(credito.cuota) : "",
    seguro: credito ? aTexto(credito.seguro_mensual) : "",
    dia: credito ? String(credito.dia_pago) : "",
    cuentaId: credito?.cuenta_pago_id ?? null,
    desembolsoId: credito ? credito.cuenta_desembolso_id : null,
  });
  const cambiar = (k: keyof typeof f, v: string | number | null) => setF((x) => ({ ...x, [k]: v }));
  const guardar = useMutation({
    mutationFn: () => {
      const capital = parseMonto(f.capital);
      const cuota = parseMonto(f.cuota);
      const tasa = Number(f.tasa.replace(",", ".")) / 100;
      if (!f.nombre.trim() || !f.entidad.trim() || !capital || !cuota || !tasa || !Number(f.plazo) || !Number(f.dia))
        throw new Error("Completa nombre, entidad, capital, tasa, plazo, cuota y día de pago");
      const datos: CreditoNuevo = {
        nombre: f.nombre.trim(),
        entidad: f.entidad.trim(),
        fecha_desembolso: f.fecha,
        capital_inicial: capital,
        monto_recibido: parseMonto(f.recibido) ?? capital,
        tasa_ea: tasa,
        plazo_meses: Number(f.plazo),
        cuota,
        dia_pago: Math.min(31, Number(f.dia)),
        seguro_mensual: parseMonto(f.seguro) ?? 0,
        cuenta_pago_id: f.cuentaId,
        cuenta_desembolso_id: f.desembolsoId ?? (credito ? null : f.cuentaId),
        numero: credito?.numero ?? null,
      };
      return credito ? api.editarCredito(credito.id, datos) : api.crearCredito(datos);
    },
    onSuccess: () => {
      toast.success(credito ? "Crédito actualizado: se recalcularon sus pagos" : "Crédito creado y cuotas programadas");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const campo = (k: keyof typeof f, texto: string, tipo: "texto" | "monto" | "numero" | "fecha", ayuda?: string) => (
    <label className="cd-stack" style={{ gap: 6 }} htmlFor={`${id}-${k}`}>
      <span className="cd-kpi-label">{texto}</span>
      <input
        id={`${id}-${k}`}
        className={`cd-input ${tipo === "texto" ? "" : "cd-num"}`}
        type={tipo === "fecha" ? "date" : "text"}
        inputMode={tipo === "monto" ? "decimal" : tipo === "numero" ? "decimal" : undefined}
        placeholder={tipo === "monto" ? "$ 0" : undefined}
        value={String(f[k] ?? "")}
        onChange={(e) =>
          cambiar(
            k,
            tipo === "monto"
              ? mascaraMonto(e.target.value)
              : tipo === "numero"
                ? e.target.value.replace(/[^\d,]/g, "")
                : e.target.value,
          )
        }
      />
      {ayuda && <span className="cd-delta-note">{ayuda}</span>}
    </label>
  );
  return (
    <Hoja
      titulo={credito ? `Editar ${credito.nombre}` : "Nuevo crédito"}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--primary" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
            {credito ? "Guardar cambios" : "Crear crédito"}
          </button>
        </>
      }
    >
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {campo("nombre", "Nombre", "texto")}
        {campo("entidad", "Entidad", "texto")}
        {campo("capital", "Capital inicial", "monto", "Lo que debes al inicio")}
        {campo("recibido", "Monto recibido", "monto", "Lo que llegó a tu cuenta")}
        {campo("tasa", "Tasa E.A. %", "numero")}
        {campo("plazo", "Plazo (meses)", "numero")}
        {campo("cuota", "Cuota", "monto", "Incluye el seguro")}
        {campo("seguro", "Seguro mensual", "monto")}
        {campo("fecha", "Desembolso", "fecha")}
        {campo("dia", "Día de pago", "numero")}
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Cuenta desde la que pagas</span>
        <SelectorCuenta cuentas={cuentas.data ?? []} valor={f.cuentaId} alCambiar={(c) => cambiar("cuentaId", c)} />
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Cuenta donde llegó el dinero</span>
        <SelectorCuenta
          titulo="Cuenta del desembolso"
          cuentas={cuentas.data ?? []}
          valor={f.desembolsoId ?? (credito ? null : f.cuentaId)}
          alCambiar={(c) => cambiar("desembolsoId", c)}
        />
        <span className="cd-delta-note">
          {credito && credito.cuenta_desembolso_id === null && f.desembolsoId === null
            ? "Este crédito no tiene desembolso registrado; elige la cuenta para crearlo."
            : "Se registra el monto recibido como desembolso (no cuenta como ingreso)."}
        </span>
      </div>
    </Hoja>
  );
}
