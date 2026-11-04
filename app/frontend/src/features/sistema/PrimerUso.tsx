/** Primer uso: una instalación vacía elige entre empezar con sus datos o explorar con datos de demostración. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { api } from "@/shared/lib/api";
import { Icono } from "@/shared/ui/Icono";

export function PrimerUso() {
  const cliente = useQueryClient();
  const [nombre, setNombre] = useState("");
  const empezar = useMutation({
    mutationFn: (modo: "vacio" | "demo") => api.primerUso(nombre.trim(), modo),
    onSuccess: () => void cliente.invalidateQueries(),
    onError: (e) => toast.error(e.message),
  });
  return (
    <main className="primer-uso">
      <div className="primer-uso-panel cd-stack">
        <div className="cd-logo">
          <span className="cd-logo-mark">
            <i />
          </span>
          Caudal
        </div>
        <h1>Bienvenido a tus finanzas</h1>
        <p className="cd-delta-note" style={{ margin: 0 }}>
          Todo se guarda en este computador. Nada sale de aquí salvo que actives el asistente.
        </p>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span className="cd-kpi-label">¿Cómo te llamas? (opcional)</span>
          <input
            className="cd-input"
            maxLength={60}
            autoFocus
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
          />
        </label>
        <div className="primer-uso-opciones">
          <button type="button" disabled={empezar.isPending} onClick={() => empezar.mutate("vacio")}>
            <span className="cd-kpi-ico">
              <Icono nombre="cuentas" />
            </span>
            <b>Empezar con mis datos</b>
            <span>Con categorías listas y dos cuentas que puedes cambiar.</span>
          </button>
          <button type="button" disabled={empezar.isPending} onClick={() => empezar.mutate("demo")}>
            <span className="cd-kpi-ico">
              <Icono nombre="flujo" />
            </span>
            <b>Explorar con datos de ejemplo</b>
            <span>18 meses de una persona ficticia, con créditos, presupuestos y metas.</span>
          </button>
        </div>
      </div>
    </main>
  );
}
