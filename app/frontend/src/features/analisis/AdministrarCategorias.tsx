/** Administrar categorías (RF-CA-03): todas las categorías y subcategorías separadas en ingresos y gastos;
 * crear, editar nombre/ícono/color y eliminar fusionando con otra (los movimientos no se pierden). */
import { useApuestasVisibles } from "@/shared/lib/useSistema";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";

import type { CategoriaNodo } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { rutaDe } from "@/shared/lib/categorias";
import { claves } from "@/shared/lib/queryKeys";
import { TarjetaCargando } from "@/shared/ui/Estados";
import { Hoja } from "@/shared/ui/Hoja";
import { Burbuja, SelectorCategoria } from "@/shared/ui/SelectorCategoria";
import { SelectorEstilo } from "@/shared/ui/SelectorEstilo";

const SECCIONES: [string, string[]][] = [
  ["Gastos", ["gasto_vida", "servicio_deuda", "apuestas", "ahorro_inversion"]],
  ["Ingresos", ["ingreso"]],
];

type Accion =
  | { tipo: "crear"; padre: CategoriaNodo }
  | { tipo: "editar"; cat: CategoriaNodo }
  | { tipo: "eliminar"; cat: CategoriaNodo };

function useRefrescar() {
  const cliente = useQueryClient();
  return () => {
    for (const k of [["categorias"], ["transacciones"], ["presupuesto"], ["reportes"], ["reglas"], ["metas"]])
      void cliente.invalidateQueries({ queryKey: k });
  };
}

function FormCategoria({ accion, arbol, alCerrar }: { accion: Accion; arbol: CategoriaNodo[]; alCerrar: () => void }) {
  const refrescar = useRefrescar();
  const base = accion.tipo === "crear" ? null : accion.cat;
  const [nombre, setNombre] = useState(base?.nombre ?? "");
  const [estilo, setEstilo] = useState({ icono: base?.icono ?? null, color: base?.color ?? null });
  const [destino, setDestino] = useState<number | null>(null);
  // Cambiar de padre (fase 8, D10): la raíz del grupo = categoría principal; una categoría = subcategoría.
  const raiz =
    base && arbol.find((r) => r.hijos.some((h) => h.id === base.id || h.hijos.some((x) => x.id === base.id)));
  const padreActual =
    raiz && base
      ? raiz.hijos.some((h) => h.id === base.id)
        ? raiz.id
        : raiz.hijos.find((h) => h.hijos.some((x) => x.id === base.id))?.id
      : undefined;
  const [padreId, setPadreId] = useState<number | undefined>(padreActual);
  const guardar = useMutation({
    mutationFn: async () => {
      if (accion.tipo === "crear") await api.crearCategoria({ padre_id: accion.padre.id, nombre, ...estilo });
      else if (accion.tipo === "editar")
        await api.editarCategoria(accion.cat.id, {
          nombre,
          ...estilo,
          ...(padreId !== undefined && padreId !== padreActual ? { padre_id: padreId } : {}),
        });
      else if (destino !== null) {
        const r = await api.eliminarCategoria(accion.cat.id, destino);
        toast(
          `Se pasaron ${r.movidos} movimientos a ${rutaDe(arbol, destino)?.ruta.slice(1).join(" › ") ?? "la otra categoría"}`,
        );
      }
    },
    onSuccess: () => {
      if (accion.tipo !== "eliminar") toast.success("Categoría guardada");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  if (accion.tipo === "eliminar") {
    const grupos = [accion.cat.grupo];
    return (
      <Hoja
        titulo={`Eliminar «${accion.cat.nombre}»`}
        onCerrar={alCerrar}
        pie={
          <>
            <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
              Cancelar
            </button>
            <button
              className="cd-btn cd-btn--peligro"
              disabled={destino === null || destino === accion.cat.id || guardar.isPending}
              onClick={() => guardar.mutate()}
            >
              Eliminar y pasar todo a la elegida
            </button>
          </>
        }
      >
        <p className="cd-delta-note" style={{ margin: 0 }}>
          Para no perder información, sus movimientos{accion.cat.hijos.length ? " y los de sus subcategorías" : ""},
          reglas, presupuestos y metas pasan a la categoría que elijas.
        </p>
        <SelectorCategoria arbol={arbol} grupos={grupos} valor={destino} permitirPadre alCambiar={setDestino} />
      </Hoja>
    );
  }
  return (
    <Hoja
      titulo={
        accion.tipo === "crear"
          ? `Nueva ${accion.padre.nivel === 1 ? "categoría" : `subcategoría de ${accion.padre.nombre}`}`
          : `Editar «${accion.cat.nombre}»`
      }
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="cd-btn cd-btn--primary"
            disabled={!nombre.trim() || guardar.isPending}
            onClick={() => guardar.mutate()}
          >
            Guardar
          </button>
        </>
      }
    >
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">Nombre</span>
        <input className="cd-input" value={nombre} onChange={(e) => setNombre(e.target.value)} />
      </label>
      {accion.tipo === "editar" && raiz && (
        <label className="cd-stack" style={{ gap: 6 }}>
          <span className="cd-kpi-label">Pertenece a</span>
          <select className="cd-input" value={padreId ?? ""} onChange={(e) => setPadreId(Number(e.target.value))}>
            <option value={raiz.id}>Ninguna: es una categoría principal</option>
            {raiz.hijos
              .filter((h) => h.id !== accion.cat.id)
              .map((h) => (
                <option key={h.id} value={h.id} disabled={accion.cat.hijos.length > 0}>
                  Subcategoría de {h.nombre}
                </option>
              ))}
          </select>
          <span className="cd-delta-note">
            {accion.cat.hijos.length > 0
              ? "Tiene subcategorías: para volverla subcategoría, mueve primero sus subcategorías."
              : "Sus movimientos, presupuestos y reglas la siguen a donde la muevas."}
          </span>
        </label>
      )}
      <SelectorEstilo icono={estilo.icono} color={estilo.color} alCambiar={setEstilo} />
    </Hoja>
  );
}

function Fila({
  cat,
  ruta,
  onAccion,
  sub,
}: {
  cat: CategoriaNodo;
  ruta: string[];
  onAccion: (a: Accion) => void;
  sub?: boolean;
}) {
  return (
    <div className="cd-row" style={{ flexWrap: "nowrap", gap: 10, padding: "8px 0", paddingLeft: sub ? 40 : 0 }}>
      <Burbuja cat={cat} ruta={ruta} tam={sub ? 26 : 32} />
      <span style={{ flex: 1, minWidth: 0, fontSize: 14, fontWeight: sub ? 500 : 700 }}>{cat.nombre}</span>
      {!sub && (
        <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => onAccion({ tipo: "crear", padre: cat })}>
          + Sub
        </button>
      )}
      <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => onAccion({ tipo: "editar", cat })}>
        Editar
      </button>
      <button className="cd-btn cd-btn--ghost cd-btn--sm" onClick={() => onAccion({ tipo: "eliminar", cat })}>
        Eliminar
      </button>
    </div>
  );
}

export function AdministrarCategorias() {
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias });
  const [accion, setAccion] = useState<Accion | null>(null);
  const apuestas = useApuestasVisibles();
  if (!arbol.data) return <TarjetaCargando />;
  return (
    <div className="cd-bento">
      {SECCIONES.map(([titulo, todos]) => {
        const grupos = todos.filter((g) => apuestas || g !== "apuestas");
        return (
          <section key={titulo} className="cd-card span-6 cd-stack" style={{ gap: 4 }}>
            <h3 className="cd-card-title">{titulo}</h3>
            {(arbol.data ?? [])
              .filter((raiz) => grupos.includes(raiz.grupo))
              .map((raiz) => (
                <div
                  key={raiz.id}
                  className="cd-stack"
                  style={{ gap: 0, borderTop: "1px solid var(--border)", paddingTop: 8 }}
                >
                  <div className="cd-row" style={{ justifyContent: "space-between" }}>
                    <span className="cd-kpi-label">{raiz.nombre}</span>
                    <button
                      className="cd-btn cd-btn--secondary cd-btn--sm"
                      onClick={() => setAccion({ tipo: "crear", padre: raiz })}
                    >
                      + Categoría
                    </button>
                  </div>
                  {raiz.hijos.map((cat) => (
                    <div key={cat.id}>
                      <Fila cat={cat} ruta={[raiz.nombre, cat.nombre]} onAccion={setAccion} />
                      {cat.hijos.map((s) => (
                        <Fila key={s.id} cat={s} ruta={[raiz.nombre, cat.nombre, s.nombre]} onAccion={setAccion} sub />
                      ))}
                    </div>
                  ))}
                </div>
              ))}
          </section>
        );
      })}
      {accion && (
        <FormCategoria
          key={`${accion.tipo}-${"cat" in accion ? accion.cat.id : accion.padre.id}`}
          accion={accion}
          arbol={arbol.data}
          alCerrar={() => setAccion(null)}
        />
      )}
    </div>
  );
}
