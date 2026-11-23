import type {
  CampoEnRevision,
  DecisionRevision,
  EntidadEnRevision,
  MovimientoEnRevision,
  RevisionSync,
  ValorRevision,
} from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta, formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

const ETIQUETAS: Record<string, string> = {
  monto: "Importe",
  saldo_inicial: "Saldo inicial",
  fecha: "Fecha",
  descripcion: "Descripción",
  nota: "Nota",
  nombre: "Nombre",
  cuenta_id: "Cuenta",
  categoria_id: "Categoría",
  padre_id: "Categoría superior",
  estado: "Estado",
  archivado_en: "Archivado",
};
const DINERO = new Set(["monto", "saldo_inicial", "monto_original"]);
const LADO = { local: "Este equipo", remoto: "El otro equipo" } as const;

function mostrar(campo: string, valor: ValorRevision): string {
  if (valor === null || valor === "") return "—";
  if (DINERO.has(campo) && typeof valor === "number") return formatoCOP(valor);
  if (campo === "fecha" && typeof valor === "string") return fechaCorta(valor, true);
  return String(valor);
}

function Opciones<T extends string>({
  etiqueta,
  valor,
  opciones,
  cambiar,
}: {
  etiqueta: string;
  valor: T | undefined;
  opciones: readonly (readonly [T, string])[];
  cambiar: (v: T) => void;
}) {
  return (
    <div className="cd-seg cd-revision-opciones" role="radiogroup" aria-label={etiqueta}>
      {opciones.map(([v, texto]) => (
        <button
          key={v}
          type="button"
          role="radio"
          aria-checked={valor === v}
          aria-selected={valor === v}
          onClick={() => cambiar(v)}
        >
          {texto}
        </button>
      ))}
    </div>
  );
}

function useResolver(id: number) {
  const cliente = useQueryClient();
  return useMutation({
    mutationFn: (d: DecisionRevision) => api.resolverRevision(id, d),
    onSuccess: () => {
      toast.success("Decisión guardada. Se enviará en la próxima sincronización.");
      void cliente.invalidateQueries();
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "No se pudo aplicar la decisión"),
  });
}

function TablaCampos({
  entidad,
  elegidos,
  elegir,
}: {
  entidad: EntidadEnRevision;
  elegidos?: Record<string, "local" | "remoto">;
  elegir?: (campo: string, lado: "local" | "remoto") => void;
}) {
  const vivos = entidad.local_existe && entidad.remoto_existe;
  return (
    <table className="cd-tabla-revision">
      <thead>
        <tr>
          <th scope="col">Campo</th>
          <th scope="col">{LADO.local}</th>
          <th scope="col">{LADO.remoto}</th>
        </tr>
      </thead>
      <tbody>
        {entidad.campos.map((c: CampoEnRevision) => (
          <tr key={c.campo}>
            <th scope="row">
              {ETIQUETAS[c.campo] ?? c.campo}
              {c.ambos && <span className="cd-badge cd-badge--warning">Cambió en los dos</span>}
            </th>
            {(["local", "remoto"] as const).map((lado) => {
              const existe = lado === "local" ? entidad.local_existe : entidad.remoto_existe;
              const texto = existe ? mostrar(c.campo, c[lado]) : "Eliminado";
              const cambio = vivos && c[lado] !== c.base;
              return (
                <td key={lado} data-cambio={cambio || undefined}>
                  {c.ambos && elegir ? (
                    <label className="cd-row" style={{ gap: 6 }}>
                      <input
                        type="radio"
                        name={`${entidad.entidad_id}-${c.campo}`}
                        checked={elegidos?.[c.campo] === lado}
                        onChange={() => elegir(c.campo, lado)}
                      />
                      {texto}
                    </label>
                  ) : (
                    texto
                  )}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Version({ revision }: { revision: Extract<RevisionSync, { tipo: "version" }> }) {
  const resolver = useResolver(revision.id);
  const vivos = revision.entidades.every((e) => e.local_existe && e.remoto_existe);
  const [eleccion, setEleccion] = useState<"local" | "remoto" | "campos">();
  const [campos, setCampos] = useState<Record<string, Record<string, "local" | "remoto">>>({});
  const faltan = revision.entidades.some((e) => e.campos.some((c) => c.ambos && !campos[e.entidad_id]?.[c.campo]));
  const opciones = [
    ["local", "Quedarme con este equipo"],
    ["remoto", "Usar la del otro equipo"],
    ...(vivos ? ([["campos", "Combinar campo por campo"]] as const) : []),
  ] as const;

  function aplicar() {
    if (!eleccion) return;
    resolver.mutate(eleccion === "campos" ? { decision: "campos", campos } : { decision: eleccion });
  }
  return (
    <article className="cd-stack" style={{ gap: 10 }} aria-label="Edición en dos equipos">
      <p>
        {vivos
          ? "Este registro se editó en los dos equipos desde la misma versión."
          : "Un equipo lo editó y el otro lo eliminó."}{" "}
        Mientras decides, este equipo conserva su versión y lo demás sigue sincronizando.
      </p>
      {revision.entidades.map((e) => (
        <div key={e.entidad_id} className="cd-stack" style={{ gap: 6 }}>
          <strong>{e.titulo}</strong>
          <TablaCampos
            entidad={e}
            elegidos={campos[e.entidad_id]}
            elegir={
              eleccion === "campos"
                ? (campo, lado) => setCampos((p) => ({ ...p, [e.entidad_id]: { ...p[e.entidad_id], [campo]: lado } }))
                : undefined
            }
          />
        </div>
      ))}
      <Opciones etiqueta="Qué versión conservar" valor={eleccion} opciones={opciones} cambiar={setEleccion} />
      {eleccion === "campos" && (
        <p className="cd-muted">
          Lo que cambió en un solo equipo se conserva. Elige el valor de cada campo que cambió en los dos.
        </p>
      )}
      <button
        type="button"
        className="cd-btn cd-btn--primary"
        style={{ alignSelf: "flex-start" }}
        disabled={!eleccion || (eleccion === "campos" && faltan) || resolver.isPending}
        onClick={aplicar}
      >
        Aplicar decisión
      </button>
    </article>
  );
}

const CAMPOS_DUPLICADO = [
  ["fecha", "Fecha"],
  ["descripcion", "Descripción"],
  ["categoria_id", "Categoría"],
  ["nota", "Nota"],
] as const;

function valorMovimiento(m: MovimientoEnRevision, campo: (typeof CAMPOS_DUPLICADO)[number][0]): string {
  if (campo === "fecha") return fechaCorta(m.fecha, true);
  if (campo === "categoria_id") return m.categoria ?? "Sin categoría";
  return m[campo] || "—";
}

function Duplicado({ revision }: { revision: Extract<RevisionSync, { tipo: "duplicado" }> }) {
  const resolver = useResolver(revision.id);
  const [decision, setDecision] = useState<"dos" | "mismo">();
  const uniendo = decision === "mismo";
  const [a, b] = revision.movimientos;
  const distintos = CAMPOS_DUPLICADO.filter(([c]) => valorMovimiento(a, c) !== valorMovimiento(b, c));
  const [datos, setDatos] = useState<Record<string, string>>({});
  const faltan = distintos.some(([c]) => !datos[c]);
  const origen = (m: MovimientoEnRevision) => (m.origen === "este_equipo" ? LADO.local : LADO.remoto);

  return (
    <article className="cd-stack" style={{ gap: 10 }} aria-label="Posible duplicado">
      <p>
        Dos equipos registraron {a.monto < 0 ? "un gasto" : "un ingreso"} de {formatoCOP(Math.abs(a.monto))} en{" "}
        {a.cuenta} en fechas cercanas. ¿Es el mismo movimiento?
      </p>
      <table className="cd-tabla-revision">
        <thead>
          <tr>
            <th scope="col">Campo</th>
            <th scope="col">{origen(a)}</th>
            <th scope="col">{origen(b)}</th>
          </tr>
        </thead>
        <tbody>
          {CAMPOS_DUPLICADO.map(([campo, etiqueta]) => {
            const elegible = uniendo && distintos.some(([c]) => c === campo);
            return (
              <tr key={campo}>
                <th scope="row">{etiqueta}</th>
                {[a, b].map((m) => (
                  <td key={m.id}>
                    {elegible ? (
                      <label className="cd-row" style={{ gap: 6 }}>
                        <input
                          type="radio"
                          name={`${revision.id}-${campo}`}
                          checked={datos[campo] === m.id}
                          onChange={() => setDatos((p) => ({ ...p, [campo]: m.id }))}
                        />
                        {valorMovimiento(m, campo)}
                      </label>
                    ) : (
                      valorMovimiento(m, campo)
                    )}
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
      <Opciones
        etiqueta="¿Es el mismo movimiento?"
        valor={decision}
        opciones={[
          ["dos", "Son dos movimientos"],
          ["mismo", "Es el mismo movimiento"],
        ]}
        cambiar={setDecision}
      />
      {uniendo && distintos.length > 0 && (
        <p className="cd-muted">Se deja un solo movimiento. Elige qué datos conservar en la tabla.</p>
      )}
      <button
        type="button"
        className="cd-btn cd-btn--primary"
        style={{ alignSelf: "flex-start" }}
        disabled={!decision || (uniendo && faltan) || resolver.isPending}
        onClick={() => resolver.mutate(uniendo ? { decision: "mismo", datos } : { decision: "dos" })}
      >
        Aplicar decisión
      </button>
    </article>
  );
}

export function PorRevisar() {
  const lista = useQuery({ queryKey: claves.revisionSync, queryFn: api.revisionSync });
  if (lista.isPending) return <TarjetaCargando filas={2} />;
  if (lista.isError) return <ErrorVista error={lista.error} reintentar={() => void lista.refetch()} />;
  if (lista.data.length === 0) return null;
  return (
    <section className="cd-card cd-stack" style={{ gap: 16 }} aria-labelledby="titulo-por-revisar">
      <h2 className="cd-card-title" id="titulo-por-revisar">
        Por revisar <span className="cd-badge cd-badge--warning">{lista.data.length}</span>
      </h2>
      {lista.data.map((r) =>
        r.tipo === "version" ? <Version key={r.id} revision={r} /> : <Duplicado key={r.id} revision={r} />,
      )}
    </section>
  );
}
