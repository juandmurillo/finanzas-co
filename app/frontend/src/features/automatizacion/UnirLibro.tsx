import { fechaCorta } from "@/shared/lib/formato";
import {
  pasar,
  situacionUnion,
  unirLibro,
  type DecisionUnion,
  type ResultadoUnion,
  type ResumenLibro,
  type SituacionUnion,
} from "@/shared/lib/syncCaudal";
import type { Session } from "@supabase/supabase-js";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

const OPCIONES: Record<Exclude<DecisionUnion, "subir">, { titulo: string; detalle: string }> = {
  combinar: {
    titulo: "Combinar los dos",
    detalle:
      "Parte del libro de tu cuenta y le suma las cuentas, categorías y movimientos de este equipo. Lo repetido no se duplica. Créditos, presupuestos y lo demás se toman de tu cuenta.",
  },
  cuenta: {
    titulo: "Usar el de mi cuenta",
    detalle: "Este equipo pasa a tener el libro de tu cuenta.",
  },
  equipo: {
    titulo: "Usar el de este equipo",
    detalle: "Este libro pasa a ser el de tu cuenta. Los demás equipos tendrán que volver a unirse.",
  },
};

function texto(r: ResumenLibro | null): string {
  if (!r) return "—";
  const partes = [`${r.movimientos ?? 0} movimientos`, `${r.cuentas ?? 0} cuentas`];
  if (r.guardada_en) partes.push(`copia del ${fechaCorta(r.guardada_en, true)}`);
  return partes.join(" · ");
}

export function Hecho({ resultado, cerrar }: { resultado: ResultadoUnion; cerrar: () => void }) {
  const c = resultado.combinado;
  return (
    <div className="cd-stack cd-union-hecho" role="status">
      <p>
        {resultado.decision === "equipo"
          ? "Listo: este libro es ahora el de tu cuenta."
          : resultado.decision === "subir"
            ? "Listo: este equipo quedó unido a tu cuenta."
            : "Listo: este equipo tiene el libro de tu cuenta."}
      </p>
      {c && (
        <p>
          Se sumaron {c.movimientos} movimientos, {c.cuentas} cuentas y {c.categorias} categorías; {c.repetidos} ya
          estaban.
          {c.sueltos > 0 && ` ${c.sueltos} movimientos entraron sin su crédito, préstamo o recurrente.`}
        </p>
      )}
      {resultado.respaldo && (
        <p className="cd-muted">
          La versión anterior quedó como copia de seguridad en Datos y respaldos ({resultado.respaldo}).
        </p>
      )}
      <button type="button" className="cd-btn cd-btn--ghost" style={{ alignSelf: "flex-start" }} onClick={cerrar}>
        Entendido
      </button>
    </div>
  );
}

export function UnirLibro({ sesion, onHecho }: { sesion: Session; onHecho: (r: ResultadoUnion) => void }) {
  const consulta = useQuery({ queryKey: ["sync", "union"], queryFn: situacionUnion, retry: false, gcTime: 0 });
  const situacion: SituacionUnion | undefined = consulta.data;
  const [eleccion, setEleccion] = useState<DecisionUnion>();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState("");
  const consultar = () => void consulta.refetch();

  async function aplicar(decision: DecisionUnion) {
    setOcupado(true);
    setError("");
    let resultado: ResultadoUnion;
    try {
      resultado = await unirLibro(decision);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo unir el libro");
      setOcupado(false);
      return;
    }
    // El resumen lo guarda la tarjeta de la cuenta: al sincronizar, esta sección desaparece.
    onHecho(resultado);
    void pasar(sesion);
  }

  if (!situacion)
    return consulta.isError ? (
      <p role="alert">{consulta.error instanceof Error ? consulta.error.message : "No se pudo consultar tu cuenta"}</p>
    ) : (
      <p className="cd-muted">Consultando tu cuenta…</p>
    );
  const { caso } = situacion;
  return (
    <div className="cd-stack" aria-label="Unir este equipo a tu cuenta" role="group">
      {caso === "nuevo" && (
        <p>
          Tu cuenta aún no tiene libro. Este equipo lo crea con lo que tiene ({texto(situacion.equipo)}) y los demás
          equipos se unirán a él.
        </p>
      )}
      {caso === "mismo" && <p>Este equipo ya tiene el libro de tu cuenta.</p>}
      {caso === "descargar" && (
        <p>
          Tu cuenta ya tiene un libro ({texto(situacion.cuenta)}) y este equipo no tiene movimientos: se descargará. Lo
          que hay aquí queda como copia de seguridad.
        </p>
      )}
      {caso === "sin_instantanea" && (
        <p>
          Tu cuenta tiene un libro, pero el equipo que lo creó aún no subió su copia. Abre Caudal en ese equipo con
          conexión y vuelve a comprobar.
        </p>
      )}
      {caso === "elegir" && (
        <>
          <p>Este equipo y tu cuenta tienen historias distintas. Elige cómo unirlos:</p>
          <table className="cd-tabla-revision">
            <tbody>
              <tr>
                <th scope="row">Este equipo</th>
                <td>{texto(situacion.equipo)}</td>
              </tr>
              <tr>
                <th scope="row">Tu cuenta</th>
                <td>{texto(situacion.cuenta)}</td>
              </tr>
            </tbody>
          </table>
          <fieldset className="cd-stack cd-union-opciones">
            <legend className="cd-muted">
              La versión que no quede como principal se guarda como copia de seguridad.
            </legend>
            {(["combinar", "cuenta", "equipo"] as const).map((d) => (
              <label key={d} className="cd-union-opcion">
                <input
                  type="radio"
                  name="union"
                  value={d}
                  checked={eleccion === d}
                  onChange={() => setEleccion(d)}
                  disabled={ocupado}
                />
                <span>
                  <strong>{OPCIONES[d].titulo}</strong>
                  <span className="cd-muted">{OPCIONES[d].detalle}</span>
                </span>
              </label>
            ))}
          </fieldset>
        </>
      )}
      {error && <p role="alert">{error}</p>}
      {caso === "elegir" ? (
        <button
          type="button"
          className="cd-btn cd-btn--primary"
          style={{ alignSelf: "flex-start" }}
          disabled={!eleccion || ocupado}
          onClick={() => eleccion && void aplicar(eleccion)}
        >
          {ocupado ? "Uniendo…" : "Aplicar"}
        </button>
      ) : caso === "sin_instantanea" ? (
        <button type="button" className="cd-btn" style={{ alignSelf: "flex-start" }} onClick={consultar}>
          Volver a comprobar
        </button>
      ) : (
        <button
          type="button"
          className="cd-btn cd-btn--primary"
          style={{ alignSelf: "flex-start" }}
          disabled={ocupado}
          onClick={() => void aplicar(situacion.decisiones[0] ?? "subir")}
        >
          {ocupado
            ? "Uniendo…"
            : caso === "descargar"
              ? "Descargar el libro de mi cuenta"
              : caso === "nuevo"
                ? "Crear el libro de mi cuenta"
                : "Vincular este equipo"}
        </button>
      )}
    </div>
  );
}
