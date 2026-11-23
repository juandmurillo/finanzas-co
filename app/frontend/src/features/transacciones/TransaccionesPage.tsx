/** Movimientos (sistema compacto, §6): chips por grupo, búsqueda y cuenta en la URL, resumen de lo mostrado y
 * tabla agrupada por día con acciones por fila (editar, duplicar, eliminar); en el celular cada fila es una
 * tarjeta. */
import { useApuestasVisibles } from "@/shared/lib/useSistema";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";

import { useCaptura } from "@/features/captura";
import { api, type FiltroTransacciones } from "@/shared/lib/api";
import { rutaDe } from "@/shared/lib/categorias";
import { fechaCorta, formatoCOP } from "@/shared/lib/formato";
import { claves } from "@/shared/lib/queryKeys";
import { useDebounce } from "@/shared/lib/useDebounce";
import { ErrorVista, TarjetaCargando } from "@/shared/ui/Estados";
import { Icono } from "@/shared/ui/Icono";
import { BarraFiltros } from "@/shared/ui/BarraFiltros";
import { CabeceraTarjeta, FilaMetricas } from "@/shared/ui/Kpi";
import { SelectorCategoria } from "@/shared/ui/SelectorCategoria";

import { etiquetaRango, FiltroFechas, rangoMeses, type RangoDias } from "./components/FiltroFechas";
import type { CategoriaNodo } from "@/shared/api/tipos";
import { useDesvanecido } from "@/shared/lib/useDesvanecido";
import { PanelLateral } from "@/shared/ui/PanelLateral";
import { esMovil } from "@/shared/lib/dispositivo";
import { hoyISO, moverMes } from "@/shared/lib/formato";

import { esNeutro, TablaMovimientos } from "./components/TablaMovimientos";
import "./movimientos.css";

import { Desplegable } from "@/shared/ui/Desplegable";
export interface BusquedaMovimientos {
  grupo?: string;
  cuenta?: number;
  vista?: "todas" | "programadas";
  /** Categoría (incluye sus subcategorías) y su nombre para mostrarlo en el filtro activo. */
  categoria?: number;
  etiqueta?: string;
  /** Rango de fechas AAAA-MM-DD (ambos incluidos). */
  desde?: string;
  hasta?: string;
  /** «Todo el historial» elegido a mano (en la vista móvil, sin rango se ven los últimos 3 meses). */
  todo?: boolean;
}

const GRUPOS = [
  ["", "Todos"],
  ["ingreso", "Ingresos"],
  ["gasto_vida", "Gasto de vida"],
  ["servicio_deuda", "Servicio de deuda"],
  ["apuestas", "Apuestas"],
  ["ahorro_inversion", "Ahorro e inversión"],
  ["prestamos_personales", "Préstamos personales"],
  ["financiacion", "Financiación"],
  ["transferencia", "Transferencias"],
  ["ajuste", "Ajuste"],
] as const;

/** Grupos con categorías propias (para el filtro por categoría). */
const GRUPOS_CATEGORIA = GRUPOS.map(([g]) => g).filter((g) => g !== "" && g !== "transferencia" && g !== "ajuste");

export function TransaccionesPage() {
  const apuestas = useApuestasVisibles();
  const busqueda = useSearch({ strict: false }) as BusquedaMovimientos;
  const navegar = useNavigate();
  const { abrir } = useCaptura();
  const [texto, setTexto] = useState("");
  const textoFiltro = useDebounce(texto.trim(), 250);
  const vista = busqueda.vista ?? "todas";
  const programados = vista === "programadas";

  const fijar = (cambios: Partial<BusquedaMovimientos>) =>
    void navegar({ to: "/movimientos", search: { ...busqueda, ...cambios }, replace: true });

  // Vista móvil: sin rango en la dirección (ni «Todo» elegido) se ven los últimos 3 meses. Los programados no
  // llevan ese rango implícito (miraba solo hacia atrás y dejaba fuera los futuros): sin rango elegido, todos.
  const mesActual = hoyISO().slice(0, 7);
  const rangoFechas =
    busqueda.desde || busqueda.todo || !esMovil() || busqueda.vista === "programadas"
      ? { desde: busqueda.desde, hasta: busqueda.hasta }
      : rangoMeses(moverMes(mesActual, -2), mesActual);

  const filtro: FiltroTransacciones = {
    texto: textoFiltro || undefined,
    grupo: busqueda.grupo,
    cuenta_id: busqueda.cuenta,
    categoria_id: busqueda.categoria,
    desde: rangoFechas.desde,
    hasta: rangoFechas.hasta,
    estado: programados ? "pendiente" : "confirmada",
    limite: 60,
  };
  const cuentas = useQuery({ queryKey: claves.cuentas, queryFn: api.cuentas });
  const movil = esMovil();
  const filaChips = useDesvanecido<HTMLDivElement>();
  const [panelAbierto, setPanelAbierto] = useState(false);
  const arbol = useQuery({ queryKey: claves.categorias, queryFn: api.categorias });
  const categoriaElegida = rutaDe(arbol.data ?? [], busqueda.categoria ?? null);
  const nombreCategoria = categoriaElegida?.ruta.slice(1).join(" › ") ?? busqueda.etiqueta;
  const hayFiltros =
    busqueda.categoria !== undefined ||
    Boolean(busqueda.desde) ||
    Boolean(busqueda.todo) ||
    busqueda.cuenta !== undefined ||
    Boolean(busqueda.grupo);
  const activos = filtrosActivos(busqueda, rangoFechas, nombreCategoria, cuentas.data ?? []);
  const lista = useInfiniteQuery({
    queryKey: claves.transacciones(filtro),
    queryFn: ({ pageParam }) => api.transacciones({ ...filtro, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (pagina) => pagina.siguiente ?? undefined,
  });
  const items = lista.data?.pages.flatMap((p) => p.items) ?? [];

  // Métricas de lo que se ve. Transferencias, préstamos con personas, financiación y ajustes no son ingreso ni
  // gasto (se compensan o solo mueven dinero): no suman.
  const sinTransferencias = items.filter((t) => !esNeutro(t));
  const entradas = sinTransferencias.filter((t) => t.monto > 0).reduce((s, t) => s + t.monto, 0);
  const salidas = sinTransferencias.filter((t) => t.monto < 0).reduce((s, t) => s - t.monto, 0);
  const primera = items.at(-1)?.fecha.slice(0, 10);
  const ultima = items[0]?.fecha.slice(0, 10);
  const rango =
    primera && ultima
      ? `${items.length}${lista.hasNextPage ? "+" : ""} movimientos · ${fechaCorta(primera, true)} – ${fechaCorta(ultima, true)}`
      : undefined;

  return (
    <>
      <div className="cd-pagehead">
        <div>
          <h1>Movimientos</h1>
          <p>Busca, filtra y corrige cualquier registro. Todo se recalcula solo.</p>
        </div>
        <button className="cd-btn cd-btn--primary solo-escritorio" onClick={() => abrir()}>
          <Icono nombre="mas" pequeno /> Registrar
        </button>
      </div>

      <BarraFiltros className="mov-filtros">
        {!movil && (
          <div className="cd-seg cd-seg--brand" role="tablist" aria-label="Vista">
            <button role="tab" aria-selected={!programados} onClick={() => fijar({ vista: undefined })}>
              Registrados
            </button>
            <button role="tab" aria-selected={programados} onClick={() => fijar({ vista: "programadas" })}>
              Programados
            </button>
          </div>
        )}
        <label className="cd-search mov-buscar">
          <Icono nombre="buscar" pequeno />
          <input
            aria-label="Buscar en descripción o nota"
            placeholder="Buscar…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
          />
        </label>
        {movil && (
          <button
            type="button"
            className="cd-icon-btn mov-filtros-boton"
            aria-haspopup="dialog"
            aria-expanded={panelAbierto}
            aria-label={activos.length ? `Filtros: ${activos.length} activos. Cambiar` : "Filtros"}
            onClick={() => setPanelAbierto(true)}
          >
            <Icono nombre="ajustes" pequeno />
            {activos.length > 0 && (
              <span className="mov-filtros-cuenta" aria-hidden>
                {activos.length}
              </span>
            )}
          </button>
        )}
        {!movil && (
          <>
            <FiltroFechas
              futuro={programados}
              valor={rangoFechas}
              alCambiar={(r) =>
                fijar(
                  r.desde
                    ? { desde: r.desde, hasta: r.hasta, todo: undefined }
                    : { desde: undefined, hasta: undefined, todo: esMovil() || undefined },
                )
              }
            />
            <div className="mov-categoria">
              <SelectorCategoria
                arbol={arbol.data ?? []}
                grupos={GRUPOS_CATEGORIA}
                valor={busqueda.categoria ?? null}
                permitirPadre
                placeholder="Todas las categorías"
                alCambiar={(id) => {
                  const r = rutaDe(arbol.data ?? [], id);
                  fijar({ categoria: id, etiqueta: r?.ruta.slice(1).join(" › ") });
                }}
              />
              {busqueda.categoria !== undefined && (
                <button
                  type="button"
                  className="cd-icon-btn"
                  aria-label={`Quitar la categoría ${nombreCategoria ?? ""}`}
                  onClick={() => fijar({ categoria: undefined, etiqueta: undefined })}
                >
                  <Icono nombre="cerrar" pequeno />
                </button>
              )}
            </div>
            <Desplegable
              aria-label="Cuenta"
              className="cd-select"
              value={busqueda.cuenta ?? ""}
              onChange={(e) => fijar({ cuenta: e.target.value ? Number(e.target.value) : undefined })}
            >
              <option value="">Todas las cuentas</option>
              {(cuentas.data ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nombre}
                </option>
              ))}
            </Desplegable>
            {hayFiltros && (
              <button
                type="button"
                className="cd-btn cd-btn--ghost cd-btn--sm"
                onClick={() =>
                  fijar({
                    categoria: undefined,
                    etiqueta: undefined,
                    desde: undefined,
                    hasta: undefined,
                    todo: undefined,
                    cuenta: undefined,
                    grupo: undefined,
                  })
                }
              >
                <Icono nombre="cerrar" pequeno /> Quitar filtros
              </button>
            )}
          </>
        )}
      </BarraFiltros>
      {movil && activos.length > 0 && (
        <ul className="filtros-activos" aria-label="Filtros activos">
          {activos.map((a) => (
            <li key={a}>{a}</li>
          ))}
        </ul>
      )}
      {panelAbierto && (
        <PanelFiltros
          inicial={busqueda}
          arbol={arbol.data ?? []}
          cuentas={cuentas.data ?? []}
          apuestas={apuestas}
          alAplicar={(b) => {
            void navegar({ to: "/movimientos", search: b, replace: true });
            setPanelAbierto(false);
          }}
          alCerrar={() => setPanelAbierto(false)}
        />
      )}
      {!movil && (
        <div ref={filaChips} className="mov-chips desvanece-lados" role="group" aria-label="Grupo">
          {GRUPOS.filter(([valor]) => apuestas || valor !== "apuestas").map(([valor, nombre]) => (
            <button
              key={valor}
              type="button"
              className="mov-chip"
              aria-pressed={(busqueda.grupo ?? "") === valor}
              onClick={() => fijar({ grupo: valor || undefined })}
            >
              {valor === "" ? "Todos" : nombre}
            </button>
          ))}
        </div>
      )}

      <section className="cd-card" aria-label="Lista de movimientos">
        <CabeceraTarjeta titulo={programados ? "Pagos programados" : "Movimientos registrados"} rango={rango} />
        {lista.isSuccess && items.length > 0 && (
          <div className="mov-metricas">
            <FilaMetricas
              etiqueta="Resumen de lo mostrado"
              metricas={[
                { etiqueta: "Entradas", valor: entradas, tono: "ingreso" },
                { etiqueta: "Salidas", valor: salidas },
                {
                  etiqueta: "Neto",
                  valor: `${entradas - salidas < 0 ? "− " : ""}${formatoCOP(Math.abs(entradas - salidas))}`,
                },
                { etiqueta: "Movimientos", valor: String(items.length), nota: "sin transferencias ni ajustes" },
              ]}
            />
          </div>
        )}
        {lista.isPending && <TarjetaCargando filas={8} />}
        {lista.isError && <ErrorVista error={lista.error} reintentar={() => void lista.refetch()} />}
        {lista.isSuccess && (
          <TablaMovimientos
            titulo={programados ? "Pagos programados" : "Movimientos registrados"}
            items={items}
            agruparPorDia
            vacio={{
              titulo: programados ? "No hay pagos programados" : "No hay movimientos con estos filtros",
              texto: "Prueba con otra búsqueda o registra uno nuevo.",
              accion: (
                <button className="cd-btn cd-btn--secondary cd-btn--sm" onClick={() => abrir()}>
                  Registrar movimiento
                </button>
              ),
            }}
          />
        )}
        {lista.hasNextPage && (
          <div className="mov-mas">
            <button
              className="cd-btn cd-btn--secondary cd-btn--sm"
              disabled={lista.isFetchingNextPage}
              onClick={() => void lista.fetchNextPage()}
            >
              {lista.isFetchingNextPage ? "Cargando…" : "Cargar más"}
            </button>
          </div>
        )}
      </section>
    </>
  );
}

/** Filtros que se están aplicando, en palabras (chips del celular y nombre del botón de filtros). */
function filtrosActivos(
  b: BusquedaMovimientos,
  rango: RangoDias,
  categoria: string | undefined,
  cuentas: { id: number; nombre: string }[],
): string[] {
  const salida: string[] = [];
  if (b.vista === "programadas") salida.push("Programados");
  if (b.desde || b.todo) salida.push(etiquetaRango(rango));
  if (b.categoria !== undefined) salida.push(categoria ?? "Categoría");
  if (b.cuenta !== undefined) salida.push(cuentas.find((c) => c.id === b.cuenta)?.nombre ?? "Cuenta");
  if (b.grupo) salida.push(GRUPOS.find(([g]) => g === b.grupo)?.[1] ?? b.grupo);
  return salida;
}

/**
 * Panel lateral de filtros (celular): los mismos filtros de escritorio, uno por fila y del mismo tamaño. Se
 * editan sobre un borrador; «Aplicar» los lleva a la lista y «Limpiar» los deja en su valor inicial.
 */
function PanelFiltros({
  inicial,
  arbol,
  cuentas,
  apuestas,
  alAplicar,
  alCerrar,
}: {
  inicial: BusquedaMovimientos;
  arbol: CategoriaNodo[];
  cuentas: { id: number; nombre: string }[];
  apuestas: boolean;
  alAplicar: (b: BusquedaMovimientos) => void;
  alCerrar: () => void;
}) {
  const [b, setB] = useState<BusquedaMovimientos>(inicial);
  const cambiar = (c: Partial<BusquedaMovimientos>) => setB((x) => ({ ...x, ...c }));
  const mes = hoyISO().slice(0, 7);
  const rango =
    b.desde || b.todo || b.vista === "programadas"
      ? { desde: b.desde, hasta: b.hasta }
      : rangoMeses(moverMes(mes, -2), mes);
  const nombreCat =
    rutaDe(arbol, b.categoria ?? null)
      ?.ruta.slice(1)
      .join(" › ") ?? b.etiqueta;
  const activos = filtrosActivos(b, rango, nombreCat, cuentas);
  return (
    <PanelLateral
      titulo="Filtros"
      onCerrar={alCerrar}
      pie={
        <>
          <button
            type="button"
            className="cd-btn cd-btn--secondary"
            disabled={activos.length === 0}
            onClick={() => setB({})}
          >
            Limpiar
          </button>
          <button type="button" className="cd-btn cd-btn--primary" onClick={() => alAplicar(b)}>
            Aplicar
          </button>
        </>
      }
    >
      <div className="panel-campo">
        <span>Activos</span>
        {activos.length ? (
          <ul className="filtros-activos">
            {activos.map((a) => (
              <li key={a}>{a}</li>
            ))}
          </ul>
        ) : (
          <span className="cd-delta-note">
            {b.vista === "programadas"
              ? "Ninguno: todos los programados, todas las cuentas y categorías."
              : "Ninguno: últimos 3 meses, todas las cuentas y categorías."}
          </span>
        )}
      </div>
      <div className="panel-campo">
        <span>Vista</span>
        <div className="cd-seg cd-seg--brand" role="radiogroup" aria-label="Vista">
          {(
            [
              [undefined, "Registrados"],
              ["programadas", "Programados"],
            ] as const
          ).map(([v, t]) => (
            <button
              key={t}
              type="button"
              role="radio"
              aria-checked={b.vista === v}
              aria-selected={b.vista === v}
              onClick={() => cambiar({ vista: v })}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
      <div className="panel-campo">
        <span>Fechas</span>
        <FiltroFechas
          futuro={b.vista === "programadas"}
          valor={rango}
          alCambiar={(r) =>
            cambiar(
              r.desde
                ? { desde: r.desde, hasta: r.hasta, todo: undefined }
                : { desde: undefined, hasta: undefined, todo: true },
            )
          }
        />
      </div>
      <div className="panel-campo">
        <span>Categoría</span>
        <SelectorCategoria
          arbol={arbol}
          grupos={GRUPOS_CATEGORIA}
          valor={b.categoria ?? null}
          permitirPadre
          placeholder="Todas las categorías"
          alCambiar={(id) => cambiar({ categoria: id, etiqueta: rutaDe(arbol, id)?.ruta.slice(1).join(" › ") })}
        />
      </div>
      <div className="panel-campo">
        <span>Cuenta</span>
        <Desplegable
          aria-label="Cuenta"
          className="cd-input"
          value={b.cuenta ?? ""}
          onChange={(e) => cambiar({ cuenta: e.target.value ? Number(e.target.value) : undefined })}
        >
          <option value="">Todas las cuentas</option>
          {cuentas.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nombre}
            </option>
          ))}
        </Desplegable>
      </div>
      <div className="panel-campo">
        <span>Grupo</span>
        <div className="panel-chips" role="group" aria-label="Grupo">
          {GRUPOS.filter(([valor]) => apuestas || valor !== "apuestas").map(([valor, nombre]) => (
            <button
              key={valor}
              type="button"
              className="mov-chip"
              aria-pressed={(b.grupo ?? "") === valor}
              onClick={() => cambiar({ grupo: valor || undefined })}
            >
              {nombre}
            </button>
          ))}
        </div>
      </div>
    </PanelLateral>
  );
}
