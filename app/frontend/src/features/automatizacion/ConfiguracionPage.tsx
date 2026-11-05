/** Configuración (fase 5): reglas de categorización, precisión de las sugerencias, respaldos e instalación. */
import { useSistema } from "@/shared/lib/useSistema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { toast } from "sonner";

import type { CondicionRegla, Regla, ReglaNueva } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP, mascaraMonto, parseMonto, porcentaje } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { SelectorCategoria } from "@/shared/ui/SelectorCategoria";

import { TusDatos } from "./TusDatos";

function describir(c: CondicionRegla): string {
  if (c.campo === "descripcion") return `descripción ${c.op} “${c.valor}”`;
  if (c.campo === "tipo") return c.valor === "gasto" ? "es un gasto" : "es un ingreso";
  const monto = (v: number | string) => formatoCOP(Number(v));
  if (c.op === "entre") return `monto entre ${monto(c.valor)} y ${monto(c.valor2 ?? 0)}`;
  return `monto ${c.op === "mayor" ? "mayor que" : c.op === "menor" ? "menor que" : "igual a"} ${monto(c.valor)}`;
}

function Precision() {
  const p = useQuery({ queryKey: claves.precision, queryFn: api.precision, staleTime: 5 * 60_000 });
  if (!p.data) return <TarjetaCargando filas={2} />;
  const { retrospectiva: r, uso_real: u, meta } = p.data;
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <div className="cd-card-head">
        <h3 className="cd-card-title">Sugerencias de categoría</h3>
        <span className="cd-badge cd-badge--neutral">meta {porcentaje(meta, 0)}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))", gap: 12 }}>
        <div className="cd-stack" style={{ gap: 2 }}>
          <span className="cd-delta-note">Aceptadas sin editar</span>
          <span className="cd-amt" style={{ fontSize: 22 }}>
            {u.tasa === null ? "—" : porcentaje(u.tasa, 0)}
          </span>
          <span className="cd-delta-note">
            {u.movimientos
              ? `${u.aceptadas} de ${u.movimientos} desde el ${fechaCorta(u.desde)}`
              : "aún sin movimientos nuevos"}
          </span>
        </div>
        <div className="cd-stack" style={{ gap: 2 }}>
          <span className="cd-delta-note">Prueba con tu historial</span>
          <span className="cd-amt" style={{ fontSize: 22 }}>
            {porcentaje(r.acierto_con_descripcion, 0)}
          </span>
          <span className="cd-delta-note">
            con descripción · {porcentaje(r.acierto_top3_con_descripcion, 0)} entre las 3 opciones
          </span>
        </div>
        <div className="cd-stack" style={{ gap: 2 }}>
          <span className="cd-delta-note">Todos los movimientos</span>
          <span className="cd-amt" style={{ fontSize: 22 }}>
            {porcentaje(r.acierto, 0)}
          </span>
          <span className="cd-delta-note">de los últimos {r.casos}, con o sin descripción</span>
        </div>
      </div>
      <p className="cd-delta-note" style={{ margin: 0 }}>
        Escribe siempre una descripción corta al registrar: con ella el acierto sube y, cuando la descripción se repite,
        casi siempre es exacto. Si una sugerencia falla seguido, crea una regla abajo.
      </p>
    </section>
  );
}

interface FormRegla {
  nombre: string;
  texto: string;
  modo: "contiene" | "empieza" | "igual";
  tipo: "" | "gasto" | "ingreso";
  minimo: string;
  maximo: string;
  categoriaId: number | null;
  etiqueta: string;
}

const formVacio: FormRegla = {
  nombre: "",
  texto: "",
  modo: "contiene",
  tipo: "",
  minimo: "",
  maximo: "",
  categoriaId: null,
  etiqueta: "",
};

function condiciones(f: FormRegla): CondicionRegla[] {
  const salida: CondicionRegla[] = [];
  if (f.texto.trim()) salida.push({ campo: "descripcion", op: f.modo, valor: f.texto.trim() });
  if (f.tipo) salida.push({ campo: "tipo", op: "igual", valor: f.tipo });
  const min = parseMonto(f.minimo);
  const max = parseMonto(f.maximo);
  if (min && max) salida.push({ campo: "monto", op: "entre", valor: min, valor2: max });
  else if (min) salida.push({ campo: "monto", op: "mayor", valor: min - 1 });
  else if (max) salida.push({ campo: "monto", op: "menor", valor: max + 1 });
  return salida;
}

function Reglas() {
  const id = useId();
  const cliente = useQueryClient();
  const reglas = useQuery({ queryKey: claves.reglas, queryFn: api.reglas });
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias, staleTime: 60_000 });
  const [f, setF] = useState<FormRegla>(formVacio);
  const conds = condiciones(f);
  const condsDemoradas = useDebounce(conds, 300);
  const prueba = useQuery({
    queryKey: ["reglas", "probar", condsDemoradas],
    queryFn: () => api.probarRegla(condsDemoradas),
    enabled: condsDemoradas.length > 0,
    retry: false,
  });
  const refrescar = () => {
    void cliente.invalidateQueries({ queryKey: claves.reglas });
    void cliente.invalidateQueries({ queryKey: ["sugerencias"] });
  };
  const crear = useMutation({
    mutationFn: () => {
      if (conds.length === 0) throw new Error("Escribe al menos una condición");
      const datos: ReglaNueva = {
        nombre: f.nombre.trim() || (f.texto.trim() ? `Si dice “${f.texto.trim()}”` : "Regla"),
        condiciones: conds,
        categoria_id: f.categoriaId,
        etiquetas: f.etiqueta.trim() ? [f.etiqueta.trim()] : [],
      };
      return api.crearRegla(datos);
    },
    onSuccess: () => {
      toast.success("Regla creada: se aplica a los movimientos nuevos");
      setF(formVacio);
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const alternar = useMutation({
    mutationFn: (r: Regla) =>
      api.editarRegla(r.id, {
        nombre: r.nombre,
        prioridad: r.prioridad,
        condiciones: r.condiciones,
        categoria_id: r.categoria_id,
        etiquetas: r.etiquetas,
        activa: !r.activa,
      }),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const eliminar = useMutation({
    mutationFn: (r: Regla) => api.eliminarRegla(r.id),
    onSuccess: (_, r) => toast(`Regla “${r.nombre}” eliminada`),
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const cambiar = <K extends keyof FormRegla>(k: K, v: FormRegla[K]) => setF((x) => ({ ...x, [k]: v }));
  const etiqueta = (campo: string, texto: string) => (
    <label htmlFor={`${id}-${campo}`} style={{ fontSize: 12, fontWeight: 600, color: "var(--ink-muted)" }}>
      {texto}
    </label>
  );

  return (
    <section className="cd-card cd-stack" style={{ gap: 14 }}>
      <div className="cd-card-head">
        <h3 className="cd-card-title">Reglas</h3>
        <span className="cd-delta-note">Se aplican antes que las sugerencias, en orden</span>
      </div>
      {reglas.data?.length === 0 && (
        <span className="cd-delta-note">
          Aún no tienes reglas. Ejemplo: si la descripción contiene “netflix”, es Streaming.
        </span>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {(reglas.data ?? []).map((r) => (
          <li
            key={r.id}
            className="cd-row"
            style={{
              flexWrap: "nowrap",
              gap: 10,
              padding: "10px 0",
              borderBottom: "1px solid var(--border)",
              opacity: r.activa ? 1 : 0.55,
            }}
          >
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{r.nombre}</b>
              <span className="cd-delta-note" style={{ display: "block" }}>
                Si {r.condiciones.map(describir).join(" y ")} →{" "}
                {r.categoria_ruta ? r.categoria_ruta.slice(1).join(" › ") : ""}
                {r.etiquetas.length > 0 && ` #${r.etiquetas.join(" #")}`}
              </span>
            </span>
            <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => alternar.mutate(r)}>
              {r.activa ? "Pausar" : "Activar"}
            </button>
            <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => eliminar.mutate(r)}>
              Eliminar
            </button>
          </li>
        ))}
      </ul>

      <div className="cd-stack" style={{ gap: 10, paddingTop: 4 }}>
        <span className="cd-kpi-label">Nueva regla</span>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))", gap: 10 }}>
          <div className="cd-stack" style={{ gap: 6, gridColumn: "1 / -1" }}>
            {etiqueta("texto", "Si la descripción")}
            <div className="cd-row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <select
                aria-label="Cómo compara el texto"
                className="cd-input"
                style={{ width: "auto" }}
                value={f.modo}
                onChange={(e) => cambiar("modo", e.target.value as FormRegla["modo"])}
              >
                <option value="contiene">contiene</option>
                <option value="empieza">empieza con</option>
                <option value="igual">es igual a</option>
              </select>
              <input
                id={`${id}-texto`}
                className="cd-input"
                placeholder="netflix"
                value={f.texto}
                onChange={(e) => cambiar("texto", e.target.value)}
              />
            </div>
          </div>
          <div className="cd-stack" style={{ gap: 6 }}>
            {etiqueta("tipo", "Y es")}
            <select
              id={`${id}-tipo`}
              className="cd-input"
              value={f.tipo}
              onChange={(e) => cambiar("tipo", e.target.value as FormRegla["tipo"])}
            >
              <option value="">gasto o ingreso</option>
              <option value="gasto">un gasto</option>
              <option value="ingreso">un ingreso</option>
            </select>
          </div>
          <div className="cd-stack" style={{ gap: 6 }}>
            {etiqueta("minimo", "Monto entre (opcional)")}
            <div className="cd-row" style={{ gap: 6, flexWrap: "nowrap" }}>
              <input
                id={`${id}-minimo`}
                aria-label="Monto mínimo"
                className="cd-input cd-num"
                inputMode="decimal"
                placeholder="$ mín"
                value={f.minimo}
                onChange={(e) => cambiar("minimo", mascaraMonto(e.target.value))}
              />
              <input
                aria-label="Monto máximo"
                className="cd-input cd-num"
                inputMode="decimal"
                placeholder="$ máx"
                value={f.maximo}
                onChange={(e) => cambiar("maximo", mascaraMonto(e.target.value))}
              />
            </div>
          </div>
          <div className="cd-stack" style={{ gap: 6 }}>
            {etiqueta("categoria", "Entonces, categoría")}
            <SelectorCategoria
              id={`${id}-categoria`}
              arbol={arbol.data ?? []}
              grupos={["gasto_vida", "servicio_deuda", "apuestas", "ingreso", "ahorro_inversion"]}
              valor={f.categoriaId}
              alCambiar={(ident) => cambiar("categoriaId", ident)}
            />
          </div>
          <div className="cd-stack" style={{ gap: 6 }}>
            {etiqueta("etiqueta", "Y etiqueta (opcional)")}
            <input
              id={`${id}-etiqueta`}
              className="cd-input"
              placeholder="suscripción"
              value={f.etiqueta}
              onChange={(e) => cambiar("etiqueta", e.target.value)}
            />
          </div>
          <div className="cd-stack" style={{ gap: 6 }}>
            {etiqueta("nombre", "Nombre (opcional)")}
            <input
              id={`${id}-nombre`}
              className="cd-input"
              placeholder="Streaming"
              value={f.nombre}
              onChange={(e) => cambiar("nombre", e.target.value)}
            />
          </div>
        </div>
        {conds.length > 0 && (
          <span className="cd-delta-note" aria-live="polite">
            {prueba.isError
              ? prueba.error.message
              : prueba.data
                ? `Cumplen ${prueba.data.total} movimientos de tu historial${
                    prueba.data.muestra.length
                      ? `, p. ej. ${prueba.data.muestra
                          .slice(0, 3)
                          .map((m) => m.descripcion || formatoCOP(m.monto))
                          .join(", ")}`
                      : ""
                  }.`
                : "Probando…"}
          </span>
        )}
        <button
          className="cd-btn cd-btn--primary"
          style={{ alignSelf: "flex-start" }}
          disabled={crear.isPending || conds.length === 0 || (f.categoriaId === null && !f.etiqueta.trim())}
          onClick={() => crear.mutate()}
        >
          Crear regla
        </button>
      </div>
    </section>
  );
}

function Respaldos() {
  const cliente = useQueryClient();
  const lista = useQuery({ queryKey: claves.respaldos, queryFn: api.respaldos });
  const respaldar = useMutation({
    mutationFn: api.respaldar,
    onSuccess: (r) => toast.success(r.archivo ? `Respaldo creado: ${r.archivo}` : "No hay base que respaldar"),
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: claves.respaldos }),
  });
  const [restaurando, setRestaurando] = useState<string | null>(null);
  const restaurar = useMutation({
    mutationFn: (archivo: string) => api.restaurarRespaldo(archivo),
    onSuccess: () => {
      toast.success("Respaldo restaurado. Lo que tenías quedó en otro respaldo.");
      setRestaurando(null);
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries(),
  });
  const kb = (b: number) => `${Math.round(b / 1024).toLocaleString("es-CO")} KB`;
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <div className="cd-card-head">
        <h3 className="cd-card-title">Respaldos</h3>
        <button
          className="cd-btn cd-btn--secondary cd-btn--sm"
          disabled={respaldar.isPending}
          onClick={() => respaldar.mutate()}
        >
          Respaldar ahora
        </button>
      </div>
      <p className="cd-delta-note" style={{ margin: 0 }}>
        Se hace uno al arrancar y otro cada día en la carpeta de respaldos; se guardan los últimos 30 y uno por día del
        último mes.
      </p>
      {lista.data?.length === 0 && <Vacio titulo="Sin respaldos todavía" />}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {(lista.data ?? []).slice(0, 6).map((r) => (
          <li key={r.archivo} className="cd-row" style={{ justifyContent: "space-between", padding: "6px 0" }}>
            <span className="cd-num" style={{ fontSize: 13 }}>
              {fechaCorta(r.fecha, true)} · {r.fecha.slice(11, 16)}
            </span>
            <span className="cd-row" style={{ gap: 8, flexWrap: "nowrap" }}>
              <span className="cd-delta-note cd-num">{kb(r.bytes)}</span>
              <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => setRestaurando(r.archivo)}>
                Restaurar
              </button>
            </span>
          </li>
        ))}
      </ul>
      {restaurando && (
        <Hoja
          titulo="Restaurar este respaldo"
          onCerrar={() => setRestaurando(null)}
          pie={
            <>
              <button className="cd-btn cd-btn--ghost" onClick={() => setRestaurando(null)}>
                Cancelar
              </button>
              <button
                className="cd-btn cd-btn--peligro"
                disabled={restaurar.isPending}
                onClick={() => restaurar.mutate(restaurando)}
              >
                Restaurar
              </button>
            </>
          }
        >
          <p className="cd-delta-note" style={{ margin: 0 }}>
            Tus datos volverán a como estaban en <b>{restaurando}</b>. Lo que tienes ahora se guarda antes en otro
            respaldo.
          </p>
        </Hoja>
      )}
      {(lista.data?.length ?? 0) > 6 && <span className="cd-delta-note">y {(lista.data?.length ?? 0) - 6} más</span>}
    </section>
  );
}

function Perfil() {
  const cliente = useQueryClient();
  const sistema = useSistema();
  const d = sistema.data;
  const [nombre, setNombre] = useState<string | null>(null);
  const [perfil, setPerfil] = useState<string | null>(null);
  const guardar = useMutation({
    mutationFn: (cambios: Parameters<typeof api.ajustarSistema>[0]) => api.ajustarSistema(cambios),
    onSuccess: () => toast.success("Ajustes guardados"),
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: claves.sistema }),
  });
  if (!d) return <TarjetaCargando filas={3} />;
  return (
    <section className="cd-card cd-stack" style={{ gap: 12 }}>
      <h3 className="cd-card-title">Tu perfil</h3>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Nombre (para el saludo)</span>
        <input
          className="cd-input"
          maxLength={60}
          value={nombre ?? d.nombre}
          onChange={(e) => setNombre(e.target.value)}
          onBlur={() => nombre !== null && nombre !== d.nombre && guardar.mutate({ nombre })}
        />
      </label>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Sobre ti, para el asistente (opcional)</span>
        <textarea
          className="cd-input"
          rows={3}
          maxLength={500}
          style={{ height: "auto", padding: 10, resize: "vertical", borderRadius: "25px" }}
          placeholder="Tu trabajo, tus metas… No pongas datos sensibles."
          value={perfil ?? d.perfil}
          onChange={(e) => setPerfil(e.target.value)}
          onBlur={() => perfil !== null && perfil !== d.perfil && guardar.mutate({ perfil })}
        />
      </label>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Secciones de apuestas</span>
        <select
          className="cd-input"
          value={d.modulo_apuestas}
          onChange={(e) => guardar.mutate({ modulo_apuestas: e.target.value as typeof d.modulo_apuestas })}
        >
          <option value="auto">Solo si registro apuestas</option>
          <option value="si">Mostrar siempre</option>
          <option value="no">Ocultar siempre</option>
        </select>
      </label>
    </section>
  );
}

export function ConfiguracionPage() {
  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Configuración</h1>
          <p>Reglas de categorización, qué tan bien acierta la app, tus datos y tus respaldos.</p>
        </div>
      </div>
      <div className="cd-bento">
        <div className="span-8 cd-stack" style={{ gap: 16 }}>
          <Precision />
          <Reglas />
          <TusDatos />
        </div>
        <div className="span-4 cd-stack" style={{ gap: 16 }}>
          <Perfil />
          <Respaldos />
          <section className="cd-card cd-stack" style={{ gap: 8 }}>
            <h3 className="cd-card-title">Instalarla como app</h3>
            <p className="cd-delta-note" style={{ margin: 0 }}>
              En el PC, el navegador ofrece «Instalar Caudal» en la barra de direcciones: abre en su propia ventana y la
              interfaz carga sin red (tus datos siempre vienen de la base local).
            </p>
            <p className="cd-delta-note" style={{ margin: 0 }}>
              En el celular: <code>npm run dev:lan</code>, abre la dirección de tu PC y elige «Agregar a la pantalla de
              inicio». Por la red local queda como acceso directo; la instalación completa pide HTTPS. Por seguridad,
              debes agregar tu dirección en <code>FINANZAS_HOSTS_PERMITIDOS</code> y <code>FINANZAS_ORIGENES_CORS</code>
              . Úsalo solo en tu Wi-Fi de confianza: aún no tiene PIN.
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
