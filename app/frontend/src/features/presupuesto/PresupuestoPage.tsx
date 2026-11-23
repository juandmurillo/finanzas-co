/** Presupuesto por grupos (fase 7): cada presupuesto reúne varias categorías con un monto mensual (p. ej.
 * «Hogar» = arriendo + servicios + internet). El monto se fija al crear o editar y rige desde ese mes (fase 8, 8.1);
 * cada fila compara lo usado con el ritmo ideal del mes, y dos gráficos muestran meses pasados y el ritmo. */
import { useRefrescar } from "@/shared/lib/useRefrescar";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import { aPeriodo, ControlPeriodo, usePeriodo } from "@/features/analisis/Periodo";
import { AreaComparada, BarrasAgrupadas, MedioAnillo } from "@/shared/charts";
import { BarraFiltros } from "@/shared/ui/BarraFiltros";
import { BarraLimite } from "@/shared/ui/Datos";
import { CabeceraTarjeta, FilaMetricas, KpiCompacto } from "@/shared/ui/Kpi";
import { esMovil } from "@/shared/lib/dispositivo";
import type { FilaPresupuesto, GrupoPresupuestoIn } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { rutaDe } from "@/shared/lib/categorias";
import { formatoCOP, hoyISO, mascaraMonto, moverMes, nombreMes, parseMonto } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useFiltroRecordado } from "@/shared/lib/useFiltroRecordado";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { Icono, type NombreIcono } from "@/shared/ui/Icono";
import { colorDe, SelectorCategoria } from "@/shared/ui/SelectorCategoria";
import { ICONOS_ELEGIBLES, SelectorEstilo } from "@/shared/ui/SelectorEstilo";

import "./presupuesto.css";

import { Desplegable } from "@/shared/ui/Desplegable";
import { ZonaPeriodo } from "@/features/analisis/ZonaPeriodo";
import { keepPreviousData } from "@tanstack/react-query";
const GRUPOS_PRESUPUESTABLES = ["gasto_vida", "servicio_deuda", "apuestas", "ahorro_inversion"];

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
  const enCurso = ritmo > 0 && ritmo < 1;
  const diferencia = f.pct - ritmo * 100;
  const movil = esMovil();
  return (
    <li
      className={`fila-presupuesto ${movil ? "fila-tocable" : ""}`}
      role={movil ? "button" : undefined}
      tabIndex={movil ? 0 : undefined}
      aria-label={movil ? `Editar ${f.nombre}` : undefined}
      onClick={movil ? alEditar : undefined}
      onKeyDown={movil ? (e) => (e.key === "Enter" || e.key === " ") && (e.preventDefault(), alEditar()) : undefined}
    >
      <div className="fila-presupuesto-cabeza">
        <IconoGrupo f={f} />
        <span className="fila-presupuesto-texto">
          <b>
            {f.nombre}
            {f.es_fijo && <span className="cd-badge cd-badge--neutral">Fijo</span>}
          </b>
          <small>{f.categorias.map((c) => c.ruta.slice(1).join(" › ")).join(" · ")}</small>
        </span>
        {f.tiene_asignacion ? (
          <span className="fila-presupuesto-pct">
            <b className="cd-num">{f.pct}%</b>
            {enCurso && (
              <small className={diferencia > 5 ? "tono-alerta" : diferencia < -5 ? "tono-ingreso" : undefined}>
                {diferencia > 5
                  ? `${Math.round(diferencia)} pts sobre el ritmo`
                  : diferencia < -5
                    ? "bajo el ritmo"
                    : "al ritmo"}
              </small>
            )}
          </span>
        ) : (
          <button
            className="cd-btn cd-btn--secondary cd-btn--sm"
            onClick={(e) => {
              e.stopPropagation();
              alEditar();
            }}
          >
            Poner monto
          </button>
        )}
        {!movil && (
          <span className="acciones-fila">
            <button type="button" aria-label={`Editar ${f.nombre}`} title="Editar" onClick={alEditar}>
              <Icono nombre="lapiz" pequeno />
            </button>
            {confirmar ? (
              <button
                type="button"
                className="peligro confirmar"
                aria-label={`Confirmar: eliminar ${f.nombre}`}
                title="Confirmar eliminación"
                onClick={() => eliminar.mutate()}
              >
                <Icono nombre="check" pequeno />
              </button>
            ) : (
              <button
                type="button"
                className="peligro"
                aria-label={`Eliminar ${f.nombre}`}
                title="Eliminar"
                onClick={() => setConfirmar(true)}
              >
                <Icono nombre="basura" pequeno />
              </button>
            )}
          </span>
        )}
      </div>
      {f.tiene_asignacion ? (
        <BarraLimite
          etiqueta={f.nombre}
          gastado={f.gastado}
          limite={f.asignado}
          ritmo={enCurso ? ritmo : undefined}
          alta
        />
      ) : (
        <span className="cd-delta-note cd-num">Gastado {formatoCOP(f.gastado)} · sin monto asignado</span>
      )}
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
  const [confirmarBorrado, setConfirmarBorrado] = useState(false);
  const eliminar = useMutation({
    mutationFn: () => api.eliminarGrupo(inicial.id ?? 0),
    onSuccess: () => {
      toast(`Presupuesto «${inicial.nombre}» eliminado`);
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
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
        confirmarBorrado ? (
          <>
            <span className="pie-confirmar" role="alert">
              ¿Eliminar «{inicial.nombre}»? Sus categorías y movimientos se conservan.
            </span>
            <button className="cd-btn cd-btn--ghost" onClick={() => setConfirmarBorrado(false)}>
              No
            </button>
            <button className="cd-btn cd-btn--peligro" disabled={eliminar.isPending} onClick={() => eliminar.mutate()}>
              {eliminar.isPending ? "Eliminando…" : "Sí, eliminar"}
            </button>
          </>
        ) : (
          <>
            {inicial.id ? (
              <button className="cd-btn cd-btn--peligro-suave" onClick={() => setConfirmarBorrado(true)}>
                Eliminar presupuesto
              </button>
            ) : null}
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
        )
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

function SelectorGrupo({
  grupos,
  valor,
  alCambiar,
}: {
  grupos: { id: number; nombre: string }[];
  valor?: number;
  alCambiar: (g: number | undefined) => void;
}) {
  return (
    <Desplegable
      aria-label="Presupuesto"
      className="cd-select"
      value={valor ?? ""}
      onChange={(e) => alCambiar(e.target.value ? Number(e.target.value) : undefined)}
    >
      <option value="">Todos juntos</option>
      {grupos.map((g) => (
        <option key={g.id} value={g.id}>
          {g.nombre}
        </option>
      ))}
    </Desplegable>
  );
}

function Historico({ grupos }: { grupos: { id: number; nombre: string }[] }) {
  const nav = usePeriodo("6m", "presupuesto-mes-a-mes");
  const [filtro, setFiltro] = useFiltroRecordado<{ grupo?: number }>("presupuesto-mes-a-mes:grupo", {});
  const grupo = filtro.grupo;
  const periodo = nav.preset === "todo" ? aPeriodo("12m") : nav.periodo;
  const desde = periodo.desde ?? moverMes(hoyISO().slice(0, 7), -11);
  const hasta = periodo.hasta ?? hoyISO().slice(0, 7);
  const h = useQuery({
    queryKey: claves.historicoPresupuesto(desde, hasta, grupo),
    queryFn: () => api.historicoPresupuesto(desde, hasta, grupo),
    placeholderData: keepPreviousData,
  });
  const meses = h.data?.meses ?? [];
  const con = meses.filter((m) => m.asignado > 0);
  const dentro = con.filter((m) => m.gastado <= m.asignado).length;
  const media = meses.length ? meses.reduce((t, m) => t + m.gastado, 0) / meses.length : 0;
  return (
    <section className="cd-card">
      <CabeceraTarjeta
        titulo="Mes a mes"
        rango={con.length ? `${dentro} de ${con.length} meses dentro del límite` : "Gastado frente al límite"}
        accion={
          <span className="cd-row" style={{ gap: 6 }}>
            <SelectorGrupo grupos={grupos} valor={grupo} alCambiar={(g) => setFiltro(() => ({ grupo: g }))} />
            <ControlPeriodo nav={nav} opciones={["6m", "12m", "rango"]} />
          </span>
        }
      />
      {h.isPending && <TarjetaCargando filas={3} />}
      {h.isError && <ErrorVista error={h.error} reintentar={() => void h.refetch()} />}
      {h.isSuccess &&
        (meses.length === 0 ? (
          <span className="cd-delta-note">Sin datos en ese periodo.</span>
        ) : (
          <ZonaPeriodo nav={nav} cargando={h.isPlaceholderData}>
            <BarrasAgrupadas
              titulo="Gastado y límite por mes"
              etiquetas={meses.map((m) => nombreMes(m.mes, true))}
              detalles={meses.map((m) => nombreMes(m.mes))}
              series={[
                { nombre: "Gastado", color: "var(--chart-1)", valores: meses.map((m) => m.gastado) },
                {
                  nombre: "Límite",
                  color: "color-mix(in srgb, var(--chart-1) 35%, var(--card))",
                  valores: meses.map((m) => m.asignado),
                },
              ]}
              relativo
              desvanecer
            />
            <p className="cd-delta-note" style={{ margin: "8px 0 0" }}>
              Gasto medio {formatoCOP(Math.round(media))} al mes. En el globo, «Diferencia» negativa = te sobró.
            </p>
          </ZonaPeriodo>
        ))}
    </section>
  );
}

function RitmoMes({ mes, grupos }: { mes: string; grupos: { id: number; nombre: string }[] }) {
  const [filtro, setFiltro] = useFiltroRecordado<{ grupo?: number }>("presupuesto-ritmo:grupo", {});
  const grupo = filtro.grupo;
  const a = useQuery({
    queryKey: [...claves.presupuesto(mes), "acumulado", grupo ?? "todos"],
    queryFn: () => api.acumuladoPresupuesto(mes, grupo),
  });
  const d = a.data;
  const ultimo = d?.serie.filter((s) => s.actual !== null).at(-1);
  const llevas = ultimo?.actual ?? 0;
  const ideal = d && ultimo ? (d.limite * ultimo.dia) / d.dias : 0;
  const proyeccion = d && ultimo && ultimo.dia < d.dias ? Math.round((llevas / ultimo.dia) * d.dias) : llevas;
  const anteriorHoy = ultimo ? d?.serie[ultimo.dia - 1]?.anterior : undefined;
  return (
    <section className="cd-card ritmo-mes">
      <CabeceraTarjeta
        titulo={`Ritmo de ${nombreMes(mes)}`}
        rango={ultimo && d ? `Gasto acumulado al día ${ultimo.dia} de ${d.dias}` : "Gasto acumulado del mes"}
        accion={<SelectorGrupo grupos={grupos} valor={grupo} alCambiar={(g) => setFiltro(() => ({ grupo: g }))} />}
      />
      {a.isPending && <TarjetaCargando filas={3} />}
      {a.isError && <ErrorVista error={a.error} reintentar={() => void a.refetch()} />}
      {d && ultimo && (
        <FilaMetricas
          etiqueta={`Ritmo de ${nombreMes(mes)}`}
          metricas={[
            { etiqueta: "Llevas", valor: llevas },
            ...(d.limite > 0
              ? [
                  {
                    etiqueta: "Ideal a hoy",
                    valor: Math.round(ideal),
                    nota: llevas > ideal ? `${formatoCOP(Math.round(llevas - ideal))} arriba` : "vas por debajo",
                    tono: llevas > ideal ? ("alerta" as const) : ("ingreso" as const),
                  },
                ]
              : []),
            {
              etiqueta: "Al cierre",
              valor: proyeccion,
              nota: d.limite > 0 ? `límite ${formatoCOP(d.limite)}` : "si sigues así",
              tono: d.limite > 0 && proyeccion > d.limite ? ("alerta" as const) : undefined,
            },
            ...(anteriorHoy !== undefined
              ? [{ etiqueta: `${nombreMes(d.anterior, true)} a la fecha`, valor: anteriorHoy }]
              : []),
          ]}
        />
      )}
      {d && (
        <AreaComparada
          alto={260}
          titulo={`Gasto acumulado de ${nombreMes(mes)} frente a ${nombreMes(d.anterior)}`}
          nombre={nombreMes(mes, true)}
          nombreAnterior={nombreMes(d.anterior, true)}
          limite={d.limite > 0 ? { valor: d.limite, etiqueta: "Límite" } : undefined}
          datos={d.serie.map((s) => ({
            etiqueta: String(s.dia),
            detalle: `Día ${s.dia}`,
            valor: s.actual,
            anterior: s.anterior,
            ideal: d.limite > 0 ? Math.round((d.limite * s.dia) / d.dias) : undefined,
          }))}
        />
      )}
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
  const grupos = (d?.filas ?? []).map((f) => ({ id: f.id, nombre: f.nombre }));

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Presupuesto</h1>
          <p>Cada peso con un destino. Un presupuesto puede reunir varias categorías.</p>
        </div>
        <div className="cd-row">
          <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={() => copiar.mutate()}>
            Copiar {nombreMes(moverMes(mes, -1)).split(" ")[0]}
          </button>
          <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => setForm({})}>
            <Icono nombre="mas" pequeno />
            Nuevo presupuesto
          </button>
        </div>
      </div>
      <BarraFiltros etiqueta="Mes del presupuesto">
        <div className="selector-mes">
          <button className="cd-icon-btn" aria-label="Mes anterior" onClick={() => setMes(moverMes(mes, -1))}>
            ‹
          </button>
          <span aria-live="polite">{nombreMes(mes)}</span>
          <button className="cd-icon-btn" aria-label="Mes siguiente" onClick={() => setMes(moverMes(mes, 1))}>
            ›
          </button>
        </div>
        {d && d.ritmo > 0 && d.ritmo < 1 && (
          <span className="cd-delta-note">Va el {Math.round(d.ritmo * 100)}% del mes</span>
        )}
      </BarraFiltros>
      {datos.isPending && <TarjetaCargando />}
      {datos.isError && <ErrorVista error={datos.error} reintentar={() => void datos.refetch()} />}
      {d && (
        <>
          <div className="cd-bento">
            <div className="span-5 presupuesto-kpis">
              <KpiCompacto
                etiqueta="Ingreso de referencia"
                icono="entra"
                valor={d.ingreso_referencia}
                nota="mínimo de 6 meses"
              />
              <KpiCompacto
                etiqueta="Asignado"
                icono="presupuesto"
                valor={d.asignado}
                nota={`${formatoCOP(d.asignado_fijo)} fijos`}
              />
              <KpiCompacto
                etiqueta="Por asignar"
                icono="cuentas"
                valor={d.por_asignar}
                delta={d.por_asignar < 0 ? { valor: 0, sentido: "alerta", texto: "De más" } : undefined}
                nota={d.por_asignar < 0 ? undefined : "disponible"}
              />
              <KpiCompacto
                className="kpi-gastado"
                etiqueta="Gastado"
                icono="sale"
                valor={d.gastado}
                nota={d.asignado > 0 ? `${Math.round((d.gastado / d.asignado) * 100)}% de lo asignado` : undefined}
                indicador={
                  d.asignado > 0 ? (
                    <MedioAnillo
                      titulo="Gastado de lo asignado"
                      fraccion={d.gastado / d.asignado}
                      tamano={esMovil() ? 96 : 170}
                      grosor={esMovil() ? 10 : 16}
                      detalle="de lo asignado"
                      severidad
                    />
                  ) : undefined
                }
              />
            </div>
            <div className="span-7">
              <Historico grupos={grupos} />
            </div>
          </div>
          <div className="cd-bento">
            <section className="cd-card span-6">
              <CabeceraTarjeta
                titulo={`Presupuestos de ${nombreMes(mes)}`}
                rango={d.ritmo > 0 && d.ritmo < 1 ? "La marca vertical es el ritmo ideal a hoy" : undefined}
              />
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
                <ul className="lista-presupuestos">
                  {d.filas.map((f) => (
                    <FilaGrupo key={f.id} f={f} ritmo={d.ritmo} alEditar={() => setForm(f)} />
                  ))}
                </ul>
              )}
            </section>
            <div className="span-6">
              <RitmoMes mes={mes} grupos={grupos} />
            </div>
          </div>
        </>
      )}
      {form && <FormGrupo key={form.id ?? "nuevo"} inicial={form} mes={mes} alCerrar={() => setForm(null)} />}
    </>
  );
}
