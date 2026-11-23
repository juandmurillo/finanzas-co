/** Renta y aportes (RF-CO-01/02/03): termómetro de topes para declarar, seguridad social estimada del
 * independiente y parámetros de Colombia con su fuente. Educativo: no reemplaza a un contador. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { ParametroCO } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, hoyISO, nombreMes, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { BarraFiltros } from "@/shared/ui/BarraFiltros";
import { BarraLimite } from "@/shared/ui/Datos";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { CabeceraTarjeta, KpiCompacto } from "@/shared/ui/Kpi";

const NOMBRES: Record<string, string> = {
  uvt: "UVT",
  smmlv: "Salario mínimo",
  usura_consumo: "Usura consumo",
  usura_consumo_bajo_monto: "Usura bajo monto",
};
const esTasa = (clave: string) => clave.startsWith("usura");

function Termometro({ anio }: { anio: number }) {
  const t = useQuery({ queryKey: claves.termometro(anio), queryFn: () => api.termometro(anio) });
  if (t.isPending) return <TarjetaCargando />;
  if (t.isError) return <ErrorVista error={t.error} reintentar={() => void t.refetch()} />;
  const d = t.data;
  const cercano = [...d.filas].sort((a, b) => (b.pct_proyectado ?? 0) - (a.pct_proyectado ?? 0))[0];
  return (
    <>
      <div className="renta-kpis">
        <KpiCompacto
          inversa
          etiqueta={`Declarar renta ${d.anio}`}
          icono="documento"
          valor={d.declara_probable ? "Probablemente sí" : "Por ahora no"}
          nota="basta con superar un tope"
        />
        <KpiCompacto
          etiqueta="Tope más cercano"
          icono="alerta"
          valor={cercano ? porcentaje(Math.min(9.99, cercano.pct_proyectado ?? 0), 0) : "—"}
          nota={cercano ? cercano.nombre : undefined}
        />
        <KpiCompacto
          etiqueta="Seguridad social"
          icono="escudo"
          valor={d.seguridad_social.total_anio}
          nota={`estimado ${d.anio}`}
        />
        <KpiCompacto
          etiqueta={`UVT ${d.anio}`}
          icono="ajustes"
          valor={d.uvt ? formatoCOP(d.uvt * 100) : "sin dato"}
          nota={`${d.meses_transcurridos} ${d.meses_transcurridos === 1 ? "mes" : "meses"} registrados`}
        />
      </div>
      <section className="cd-card cd-stack" style={{ gap: 14 }}>
        <CabeceraTarjeta
          titulo={`Topes para declarar por ${d.anio}`}
          rango="Barra: lo que cerrarías el año a este ritmo frente al tope"
        />
        {d.filas.map((f) => (
          <div key={f.clave} className="cd-stack renta-tope" style={{ gap: 6 }}>
            <span className="renta-tope-nombre">{f.nombre}</span>
            {f.tope ? (
              <BarraLimite etiqueta={f.nombre} gastado={f.proyectado} limite={f.tope} alta />
            ) : (
              <span className="cd-delta-note">Sin tope configurado</span>
            )}
            <span className="cd-delta-note cd-num">
              Llevas {formatoCOP(f.valor)} · tope {f.tope_uvt.toLocaleString("es-CO")} UVT
            </span>
          </div>
        ))}
        <p className="cd-delta-note" style={{ margin: 0 }}>
          {d.aviso} Los topes son los del art. 592 del Estatuto Tributario; la app no ve tus consumos con tarjeta de
          otros bancos ni tu patrimonio fuera de estas cuentas.
        </p>
      </section>
      <section className="cd-card cd-stack" style={{ gap: 12, overflowX: "auto" }}>
        <CabeceraTarjeta
          titulo="Seguridad social como independiente"
          rango={`total ${formatoCOP(d.seguridad_social.total_anio)}`}
        />
        <span className="cd-delta-note">
          IBC = {porcentaje(d.seguridad_social.porcentajes.ibc, 0)} de tus ingresos de trabajo independiente (mínimo 1
          salario mínimo). Salud {porcentaje(d.seguridad_social.porcentajes.salud, 1)}, pensión{" "}
          {porcentaje(d.seguridad_social.porcentajes.pension, 0)}, ARL riesgo I{" "}
          {porcentaje(d.seguridad_social.porcentajes.arl, 3)}. {d.seguridad_social.nota}
        </span>
        {d.seguridad_social.meses.length === 0 ? (
          <span className="cd-delta-note">No hay ingresos de trabajo independiente este año.</span>
        ) : (
          <table className="cd-table cd-num tabla-apilable">
            <thead>
              <tr>
                <th>Mes</th>
                <th style={{ textAlign: "right" }}>Ingreso</th>
                <th style={{ textAlign: "right" }}>IBC</th>
                <th style={{ textAlign: "right" }}>Aportes</th>
              </tr>
            </thead>
            <tbody>
              {d.seguridad_social.meses.map((m) => (
                <tr key={m.mes}>
                  <td data-etiqueta="Mes" style={{ textTransform: "capitalize" }}>
                    {nombreMes(m.mes)}
                  </td>
                  <td data-etiqueta="Ingreso" style={{ textAlign: "right" }}>
                    {formatoCOP(m.ingreso)}
                  </td>
                  <td data-etiqueta="IBC" style={{ textAlign: "right" }}>
                    {m.obligado ? formatoCOP(m.ibc) : "no obligado"}
                  </td>
                  <td data-etiqueta="Aportes" style={{ textAlign: "right", fontWeight: 700 }}>
                    {m.obligado ? formatoCOP(m.total) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </>
  );
}

function Parametros() {
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: claves.parametros, queryFn: api.parametros });
  const trm = useQuery({
    queryKey: claves.trm(hoyISO()),
    queryFn: () => api.trm(),
    retry: false,
    staleTime: 3_600_000,
  });
  const [editando, setEditando] = useState<ParametroCO | null>(null);
  const guardar = useMutation({
    mutationFn: (p: ParametroCO) => api.guardarParametro(p),
    onSuccess: () => {
      toast.success("Parámetro guardado");
      setEditando(null);
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: ["parametros"] }),
  });
  const valor = (p: ParametroCO) => (esTasa(p.clave) ? `${porcentaje(p.valor, 2)} E.A.` : formatoCOP(p.valor * 100));
  return (
    <section className="cd-card cd-stack" style={{ gap: 10 }}>
      <CabeceraTarjeta titulo="Parámetros de Colombia" rango="toca uno para corregirlo" />
      {trm.data && (
        <div className="cd-row" style={{ justifyContent: "space-between" }}>
          <span>
            <b style={{ fontSize: 14 }}>TRM</b>
            <span className="cd-delta-note">
              {" "}
              · {trm.data.aproximada ? "última conocida, sin red" : trm.data.fuente}
            </span>
          </span>
          <span className="cd-amt cd-num">
            $ {trm.data.valor.toLocaleString("es-CO", { minimumFractionDigits: 2 })}
            <span className="cd-delta-note"> {fechaCorta(trm.data.fecha)}</span>
          </span>
        </div>
      )}
      {(lista.data ?? []).map((p) =>
        editando && editando.clave === p.clave && editando.vigencia_desde === p.vigencia_desde ? (
          <div key={`${p.clave}-${p.vigencia_desde}`} className="cd-stack" style={{ gap: 6 }}>
            <b style={{ fontSize: 14 }}>
              {NOMBRES[p.clave] ?? p.clave} desde {fechaCorta(p.vigencia_desde, true)}
            </b>
            <input
              aria-label="Valor"
              className="cd-input cd-num"
              inputMode="decimal"
              value={editando.valor}
              onChange={(e) => setEditando({ ...editando, valor: Number(e.target.value.replace(",", ".")) || 0 })}
            />
            <input
              aria-label="Fuente"
              className="cd-input"
              placeholder="Resolución, decreto o sitio oficial"
              value={editando.fuente}
              onChange={(e) => setEditando({ ...editando, fuente: e.target.value })}
            />
            <div className="cd-row" style={{ gap: 6 }}>
              <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => guardar.mutate(editando)}>
                Guardar
              </button>
              <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setEditando(null)}>
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            key={`${p.clave}-${p.vigencia_desde}`}
            className="fila-boton cd-row"
            style={{ justifyContent: "space-between", padding: "6px 4px", flexWrap: "nowrap", gap: 10 }}
            onClick={() => setEditando(p)}
            title={`Fuente: ${p.fuente}`}
          >
            <span style={{ minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{NOMBRES[p.clave] ?? p.clave}</b>
              <span className="cd-delta-note"> · desde {fechaCorta(p.vigencia_desde, true)}</span>
            </span>
            <span className="cd-amt cd-num">{valor(p)}</span>
          </button>
        ),
      )}
      <span className="cd-delta-note">Toca un valor para corregirlo; cada cambio guarda su fuente.</span>
    </section>
  );
}

export function ImpuestosPage() {
  const actual = new Date().getFullYear();
  const [anio, setAnio] = useState(actual);
  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Renta y aportes</h1>
          <p>Si te tocaría declarar renta y cuánto aportarías como independiente. Estimación educativa.</p>
        </div>
      </div>
      <BarraFiltros etiqueta="Año gravable">
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Año gravable">
          {[actual - 1, actual].map((a) => (
            <button
              key={a}
              role="radio"
              aria-checked={anio === a}
              aria-selected={anio === a}
              onClick={() => setAnio(a)}
            >
              {a}
            </button>
          ))}
        </div>
      </BarraFiltros>
      <div className="cd-bento">
        <div className="span-8 cd-stack" style={{ gap: "var(--gap-bento)" }}>
          <Termometro anio={anio} />
        </div>
        <div className="span-4">
          <Parametros />
        </div>
      </div>
    </>
  );
}
