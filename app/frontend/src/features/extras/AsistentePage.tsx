/** Asistente opcional (RF-IA-01, fase 8 punto 14): vista de chat como los LLM actuales — hilo con burbujas,
 * respuestas con formato, herramientas consultadas, copiar y escritura fija abajo (Enter envía, Shift+Enter
 * salta de línea). Solo con tu consentimiento. Lo que aún no existe (historial guardado, adjuntar) avisa al
 * intentar usarlo. */
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";

import type { RespuestaAsistente } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { fechaCorta } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { TarjetaCargando } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { Icono } from "@/shared/ui/Icono";

const SUGERENCIAS = [
  { titulo: "¿En qué se me fue el dinero?", detalle: "este mes, por categoría" },
  { titulo: "¿Qué crédito pago primero?", detalle: "si abono $100.000 extra al mes" },
  { titulo: "¿Cómo voy con el presupuesto?", detalle: "y qué ajustar en lo que queda del mes" },
  { titulo: "¿Cuándo me quedo sin saldo?", detalle: "con lo programado de los próximos 45 días" },
];

const NOMBRES_HERRAMIENTA: Record<string, string> = {
  resumen_mensual: "Resumen mensual",
  gasto_por_categoria: "Gasto por categoría",
  buscar_movimientos: "Movimientos",
  deudas: "Créditos",
  presupuesto: "Presupuesto",
  recurrentes: "Recurrentes",
  calendario: "Calendario",
  metas: "Metas",
  revision_mensual: "Revisión mensual",
  termometro_renta: "Renta",
  prestamos_personales: "Préstamos",
};

const aunNo = (que: string) =>
  toast(`${que}: aún no disponible`, { description: "Está en diseño; llegará en una próxima versión." });

type Mensaje =
  { de: "yo"; texto: string } | { de: "asistente"; r: RespuestaAsistente } | { de: "error"; texto: string };

// ---------- Formato mínimo de las respuestas (negritas, listas y tablas en Markdown) ----------
function enLinea(texto: string): ReactNode[] {
  return texto
    .split(/(\*\*[^*]+\*\*)/g)
    .map((t, i) => (t.startsWith("**") && t.endsWith("**") ? <b key={i}>{t.slice(2, -2)}</b> : t));
}

function Markdown({ texto }: { texto: string }) {
  const bloques: ReactNode[] = [];
  const lineas = texto.split("\n");
  for (let i = 0; i < lineas.length;) {
    const l = lineas[i] ?? "";
    if (l.trim().startsWith("|")) {
      const filas: string[][] = [];
      while (i < lineas.length && (lineas[i] ?? "").trim().startsWith("|")) {
        const celdas = (lineas[i] ?? "")
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
        if (!celdas.every((c) => /^:?-+:?$/.test(c))) filas.push(celdas);
        i++;
      }
      const [cabeza, ...cuerpo] = filas;
      bloques.push(
        <div key={`t${i}`} style={{ overflowX: "auto" }}>
          <table className="cd-table chat-tabla">
            <thead>
              <tr>
                {cabeza?.map((c, j) => (
                  <th key={j}>{enLinea(c)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {cuerpo.map((f, k) => (
                <tr key={k}>
                  {f.map((c, j) => (
                    <td key={j}>{enLinea(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*]|\d+\.)\s/.test(l)) {
      const items: string[] = [];
      const ordenada = /^\s*\d+\./.test(l);
      while (i < lineas.length && /^\s*([-*]|\d+\.)\s/.test(lineas[i] ?? "")) {
        items.push((lineas[i] ?? "").replace(/^\s*([-*]|\d+\.)\s/, ""));
        i++;
      }
      const Lista = ordenada ? "ol" : "ul";
      bloques.push(
        <Lista key={`l${i}`}>
          {items.map((t, j) => (
            <li key={j}>{enLinea(t)}</li>
          ))}
        </Lista>,
      );
      continue;
    }
    if (/^#{1,4}\s/.test(l)) bloques.push(<h4 key={`h${i}`}>{enLinea(l.replace(/^#+\s/, ""))}</h4>);
    else if (l.trim()) bloques.push(<p key={`p${i}`}>{enLinea(l)}</p>);
    i++;
  }
  return <div className="chat-md">{bloques}</div>;
}

// ---------- Privacidad (consentimiento) ----------
function Privacidad({ alCerrar }: { alCerrar: () => void }) {
  const cliente = useQueryClient();
  const estado = useQuery({ queryKey: claves.asistente, queryFn: api.estadoAsistente });
  const cambiar = useMutation({
    mutationFn: (activo: boolean) => api.consentimientoAsistente(activo),
    onSuccess: (_, activo) => toast(activo ? "Asistente activado" : "Asistente desactivado: no se envía nada"),
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries({ queryKey: claves.asistente }),
  });
  const activo = estado.data?.consentimiento != null;
  return (
    <Hoja
      titulo="Privacidad del asistente"
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cerrar
          </button>
          <button
            className={`cd-btn ${activo ? "cd-btn--secondary" : "cd-btn--primary"}`}
            disabled={cambiar.isPending || !estado.data}
            onClick={() => cambiar.mutate(!activo)}
          >
            {activo ? "Desactivar y dejar de enviar" : "Acepto: activar el asistente"}
          </button>
        </>
      }
    >
      {!estado.data ? (
        <TarjetaCargando filas={3} />
      ) : (
        <>
          <p className="cd-delta-note" style={{ margin: 0 }}>
            Al preguntar, tu pregunta y los datos que el asistente consulte salen de tu computador hacia la API de
            Claude (Anthropic): totales en pesos y, si busca movimientos, hasta 15 descripciones. Nunca números de
            cuenta ni de crédito, ni nombres de personas. Todo lo demás de la app sigue siendo 100 % local.
          </p>
          {!estado.data.credenciales && (
            <p className="cd-delta-note" style={{ margin: 0, color: "var(--warning)" }}>
              Falta la clave: agrega <code>ANTHROPIC_API_KEY=…</code> en <code>app/backend/.env</code> (no se sube a
              GitHub) o inicia sesión con <code>ant auth login</code>, y reinicia la app.
            </p>
          )}
          {activo && estado.data.consentimiento && (
            <span className="cd-delta-note">Aceptado el {fechaCorta(estado.data.consentimiento.desde, true)}.</span>
          )}
          <span className="cd-delta-note">
            Modelo: {estado.data.modelo}. Cada pregunta tiene un costo en tu cuenta de la API.
          </span>
        </>
      )}
    </Hoja>
  );
}

// ---------- Mensajes ----------
function MensajeAsistente({ r }: { r: RespuestaAsistente }) {
  const copiar = () =>
    void navigator.clipboard.writeText(r.respuesta).then(
      () => toast("Respuesta copiada"),
      () => toast.error("No se pudo copiar"),
    );
  return (
    <div className="chat-fila chat-fila--asistente">
      <span className="chat-avatar" aria-hidden>
        <Icono nombre="info" pequeno />
      </span>
      <div className="chat-burbuja chat-burbuja--asistente">
        <Markdown texto={r.respuesta} />
        <div className="chat-pie">
          {[...new Set(r.herramientas)].map((h) => (
            <span key={h} className="cd-badge cd-badge--neutral">
              {NOMBRES_HERRAMIENTA[h] ?? h}
            </span>
          ))}
          <button
            type="button"
            className="cd-btn cd-btn--ghost cd-btn--sm"
            onClick={copiar}
            aria-label="Copiar respuesta"
          >
            Copiar
          </button>
        </div>
      </div>
    </div>
  );
}

export function AsistentePage() {
  const estado = useQuery({ queryKey: claves.asistente, queryFn: api.estadoAsistente });
  const [texto, setTexto] = useState("");
  const [mensajes, setMensajes] = useState<Mensaje[]>([]);
  const [privacidad, setPrivacidad] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const entrada = useRef<HTMLTextAreaElement>(null);
  const listo = Boolean(estado.data?.consentimiento && estado.data.credenciales);
  const preguntar = useMutation({
    mutationFn: (pregunta: string) => api.preguntar(pregunta),
    onSuccess: (r) => setMensajes((m) => [...m, { de: "asistente", r }]),
    onError: (e) => setMensajes((m) => [...m, { de: "error", texto: e.message }]),
  });
  useEffect(() => {
    fin.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [mensajes, preguntar.isPending]);
  useEffect(() => {
    const t = entrada.current;
    if (t) {
      t.style.height = "auto";
      t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
    }
  }, [texto]);

  const enviar = (pregunta = texto) => {
    const limpia = pregunta.trim();
    if (!limpia || preguntar.isPending) return;
    if (!listo) {
      setPrivacidad(true);
      return;
    }
    setMensajes((m) => [...m, { de: "yo", texto: limpia }]);
    setTexto("");
    preguntar.mutate(limpia);
  };

  return (
    <div className="chat">
      <div className="chat-cabecera">
        <div>
          <h1 style={{ margin: 0, fontSize: 22 }}>Asistente</h1>
          <span className="cd-delta-note">Pregunta en tus palabras sobre tus finanzas. Responde con tus datos.</span>
        </div>
        <div className="cd-row" style={{ gap: 6 }}>
          <button
            type="button"
            className="cd-btn cd-btn--ghost cd-btn--sm"
            onClick={() => aunNo("Historial de conversaciones")}
          >
            Historial
          </button>
          <button
            type="button"
            className="cd-btn cd-btn--ghost cd-btn--sm"
            disabled={mensajes.length === 0}
            onClick={() => setMensajes([])}
          >
            Nueva conversación
          </button>
          <button type="button" className="cd-btn cd-btn--secondary cd-btn--sm" onClick={() => setPrivacidad(true)}>
            <span className={`chat-punto ${listo ? "activo" : ""}`} aria-hidden />
            {listo ? "Activado" : estado.data?.consentimiento ? "Falta la clave" : "Apagado"}
          </button>
        </div>
      </div>

      <div className="chat-hilo" aria-live="polite">
        {mensajes.length === 0 ? (
          <div className="chat-inicio">
            <span className="chat-avatar chat-avatar--grande" aria-hidden>
              <Icono nombre="info" />
            </span>
            <h2>¿En qué te ayudo hoy?</h2>
            <p className="cd-delta-note">
              Conozco tus movimientos, deudas, presupuesto, recurrentes y metas. No soy asesor financiero licenciado ni
              hago operaciones por ti.
            </p>
            <div className="chat-sugerencias">
              {SUGERENCIAS.map((s) => (
                <button key={s.titulo} type="button" onClick={() => enviar(`${s.titulo} (${s.detalle})`)}>
                  <b>{s.titulo}</b>
                  <span>{s.detalle}</span>
                </button>
              ))}
            </div>
          </div>
        ) : (
          mensajes.map((m, i) =>
            m.de === "yo" ? (
              <div key={i} className="chat-fila chat-fila--yo">
                <div className="chat-burbuja chat-burbuja--yo">{m.texto}</div>
              </div>
            ) : m.de === "asistente" ? (
              <MensajeAsistente key={i} r={m.r} />
            ) : (
              <div key={i} className="chat-fila chat-fila--asistente">
                <span className="chat-avatar" aria-hidden>
                  <Icono nombre="alerta" pequeno />
                </span>
                <div className="chat-burbuja chat-burbuja--error">{m.texto}</div>
              </div>
            ),
          )
        )}
        {preguntar.isPending && (
          <div className="chat-fila chat-fila--asistente">
            <span className="chat-avatar" aria-hidden>
              <Icono nombre="info" pequeno />
            </span>
            <div className="chat-burbuja chat-burbuja--asistente chat-pensando">
              <span />
              <span />
              <span />
              <small>Consultando tus datos…</small>
            </div>
          </div>
        )}
        <div ref={fin} />
      </div>

      <form
        className="chat-entrada"
        onSubmit={(e) => {
          e.preventDefault();
          enviar();
        }}
      >
        <button type="button" className="cd-icon-btn" aria-label="Adjuntar" onClick={() => aunNo("Adjuntar archivos")}>
          <Icono nombre="mas" pequeno />
        </button>
        <textarea
          ref={entrada}
          rows={1}
          maxLength={500}
          aria-label="Tu pregunta"
          placeholder={
            listo ? "Pregunta lo que quieras sobre tus finanzas…" : "Activa el asistente en «Apagado» para preguntar"
          }
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              enviar();
            }
          }}
        />
        <button
          type="submit"
          className="cd-btn cd-btn--primary chat-enviar"
          aria-label="Enviar"
          disabled={!texto.trim() || preguntar.isPending}
        >
          ↑
        </button>
      </form>
      <span className="cd-delta-note" style={{ textAlign: "center" }}>
        Enter envía · Shift + Enter salta de línea · Las respuestas pueden equivocarse: revisa las cifras importantes.
      </span>
      {privacidad && <Privacidad alCerrar={() => setPrivacidad(false)} />}
    </div>
  );
}
