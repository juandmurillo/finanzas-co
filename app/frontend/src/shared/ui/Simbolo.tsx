/** Símbolo propio de cuentas y categorías: ícono de Caudal, logo, emoji o una imagen que sube la persona
 * (se reduce a 96 px en el navegador antes de guardarla), y su color de la paleta `--cat-1…8`. */
import { useId, useRef, useState, type ChangeEvent } from "react";

import { esIcono, Icono, type NombreIcono } from "./Icono";

export const COLORES_SIMBOLO = ["cat-1", "cat-2", "cat-3", "cat-4", "cat-5", "cat-6", "cat-7", "cat-8"] as const;
const EMOJIS = ["🏦", "💳", "💵", "🪙", "💰", "📱", "🛒", "🍔", "🚌", "🏠", "💡", "🎁", "❤️", "⚽", "🎓", "✈️"];
const LADO = 96;

export type TipoSimbolo = "icono" | "imagen" | "emoji" | "vacio";

export function tipoSimbolo(valor: string | null | undefined, iconos: readonly string[] = []): TipoSimbolo {
  if (!valor) return "vacio";
  if (valor.startsWith("data:image/") || valor.startsWith("/")) return "imagen";
  if (/^[a-z_]{2,40}$/.test(valor))
    return esIcono(valor) && (iconos.length === 0 || iconos.includes(valor)) ? "icono" : "vacio";
  return "emoji";
}

/** Dibuja el símbolo; si no hay uno válido, usa el ícono de respaldo. */
export function SimboloVista({
  valor,
  respaldo,
  tam = 20,
  iconos = [],
}: {
  valor: string | null | undefined;
  respaldo: NombreIcono;
  tam?: number;
  /** Nombres de ícono aceptados (si está vacío, cualquier nombre en minúsculas). */
  iconos?: readonly string[];
}) {
  const tipo = tipoSimbolo(valor, iconos);
  if (tipo === "imagen")
    return (
      <img
        className={`simbolo-img ${valor?.startsWith("/") ? "simbolo-img--logo" : ""}`}
        src={valor ?? ""}
        alt=""
        width={tam}
        height={tam}
      />
    );
  if (tipo === "emoji")
    return (
      <span className="simbolo-emoji" style={{ fontSize: Math.round(tam * 0.8) }} aria-hidden>
        {valor}
      </span>
    );
  return <Icono nombre={tipo === "icono" ? (valor as NombreIcono) : respaldo} pequeno={tam < 22} />;
}

/** Lee una imagen y la devuelve como data URL WebP (o PNG) cuadrada de 96 px, recortada al centro. */
async function reducirImagen(archivo: File): Promise<string> {
  const url = URL.createObjectURL(archivo);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => mal(new Error("No pude leer la imagen"));
      i.src = url;
    });
    const lado = Math.min(img.naturalWidth, img.naturalHeight);
    const lienzo = document.createElement("canvas");
    lienzo.width = LADO;
    lienzo.height = LADO;
    const ctx = lienzo.getContext("2d");
    if (!ctx) throw new Error("No pude procesar la imagen");
    ctx.drawImage(img, (img.naturalWidth - lado) / 2, (img.naturalHeight - lado) / 2, lado, lado, 0, 0, LADO, LADO);
    const webp = lienzo.toDataURL("image/webp", 0.85);
    return webp.startsWith("data:image/webp") ? webp : lienzo.toDataURL("image/png");
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Elegir color y símbolo: ícono (o logo), emoji o imagen propia. */
export function SelectorSimbolo({
  icono,
  color,
  alCambiar,
  iconos,
  logos = [],
  respaldo,
}: {
  icono: string | null;
  color: string | null;
  alCambiar: (v: { icono: string | null; color: string | null }) => void;
  iconos: readonly NombreIcono[];
  logos?: { ruta: string; nombre: string }[];
  respaldo: NombreIcono;
}) {
  const id = useId();
  const archivo = useRef<HTMLInputElement>(null);
  const tipo = tipoSimbolo(icono);
  const [modo, setModo] = useState<"icono" | "emoji" | "imagen">(
    tipo === "emoji" ? "emoji" : tipo === "imagen" && icono?.startsWith("data:") ? "imagen" : "icono",
  );
  const [error, setError] = useState<string | null>(null);
  const subir = async (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    if (!f.type.startsWith("image/")) return setError("Elige una imagen (PNG, JPG o WebP)");
    try {
      setError(null);
      alCambiar({ icono: await reducirImagen(f), color });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No pude leer la imagen");
    }
  };
  return (
    <div className="selector-simbolo">
      <div className="selector-simbolo-vista" aria-hidden>
        <span
          className="selector-simbolo-burbuja"
          style={
            color
              ? { background: `color-mix(in srgb, var(--${color}) 22%, transparent)`, color: `var(--${color})` }
              : undefined
          }
        >
          <SimboloVista valor={icono} respaldo={respaldo} tam={30} />
        </span>
      </div>
      <div className="cd-stack" style={{ gap: 10, minWidth: 0 }}>
        <div className="selector-simbolo-colores" role="radiogroup" aria-label="Color">
          {COLORES_SIMBOLO.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Color ${c.slice(-1)}`}
              onClick={() => alCambiar({ icono, color: color === c ? null : c })}
              style={{ background: `var(--${c})` }}
            />
          ))}
        </div>
        <div className="cd-seg" role="tablist" aria-label="Tipo de símbolo">
          {(
            [
              ["icono", "Ícono"],
              ["emoji", "Emoji"],
              ["imagen", "Imagen"],
            ] as const
          ).map(([v, t]) => (
            <button key={v} type="button" role="tab" aria-selected={modo === v} onClick={() => setModo(v)}>
              {t}
            </button>
          ))}
        </div>
        {modo === "icono" && (
          <div className="selector-simbolo-rejilla" role="radiogroup" aria-label="Ícono">
            <button
              type="button"
              role="radio"
              aria-checked={!icono}
              aria-label="Automático"
              title="Automático"
              onClick={() => alCambiar({ icono: null, color })}
            >
              <Icono nombre={respaldo} pequeno />
            </button>
            {logos.map((l) => (
              <button
                key={l.ruta}
                type="button"
                role="radio"
                aria-checked={icono === l.ruta}
                aria-label={l.nombre}
                title={l.nombre}
                onClick={() => alCambiar({ icono: l.ruta, color })}
              >
                <img src={l.ruta} alt="" width={20} height={20} />
              </button>
            ))}
            {iconos.map((n) => (
              <button
                key={n}
                type="button"
                role="radio"
                aria-checked={icono === n}
                aria-label={n}
                onClick={() => alCambiar({ icono: n, color })}
              >
                <Icono nombre={n} pequeno />
              </button>
            ))}
          </div>
        )}
        {modo === "emoji" && (
          <div className="cd-stack" style={{ gap: 8 }}>
            <div className="selector-simbolo-rejilla" role="radiogroup" aria-label="Emoji">
              {EMOJIS.map((e) => (
                <button
                  key={e}
                  type="button"
                  role="radio"
                  aria-checked={icono === e}
                  aria-label={e}
                  onClick={() => alCambiar({ icono: e, color })}
                >
                  <span style={{ fontSize: 18 }}>{e}</span>
                </button>
              ))}
            </div>
            <label className="cd-stack" style={{ gap: 4 }} htmlFor={`${id}-emoji`}>
              <span className="cd-delta-note">O escribe o pega cualquier emoji</span>
              <input
                id={`${id}-emoji`}
                className="cd-input"
                maxLength={8}
                value={tipo === "emoji" ? (icono ?? "") : ""}
                placeholder="🙂"
                onChange={(e) => {
                  const v = e.target.value.replace(/[A-Za-z0-9<>"'&\s]/g, "");
                  alCambiar({ icono: v || null, color });
                }}
              />
            </label>
          </div>
        )}
        {modo === "imagen" && (
          <div className="cd-stack" style={{ gap: 6 }}>
            <input ref={archivo} type="file" accept="image/png,image/jpeg,image/webp" hidden onChange={subir} />
            <button
              type="button"
              className="cd-btn cd-btn--secondary cd-btn--sm"
              style={{ alignSelf: "flex-start" }}
              onClick={() => archivo.current?.click()}
            >
              {tipo === "imagen" && icono?.startsWith("data:") ? "Cambiar imagen" : "Subir imagen"}
            </button>
            <span className="cd-delta-note">Se recorta cuadrada y se reduce a 96 px; queda solo en tu base local.</span>
            {error && (
              <span className="cd-delta-note" style={{ color: "var(--negative)" }}>
                {error}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
