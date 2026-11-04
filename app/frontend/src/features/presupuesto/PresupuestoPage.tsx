/** Presupuesto por grupos (fase 7): cada presupuesto reúne varias categorías con un monto mensual (p. ej.
 * «Hogar» = arriendo + servicios + internet). El monto se fija al crear o editar y rige desde ese mes (fase 8, 8.1);
 * cada fila compara lo usado con el ritmo ideal del mes, y dos gráficos muestran meses pasados y el ritmo. */
import { rutaSuave } from "@/shared/lib/curvas";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { aPeriodo, ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";
import type { FilaPresupuesto, GrupoPresupuestoIn } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { rutaDe } from "@/shared/lib/categorias";
import { abreviar, formatoCOP, hoyISO, mascaraMonto, moverMes, nombreMes, parseMonto } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { Dinero } from "@/shared/ui/Dinero";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { Icono, type NombreIcono } from "@/shared/ui/Icono";
import { colorDe, SelectorCategoria } from "@/shared/ui/SelectorCategoria";
import { ICONOS_ELEGIBLES, SelectorEstilo } from "@/shared/ui/SelectorEstilo";
import { Sensores, TooltipGrafico, ZonaGrafico } from "@/shared/ui/TooltipGrafico";

const GRUPOS_PRESUPUESTABLES = ["gasto_vida", "servicio_deuda", "apuestas", "ahorro_inversion"];

function useRefrescar() {
  const cliente = useQueryClient();
  return () => {
    void cliente.invalidateQueries({ queryKey: ["presupuesto"] });
    void cliente.invalidateQueries({ queryKey: claves.alertas });
  };
}

function IconoGrupo({ f }: { f: Pick<FilaPresupuesto, "icono" | "color"> }) {
  const c = colorDe(f);
  const nombre = (ICONOS_ELEGIBLES as string[]).includes(f.icono ?? "") ? (f.icono as NombreIcono) : "presupuesto";
  return (
    <span className="cd-kpi-ico" style={{ background: c.fondo, color: c.tinta, flex: "none" }} aria-hidden>
      <Icono nombre={nombre} />
    </span>
  );
}

function FilaGrupo({ f, ritmo, alEditar }: { f: FilaPresupuesto; ritmo: number; alEditar: () => void }) {
  const refrescar = useRefrescar();
  const [confirmar, setConfirmar] = useState(false);
  const eliminar = useMutation({
    mutationFn: () => api.eliminarGrupo(f.id),
    onSuccess: () => toast(`Presupuesto «${f.nombre}» eliminado`),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const clase = f.pct >= 100 ? "cd-progress--over" : f.pct >= 80 ? "cd-progress--warn" : "";
  return (
    <li className="cd-stack" style={{ gap: 8, padding: "14px 0", borderBottom: "1px solid var(--border)" }}>
      <div className="cd-row" style={{ flexWrap: "nowrap", gap: 12 }}>
        <IconoGrupo f={f} />
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{f.nombre}</b>
          {f.es_fijo && (
            <span className="cd-badge cd-badge--neutral" style={{ marginLeft: 8 }}>
              Fijo
            </span>
          )}
          <span className="cd-delta-note" style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis" }}>
            {f.categorias.map((c) => c.ruta.slice(1).join(" › ")).join(" · ")}
          </span>
        </span>
        <span className="cd-stack" style={{ alignItems: "flex-end", gap: 0 }}>
          {f.tiene_asignacion ? (
            <>
              <b className="cd-num" style={{ fontSize: 16 }}>
                {f.pct} %
              </b>
              <span className="cd-delta-note cd-num">de {formatoCOP(f.asignado)}</span>
            </>
          ) : (
            <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={alEditar}>
              Poner monto
            </button>
          )}
        </span>
      </div>
      {f.tiene_asignacion && (
        <div
          className={`cd-progress ${clase}`}
          role="progressbar"
          aria-label={f.nombre}
          aria-valuenow={f.pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${Math.min(100, f.pct)}%` }} />
          {ritmo > 0 && ritmo < 1 && (
            <span className="presupuesto-ritmo" style={{ left: `${ritmo * 100}%` }} title="Ritmo ideal a hoy" />
          )}
        </div>
      )}
      <div className="cd-row" style={{ justifyContent: "space-between", gap: 8 }}>
        <span className="cd-delta-note cd-num">
          {f.tiene_asignacion && ritmo > 0 && ritmo < 1 && (
            <b style={{ color: f.pct > ritmo * 100 + 5 ? "var(--negative)" : "var(--positive)" }}>
              {f.pct > ritmo * 100 + 5
                ? `${Math.round(f.pct - ritmo * 100)} pts por encima del ritmo`
                : f.pct < ritmo * 100 - 5
                  ? "por debajo del ritmo"
                  : "al ritmo"}
              {" · "}
            </b>
          )}
          Gastado {formatoCOP(f.gastado)}
          {f.tiene_asignacion &&
            (f.disponible >= 0
              ? ` · quedan ${formatoCOP(f.disponible)}`
              : ` · te pasaste ${formatoCOP(-f.disponible)}`)}
        </span>
        <span className="cd-row" style={{ gap: 4 }}>
          <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={alEditar}>
            Editar
          </button>
          {confirmar ? (
            <button
              className="cd-btn cd-btn--sm"
              style={{ background: "var(--negative)", color: "var(--card)" }}
              onClick={() => eliminar.mutate()}
            >
              Confirmar
            </button>
          ) : (
            <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setConfirmar(true)}>
              Eliminar
            </button>
          )}
        </span>
      </div>
    </li>
  );
}

function FormGrupo({
  inicial,
  mes,
  alCerrar,
}: {
  inicial: Partial<FilaPresupuesto> & { categoria_ids?: number[] };
  mes: string;
  alCerrar: () => void;
}) {
  const refrescar = useRefrescar();
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias, staleTime: 60_000 });
  const [nombre, setNombre] = useState(inicial.nombre ?? "");
  const [ids, setIds] = useState<number[]>(inicial.categoria_ids ?? inicial.categorias?.map((c) => c.id) ?? []);
  const [estilo, setEstilo] = useState({ icono: inicial.icono ?? null, color: inicial.color ?? null });
  const [fijo, setFijo] = useState(inicial.es_fijo ?? false);
  const [monto, setMonto] = useState(
    inicial.tiene_asignacion ? mascaraMonto(String((inicial.asignado ?? 0) / 100)) : "",
  );
  const guardar = useMutation({
    mutationFn: async () => {
      const centavos = parseMonto(monto);
      if (!centavos) throw new Error("Escribe el monto mensual del presupuesto");
      const datos: GrupoPresupuestoIn = { nombre, categoria_ids: ids, ...estilo, es_fijo: fijo };
      const id = inicial.id ?? (await api.crearGrupo(datos)).id;
      if (inicial.id) await api.editarGrupo(inicial.id, datos);
      if (centavos !== inicial.asignado || !inicial.tiene_asignacion) await api.asignar(mes, id, centavos);
    },
    onSuccess: () => {
      toast.success(inicial.id ? "Presupuesto actualizado" : `Presupuesto «${nombre}» creado`);
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  return (
    <Hoja
      titulo={inicial.id ? `Editar ${inicial.nombre}` : "Nuevo presupuesto"}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="cd-btn cd-btn--primary"
            disabled={!nombre.trim() || ids.length === 0 || !parseMonto(monto) || guardar.isPending}
            onClick={() => guardar.mutate()}
          >
            {inicial.id ? "Guardar cambios" : "Crear presupuesto"}
          </button>
        </>
      }
    >
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Nombre</span>
        <input className="cd-input" value={nombre} placeholder="Hogar" onChange={(e) => setNombre(e.target.value)} />
      </label>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Monto al mes</span>
        <input
          className="cd-input cd-num"
          inputMode="decimal"
          placeholder="$ 0"
          value={monto}
          onChange={(e) => setMonto(mascaraMonto(e.target.value))}
        />
        <span className="cd-delta-note">
          Rige desde {nombreMes(mes)} y los meses siguientes, hasta que lo vuelvas a editar.
        </span>
      </label>
      <div className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Categorías que incluye</span>
        <div className="cd-row" style={{ gap: 6 }}>
          {ids.map((id) => (
            <span key={id} className="cd-badge cd-badge--neutral" style={{ gap: 6 }}>
              {rutaDe(arbol.data ?? [], id)
                ?.ruta.slice(1)
                .join(" › ") ?? id}
              <button
                type="button"
                aria-label="Quitar"
                style={{ border: 0, background: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                onClick={() => setIds((x) => x.filter((i) => i !== id))}
              >
                ×
              </button>
            </span>
          ))}
        </div>
        <SelectorCategoria
          arbol={arbol.data ?? []}
          grupos={GRUPOS_PRESUPUESTABLES}
          valor={null}
          permitirPadre
          alCambiar={(id) => setIds((x) => (x.includes(id) ? x : [...x, id]))}
        />
      </div>
      <SelectorEstilo icono={estilo.icono} color={estilo.color} alCambiar={setEstilo} />
      <label className="cd-row" style={{ gap: 8, fontSize: 13, fontWeight: 600 }}>
        <input type="checkbox" checked={fijo} onChange={(e) => setFijo(e.target.checked)} />
        Gasto fijo obligatorio (va primero)
      </label>
    </Hoja>
  );
}

function Historico({ grupos }: { grupos: { id: number; nombre: string }[] }) {
  const nav = usePeriodo("6m", "presupuesto-mes-a-mes");
  const [filtro, setFiltro] = useFiltroRecordado<{ grupo?: number }>("presupuesto-mes-a-mes:grupo", {});
  const grupo = filtro.grupo;
  const setGrupo = (g: number | undefined) => setFiltro(() => ({ grupo: g }));
  const periodo = nav.preset === "todo" ? aPeriodo("12m") : nav.periodo;
  const desde = periodo.desde ?? moverMes(hoyISO().slice(0, 7), -11);
  const hasta = periodo.hasta ?? hoyISO().slice(0, 7);
  const h = useQuery({
    queryKey: claves.historicoPresupuesto(desde, hasta, grupo),
    queryFn: () => api.historicoPresupuesto(desde, hasta, grupo),
  });
  const meses = h.data?.meses ?? [];
  const con = meses.filter((m) => m.asignado > 0);
  const dentro = con.filter((m) => m.gastado <= m.asignado).length;
  const media = meses.length ? meses.reduce((t, m) => t + m.gastado, 0) / meses.length : 0;
  const limiteMedio = con.length ? con.reduce((t, m) => t + m.asignado, 0) / con.length : 0;
  const maximo = Math.max(1, ...meses.flatMap((m) => [m.asignado, m.gastado]));
  const ancho = 640;
  const paso = (ancho - 50) / Math.max(1, meses.length);
  const [activo, setActivo] = useState<number | null>(null);
  const centro = (i: number) => 56 + i * paso + Math.min(36, paso * 0.7) / 2;
  const m0 = activo !== null ? meses[activo] : undefined;
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <div className="cd-card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="cd-card-title">Mes a mes</h3>
        <div className="cd-row" style={{ gap: 6 }}>
          <select
            aria-label="Presupuesto"
            className="cd-input"
            style={{ width: "auto" }}
            value={grupo ?? ""}
            onChange={(e) => setGrupo(e.target.value ? Number(e.target.value) : undefined)}
          >
            <option value="">Todos juntos</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>
                {g.nombre}
              </option>
            ))}
          </select>
          <ControlPeriodo nav={nav} opciones={["6m", "12m", "rango"]} />
        </div>
      </div>
      {con.length > 0 && (
        <span className="cd-delta-note">
          <b style={{ color: "var(--ink)" }}>
            {dentro} de {con.length}
          </b>{" "}
          meses dentro del límite · gasto medio {formatoCOP(Math.round(media))}
          {con.length > 0 && ` · límite medio ${formatoCOP(Math.round(limiteMedio))}`}
        </span>
      )}
      {meses.length === 0 ? (
        <span className="cd-delta-note">Sin datos en ese periodo.</span>
      ) : (
        <ZonaGrafico>
          <svg className="cd-chart" viewBox={`0 0 ${ancho} 200`} role="img" aria-label="Asignado y gastado por mes">
            <line className="grid" x1="44" x2={ancho} y1="20" y2="20" />
            <text x="38" y="24" textAnchor="end">
              {abreviar(maximo)}
            </text>
            <line className="grid-dash" x1="44" x2={ancho} y1="170" y2="170" />
            {meses.map((m, i) => {
              const x = 56 + i * paso;
              const alto = (v: number) => (v / maximo) * 150;
              const pasado = m.asignado > 0 && m.gastado > m.asignado;
              return (
                <g key={m.mes}>
                  <rect
                    opacity={activo === null || activo === i ? 1 : 0.45}
                    x={x}
                    y={170 - alto(m.gastado)}
                    width={Math.min(36, paso * 0.7)}
                    height={alto(m.gastado)}
                    rx="5"
                    fill={pasado ? "var(--negative)" : "var(--chart-1)"}
                  />
                  {m.asignado > 0 && (
                    <line
                      x1={x - 4}
                      x2={x + Math.min(36, paso * 0.7) + 4}
                      y1={170 - alto(m.asignado)}
                      y2={170 - alto(m.asignado)}
                      stroke="var(--ink)"
                      strokeWidth="2.5"
                      strokeDasharray="5 3"
                    />
                  )}
                  <text x={x + Math.min(36, paso * 0.7) / 2} y="192" textAnchor="middle">
                    {nombreMes(m.mes, true)}
                  </text>
                </g>
              );
            })}
            <Sensores
              n={meses.length}
              x={centro}
              ancho={paso}
              alto={175}
              arriba={10}
              activo={activo}
              alCambiar={setActivo}
            />
          </svg>
          {m0 && activo !== null && (
            <TooltipGrafico izquierda={(centro(activo) / ancho) * 100}>
              <b style={{ textTransform: "capitalize" }}>{nombreMes(m0.mes)}</b>
              <span className="fila">
                <span>
                  <i
                    className="punto"
                    style={{
                      background: m0.asignado > 0 && m0.gastado > m0.asignado ? "var(--negative)" : "var(--chart-1)",
                    }}
                  />
                  Gastado
                </span>
                {formatoCOP(m0.gastado)}
              </span>
              <span className="fila">
                <span>Límite</span>
                {m0.asignado ? formatoCOP(m0.asignado) : "—"}
              </span>
              {m0.asignado > 0 && (
                <span className="fila">
                  <span>{m0.gastado > m0.asignado ? "Te pasaste" : "Te sobró"}</span>
                  {formatoCOP(Math.abs(m0.asignado - m0.gastado))}
                </span>
              )}
            </TooltipGrafico>
          )}
        </ZonaGrafico>
      )}
      <div className="cd-legend">
        <span>
          <i className="cd-sw" style={{ background: "var(--ink)", height: 3 }} />
          Límite del mes
        </span>
        <span>
          <i className="cd-sw c1" />
          Gastado dentro del límite
        </span>
        <span>
          <i className="cd-sw" style={{ background: "var(--negative)" }} />
          Gastado por encima de lo asignado
        </span>
      </div>
    </section>
  );
}

function RitmoMes({ mes, grupos }: { mes: string; grupos: { id: number; nombre: string }[] }) {
  const [filtro, setFiltro] = useFiltroRecordado<{ grupo?: number }>("presupuesto-ritmo:grupo", {});
  const grupo = filtro.grupo;
  const setGrupo = (g: number | undefined) => setFiltro(() => ({ grupo: g }));
  const a = useQuery({
    queryKey: [...claves.presupuesto(mes), "acumulado", grupo ?? "todos"],
    queryFn: () => api.acumuladoPresupuesto(mes, grupo),
  });
  const d = a.data;
  const W = 640;
  const H = 200;
  const tope = d ? Math.max(1, d.limite, ...d.serie.map((s) => Math.max(s.actual ?? 0, s.anterior))) : 1;
  const x = (dia: number) => 44 + ((dia - 1) / Math.max(1, (d?.dias ?? 30) - 1)) * (W - 54);
  const y = (v: number) => 170 - (v / tope) * 150;
  const linea = (puntos: [number, number][]) => rutaSuave(puntos.map(([dx, v]): [number, number] => [x(dx), y(v)]));
  const actual = d?.serie.filter((s) => s.actual !== null).map((s) => [s.dia, s.actual ?? 0] as [number, number]) ?? [];
  const ultimo = actual.at(-1);
  const ideal = d && ultimo ? (d.limite * ultimo[0]) / d.dias : 0;
  const [activo, setActivo] = useState<number | null>(null);
  const punto = activo !== null ? d?.serie[activo] : undefined;
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <div className="cd-card-head" style={{ flexWrap: "wrap", gap: 8 }}>
        <h3 className="cd-card-title">Ritmo de {nombreMes(mes)}</h3>
        <select
          aria-label="Presupuesto"
          className="cd-input"
          style={{ width: "auto" }}
          value={grupo ?? ""}
          onChange={(e) => setGrupo(e.target.value ? Number(e.target.value) : undefined)}
        >
          <option value="">Todos juntos</option>
          {grupos.map((g) => (
            <option key={g.id} value={g.id}>
              {g.nombre}
            </option>
          ))}
        </select>
      </div>
      {d && ultimo && d.limite > 0 && (
        <span className="cd-delta-note">
          Al día {ultimo[0]} llevas <b style={{ color: "var(--ink)" }}>{formatoCOP(ultimo[1])}</b>; a ritmo ideal serían{" "}
          {formatoCOP(Math.round(ideal))}
          {ultimo[1] > ideal ? ` (${formatoCOP(Math.round(ultimo[1] - ideal))} por encima)` : " (vas bien)"}.
        </span>
      )}
      {d && (
        <ZonaGrafico>
          <svg
            className="cd-chart"
            viewBox={`0 0 ${W} ${H}`}
            role="img"
            aria-label="Gasto acumulado del mes contra el ritmo ideal"
          >
            <line className="grid" x1="44" x2={W} y1="20" y2="20" />
            <line className="grid-dash" x1="44" x2={W} y1="170" y2="170" />
            <text x="38" y="24" textAnchor="end">
              {abreviar(tope)}
            </text>
            {[1, 8, 15, 22, d.dias].map((dia) => (
              <text key={dia} x={x(dia)} y="190" textAnchor="middle">
                {dia}
              </text>
            ))}
            {d.limite > 0 && (
              <>
                <line
                  x1="44"
                  x2={W - 10}
                  y1={y(d.limite)}
                  y2={y(d.limite)}
                  stroke="var(--ink)"
                  strokeWidth="1.5"
                  strokeDasharray="5 4"
                />
                <path
                  d={linea([
                    [1, d.limite / d.dias],
                    [d.dias, d.limite],
                  ])}
                  stroke="var(--ink-subtle)"
                  strokeWidth="2"
                  fill="none"
                  strokeDasharray="2 4"
                />
              </>
            )}
            <path className="l3" d={linea(d.serie.map((s) => [s.dia, s.anterior]))} />
            {actual.length > 0 && <path className="l1" d={linea(actual)} strokeWidth="3" />}
            {punto?.actual != null && <circle cx={x(punto.dia)} cy={y(punto.actual)} r="5" fill="var(--chart-1)" />}
            {punto && <circle cx={x(punto.dia)} cy={y(punto.anterior)} r="4" fill="var(--chart-3)" />}
            <Sensores
              n={d.dias}
              x={(i) => x(i + 1)}
              ancho={(W - 54) / Math.max(1, d.dias - 1)}
              alto={172}
              arriba={10}
              activo={activo}
              alCambiar={setActivo}
            />
          </svg>
          {punto && activo !== null && (
            <TooltipGrafico izquierda={(x(punto.dia) / W) * 100}>
              <b>Día {punto.dia}</b>
              <span className="fila">
                <span>
                  <i className="punto" style={{ background: "var(--chart-1)" }} />
                  {nombreMes(mes, true)}
                </span>
                {punto.actual == null ? "—" : formatoCOP(punto.actual)}
              </span>
              <span className="fila">
                <span>
                  <i className="punto" style={{ background: "var(--chart-3)" }} />
                  {nombreMes(d.anterior, true)}
                </span>
                {formatoCOP(punto.anterior)}
              </span>
              {d.limite > 0 && (
                <span className="fila">
                  <span>Ritmo ideal</span>
                  {formatoCOP(Math.round((d.limite * punto.dia) / d.dias))}
                </span>
              )}
            </TooltipGrafico>
          )}
        </ZonaGrafico>
      )}
      <div className="cd-legend">
        <span>
          <i className="cd-sw c1" />
          {nombreMes(mes)}
        </span>
        <span>
          <i className="cd-sw c3" />
          {d ? nombreMes(d.anterior) : "Mes anterior"}
        </span>
        <span>
          <i className="cd-sw" style={{ background: "var(--ink-subtle)", height: 3 }} />
          Ritmo ideal
        </span>
        <span>
          <i className="cd-sw" style={{ background: "var(--ink)", height: 3 }} />
          Límite
        </span>
      </div>
    </section>
  );
}

export function PresupuestoPage() {
  const [mes, setMes] = useState(hoyISO().slice(0, 7));
  const [form, setForm] = useState<(Partial<FilaPresupuesto> & { categoria_ids?: number[] }) | null>(null);
  const refrescar = useRefrescar();
  const datos = useQuery({ queryKey: claves.presupuesto(mes), queryFn: () => api.presupuesto(mes) });
  const copiar = useMutation({
    mutationFn: () => api.copiarPresupuesto(mes, moverMes(mes, -1)),
    onSuccess: (r) =>
      toast.success(
        r.copiadas ? `Copié ${r.copiadas} montos de ${nombreMes(moverMes(mes, -1))}` : "No había nada nuevo que copiar",
      ),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const d = datos.data;

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Presupuesto</h1>
          <p>Cada peso con un destino. Un presupuesto puede reunir varias categorías.</p>
        </div>
        <div className="cd-row">
          <div className="cd-row" style={{ gap: 4 }}>
            <button className="cd-icon-btn" aria-label="Mes anterior" onClick={() => setMes(moverMes(mes, -1))}>
              ‹
            </button>
            <span
              className="cd-select"
              style={{ height: 40, minWidth: 150, justifyContent: "center", textTransform: "capitalize" }}
            >
              {nombreMes(mes)}
            </span>
            <button className="cd-icon-btn" aria-label="Mes siguiente" onClick={() => setMes(moverMes(mes, 1))}>
              ›
            </button>
          </div>
          <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={() => copiar.mutate()}>
            Copiar {nombreMes(moverMes(mes, -1)).split(" ")[0]}
          </button>
          <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => setForm({})}>
            <Icono nombre="mas" pequeno />
            Nuevo presupuesto
          </button>
        </div>
      </div>
      {datos.isPending && <TarjetaCargando />}
      {datos.isError && <ErrorVista error={datos.error} reintentar={() => void datos.refetch()} />}
      {d && (
        <>
          <div className="cd-bento">
            {[
              { etiqueta: "Ingreso de referencia", valor: d.ingreso_referencia, nota: "mínimo de 6 meses" },
              { etiqueta: "Asignado", valor: d.asignado, nota: `${formatoCOP(d.asignado_fijo)} fijos` },
              {
                etiqueta: "Por asignar",
                valor: d.por_asignar,
                nota: d.por_asignar < 0 ? "asignaste más de lo que entra" : "disponible",
              },
              {
                etiqueta: "Gastado",
                valor: d.gastado,
                nota: d.asignado ? `${Math.round((100 * d.gastado) / d.asignado)} % de lo asignado` : "—",
              },
            ].map((k) => (
              <div key={k.etiqueta} className="cd-card cd-kpi span-3">
                <span className="cd-kpi-label">{k.etiqueta}</span>
                <span className="cd-kpi-value">
                  <Dinero centavos={k.valor} />
                </span>
                <span className="cd-delta-note">{k.nota}</span>
              </div>
            ))}
          </div>
          <div className="cd-bento">
            <section className="cd-card span-8">
              <h3 className="cd-card-title">Presupuestos de {nombreMes(mes)}</h3>
              {d.filas.length === 0 ? (
                <Vacio
                  titulo="Aún no tienes presupuestos"
                  texto="Crea uno, por ejemplo «Hogar» con el arriendo, los servicios y el internet."
                  accion={
                    <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => setForm({})}>
                      Nuevo presupuesto
                    </button>
                  }
                />
              ) : (
                <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
                  {d.filas.map((f) => (
                    <FilaGrupo key={f.id} f={f} ritmo={d.ritmo} alEditar={() => setForm(f)} />
                  ))}
                </ul>
              )}
            </section>
            <section className="cd-card span-4 cd-stack" style={{ gap: 10 }}>
              <h3 className="cd-card-title">Gastado sin presupuesto</h3>
              {d.sin_presupuesto.length === 0 && (
                <span className="cd-delta-note">Todo lo gastado tiene presupuesto.</span>
              )}
              {d.sin_presupuesto.map((s) => (
                <div key={s.categoria_id} className="cd-row" style={{ flexWrap: "nowrap", gap: 8 }}>
                  <span className="cd-stack" style={{ flex: 1, minWidth: 0, gap: 0 }}>
                    <span
                      title={s.ruta.slice(1).join(" › ")}
                      style={{
                        fontSize: 14,
                        fontWeight: 600,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {s.ruta.slice(1).join(" › ")}
                    </span>
                    <span className="cd-delta-note cd-num">{formatoCOP(s.gastado)} gastados</span>
                  </span>
                  <button
                    className="cd-btn cd-btn--ghost cd-btn--sm"
                    onClick={() => setForm({ nombre: s.ruta.at(-1), categoria_ids: [s.categoria_id] })}
                  >
                    Presupuestar
                  </button>
                </div>
              ))}
            </section>
          </div>
          <div className="cd-bento">
            <div className="span-6">
              <RitmoMes mes={mes} grupos={d.filas.map((f) => ({ id: f.id, nombre: f.nombre }))} />
            </div>
            <div className="span-6">
              <Historico grupos={d.filas.map((f) => ({ id: f.id, nombre: f.nombre }))} />
            </div>
          </div>
        </>
      )}
      {form && <FormGrupo key={form.id ?? "nuevo"} inicial={form} mes={mes} alCerrar={() => setForm(null)} />}
    </>
  );
}
