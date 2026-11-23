/**
 * Selector de fecha propio (reemplaza a `<input type="date|month|datetime-local">`): calendario con el tema y
 * el estilo de apariencia de Caudal en vez del del navegador. Se usa igual que el input —`type`, `value`
 * (AAAA-MM-DD, AAAA-MM o AAAA-MM-DDTHH:MM), `min`, `max` y `onChange(e)` con `e.target.value`—.
 *
 * Teclado: en el calendario ← → ↑ ↓ mueven el día, Re Pág / Av Pág cambian de mes, Inicio / Fin van al lunes y
 * al domingo, Enter elige y Escape cierra. La semana empieza el lunes, como en Colombia.
 */
import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";

import { ahoraLocal, fechaCorta, hoyISO, moverMes, nombreMes } from "@/shared/lib/formato";

import { Flotante } from "./Flotante";
import { Icono } from "./Icono";
import type { CambioDesplegable } from "./Desplegable";

type Tipo = "date" | "month" | "datetime-local";

const DIAS = ["L", "M", "M", "J", "V", "S", "D"];
const DIAS_LARGOS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const MESES = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];

const dos = (n: number) => String(n).padStart(2, "0");

function sumarDias(iso: string, dias: number): string {
  const [a, m, d] = iso.split("-").map(Number);
  const f = new Date(a ?? 2026, (m ?? 1) - 1, (d ?? 1) + dias);
  return `${f.getFullYear()}-${dos(f.getMonth() + 1)}-${dos(f.getDate())}`;
}

/** Lunes = 0 … domingo = 6. */
function diaSemana(iso: string): number {
  const [a, m, d] = iso.split("-").map(Number);
  return (new Date(a ?? 2026, (m ?? 1) - 1, d ?? 1).getDay() + 6) % 7;
}

function diasDelMes(mes: string): number {
  return new Date(Number(mes.slice(0, 4)), Number(mes.slice(5, 7)), 0).getDate();
}

/** El mismo día en otro mes (31 → último día si el mes es más corto). */
function moverDiaDeMes(iso: string, meses: number): string {
  const mes = moverMes(iso.slice(0, 7), meses);
  return `${mes}-${dos(Math.min(Number(iso.slice(8, 10)), diasDelMes(mes)))}`;
}

function textoValor(tipo: Tipo, valor: string): string {
  if (!valor) return "";
  if (tipo === "month") return nombreMes(valor.slice(0, 7)).replace(/^./, (c) => c.toUpperCase());
  const dia = fechaCorta(valor.slice(0, 10), true);
  return tipo === "datetime-local" ? `${dia} · ${valor.slice(11, 16) || "00:00"}` : dia;
}

export function CampoFecha({
  type,
  value,
  onChange,
  min,
  max,
  id,
  className = "",
  style,
  disabled,
  placeholder,
  "aria-label": ariaLabel,
  "aria-invalid": ariaInvalid,
}: {
  type: Tipo;
  value?: string | null;
  onChange?: (e: CambioDesplegable) => void;
  min?: string;
  max?: string;
  id?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
}) {
  const valor = value ?? "";
  const [abierto, setAbierto] = useState(false);
  const control = useRef<HTMLButtonElement>(null);
  const titulo = useId();
  const emitir = (v: string) => onChange?.({ target: { value: v }, currentTarget: { value: v } });
  const texto = textoValor(type, valor);
  const vacio = placeholder ?? (type === "month" ? "Elegir mes" : "Elegir fecha");
  return (
    <>
      <button
        ref={control}
        id={id}
        type="button"
        className={`campo-fecha ${className}`}
        style={style}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={abierto}
        aria-describedby={ariaLabel ? undefined : `${titulo}-valor`}
        aria-invalid={ariaInvalid}
        aria-label={ariaLabel ? `${ariaLabel}: ${texto || "sin elegir"}` : undefined}
        onClick={() => setAbierto((x) => !x)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !abierto) {
            e.preventDefault();
            setAbierto(true);
          }
        }}
      >
        <Icono nombre="calendario" pequeno />
        <span id={`${titulo}-valor`} className={`campo-fecha-valor ${texto ? "" : "vacio"}`}>
          {texto || vacio}
        </span>
      </button>
      {abierto && (
        <Flotante
          ancla={control}
          alCerrar={() => setAbierto(false)}
          className="calendario"
          role="dialog"
          aria-labelledby={titulo}
          atrapar
        >
          {type === "month" ? (
            <Meses
              valor={valor}
              min={min}
              max={max}
              idTitulo={titulo}
              alElegir={(v) => {
                emitir(v);
                setAbierto(false);
                control.current?.focus();
              }}
            />
          ) : (
            <Calendario
              tipo={type}
              valor={valor}
              min={min}
              max={max}
              idTitulo={titulo}
              alCambiar={emitir}
              alCerrar={() => {
                setAbierto(false);
                control.current?.focus();
              }}
            />
          )}
        </Flotante>
      )}
    </>
  );
}

function Calendario({
  tipo,
  valor,
  min,
  max,
  idTitulo,
  alCambiar,
  alCerrar,
}: {
  tipo: "date" | "datetime-local";
  valor: string;
  min?: string;
  max?: string;
  idTitulo: string;
  alCambiar: (v: string) => void;
  alCerrar: () => void;
}) {
  const hoy = hoyISO();
  const dia = valor.slice(0, 10);
  const hora = tipo === "datetime-local" ? valor.slice(11, 16) || ahoraLocal().slice(11, 16) : "";
  const [foco, setFoco] = useState(dia || hoy);
  const [vista, setVista] = useState<"dias" | "meses">("dias");
  const rejilla = useRef<HTMLDivElement>(null);
  const mes = foco.slice(0, 7);
  const minDia = min?.slice(0, 10);
  const maxDia = max?.slice(0, 10);
  const fuera = (d: string) => Boolean((minDia && d < minDia) || (maxDia && d > maxDia));

  // El día con foco recibe el foco del teclado (tabindex móvil).
  useEffect(() => {
    if (vista === "dias") rejilla.current?.querySelector<HTMLButtonElement>(`[data-dia="${foco}"]`)?.focus();
  }, [foco, vista]);

  const elegirDia = (d: string) => {
    if (fuera(d)) return;
    if (tipo === "date") {
      alCambiar(d);
      alCerrar();
    } else alCambiar(`${d}T${hora}`);
  };
  const alTeclado = (e: KeyboardEvent<HTMLDivElement>) => {
    const pasos: Record<string, () => string> = {
      ArrowLeft: () => sumarDias(foco, -1),
      ArrowRight: () => sumarDias(foco, 1),
      ArrowUp: () => sumarDias(foco, -7),
      ArrowDown: () => sumarDias(foco, 7),
      PageUp: () => moverDiaDeMes(foco, e.shiftKey ? -12 : -1),
      PageDown: () => moverDiaDeMes(foco, e.shiftKey ? 12 : 1),
      Home: () => sumarDias(foco, -diaSemana(foco)),
      End: () => sumarDias(foco, 6 - diaSemana(foco)),
    };
    const paso = pasos[e.key];
    if (!paso) return;
    e.preventDefault();
    setFoco(paso());
  };

  const primero = `${mes}-01`;
  const inicio = sumarDias(primero, -diaSemana(primero));
  const celdas = Array.from({ length: 42 }, (_, i) => sumarDias(inicio, i));
  const semanas = celdas.at(35)?.slice(0, 7) === mes ? 6 : 5;

  if (vista === "meses")
    return (
      <Meses
        valor={dia.slice(0, 7)}
        min={minDia?.slice(0, 7)}
        max={maxDia?.slice(0, 7)}
        idTitulo={idTitulo}
        inicial={mes}
        alElegir={(m) => {
          setFoco(`${m}-${dos(Math.min(Number(foco.slice(8, 10)), diasDelMes(m)))}`);
          setVista("dias");
        }}
      />
    );

  return (
    <div className="calendario-cuerpo">
      <div className="calendario-cabeza">
        <button
          type="button"
          className="calendario-flecha"
          aria-label="Mes anterior"
          onClick={() => setFoco(moverDiaDeMes(foco, -1))}
        >
          ‹
        </button>
        <button
          type="button"
          id={idTitulo}
          className="calendario-titulo"
          aria-label={`${nombreMes(mes)}. Elegir mes`}
          onClick={() => setVista("meses")}
        >
          {nombreMes(mes).replace(/^./, (c) => c.toUpperCase())}
          <span aria-hidden="true">▾</span>
        </button>
        <button
          type="button"
          className="calendario-flecha"
          aria-label="Mes siguiente"
          onClick={() => setFoco(moverDiaDeMes(foco, 1))}
        >
          ›
        </button>
      </div>
      <div ref={rejilla} className="calendario-rejilla" role="grid" aria-labelledby={idTitulo} onKeyDown={alTeclado}>
        <div role="row" className="calendario-fila">
          {DIAS.map((d, i) => (
            <span key={i} role="columnheader" className="calendario-dia-semana" aria-label={DIAS_LARGOS[i]}>
              {d}
            </span>
          ))}
        </div>
        {Array.from({ length: semanas }, (_, s) => (
          <div key={s} role="row" className="calendario-fila">
            {celdas.slice(s * 7, s * 7 + 7).map((d) => {
              const otroMes = d.slice(0, 7) !== mes;
              const elegido = d === dia;
              return (
                <span key={d} role="gridcell" aria-selected={elegido}>
                  <button
                    type="button"
                    data-dia={d}
                    tabIndex={d === foco ? 0 : -1}
                    disabled={fuera(d)}
                    className={`calendario-dia ${otroMes ? "otro-mes" : ""} ${elegido ? "elegido" : ""} ${d === hoy ? "hoy" : ""}`}
                    aria-label={`${DIAS_LARGOS[diaSemana(d)]} ${fechaCorta(d, true)}${d === hoy ? ", hoy" : ""}`}
                    aria-current={d === hoy ? "date" : undefined}
                    onClick={() => elegirDia(d)}
                    onFocus={() => d !== foco && setFoco(d)}
                  >
                    {Number(d.slice(8, 10))}
                  </button>
                </span>
              );
            })}
          </div>
        ))}
      </div>
      {tipo === "datetime-local" && (
        <Hora
          valor={hora}
          alCambiar={(h) => alCambiar(`${dia || foco}T${h}`)}
          alAhora={() => {
            const ahora = ahoraLocal();
            setFoco(ahora.slice(0, 10));
            alCambiar(ahora.slice(0, 16));
          }}
        />
      )}
      <div className="calendario-pie">
        <button
          type="button"
          className="cd-btn cd-btn--ghost cd-btn--sm"
          disabled={fuera(hoy)}
          onClick={() => (tipo === "date" ? elegirDia(hoy) : (setFoco(hoy), alCambiar(`${hoy}T${hora}`)))}
        >
          Hoy
        </button>
        {tipo === "datetime-local" && (
          <button type="button" className="cd-btn cd-btn--primary cd-btn--sm" onClick={alCerrar}>
            Listo
          </button>
        )}
      </div>
    </div>
  );
}

/** Hora y minutos con dos campos numéricos (↑ ↓ suben y bajan) y «Ahora». */
function Hora({ valor, alCambiar, alAhora }: { valor: string; alCambiar: (h: string) => void; alAhora: () => void }) {
  const [h = "00", m = "00"] = valor.split(":");
  const campo = (actual: string, tope: number, etiqueta: string, armar: (v: number) => string) => (
    <input
      className="calendario-hora-campo"
      inputMode="numeric"
      aria-label={etiqueta}
      maxLength={2}
      value={actual}
      onFocus={(e) => e.target.select()}
      onKeyDown={(e) => {
        if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
        e.preventDefault();
        const n = (Number(actual) + (e.key === "ArrowUp" ? 1 : -1) + tope + 1) % (tope + 1);
        alCambiar(armar(n));
      }}
      onChange={(e) => {
        const limpio = e.target.value.replace(/\D/g, "").slice(0, 2);
        if (limpio === "") return;
        alCambiar(armar(Math.min(tope, Number(limpio))));
      }}
    />
  );
  return (
    <div className="calendario-hora" role="group" aria-label="Hora">
      <Icono nombre="recurrentes" pequeno />
      {campo(h, 23, "Hora", (v) => `${dos(v)}:${m}`)}
      <span aria-hidden="true">:</span>
      {campo(m, 59, "Minutos", (v) => `${h}:${dos(v)}`)}
      <button type="button" className="cd-btn cd-btn--ghost cd-btn--sm" onClick={alAhora}>
        Ahora
      </button>
    </div>
  );
}

/** Rejilla de 12 meses con el año arriba (‹ 2026 ›). */
function Meses({
  valor,
  min,
  max,
  idTitulo,
  inicial,
  alElegir,
}: {
  valor: string;
  min?: string;
  max?: string;
  idTitulo: string;
  inicial?: string;
  alElegir: (mes: string) => void;
}) {
  const [anio, setAnio] = useState(Number((inicial || valor || hoyISO()).slice(0, 4)));
  const caja = useRef<HTMLDivElement>(null);
  const actual = hoyISO().slice(0, 7);
  useEffect(() => {
    caja.current?.querySelector<HTMLButtonElement>(".calendario-mes.elegido, .calendario-mes:not(:disabled)")?.focus();
  }, []);
  return (
    <div className="calendario-cuerpo" ref={caja}>
      <div className="calendario-cabeza">
        <button type="button" className="calendario-flecha" aria-label="Año anterior" onClick={() => setAnio(anio - 1)}>
          ‹
        </button>
        <span id={idTitulo} className="calendario-titulo" aria-live="polite">
          {anio}
        </span>
        <button
          type="button"
          className="calendario-flecha"
          aria-label="Año siguiente"
          onClick={() => setAnio(anio + 1)}
        >
          ›
        </button>
      </div>
      <div className="calendario-meses">
        {MESES.map((nombre, i) => {
          const m = `${anio}-${dos(i + 1)}`;
          return (
            <button
              key={m}
              type="button"
              className={`calendario-mes ${m === valor.slice(0, 7) ? "elegido" : ""} ${m === actual ? "hoy" : ""}`}
              aria-pressed={m === valor.slice(0, 7)}
              aria-label={nombreMes(m)}
              disabled={Boolean((min && m < min.slice(0, 7)) || (max && m > max.slice(0, 7)))}
              onClick={() => alElegir(m)}
            >
              {nombre}
            </button>
          );
        })}
      </div>
    </div>
  );
}
