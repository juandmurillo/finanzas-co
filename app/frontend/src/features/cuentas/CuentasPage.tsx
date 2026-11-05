/** Cuentas: saldo calculado de cada una (nunca se edita a mano; RF-CU-02), crear, editar, archivar y elegir
 * cuáles suman al saldo total (fase 8, puntos 3 y 15). */
import { useRefrescar } from "@/shared/lib/useRefrescar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";

import type { Cuenta, CuentaNueva } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { formatoCOP, mascaraMonto, parseMonto } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { LogoCuenta } from "@/shared/ui/SelectorCuenta";

const TIPOS: Record<CuentaNueva["tipo"] & string, string> = {
  billetera: "Billetera digital",
  ahorro: "Ahorro",
  efectivo: "Efectivo",
  tarjeta_credito: "Tarjeta de crédito",
  inversion: "Inversión",
};
/** Logos propios opcionales: `public/cuentas/logos.json` con [{ ruta, nombre }]. El repositorio no incluye marcas. */
async function cargarLogos(): Promise<{ ruta: string; nombre: string }[]> {
  try {
    const r = await fetch("/cuentas/logos.json");
    return r.ok ? ((await r.json()) as { ruta: string; nombre: string }[]) : [];
  } catch {
    return [];
  }
}

function FormCuenta({ cuenta, alCerrar }: { cuenta: Cuenta | null; alCerrar: () => void }) {
  const refrescar = useRefrescar();
  const logos = useQuery({ queryKey: ["logos-cuentas"], queryFn: cargarLogos, staleTime: Infinity });
  const [f, setF] = useState({
    nombre: cuenta?.nombre ?? "",
    tipo: (cuenta?.tipo ?? "billetera") as NonNullable<CuentaNueva["tipo"]>,
    institucion: cuenta?.institucion ?? "",
    icono: cuenta?.icono ?? null,
    saldo: "",
    incluir: cuenta?.incluir_en_total ?? true,
  });
  const guardar = useMutation({
    mutationFn: async () => {
      if (!f.nombre.trim()) throw new Error("Escribe el nombre de la cuenta");
      const base = {
        nombre: f.nombre.trim(),
        tipo: f.tipo,
        institucion: f.institucion.trim() || null,
        icono: f.icono,
        incluir_en_total: f.incluir,
      };
      if (cuenta) await api.editarCuenta(cuenta.id, base);
      else await api.crearCuenta({ ...base, saldo_inicial: parseMonto(f.saldo) ?? 0 });
    },
    onSuccess: () => {
      toast.success(cuenta ? "Cuenta actualizada" : "Cuenta creada");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const archivar = useMutation({
    mutationFn: () => api.editarCuenta(cuenta?.id ?? 0, { archivada: true }),
    onSuccess: () => {
      toast(`${cuenta?.nombre} archivada: sus movimientos se conservan`);
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const etiqueta = { fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" } as const;
  return (
    <Hoja
      titulo={cuenta ? `Editar ${cuenta.nombre}` : "Nueva cuenta"}
      onCerrar={alCerrar}
      pie={
        <>
          {cuenta && (
            <button
              className="cd-btn cd-btn--ghost izquierda"
              disabled={archivar.isPending || cuenta.saldo !== 0}
              title={
                cuenta.saldo !== 0
                  ? "Deja el saldo en cero (con un ajuste o transferencia) antes de archivarla"
                  : undefined
              }
              onClick={() => archivar.mutate()}
            >
              Archivar
            </button>
          )}
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--primary" disabled={guardar.isPending} onClick={() => guardar.mutate()}>
            {cuenta ? "Guardar cambios" : "Crear cuenta"}
          </button>
        </>
      }
    >
      <label className="cd-stack" style={{ gap: 6 }}>
        <span style={etiqueta}>Nombre</span>
        <input className="cd-input" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} />
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Tipo</span>
          <select
            className="cd-input"
            value={f.tipo}
            onChange={(e) => {
              const tipo = e.target.value as typeof f.tipo;
              setF({ ...f, tipo, incluir: tipo === "inversion" ? false : f.incluir });
            }}
          >
            {Object.entries(TIPOS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </select>
        </label>
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Entidad (opcional)</span>
          <input
            className="cd-input"
            value={f.institucion}
            onChange={(e) => setF({ ...f, institucion: e.target.value })}
          />
        </label>
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        <span style={etiqueta}>Logo</span>
        <div className="cd-row" role="radiogroup" aria-label="Logo" style={{ gap: 8 }}>
          {[{ ruta: null, nombre: "Ícono del tipo" }, ...(logos.data ?? [])].map((l) => (
            <button
              key={l.nombre}
              type="button"
              role="radio"
              aria-checked={f.icono === l.ruta}
              className="cd-btn cd-btn--sm selector-chip"
              aria-pressed={f.icono === l.ruta}
              onClick={() => setF({ ...f, icono: l.ruta })}
            >
              <LogoCuenta cuenta={{ nombre: f.nombre, tipo: f.tipo, icono: l.ruta }} tam={20} />
              {l.nombre}
            </button>
          ))}
        </div>
      </div>
      {!cuenta && (
        <label className="cd-stack" style={{ gap: 6 }}>
          <span style={etiqueta}>Saldo de hoy</span>
          <input
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={f.saldo}
            onChange={(e) => setF({ ...f, saldo: mascaraMonto(e.target.value) })}
          />
          <span className="cd-delta-note">Desde aquí el saldo se calcula con cada movimiento.</span>
        </label>
      )}
      <label className="cd-row" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={f.incluir} onChange={(e) => setF({ ...f, incluir: e.target.checked })} />
        Sumar al saldo total (Inicio, Cuentas y saldo proyectado)
      </label>
    </Hoja>
  );
}

export function CuentasPage() {
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: api.cuentas });
  const refrescar = useRefrescar();
  const [editando, setEditando] = useState<Cuenta | "nueva" | null>(null);
  const incluir = useMutation({
    mutationFn: (c: Cuenta) => api.editarCuenta(c.id, { incluir_en_total: !c.incluir_en_total }),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  if (cuentas.isPending) return <TarjetaCargando />;
  if (cuentas.isError) return <ErrorVista error={cuentas.error} reintentar={() => void cuentas.refetch()} />;
  const incluidas = cuentas.data.filter((c) => c.incluir_en_total);
  const total = incluidas.reduce((t, c) => t + c.saldo, 0);
  const todas = cuentas.data.reduce((t, c) => t + c.saldo, 0);

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Cuentas</h1>
          <p>El saldo se calcula con cada movimiento; para corregirlo registra un ajuste.</p>
        </div>
        <button className="cd-btn cd-btn--primary" onClick={() => setEditando("nueva")}>
          + Cuenta
        </button>
      </div>
      {editando && (
        <FormCuenta
          key={editando === "nueva" ? "nueva" : editando.id}
          cuenta={editando === "nueva" ? null : editando}
          alCerrar={() => setEditando(null)}
        />
      )}
      <div className="cd-bento">
        <div className="span-4 cd-balance">
          <div className="cd-balance-top">
            <span className="cd-balance-label">Saldo total</span>
            <span className="cd-chip-glass">
              {incluidas.length} de {cuentas.data.length} cuentas
            </span>
          </div>
          <div className="cd-balance-value">
            <Dinero centavos={total} />
          </div>
          {total !== todas && (
            <div className="cd-balance-foot">
              <span style={{ opacity: 0.85 }}>Con todas las cuentas: {formatoCOP(todas)}</span>
            </div>
          )}
        </div>
        {cuentas.data.map((c) => (
          <div key={c.id} className="cd-card cd-kpi span-4" style={{ opacity: c.incluir_en_total ? 1 : 0.75 }}>
            <div className="cd-row" style={{ justifyContent: "space-between", flexWrap: "nowrap", gap: 8 }}>
              <span className="cd-kpi-label" style={{ gap: 10 }}>
                <LogoCuenta cuenta={c} tam={32} />
                {c.nombre}
              </span>
              <label className="casilla-suma" title="Incluir en el saldo total">
                ¿Suma?
                <input
                  type="checkbox"
                  checked={c.incluir_en_total}
                  disabled={incluir.isPending}
                  onChange={() => incluir.mutate(c)}
                />
              </label>
            </div>
            <div className="cd-kpi-value">
              <Dinero centavos={c.saldo} />
            </div>
            <div className="cd-kpi-foot">
              <span className="cd-badge cd-badge--neutral cd-badge--plain">
                {(TIPOS as Record<string, string>)[c.tipo] ?? c.tipo}
              </span>
              <span className="cd-row" style={{ gap: 8, flexWrap: "nowrap" }}>
                <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setEditando(c)}>
                  Editar
                </button>
                <Link className="cd-link" to="/movimientos" search={{ cuenta: c.id }}>
                  Movimientos →
                </Link>
              </span>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
