/** Selector visual de categoría: botón que abre una hoja con las categorías (ícono y color), y al tocar
 * una con subcategorías las despliega. Búsqueda por nombre; la sugerida ✦ arriba. */
import { useApuestasVisibles } from "@/shared/lib/useSistema";
import { useMemo, useState } from "react";

import type { CategoriaNodo } from "@/shared/api/tipos";
import { filtrarCategorias, rutaDe } from "@/shared/lib/categorias";

import { Hoja } from "./Hoja";
import { Icono, iconoCategoria, type NombreIcono } from "./Icono";

const ICONOS_VALIDOS = new Set<string>([
  "inicio",
  "movimientos",
  "presupuesto",
  "deudas",
  "persona",
  "recurrentes",
  "meta",
  "flujo",
  "categorias",
  "documento",
  "cuentas",
  "entra",
  "sale",
  "corazon",
  "dado",
  "ruta",
  "telefono",
  "bolsa",
  "comida",
  "regalo",
  "balon",
  "escudo",
  "calendario",
  "wifi",
  "info",
]);

export function iconoDe(cat: CategoriaNodo, ruta: string[]): NombreIcono {
  return cat.icono && ICONOS_VALIDOS.has(cat.icono) ? (cat.icono as NombreIcono) : iconoCategoria(ruta, cat.grupo);
}

export function colorDe(cat: { color?: string | null } | undefined): { fondo: string; tinta: string } {
  return cat?.color
    ? { fondo: `color-mix(in srgb, var(--${cat.color}) 22%, transparent)`, tinta: `var(--${cat.color})` }
    : { fondo: "var(--brand-soft)", tinta: "var(--on-brand-soft)" };
}

export function Burbuja({ cat, ruta, tam = 36 }: { cat: CategoriaNodo; ruta: string[]; tam?: number }) {
  const c = colorDe(cat);
  return (
    <span
      className="cd-kpi-ico"
      style={{ width: tam, height: tam, flex: "none", background: c.fondo, color: c.tinta }}
      aria-hidden
    >
      <Icono nombre={iconoDe(cat, ruta)} pequeno={tam < 32} />
    </span>
  );
}

interface Props {
  arbol: CategoriaNodo[];
  grupos: string[];
  valor: number | null;
  alCambiar: (id: number) => void;
  sugerida?: number | null;
  /** Permite elegir la categoría completa aunque tenga subcategorías (presupuestos, metas). */
  permitirPadre?: boolean;
  id?: string;
  invalido?: boolean;
}

export function SelectorCategoria({ arbol, grupos, valor, alCambiar, sugerida, permitirPadre, id, invalido }: Props) {
  const [abierto, setAbierto] = useState(false);
  const [texto, setTexto] = useState("");
  const [abiertaId, setAbiertaId] = useState<number | null>(null);
  const actual = rutaDe(arbol, valor);
  const apuestas = useApuestasVisibles();
  const visibles = useMemo(
    () => filtrarCategorias(arbol, apuestas ? grupos : grupos.filter((g) => g !== "apuestas"), texto),
    [arbol, grupos, texto, apuestas],
  );
  const sugeridaInfo = rutaDe(arbol, sugerida ?? null);
  const elegir = (ident: number) => {
    alCambiar(ident);
    setAbierto(false);
    setTexto("");
    setAbiertaId(null);
  };

  return (
    <>
      <button
        id={id}
        type="button"
        className="cd-input selector-disparador"
        aria-haspopup="dialog"
        aria-invalid={invalido}
        onClick={() => setAbierto(true)}
      >
        {actual ? (
          <>
            <Burbuja cat={actual.categoria} ruta={actual.ruta} tam={26} />
            <span className="selector-texto">{actual.ruta.slice(1).join(" › ")}</span>
          </>
        ) : (
          <span className="selector-texto cd-muted">Elegir categoría…</span>
        )}
        <span aria-hidden className="cd-muted">
          ▾
        </span>
      </button>
      {abierto && (
        <Hoja titulo="Categoría" onCerrar={() => setAbierto(false)}>
          <input
            className="cd-input"
            placeholder="Buscar: uber, mercado, internet…"
            aria-label="Buscar categoría"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
          {sugeridaInfo && !texto && (
            <button
              type="button"
              className="selector-opcion destacada"
              onClick={() => elegir(sugeridaInfo.categoria.id)}
            >
              <Burbuja cat={sugeridaInfo.categoria} ruta={sugeridaInfo.ruta} tam={30} />
              <span>
                ✦ {sugeridaInfo.ruta.slice(1).join(" › ")}
                <small className="cd-delta-note"> sugerida</small>
              </span>
            </button>
          )}
          <div className="selector-rejilla" role="list">
            {visibles.map(({ raiz, categoria, subcategorias }) => {
              const ruta = [raiz.nombre, categoria.nombre];
              const desplegada = abiertaId === categoria.id || (texto !== "" && subcategorias.length > 0);
              const tieneHijos = categoria.hijos.length > 0;
              return (
                <div key={categoria.id} role="listitem" className="cd-stack" style={{ gap: 6 }}>
                  <button
                    type="button"
                    className={`selector-opcion ${valor === categoria.id ? "activa" : ""}`}
                    aria-expanded={tieneHijos ? desplegada : undefined}
                    onClick={() => (tieneHijos ? setAbiertaId(desplegada ? null : categoria.id) : elegir(categoria.id))}
                  >
                    <Burbuja cat={categoria} ruta={ruta} tam={30} />
                    <span style={{ flex: 1, minWidth: 0 }}>{categoria.nombre}</span>
                    {tieneHijos && <span className="cd-muted">{desplegada ? "▴" : "▾"}</span>}
                  </button>
                  {desplegada && (
                    <div className="cd-row" style={{ gap: 6, paddingLeft: 8 }}>
                      {permitirPadre && (
                        <button
                          type="button"
                          className="cd-btn cd-btn--ghost cd-btn--sm"
                          onClick={() => elegir(categoria.id)}
                        >
                          Toda {categoria.nombre}
                        </button>
                      )}
                      {subcategorias.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          aria-pressed={valor === s.id}
                          className="cd-btn cd-btn--sm selector-chip"
                          onClick={() => elegir(s.id)}
                        >
                          <Icono nombre={iconoDe(s, [...ruta, s.nombre])} pequeno />
                          {s.nombre}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
            {visibles.length === 0 && <span className="cd-delta-note">Ninguna categoría coincide.</span>}
          </div>
        </Hoja>
      )}
    </>
  );
}
