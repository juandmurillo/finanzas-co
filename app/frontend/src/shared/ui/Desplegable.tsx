/**
 * Lista desplegable propia (reemplaza a `<select>`): el control y la lista siguen el tema y el estilo de
 * apariencia en vez del menú del navegador. Se usa igual que un `<select>` —`value`, `onChange(e)` con
 * `e.target.value` y `<option>` / `<optgroup>` como hijos—, así que cambiar uno por otro no toca la lógica.
 *
 * Accesibilidad (patrón «combobox de solo selección» de WAI-ARIA): el foco queda en el control; ↑ ↓ Inicio Fin
 * recorren, Enter o Espacio eligen, Escape cierra y escribir una letra salta a la opción que empieza por ella.
 */
import {
  Children,
  Fragment,
  isValidElement,
  useId,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from "react";

import { Flotante } from "./Flotante";

interface Opcion {
  valor: string;
  texto: string;
  contenido: ReactNode;
  deshabilitada: boolean;
  grupo?: string;
}

/** Evento mínimo compatible con el de `<select>`: los manejadores leen `e.target.value`. */
export interface CambioDesplegable {
  target: { value: string };
  currentTarget: { value: string };
}

function textoDe(nodo: ReactNode): string {
  if (nodo == null || typeof nodo === "boolean") return "";
  if (typeof nodo === "string" || typeof nodo === "number") return String(nodo);
  if (Array.isArray(nodo)) return nodo.map(textoDe).join("");
  if (isValidElement<{ children?: ReactNode }>(nodo)) return textoDe(nodo.props.children);
  return "";
}

function leerOpciones(hijos: ReactNode, grupo?: string): Opcion[] {
  const salida: Opcion[] = [];
  Children.forEach(hijos, (hijo) => {
    if (!isValidElement(hijo)) return;
    const el = hijo as ReactElement<{
      children?: ReactNode;
      value?: string | number;
      label?: string;
      disabled?: boolean;
    }>;
    if (el.type === Fragment) salida.push(...leerOpciones(el.props.children, grupo));
    else if (el.type === "optgroup") salida.push(...leerOpciones(el.props.children, el.props.label));
    else if (el.type === "option") {
      const texto = textoDe(el.props.children);
      salida.push({
        valor: String(el.props.value ?? texto),
        texto,
        contenido: el.props.children,
        deshabilitada: Boolean(el.props.disabled),
        grupo,
      });
    }
  });
  return salida;
}

export function Desplegable({
  value,
  onChange,
  children,
  id,
  className = "",
  style,
  disabled,
  placeholder = "Elegir…",
  "aria-label": ariaLabel,
  "aria-labelledby": ariaLabelledby,
  "aria-invalid": ariaInvalid,
}: {
  value?: string | number | null;
  onChange?: (e: CambioDesplegable) => void;
  children?: ReactNode;
  id?: string;
  className?: string;
  style?: CSSProperties;
  disabled?: boolean;
  placeholder?: string;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  "aria-invalid"?: boolean;
}) {
  const opciones = leerOpciones(children);
  const actual = String(value ?? "");
  const iActual = opciones.findIndex((o) => o.valor === actual);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const control = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement | null>(null);
  const base = useId();
  const idLista = `${base}-lista`;
  const idOpcion = (i: number) => `${base}-op-${i}`;
  const busqueda = useRef({ texto: "", hasta: 0 });

  const habilitadas = opciones.map((o, i) => (o.deshabilitada ? -1 : i)).filter((i) => i >= 0);
  const verActiva = (i: number) => {
    setActiva(i);
    requestAnimationFrame(() => document.getElementById(idOpcion(i))?.scrollIntoView?.({ block: "nearest" }));
  };
  const abrir = () => {
    if (disabled) return;
    setAbierto(true);
    verActiva(iActual >= 0 ? iActual : (habilitadas[0] ?? -1));
  };
  const elegir = (i: number) => {
    const o = opciones[i];
    if (!o || o.deshabilitada) return;
    setAbierto(false);
    if (o.valor !== actual) onChange?.({ target: { value: o.valor }, currentTarget: { value: o.valor } });
  };
  const mover = (desde: number, paso: number) => {
    const pos = habilitadas.indexOf(desde);
    if (pos < 0) return habilitadas[paso > 0 ? 0 : habilitadas.length - 1] ?? -1;
    return habilitadas[Math.max(0, Math.min(habilitadas.length - 1, pos + paso))] ?? desde;
  };
  /** Escribir letras salta a la primera opción que empieza así (como en un select). */
  const buscar = (letra: string) => {
    const ahora = Date.now();
    const b = busqueda.current;
    b.texto = ahora > b.hasta ? letra : b.texto + letra;
    b.hasta = ahora + 700;
    const desde = abierto ? activa : iActual;
    const normal = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    const orden = [...habilitadas.filter((i) => i > desde), ...habilitadas.filter((i) => i <= desde)];
    const hallada = orden.find((i) => normal(opciones[i]?.texto ?? "").startsWith(normal(b.texto)));
    if (hallada === undefined) return;
    if (abierto) verActiva(hallada);
    else elegir(hallada);
  };

  const alTeclado = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!abierto) {
      if (["ArrowDown", "ArrowUp", "Enter", " "].includes(e.key)) {
        e.preventDefault();
        abrir();
      } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buscar(e.key);
      return;
    }
    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        verActiva(mover(activa, 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        verActiva(mover(activa, -1));
        break;
      case "Home":
        e.preventDefault();
        verActiva(habilitadas[0] ?? -1);
        break;
      case "End":
        e.preventDefault();
        verActiva(habilitadas.at(-1) ?? -1);
        break;
      case "PageDown":
        e.preventDefault();
        verActiva(mover(activa, 8));
        break;
      case "PageUp":
        e.preventDefault();
        verActiva(mover(activa, -8));
        break;
      case "Enter":
      case " ":
        e.preventDefault();
        elegir(activa);
        break;
      case "Escape":
        // Solo cierra la lista: la hoja o la captura de debajo siguen abiertas.
        e.preventDefault();
        e.stopPropagation();
        setAbierto(false);
        break;
      case "Tab":
        setAbierto(false);
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) buscar(e.key);
    }
  };

  const elegida = opciones[iActual];
  return (
    <>
      <button
        ref={control}
        id={id}
        type="button"
        role="combobox"
        className={`desplegable ${className}`}
        style={style}
        disabled={disabled}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledby}
        aria-invalid={ariaInvalid}
        aria-describedby={`${base}-valor`}
        aria-haspopup="listbox"
        aria-expanded={abierto}
        aria-controls={abierto ? idLista : undefined}
        aria-activedescendant={abierto && activa >= 0 ? idOpcion(activa) : undefined}
        onClick={() => (abierto ? setAbierto(false) : abrir())}
        onKeyDown={alTeclado}
        onBlur={(e) => {
          if (!lista.current?.contains(e.relatedTarget as Node)) setAbierto(false);
        }}
      >
        <span id={`${base}-valor`} className={`desplegable-valor ${elegida ? "" : "vacio"}`}>
          {elegida?.contenido ?? placeholder}
        </span>
        <svg className="desplegable-flecha" viewBox="0 0 12 12" aria-hidden="true">
          <path d="M3 4.5 6 7.5 9 4.5" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
      </button>
      {abierto && (
        <Flotante
          ancla={control}
          alCerrar={() => setAbierto(false)}
          className="desplegable-lista"
          id={idLista}
          role="listbox"
          aria-label={ariaLabel}
          aria-labelledby={ariaLabel ? undefined : (ariaLabelledby ?? id)}
        >
          <div ref={lista} className="desplegable-opciones">
            {opciones.map((o, i) => {
              const titulo = o.grupo && o.grupo !== opciones[i - 1]?.grupo ? o.grupo : null;
              return (
                <Fragment key={`${o.grupo ?? ""}-${o.valor}-${i}`}>
                  {titulo && (
                    <div className="desplegable-grupo" role="presentation">
                      {titulo}
                    </div>
                  )}
                  <div
                    id={idOpcion(i)}
                    role="option"
                    aria-selected={i === iActual}
                    aria-disabled={o.deshabilitada || undefined}
                    className={`desplegable-opcion ${i === activa ? "activa" : ""} ${o.grupo ? "en-grupo" : ""}`}
                    // El foco se queda en el control: el clic no debe quitárselo.
                    onPointerDown={(e) => e.preventDefault()}
                    onPointerEnter={() => !o.deshabilitada && setActiva(i)}
                    onClick={() => elegir(i)}
                  >
                    <span className="desplegable-texto">{o.contenido}</span>
                    {i === iActual && (
                      <svg className="desplegable-marca" viewBox="0 0 12 12" aria-hidden="true">
                        <path
                          d="M2.5 6.2 5 8.6l4.5-5"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.8"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                </Fragment>
              );
            })}
          </div>
        </Flotante>
      )}
    </>
  );
}
