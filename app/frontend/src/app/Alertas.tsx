/** Campana de alertas (fase 5): vencidos, saldo proyectado negativo, pagos próximos, presupuesto y metas. */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useId, useRef, useState } from "react";

import { api } from "@/shared/lib/api";
import { formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Icono } from "@/shared/ui/Icono";

const COLOR = { critica: "var(--negative)", aviso: "var(--warning)", info: "var(--ink-muted)" } as const;

export function Alertas() {
  const id = useId();
  const [abierto, setAbierto] = useState(false);
  const caja = useRef<HTMLDivElement>(null);
  const alertas = useQuery({ queryKey: claves.alertas, queryFn: api.alertas, refetchInterval: 15 * 60_000 });
  const lista = alertas.data ?? [];
  const criticas = lista.filter((a) => a.nivel === "critica").length;

  useEffect(() => {
    if (!abierto) return;
    const fuera = (e: MouseEvent) => caja.current && !caja.current.contains(e.target as Node) && setAbierto(false);
    const escape = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false);
    document.addEventListener("mousedown", fuera);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("mousedown", fuera);
      document.removeEventListener("keydown", escape);
    };
  }, [abierto]);

  return (
    <div ref={caja} style={{ position: "relative" }}>
      <button
        className="cd-icon-btn"
        aria-label={lista.length ? `Alertas: ${lista.length}` : "Sin alertas"}
        aria-expanded={abierto}
        aria-controls={id}
        onClick={() => setAbierto((x) => !x)}
        style={{ position: "relative" }}
      >
        <Icono nombre="campana" />
        {lista.length > 0 && (
          <span
            aria-hidden
            className="cd-num"
            style={{
              position: "absolute",
              top: -2,
              right: -2,
              minWidth: 18,
              height: 18,
              padding: "0 5px",
              borderRadius: 999,
              background: criticas ? "var(--negative)" : "var(--warning)",
              color: "var(--card)",
              font: "700 11px/18px var(--font-sans)",
            }}
          >
            {lista.length}
          </span>
        )}
      </button>
      {abierto && (
        <div
          id={id}
          role="dialog"
          aria-label="Alertas"
          className="cd-card cd-stack"
          style={{
            position: "absolute",
            right: 0,
            top: "calc(100% + 8px)",
            width: "min(360px, calc(100vw - 32px))",
            maxHeight: "70vh",
            overflowY: "auto",
            gap: 4,
            zIndex: 40,
            boxShadow: "var(--shadow-lg, 0 12px 32px rgb(0 0 0 / 0.18))",
          }}
        >
          <h3 className="cd-card-title" style={{ marginBottom: 6 }}>
            Alertas
          </h3>
          {lista.length === 0 && <span className="cd-delta-note">Todo en orden por ahora.</span>}
          {lista.map((a) => (
            <Link
              key={`${a.tipo}-${a.titulo}`}
              to={a.enlace}
              onClick={() => setAbierto(false)}
              className="cd-row"
              style={{
                flexWrap: "nowrap",
                alignItems: "flex-start",
                gap: 10,
                padding: "10px 8px",
                borderRadius: "var(--radius-md)",
                color: "inherit",
                textDecoration: "none",
              }}
            >
              <span
                aria-hidden
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: 999,
                  background: COLOR[a.nivel],
                  marginTop: 6,
                  flex: "none",
                }}
              />
              <span className="cd-stack" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>{a.titulo}</span>
                <span className="cd-delta-note cd-num">{formatoCOP(a.monto, { signo: true })}</span>
              </span>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
