/** Estados de toda vista: cargando (skeleton con la forma real), vacío (con acción) y error (con reintentar). */
import type { ReactNode } from "react";

import { Icono } from "./Icono";

export function Esqueleto({ alto = 16, ancho = "100%" }: { alto?: number; ancho?: number | string }) {
  return <div className="skeleton" style={{ height: alto, width: ancho }} aria-hidden="true" />;
}

export function TarjetaCargando({ filas = 4 }: { filas?: number }) {
  return (
    <div className="cd-card cd-stack" aria-busy="true" aria-label="Cargando">
      <Esqueleto alto={20} ancho="40%" />
      {Array.from({ length: filas }, (_, i) => (
        <Esqueleto key={i} alto={36} />
      ))}
    </div>
  );
}

export function Vacio({ titulo, texto, accion }: { titulo: string; texto?: string; accion?: ReactNode }) {
  return (
    <div className="cd-stack" style={{ alignItems: "center", textAlign: "center", padding: "32px 16px", gap: 8 }}>
      <span className="cd-kpi-ico">
        <Icono nombre="info" />
      </span>
      <b style={{ fontSize: 15 }}>{titulo}</b>
      {texto && <span className="cd-delta-note">{texto}</span>}
      {accion}
    </div>
  );
}

export function ErrorVista({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  const mensaje = error instanceof Error ? error.message : "Algo salió mal";
  return (
    <div
      role="alert"
      className="cd-row"
      style={{
        padding: "14px 18px",
        borderRadius: "var(--radius-lg)",
        background: "var(--negative-soft)",
        color: "var(--negative)",
      }}
    >
      <Icono nombre="alerta" />
      <span style={{ flex: 1, fontSize: 14, fontWeight: 600 }}>No pude cargar esto: {mensaje}</span>
      {reintentar && (
        <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={reintentar}>
          Reintentar
        </button>
      )}
    </div>
  );
}
