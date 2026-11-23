/** Selector de cuenta con su logo, nombre y saldo pequeño debajo. */
import { useQuery } from "@tanstack/react-query";

import type { Cuenta } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";

import { Desplegable } from "./Desplegable";
import { Icono, type NombreIcono } from "./Icono";
import { SimboloVista, tipoSimbolo } from "./Simbolo";

export const ICONO_TIPO: Record<string, NombreIcono> = {
  efectivo: "bolsa",
  ahorro: "meta",
  billetera: "cuentas",
  tarjeta_credito: "cuentas",
  inversion: "flujo",
};

export function LogoCuenta({ cuenta, tam = 36 }: { cuenta: Pick<Cuenta, "nombre" | "tipo" | "icono">; tam?: number }) {
  if (cuenta.icono?.startsWith("data:image/")) {
    return (
      <span className="logo-cuenta logo-cuenta--imagen" style={{ width: tam, height: tam }}>
        <img src={cuenta.icono} alt="" />
      </span>
    );
  }
  if (cuenta.icono && !cuenta.icono.startsWith("/") && tipoSimbolo(cuenta.icono) !== "vacio") {
    return (
      <span className="cd-kpi-ico" style={{ width: tam, height: tam, flex: "none" }} aria-hidden>
        <SimboloVista valor={cuenta.icono} respaldo={ICONO_TIPO[cuenta.tipo] ?? "cuentas"} tam={tam * 0.6} />
      </span>
    );
  }
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

/** Lista desplegable de cuentas (la misma `Desplegable` de toda la app): logo, nombre y saldo en cada opción. */
export function SelectorCuenta({ cuentas, valor, alCambiar, excluir, id, titulo = "Cuenta" }: Props) {
  return (
    <Desplegable
      id={id}
      className="cd-input selector-disparador selector-cuenta"
      value={valor ?? ""}
      placeholder="Elegir cuenta…"
      aria-label={id ? undefined : titulo}
      onChange={(e) => alCambiar(Number(e.target.value))}
    >
      {cuentas
        .filter((c) => c.id !== excluir)
        .map((c) => (
          <option key={c.id} value={c.id}>
            <span className="opcion-cuenta">
              <LogoCuenta cuenta={c} tam={26} />
              <span className="opcion-cuenta-texto">
                {c.nombre}
                <small className="cd-delta-note cd-num">{formatoCOP(c.saldo)}</small>
              </span>
            </span>
          </option>
        ))}
    </Desplegable>
  );
}
