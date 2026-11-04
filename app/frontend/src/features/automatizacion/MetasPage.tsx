/** Metas y hábitos (RF-ME, fase 8 punto 11): ahorro, salir de deudas, tope de gasto y hábito. Cada meta muestra
 * cuenta regresiva, fecha prevista al ritmo actual y avance con signo (negativo si se retrocede); se editan en
 * un popup, y las cumplidas y archivadas tienen su propia sección. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { Meta, MetaNueva, TipoMeta } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { rutaDe } from "@/shared/lib/categorias";
import { fechaCorta, formatoCOP, mascaraMonto, nombreMes, parseMonto, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { MenuAcciones } from "@/shared/ui/MenuAcciones";
import { Icono, type NombreIcono } from "@/shared/ui/Icono";
import { SelectorCategoria } from "@/shared/ui/SelectorCategoria";
import { LogoCuenta } from "@/shared/ui/SelectorCuenta";

const TIPOS: Record<TipoMeta, { nombre: string; icono: NombreIcono; ayuda: string }> = {
  ahorro: { nombre: "Ahorro", icono: "meta", ayuda: "Junta un monto en una cuenta (fondo de emergencia, una compra)." },
  deuda: {
    nombre: "Salir de deudas",
    icono: "deudas",
    ayuda: "Mide cuánto has bajado de la deuda total de tus créditos.",
  },
  tope_gasto: { nombre: "Tope de gasto", icono: "presupuesto", ayuda: "Un máximo al mes para una categoría." },
  habito: { nombre: "Hábito", icono: "dado", ayuda: "Llevar a cero una categoría y cuidar la racha." },
};

function useEstadoMeta(m: Meta) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (nuevo: Meta["estado"]) => api.estadoMeta(m.id, nuevo),
    onSuccess: (_, nuevo) =>
      toast(
        nuevo === "cumplida"
          ? `¡${m.nombre} cumplida!`
          : nuevo === "archivada"
            ? `${m.nombre} archivada`
            : `${m.nombre} activa de nuevo`,
      ),
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: claves.metas }),
  });
}

/** «faltan 42 días · 30 jun 2027» o «venció hace 3 días». */
function cuentaRegresiva(m: Meta): string | null {
  if (m.dias_restantes === null || !m.fecha_objetivo) return null;
  const fecha = fechaCorta(m.fecha_objetivo, true);
  if (m.dias_restantes < 0) return `venció hace ${-m.dias_restantes} días · ${fecha}`;
  if (m.dias_restantes === 0) return `vence hoy · ${fecha}`;
  return `faltan ${m.dias_restantes} días · ${fecha}`;
}

function TarjetaMeta({ m, alEditar }: { m: Meta; alEditar: () => void }) {
  const estado = useEstadoMeta(m);
  const pct = Math.round(m.progreso * 100);
  const retrocede = (m.tipo === "ahorro" || m.tipo === "deuda") && pct < 0;
  const regresiva = cuentaRegresiva(m);
  const limite = m.tipo === "tope_gasto" || m.tipo === "habito";
  const claseBarra = limite ? (m.excedido ? "cd-progress--over" : pct >= 80 ? "cd-progress--warn" : "") : "";
  let detalle: string;
  if (m.tipo === "ahorro") {
    detalle = `${formatoCOP(m.actual)} de ${formatoCOP(m.objetivo ?? 0)} en ${m.cuenta ?? "tu cuenta"}`;
    if (m.aporte_mensual && m.fecha_objetivo)
      detalle += ` · ${formatoCOP(m.aporte_mensual)}/mes para el ${fechaCorta(m.fecha_objetivo, true)}`;
  } else if (m.tipo === "deuda") {
    detalle = `Debías ${formatoCOP(m.base ?? 0)}; hoy ${formatoCOP(m.actual)}`;
  } else if (m.tipo === "tope_gasto") {
    detalle = `${formatoCOP(m.actual)} de ${formatoCOP(m.objetivo ?? 0)} en ${nombreMes(m.mes ?? "")}`;
  } else {
    detalle = m.actual > 0 ? `${formatoCOP(m.actual)} este mes` : "Nada este mes";
  }
  return (
    <article className="cd-card cd-stack" style={{ gap: 14 }}>
      <div className="cd-row" style={{ flexWrap: "nowrap", gap: 12 }}>
        <span className="cd-kpi-ico" style={{ flex: "none" }}>
          <Icono nombre={TIPOS[m.tipo].icono} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{m.nombre}</b>
          <span className="cd-delta-note" style={{ display: "block" }}>
            {TIPOS[m.tipo].nombre}
            {m.rastrea.length > 0 && ` · ${m.rastrea.join(", ")}`}
          </span>
        </span>
        {m.tipo === "habito" ? (
          <span className="cd-stack" style={{ alignItems: "flex-end", gap: 0 }}>
            <span className="cd-amt" style={{ fontSize: 22 }}>
              {m.racha_dias ?? "—"}
            </span>
            <span className="cd-delta-note">días sin</span>
          </span>
        ) : (
          <span className="cd-amt" style={{ fontSize: 20, color: retrocede ? "var(--negative)" : undefined }}>
            {retrocede ? "−" : ""}
            {Math.abs(pct)}%
          </span>
        )}
        <MenuAcciones
          etiqueta={`Acciones de ${m.nombre}`}
          acciones={[
            { texto: "Editar", alElegir: alEditar },
            ...(m.tipo === "ahorro" || m.tipo === "deuda"
              ? [{ texto: "Marcar cumplida", alElegir: () => estado.mutate("cumplida") }]
              : []),
            { texto: "Archivar", alElegir: () => estado.mutate("archivada") },
          ]}
        />
      </div>
      {m.tipo !== "habito" && (
        <div
          className={`cd-progress ${claseBarra}`}
          role="progressbar"
          aria-label={m.nombre}
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
      )}
      <span className="cd-delta-note cd-num">
        {detalle}
        {m.excedido && m.tipo === "tope_gasto" && " · pasaste el tope"}
        {retrocede && (m.tipo === "ahorro" ? " · hoy hay menos que al empezar" : " · la deuda creció")}
      </span>
      {(regresiva || m.fecha_prevista || m.ritmo_mensual !== undefined) && (
        <div className="meta-fechas">
          {regresiva && (
            <span>
              <small>Fecha objetivo</small>
              <b style={{ color: m.dias_restantes !== null && m.dias_restantes < 0 ? "var(--negative)" : undefined }}>
                {regresiva}
              </b>
            </span>
          )}
          {(m.tipo === "ahorro" || m.tipo === "deuda") && (
            <span>
              <small>Al ritmo actual</small>
              <b>
                {m.fecha_prevista
                  ? `lo logras en ${nombreMes(m.fecha_prevista.slice(0, 7))}`
                  : m.ritmo_mensual && m.ritmo_mensual < 0
                    ? "vas retrocediendo"
                    : "sin avance en 3 meses"}
              </b>
            </span>
          )}
        </div>
      )}
      {(m.tipo === "ahorro" || m.tipo === "deuda") && m.progreso >= 1 && (
        <button
          className="cd-btn cd-btn--primary cd-btn--sm"
          style={{ alignSelf: "flex-start" }}
          onClick={() => estado.mutate("cumplida")}
        >
          ¡Lo lograste! Marcar cumplida
        </button>
      )}
    </article>
  );
}

function FormMeta({ meta, alCerrar }: { meta: Meta | null; alCerrar: () => void }) {
  const id = useId();
  const cliente = useQueryClient();
  const [tipo, setTipo] = useState<TipoMeta>(meta?.tipo ?? "ahorro");
  const [nombre, setNombre] = useState(meta?.nombre ?? "");
  const [objetivo, setObjetivo] = useState(meta?.objetivo ? mascaraMonto(String(meta.objetivo / 100)) : "");
  const [rastreo, setRastreo] = useState<"cuentas" | "categorias">(
    meta && meta.cuenta_ids.length === 0 && meta.categoria_ids.length > 0 ? "categorias" : "cuentas",
  );
  const [cuentaIds, setCuentaIds] = useState<number[]>(meta?.cuenta_ids ?? []);
  const [categoriaIds, setCategoriaIds] = useState<number[]>(meta?.categoria_ids ?? []);
  const [fecha, setFecha] = useState(meta?.fecha_objetivo ?? "");
  const [estado, setEstado] = useState<Meta["estado"]>(meta?.estado ?? "activa");
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: () => api.cuentas() });
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias, staleTime: 60_000 });
  const crear = useMutation({
    mutationFn: async () => {
      const datos: MetaNueva = {
        nombre: nombre.trim() || TIPOS[tipo].nombre,
        tipo,
        objetivo: tipo === "habito" ? 0 : parseMonto(objetivo),
        cuenta_ids: rastreo === "cuentas" ? cuentaIds : [],
        categoria_ids: rastreo === "categorias" ? categoriaIds : [],
        fecha_objetivo: (tipo === "ahorro" || tipo === "deuda") && fecha ? fecha : null,
      };
      if (!meta) {
        await api.crearMeta(datos);
        return;
      }
      await api.editarMeta(meta.id, datos);
      if (estado !== meta.estado) await api.estadoMeta(meta.id, estado);
    },
    onSuccess: () => {
      toast.success(meta ? "Meta actualizada" : "Meta creada");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: claves.metas }),
  });
  const etiqueta = (campo: string, texto: string) => (
    <label htmlFor={`${id}-${campo}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
      {texto}
    </label>
  );
  return (
    <Hoja
      titulo={meta ? `Editar ${meta.nombre}` : "Nueva meta"}
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--primary" disabled={crear.isPending} onClick={() => crear.mutate()}>
            {meta ? "Guardar cambios" : "Crear meta"}
          </button>
        </>
      }
    >
      <div className="cd-stack" style={{ gap: 6 }}>
        {etiqueta("tipo", "Tipo")}
        <select
          id={`${id}-tipo`}
          className="cd-input"
          disabled={Boolean(meta)}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as TipoMeta)}
        >
          {Object.entries(TIPOS).map(([v, t]) => (
            <option key={v} value={v}>
              {t.nombre}
            </option>
          ))}
        </select>
        <span className="cd-delta-note">{TIPOS[tipo].ayuda}</span>
      </div>
      <div className="cd-stack" style={{ gap: 6 }}>
        {etiqueta("nombre", "Nombre")}
        <input
          id={`${id}-nombre`}
          className="cd-input"
          placeholder={
            tipo === "ahorro" ? "Fondo de emergencia" : tipo === "habito" ? "Cero domicilios" : TIPOS[tipo].nombre
          }
          value={nombre}
          onChange={(e) => setNombre(e.target.value)}
        />
      </div>
      {(tipo === "ahorro" || tipo === "tope_gasto") && (
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("objetivo", tipo === "ahorro" ? "Monto a juntar" : "Máximo al mes")}
          <input
            id={`${id}-objetivo`}
            className="cd-input cd-num"
            inputMode="decimal"
            placeholder="$ 0"
            value={objetivo}
            onChange={(e) => setObjetivo(mascaraMonto(e.target.value))}
          />
        </div>
      )}
      {meta && (
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("estado", "Estado")}
          <select
            id={`${id}-estado`}
            className="cd-input"
            value={estado}
            onChange={(e) => setEstado(e.target.value as Meta["estado"])}
          >
            <option value="activa">Activa</option>
            <option value="cumplida">Cumplida</option>
            <option value="archivada">Archivada</option>
          </select>
        </div>
      )}
      {(tipo === "ahorro" || tipo === "deuda") && (
        <div className="cd-stack" style={{ gap: 6 }}>
          {etiqueta("fecha", "Para cuándo (opcional)")}
          <input
            id={`${id}-fecha`}
            type="date"
            className="cd-input"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </div>
      )}
      {tipo !== "deuda" && (
        <div className="cd-stack" style={{ gap: 8 }}>
          <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>Rastrear con</span>
          <div className="cd-seg" role="radiogroup" aria-label="Rastrear con" style={{ display: "flex" }}>
            {(
              [
                ["cuentas", "Cuentas"],
                ["categorias", "Categorías"],
              ] as const
            ).map(([v, t]) => (
              <button
                key={v}
                type="button"
                role="radio"
                aria-checked={rastreo === v}
                aria-selected={rastreo === v}
                style={{ flex: 1, justifyContent: "center" }}
                onClick={() => setRastreo(v)}
              >
                {t}
              </button>
            ))}
          </div>
          <span className="cd-delta-note">
            {tipo === "ahorro"
              ? rastreo === "cuentas"
                ? "Cuenta lo que hay en esas cuentas."
                : "Cuenta lo que aportas a esas categorías desde hoy."
              : rastreo === "cuentas"
                ? "Vigila todo lo que gastas desde esas cuentas cada mes."
                : "Vigila lo que gastas en esas categorías cada mes."}
          </span>
          {rastreo === "cuentas" ? (
            <div className="cd-row" style={{ gap: 6 }}>
              {(cuentas.data ?? []).map((c) => {
                const activa = cuentaIds.includes(c.id);
                return (
                  <button
                    key={c.id}
                    type="button"
                    aria-pressed={activa}
                    className="cd-btn cd-btn--sm selector-chip"
                    onClick={() => setCuentaIds((x) => (activa ? x.filter((i) => i !== c.id) : [...x, c.id]))}
                  >
                    <LogoCuenta cuenta={c} tam={20} />
                    {c.nombre}
                  </button>
                );
              })}
            </div>
          ) : (
            <>
              <div className="cd-row" style={{ gap: 6 }}>
                {categoriaIds.map((cid) => (
                  <span key={cid} className="cd-badge cd-badge--neutral" style={{ gap: 6 }}>
                    {rutaDe(arbol.data ?? [], cid)
                      ?.ruta.slice(1)
                      .join(" › ") ?? cid}
                    <button
                      type="button"
                      aria-label="Quitar"
                      style={{ border: 0, background: "none", color: "inherit", cursor: "pointer", padding: 0 }}
                      onClick={() => setCategoriaIds((x) => x.filter((i) => i !== cid))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
              <SelectorCategoria
                arbol={arbol.data ?? []}
                grupos={["gasto_vida", "apuestas", "ahorro_inversion", "servicio_deuda"]}
                valor={null}
                permitirPadre
                alCambiar={(cid) => setCategoriaIds((x) => (x.includes(cid) ? x : [...x, cid]))}
              />
            </>
          )}
        </div>
      )}
    </Hoja>
  );
}

/** Cumplida: cuánto tomó, el objetivo y lo logrado; editar (también el estado) o archivar. */
function TarjetaCumplida({ m, alEditar }: { m: Meta; alEditar: () => void }) {
  const estado = useEstadoMeta(m);
  const dias = m.cumplida_en ? Math.round((Date.parse(m.cumplida_en) - Date.parse(m.creado_en)) / 86_400_000) : null;
  const enFecha = m.fecha_objetivo && m.cumplida_en ? m.cumplida_en <= m.fecha_objetivo : null;
  return (
    <article className="cd-card cd-stack" style={{ gap: 10 }}>
      <div className="cd-row" style={{ flexWrap: "nowrap", gap: 10 }}>
        <span
          className="cd-kpi-ico"
          style={{ flex: "none", background: "var(--positive-soft)", color: "var(--positive)" }}
        >
          <Icono nombre={TIPOS[m.tipo].icono} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <b style={{ fontSize: 15 }}>{m.nombre}</b>
          <span className="cd-delta-note" style={{ display: "block" }}>
            {TIPOS[m.tipo].nombre}
          </span>
        </span>
        <span className="cd-badge cd-badge--positive">Cumplida</span>
      </div>
      <div className="meta-fechas">
        <span>
          <small>Tomó</small>
          <b>{dias !== null ? `${dias} días` : "—"}</b>
        </span>
        <span>
          <small>Del {fechaCorta(m.creado_en, true)} al</small>
          <b>{m.cumplida_en ? fechaCorta(m.cumplida_en, true) : "—"}</b>
        </span>
        <span>
          <small>Objetivo</small>
          <b>
            {m.tipo === "deuda" ? "deuda en $ 0" : formatoCOP(m.objetivo ?? 0)}
            {enFecha !== null && (enFecha ? " · a tiempo" : " · después de la fecha")}
          </b>
        </span>
        <span>
          <small>Lograste</small>
          <b>{m.tipo === "deuda" ? `bajar ${porcentaje(Math.max(0, m.progreso), 0)}` : formatoCOP(m.actual)}</b>
        </span>
      </div>
      <div className="cd-row" style={{ gap: 6 }}>
        <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={alEditar}>
          Editar
        </button>
        <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => estado.mutate("activa")}>
          Desmarcar cumplida
        </button>
        <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => estado.mutate("archivada")}>
          Archivar
        </button>
      </div>
    </article>
  );
}

function FilaArchivada({ m }: { m: Meta }) {
  const cliente = useQueryClient();
  const estado = useEstadoMeta(m);
  const [confirmar, setConfirmar] = useState(false);
  const eliminar = useMutation({
    mutationFn: () => api.eliminarMeta(m.id),
    onSuccess: () => toast(`${m.nombre} eliminada`),
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: claves.metas }),
  });
  return (
    <li
      className="cd-row"
      style={{ flexWrap: "nowrap", gap: 8, padding: "10px 0", borderBottom: "1px solid var(--border)" }}
    >
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{m.nombre}</b>
        <span className="cd-delta-note" style={{ display: "block" }}>
          {TIPOS[m.tipo].nombre}
          {m.cumplida_en && ` · cumplida el ${fechaCorta(m.cumplida_en, true)}`}
        </span>
      </span>
      <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={() => estado.mutate("activa")}>
        Restaurar
      </button>
      {confirmar ? (
        <button
          className="cd-btn cd-btn--peligro cd-btn--sm"
          disabled={eliminar.isPending}
          onClick={() => eliminar.mutate()}
        >
          Sí, eliminar
        </button>
      ) : (
        <button className="cd-btn cd-btn--ghost cd-btn--peligro-suave cd-btn--sm" onClick={() => setConfirmar(true)}>
          Eliminar
        </button>
      )}
    </li>
  );
}

export function MetasPage() {
  const metas = useQuery({ queryKey: claves.metas, queryFn: api.metas });
  const [form, setForm] = useState<Meta | "nueva" | null>(null);
  const todas = metas.data ?? [];
  const activas = todas.filter((m) => m.estado === "activa");
  const cumplidas = todas.filter((m) => m.estado === "cumplida");
  const archivadas = todas.filter((m) => m.estado === "archivada");
  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Metas y hábitos</h1>
          <p>Lo que quieres lograr, medido solo con tus movimientos. Sin juicios, siempre a la vista.</p>
        </div>
        <button className="cd-btn cd-btn--primary" onClick={() => setForm("nueva")}>
          + Meta
        </button>
      </div>
      {form && (
        <FormMeta
          key={form === "nueva" ? "nueva" : form.id}
          meta={form === "nueva" ? null : form}
          alCerrar={() => setForm(null)}
        />
      )}
      {metas.isPending && <TarjetaCargando />}
      {metas.isError && <ErrorVista error={metas.error} reintentar={() => void metas.refetch()} />}
      {metas.isSuccess && activas.length === 0 && (
        <section className="cd-card">
          <Vacio
            titulo="No tienes metas activas"
            texto="Empieza por un fondo de emergencia, salir de deudas o un hábito que quieras cuidar."
            accion={
              <button className="cd-btn cd-btn--primary cd-btn--sm" onClick={() => setForm("nueva")}>
                Nueva meta
              </button>
            }
          />
        </section>
      )}
      <div className="metas-rejilla">
        {activas.map((m) => (
          <TarjetaMeta key={m.id} m={m} alEditar={() => setForm(m)} />
        ))}
      </div>
      {cumplidas.length > 0 && (
        <>
          <h2 className="cd-card-title" style={{ margin: "8px 0 0" }}>
            Cumplidas
          </h2>
          <div className="metas-rejilla">
            {cumplidas.map((m) => (
              <TarjetaCumplida key={m.id} m={m} alEditar={() => setForm(m)} />
            ))}
          </div>
        </>
      )}
      {archivadas.length > 0 && (
        <details className="cd-card">
          <summary className="cd-card-title" style={{ cursor: "pointer" }}>
            Archivadas ({archivadas.length})
          </summary>
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {archivadas.map((m) => (
              <FilaArchivada key={m.id} m={m} />
            ))}
          </ul>
        </details>
      )}
    </>
  );
}
