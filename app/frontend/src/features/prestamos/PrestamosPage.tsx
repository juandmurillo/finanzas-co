/** Préstamos personales (RF-PP): por persona, «Me deben» y «Debo», con el detalle de cada préstamo. */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import type { DireccionPrestamo, Prestamo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP } from "@/shared/lib/formato";
import { mostrarPanel } from "@/shared/lib/panel";
import { claves } from "@/shared/lib/queryKeys";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { BarraFiltros } from "@/shared/ui/BarraFiltros";
import { Hoja } from "@/shared/ui/Hoja";
import { KpiCompacto } from "@/shared/ui/Kpi";

import { estadoVisible, TarjetaPrestamo } from "./GestionPrestamo";
import { NuevoPrestamo } from "./NuevoPrestamo";
import "./prestamos.css";

type Pestana = DireccionPrestamo | "cerrados";

interface Persona {
  nombre: string;
  prestamos: Prestamo[];
  meDebe: number;
  leDebo: number;
  proxima: { fecha: string; monto: number } | null;
  vencido: number;
}

/** Agrupa por persona (contraparte), con lo pendiente en cada sentido. */
export function agruparPorPersona(lista: Prestamo[]): Persona[] {
  const mapa = new Map<string, Persona>();
  for (const p of lista) {
    const clave = String(p.contraparte_id ?? p.persona);
    const persona = mapa.get(clave) ?? {
      nombre: p.persona,
      prestamos: [],
      meDebe: 0,
      leDebo: 0,
      proxima: null,
      vencido: 0,
    };
    persona.prestamos.push(p);
    if (p.estado === "activo") {
      if (p.direccion === "presto_yo") persona.meDebe += p.pendiente;
      else persona.leDebo += p.pendiente;
      if (p.proxima_cuota && (!persona.proxima || p.proxima_cuota.fecha < persona.proxima.fecha))
        persona.proxima = p.proxima_cuota;
      persona.vencido = Math.max(persona.vencido, p.dias_vencido);
    }
    mapa.set(clave, persona);
  }
  return [...mapa.values()].sort(
    (a, b) =>
      (a.proxima?.fecha ?? "9999").localeCompare(b.proxima?.fecha ?? "9999") || a.nombre.localeCompare(b.nombre),
  );
}

function iniciales(nombre: string): string {
  return nombre
    .split(/\s+/)
    .map((x) => x[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

function FilaPersona({
  persona,
  pestana,
  activa,
  alElegir,
}: {
  persona: Persona;
  pestana: Pestana;
  activa: boolean;
  alElegir: () => void;
}) {
  const saldo = pestana === "presto_yo" ? persona.meDebe : pestana === "me_prestaron" ? persona.leDebo : 0;
  const otro = pestana === "presto_yo" ? persona.leDebo : pestana === "me_prestaron" ? persona.meDebe : 0;
  const delaPestana = persona.prestamos.filter((p) =>
    pestana === "cerrados" ? p.estado !== "activo" : p.estado === "activo" && p.direccion === pestana,
  );
  const n = delaPestana.length;
  return (
    <li>
      <button type="button" className="fila-persona" aria-current={activa ? "true" : undefined} onClick={alElegir}>
        <span className="cd-avatar avatar-persona" aria-hidden>
          {iniciales(persona.nombre)}
        </span>
        <span className="fila-persona-texto">
          <b>{persona.nombre}</b>
          <small>
            {n} {n === 1 ? "préstamo" : "préstamos"}
            {persona.vencido > 0 && pestana !== "cerrados"
              ? ` · vencido hace ${persona.vencido} ${persona.vencido === 1 ? "día" : "días"}`
              : persona.proxima && pestana !== "cerrados"
                ? ` · próximo ${fechaCorta(persona.proxima.fecha)}`
                : ""}
          </small>
          {otro > 0 && (
            <small className="fila-persona-otro">
              {pestana === "presto_yo" ? `Tú le debes ${formatoCOP(otro)}` : `Te debe ${formatoCOP(otro)}`}
            </small>
          )}
        </span>
        {pestana !== "cerrados" && (
          <b className={`cd-num fila-persona-saldo ${pestana === "presto_yo" ? "texto-ingreso" : ""}`}>
            {formatoCOP(saldo)}
          </b>
        )}
      </button>
    </li>
  );
}

function PanelPersona({
  persona,
  pestana,
  alNuevo,
  alVolver,
}: {
  persona: Persona;
  pestana: Pestana;
  alNuevo: () => void;
  alVolver: () => void;
}) {
  // Primero los de la pestaña; después, el otro sentido y los cerrados, para ver todo con esa persona.
  const orden = (p: Prestamo) =>
    pestana === "cerrados"
      ? p.estado === "activo"
        ? 1
        : 0
      : p.estado !== "activo"
        ? 2
        : p.direccion === pestana
          ? 0
          : 1;
  const prestamos = [...persona.prestamos].sort((a, b) => orden(a) - orden(b) || b.fecha.localeCompare(a.fecha));
  const cerrados = prestamos.filter((p) => p.estado !== "activo");
  const activos = prestamos.filter((p) => p.estado === "activo");
  return (
    <section className="panel-persona cd-stack" aria-labelledby="panel-persona-nombre" tabIndex={-1}>
      <button type="button" className="panel-volver" onClick={alVolver}>
        ‹ Personas
      </button>
      <header className="panel-persona-cabeza">
        <span className="cd-avatar avatar-persona avatar-persona--grande" aria-hidden>
          {iniciales(persona.nombre)}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <h2 id="panel-persona-nombre">{persona.nombre}</h2>
          <div className="panel-persona-saldos">
            {activos.length > 1 || (persona.meDebe > 0 && persona.leDebo > 0) ? (
              <>
                {persona.meDebe > 0 && (
                  <span>
                    Te debe <b className="cd-num texto-ingreso">{formatoCOP(persona.meDebe)}</b>
                  </span>
                )}
                {persona.leDebo > 0 && (
                  <span>
                    Le debes <b className="cd-num">{formatoCOP(persona.leDebo)}</b>
                  </span>
                )}
                <span>{activos.length} préstamos activos</span>
              </>
            ) : (
              <span>
                {activos.length === 1 ? "1 préstamo activo" : "Sin préstamos activos"}
                {cerrados.length > 0 ? ` · ${cerrados.length} cerrados` : ""}
              </span>
            )}
          </div>
        </div>
        <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={alNuevo}>
          + Otro préstamo
        </button>
      </header>
      {activos.map((p) => (
        <TarjetaPrestamo key={p.id} p={p} />
      ))}
      {activos.length === 0 && <p className="cd-delta-note">No hay préstamos activos con {persona.nombre}.</p>}
      {cerrados.length > 0 && (
        <details className="prestamos-cerrados" open={pestana === "cerrados"}>
          <summary>
            Cerrados ({cerrados.length}) · {cerrados.map((p) => estadoVisible(p).texto.toLowerCase()).join(", ")}
          </summary>
          <div className="cd-stack" style={{ gap: 12, marginTop: 12 }}>
            {cerrados.map((p) => (
              <TarjetaPrestamo key={p.id} p={p} />
            ))}
          </div>
        </details>
      )}
    </section>
  );
}

export function PrestamosPage() {
  const [pestana, setPestana] = useState<Pestana>("presto_yo");
  const [elegida, setElegida] = useState<string | null>(null);
  const [nuevo, setNuevo] = useState<{ persona?: string } | null>(null);
  const resumen = useQuery({ queryKey: claves.resumenPrestamos, queryFn: api.resumenPrestamos });
  const lista = useQuery({ queryKey: claves.prestamos(), queryFn: () => api.prestamos() });
  const personas = agruparPorPersona(lista.data ?? []);
  const visibles = personas.filter((x) =>
    x.prestamos.some((p) =>
      pestana === "cerrados" ? p.estado !== "activo" : p.estado === "activo" && p.direccion === pestana,
    ),
  );
  const seleccionada = visibles.find((x) => x.nombre === elegida) ?? visibles[0];
  const r = resumen.data;

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Préstamos personales</h1>
          <p>Con amigos, familia u otras fuentes. Cada persona reúne sus préstamos, entregas y abonos.</p>
        </div>
        <button className="cd-btn cd-btn--primary" onClick={() => setNuevo({})}>
          + Préstamo
        </button>
      </div>
      {nuevo && (
        <Hoja
          titulo={nuevo.persona ? `Nuevo préstamo con ${nuevo.persona}` : "Nuevo préstamo"}
          onCerrar={() => setNuevo(null)}
        >
          <NuevoPrestamo
            personas={personas.map((x) => x.nombre)}
            personaInicial={nuevo.persona}
            direccionInicial={pestana === "me_prestaron" ? "me_prestaron" : "presto_yo"}
            alGuardar={() => setNuevo(null)}
          />
        </Hoja>
      )}

      {r && (
        <div className="cd-bento prestamos-kpis">
          <KpiCompacto
            className="span-3"
            inversa
            etiqueta="Me deben"
            icono="entra"
            valor={r.me_deben}
            nota={`${r.activos} activos`}
          />
          <KpiCompacto className="span-3" etiqueta="Debo" icono="sale" valor={r.debo} nota="incluye intereses" />
          <KpiCompacto
            className="span-3"
            etiqueta="Próximos 7 días"
            icono="calendario"
            valor={r.proximos_7_dias}
            nota="por cobrar o pagar"
          />
          <KpiCompacto
            className="span-3"
            etiqueta="Vencidos"
            icono="alerta"
            valor={String(r.vencidos)}
            delta={r.vencidos ? { valor: 0, sentido: "alerta", texto: "Revisa con cada persona" } : undefined}
            nota={r.vencidos ? undefined : "todo al día"}
          />
        </div>
      )}

      <BarraFiltros etiqueta="Sentido de los préstamos">
        <div className="cd-seg cd-seg--brand" role="tablist" aria-label="Sentido">
          {(
            [
              ["presto_yo", "Me deben"],
              ["me_prestaron", "Debo"],
              ["cerrados", "Cerrados"],
            ] as [Pestana, string][]
          ).map(([v, t]) => (
            <button
              key={v}
              role="tab"
              aria-selected={pestana === v}
              onClick={() => {
                setPestana(v);
                setElegida(null);
              }}
            >
              {t}
            </button>
          ))}
        </div>
      </BarraFiltros>

      {lista.isPending && <TarjetaCargando />}
      {lista.isError && <ErrorVista error={lista.error} reintentar={() => void lista.refetch()} />}
      {lista.isSuccess && visibles.length === 0 && (
        <section className="cd-card">
          <Vacio
            titulo={
              pestana === "cerrados"
                ? "Aún no hay préstamos cerrados"
                : pestana === "presto_yo"
                  ? "Nadie te debe ahora"
                  : "No le debes a nadie"
            }
            texto="Registra uno con «+ Préstamo»."
          />
        </section>
      )}
      {lista.isSuccess && visibles.length > 0 && seleccionada && (
        <div className="prestamos" data-detalle={elegida !== null ? "si" : "no"}>
          <section className="cd-card prestamos-lista" aria-label="Personas">
            <ul>
              {visibles.map((x) => (
                <FilaPersona
                  key={x.nombre}
                  persona={x}
                  pestana={pestana}
                  activa={seleccionada.nombre === x.nombre}
                  alElegir={() => {
                    setElegida(x.nombre);
                    requestAnimationFrame(() => mostrarPanel(".panel-persona"));
                  }}
                />
              ))}
            </ul>
          </section>
          <PanelPersona
            key={seleccionada.nombre}
            persona={seleccionada}
            pestana={pestana}
            alNuevo={() => setNuevo({ persona: seleccionada.nombre })}
            alVolver={() => setElegida(null)}
          />
        </div>
      )}
    </>
  );
}
