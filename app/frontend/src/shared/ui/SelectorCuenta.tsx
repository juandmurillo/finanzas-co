/** Selector de cuenta con su logo, nombre y saldo pequeño debajo. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { Cuenta } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";

import { Hoja } from "./Hoja";
import { Icono, type NombreIcono } from "./Icono";

const ICONO_TIPO: Record<string, NombreIcono> = {
  efectivo: "bolsa",
  ahorro: "meta",
  billetera: "cuentas",
  tarjeta_credito: "cuentas",
  inversion: "flujo",
};

export function LogoCuenta({ cuenta, tam = 36 }: { cuenta: Pick<Cuenta, "nombre" | "tipo" | "icono">; tam?: number }) {
  if (cuenta.icono?.startsWith("/")) {
    return (
      <span className="logo-cuenta" style={{ width: tam, height: tam, padding: tam < 24 ? 2 : 4 }}>
        <img src={cuenta.icono} alt="" />
      </span>
    );
  }
  return (
    <span className="cd-kpi-ico" style={{ width: tam, height: tam, flex: "none" }} aria-hidden>
      <Icono nombre={ICONO_TIPO[cuenta.tipo] ?? "cuentas"} pequeno={tam < 32} />
    </span>
  );
}

/** Nombre de una cuenta con su logo pequeño delante; la busca en la lista de cuentas (ya en caché). */
export function CuentaEtiqueta({ nombre, id, tam = 16 }: { nombre: string; id?: number | null; tam?: number }) {
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas(), staleTime: 60_000 });
  const cuenta = cuentas.data?.find((c) => (id != null ? c.id === id : c.nombre === nombre));
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4, verticalAlign: "middle" }}>
      {cuenta && <LogoCuenta cuenta={cuenta} tam={tam} />}
      {nombre}
    </span>
  );
}

interface Props {
  cuentas: Cuenta[];
  valor: number | null;
  alCambiar: (id: number) => void;
  excluir?: number | null;
  id?: string;
  titulo?: string;
}

export function SelectorCuenta({ cuentas, valor, alCambiar, excluir, id, titulo = "Cuenta" }: Props) {
  const [abierto, setAbierto] = useState(false);
  const actual = cuentas.find((c) => c.id === valor);
  return (
    <>
      <button
        id={id}
        type="button"
        className="cd-input selector-disparador"
        aria-haspopup="dialog"
        onClick={() => setAbierto(true)}
      >
        {actual ? (
          <>
            <LogoCuenta cuenta={actual} tam={26} />
            <span className="selector-texto">
              {actual.nombre}
              <small className="cd-delta-note cd-num"> {formatoCOP(actual.saldo)}</small>
            </span>
          </>
        ) : (
          <span className="selector-texto cd-muted">Elegir cuenta…</span>
        )}
        <span aria-hidden className="cd-muted">
          ▾
        </span>
      </button>
      {abierto && (
        <Hoja titulo={titulo} onCerrar={() => setAbierto(false)}>
          <div className="cd-stack" style={{ gap: 6 }} role="list">
            {cuentas
              .filter((c) => c.id !== excluir)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  role="listitem"
                  className={`selector-opcion ${c.id === valor ? "activa" : ""}`}
                  onClick={() => {
                    alCambiar(c.id);
                    setAbierto(false);
                  }}
                >
                  <LogoCuenta cuenta={c} />
                  <span className="cd-stack" style={{ gap: 0, flex: 1, minWidth: 0 }}>
                    <b style={{ fontSize: 14 }}>{c.nombre}</b>
                    <small className="cd-delta-note cd-num">{formatoCOP(c.saldo)}</small>
                  </span>
                </button>
              ))}
          </div>
        </Hoja>
      )}
    </>
  );
}
