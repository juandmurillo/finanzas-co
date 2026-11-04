/** Movimientos: lista agrupada por día, filtros en la URL, pestaña de programados y edición lateral. */
import { useApuestasVisibles } from "@/shared/lib/useSistema";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { useCaptura } from "@/features/captura";
import { api, type FiltroTransacciones } from "@/shared/lib/api";
import { encabezadoDia, formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { ErrorVista, TarjetaCargando, Vacio } from "@/shared/ui/Estados";
import { Icono } from "@/shared/ui/Icono";

import { agruparPorDia, FilaMovimiento } from "./components/FilaMovimiento";

export interface BusquedaMovimientos {
  grupo?: string;
  cuenta?: number;
  vista?: "todas" | "programadas";
}

const GRUPOS = [
  ["", "Todos los grupos"],
  ["ingreso", "Ingresos"],
  ["gasto_vida", "Gasto de vida"],
  ["servicio_deuda", "Servicio de deuda"],
  ["apuestas", "Apuestas"],
  ["prestamos_personales", "Préstamos personales"],
  ["transferencia", "Transferencias"],
] as const;

export function TransaccionesPage() {
  const apuestas = useApuestasVisibles();
  const busqueda = useSearch({ strict: false }) as BusquedaMovimientos;
  const navegar = useNavigate();
  const { abrir } = useCaptura();
  const [texto, setTexto] = useState("");
  const textoFiltro = useDebounce(texto.trim(), 250);
  const vista = busqueda.vista ?? "todas";

  const fijar = (cambios: Partial<BusquedaMovimientos>) =>
    void navegar({ to: "/movimientos", search: { ...busqueda, ...cambios }, replace: true });

  const filtro: FiltroTransacciones = {
    texto: textoFiltro || undefined,
    grupo: busqueda.grupo,
    cuenta_id: busqueda.cuenta,
    estado: vista === "programadas" ? "pendiente" : "confirmada",
    limite: 60,
  };
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: api.cuentas });
  const lista = useInfiniteQuery({
    queryKey: claves.transacciones(filtro),
    queryFn: ({ pageParam }) => api.transacciones({ ...filtro, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (pagina) => pagina.siguiente ?? undefined,
  });
  const items = lista.data?.pages.flatMap((p) => p.items) ?? [];
  const dias = agruparPorDia(items);

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Movimientos</h1>
          <p>Busca, filtra y corrige cualquier registro. Todo se recalcula solo.</p>
        </div>
      </div>

      <div className="cd-row" style={{ justifyContent: "space-between" }}>
        <div className="cd-seg cd-seg--brand" role="tablist" aria-label="Vista">
          <button role="tab" aria-selected={vista === "todas"} onClick={() => fijar({ vista: undefined })}>
            Registrados
          </button>
          <button role="tab" aria-selected={vista === "programadas"} onClick={() => fijar({ vista: "programadas" })}>
            Programados
          </button>
        </div>
        <div className="cd-row" style={{ gap: 8 }}>
          <label className="cd-search" style={{ minWidth: 220 }}>
            <Icono nombre="buscar" />
            <input
              aria-label="Buscar en descripción o nota"
              placeholder="Buscar…"
              value={texto}
              onChange={(e) => setTexto(e.target.value)}
              style={{
                border: 0,
                outline: "none",
                background: "transparent",
                color: "var(--ink)",
                font: "500 14px var(--font-sans)",
                flex: 1,
                minWidth: 0,
              }}
            />
          </label>
          <select
            aria-label="Grupo"
            className="cd-select"
            style={{ height: 40 }}
            value={busqueda.grupo ?? ""}
            onChange={(e) => fijar({ grupo: e.target.value || undefined })}
          >
            {GRUPOS.filter(([valor]) => apuestas || valor !== "apuestas").map(([valor, texto]) => (
              <option key={valor} value={valor}>
                {texto}
              </option>
            ))}
          </select>
          <select
            aria-label="Cuenta"
            className="cd-select"
            style={{ height: 40 }}
            value={busqueda.cuenta ?? ""}
            onChange={(e) => fijar({ cuenta: e.target.value ? Number(e.target.value) : undefined })}
          >
            <option value="">Todas las cuentas</option>
            {(cuentas.data ?? []).map((c) => (
              <option key={c.id} value={c.id}>
                {c.nombre}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="cd-bento">
        <section className="cd-card span-12" style={{ padding: "8px 16px 16px" }} aria-label="Lista de movimientos">
          {lista.isPending && <TarjetaCargando filas={8} />}
          {lista.isError && <ErrorVista error={lista.error} reintentar={() => void lista.refetch()} />}
          {lista.isSuccess && items.length === 0 && (
            <Vacio
              titulo={vista === "programadas" ? "No hay pagos programados" : "No hay movimientos con estos filtros"}
              texto="Prueba con otra búsqueda o registra uno nuevo."
              accion={
                <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={() => abrir()}>
                  Registrar movimiento
                </button>
              }
            />
          )}
          {dias.map((d) => (
            <div key={d.dia}>
              <div className="cd-row" style={{ justifyContent: "space-between", padding: "16px 8px 6px" }}>
                <span className="cd-nav-group" style={{ padding: 0, margin: 0 }}>
                  {encabezadoDia(d.dia)}
                </span>
                <span className="cd-amt cd-muted" style={{ fontSize: 12 }}>
                  {formatoCOP(d.total, { signo: true })}
                </span>
              </div>
              <ul className="cd-list">
                {d.items.map((tx) => (
                  <FilaMovimiento key={tx.id} tx={tx} />
                ))}
              </ul>
            </div>
          ))}
          {lista.hasNextPage && (
            <div style={{ display: "grid", placeItems: "center", paddingTop: 12 }}>
              <button
                className="cd-btn cd-btn--secondary"
                disabled={lista.isFetchingNextPage}
                onClick={() => void lista.fetchNextPage()}
              >
                {lista.isFetchingNextPage ? "Cargando…" : "Cargar más"}
              </button>
            </div>
          )}
        </section>
      </div>
    </>
  );
}
