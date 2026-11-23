/**
 * Tabla de movimientos del sistema compacto: fecha, concepto con su categoría, cuenta, estado y monto, más
 * acciones por fila (editar, duplicar, eliminar). Opcionalmente agrupada por día con el total del día.
 * La usan Movimientos e Inicio (recientes). Eliminar pide confirmación; nada se borra con un clic.
 */
import { useMutation } from "@tanstack/react-query";
import { esMovil } from "@/shared/lib/dispositivo";
import { useState, type ReactNode } from "react";
import { toast } from "sonner";

import { useCaptura } from "@/features/captura";
import type { Transaccion } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { encabezadoDia, fechaCorta, formatoCOP, horaCorta, hoyISO, mascaraMonto } from "@/shared/lib/formato";
import { useRefrescar } from "@/shared/lib/useRefrescar";
import { EstadoPunto, TablaDensa, type Columna } from "@/shared/ui/Datos";
import { Hoja } from "@/shared/ui/Hoja";
import { IconoCategoria, tonosCategoria, useEstiloCategorias } from "@/shared/ui/EstiloCategoria";
import { Icono } from "@/shared/ui/Icono";

import "./tabla-movimientos.css";

/** Grupos que no son ingreso ni gasto (se compensan o solo mueven dinero entre bolsillos). */
export const GRUPOS_NEUTROS = new Set(["transferencia", "prestamos_personales", "financiacion", "ajuste"]);
export const esNeutro = (t: Transaccion) => GRUPOS_NEUTROS.has(t.grupo ?? "");

function Concepto({ t }: { t: Transaccion }) {
  const tono = useEstiloCategorias()({ id: t.categoria_id, ruta: t.categoria_ruta });
  return (
    <span className="mov-concepto">
      <span className="mov-ico" aria-hidden style={tonosCategoria(tono)}>
        <IconoCategoria estilo={tono} ruta={t.categoria_ruta} grupo={t.grupo} tam={16} />
      </span>
      <span className="mov-texto">
        <b>{t.descripcion || t.categoria_ruta.at(-1) || "Sin descripción"}</b>
        <small>{t.categoria_ruta.slice(1).join(" › ") || "Sin categoría"}</small>
        <EstadoProgramado t={t} />
      </span>
    </span>
  );
}

/** Solo los programados llevan estado (bajo el concepto): «Programado» o «Vencido». */
function EstadoProgramado({ t }: { t: Transaccion }) {
  if (t.estado !== "pendiente") return null;
  return t.fecha.slice(0, 10) < hoyISO() ? (
    <EstadoPunto tono="negativo" texto="Vencido" />
  ) : (
    <EstadoPunto tono="aviso" texto="Programado" />
  );
}

function Monto({ t }: { t: Transaccion }) {
  return (
    <span className={esNeutro(t) ? "cd-muted" : t.monto > 0 ? "tono-ingreso" : undefined}>
      {t.monto > 0 ? "+ " : t.monto < 0 ? "− " : ""}
      {formatoCOP(Math.abs(t.monto))}
    </span>
  );
}

function ConfirmarEliminar({ t, alCerrar }: { t: Transaccion; alCerrar: () => void }) {
  const refrescar = useRefrescar();
  const eliminar = useMutation({
    mutationFn: () => api.eliminarTransaccion(t.id),
    onSuccess: () => {
      toast.success("Movimiento eliminado");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: refrescar,
  });
  const titulo = t.descripcion || t.categoria_ruta.at(-1) || "este movimiento";
  return (
    <Hoja
      titulo="Eliminar movimiento"
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--peligro" disabled={eliminar.isPending} onClick={() => eliminar.mutate()}>
            {eliminar.isPending ? "Eliminando…" : "Eliminar"}
          </button>
        </>
      }
    >
      <p style={{ margin: 0 }}>
        Vas a eliminar <b>{titulo}</b> del {fechaCorta(t.fecha, true)} por <b>{formatoCOP(Math.abs(t.monto))}</b>.
        {t.transferencia_id ? " También se elimina el otro lado de la transferencia." : ""} Los saldos y reportes se
        recalculan solos.
      </p>
    </Hoja>
  );
}

export function TablaMovimientos({
  items,
  titulo,
  agruparPorDia = false,
  sinCuenta = false,
  vacio,
}: {
  items: Transaccion[];
  titulo: string;
  agruparPorDia?: boolean;
  /** Oculta la columna de cuenta (vistas estrechas). */
  sinCuenta?: boolean;
  vacio?: { titulo: string; texto?: string; accion?: ReactNode };
}) {
  const { abrir, abrirMovimiento } = useCaptura();
  const [borrando, setBorrando] = useState<Transaccion | null>(null);
  // En el celular la fila no lleva botones: tocarla abre sus acciones (editar, duplicar, eliminar).
  const [acciones, setAcciones] = useState<Transaccion | null>(null);

  const duplicar = (t: Transaccion) => {
    const tipo = t.grupo === "transferencia" ? "transferencia" : t.monto > 0 ? "ingreso" : "gasto";
    const pesos = Math.abs(t.monto) / 100;
    abrir(tipo, {
      monto: mascaraMonto(Number.isInteger(pesos) ? String(pesos) : pesos.toFixed(2).replace(".", ",")),
      descripcion: t.descripcion,
      categoriaId: tipo === "transferencia" ? null : t.categoria_id,
      cuentaId: t.cuenta_id,
      nota: t.nota,
    });
  };

  const columnas: Columna<Transaccion>[] = [
    {
      clave: "fecha",
      titulo: agruparPorDia ? "Hora" : "Fecha",
      render: (t) =>
        agruparPorDia ? (
          <span className="mov-fecha">{horaCorta(t.fecha) || "—"}</span>
        ) : (
          <span className="mov-fecha">
            {fechaCorta(t.fecha)}
            <small>{horaCorta(t.fecha)}</small>
          </span>
        ),
    },
    { clave: "concepto", titulo: "Concepto", render: (t) => <Concepto t={t} /> },
    ...(sinCuenta
      ? []
      : [{ clave: "cuenta", titulo: "Cuenta", secundaria: true, render: (t: Transaccion) => t.cuenta }]),
    { clave: "monto", titulo: "Monto", alinear: "fin", render: (t) => <Monto t={t} /> },
    {
      clave: "acciones",
      titulo: "Acciones",
      clase: "acciones",
      alinear: "fin",
      render: (t) => {
        const nombre = t.descripcion || t.categoria_ruta.at(-1) || "movimiento";
        return (
          // Las acciones no deben abrir además el editor de la fila.
          <span className="acciones-fila" onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
            <button type="button" aria-label={`Editar ${nombre}`} title="Editar" onClick={() => abrirMovimiento(t)}>
              <Icono nombre="lapiz" pequeno />
            </button>
            <button type="button" aria-label={`Duplicar ${nombre}`} title="Duplicar" onClick={() => duplicar(t)}>
              <Icono nombre="copiar" pequeno />
            </button>
            <button
              type="button"
              className="peligro"
              aria-label={`Eliminar ${nombre}`}
              title="Eliminar"
              onClick={() => setBorrando(t)}
            >
              <Icono nombre="basura" pequeno />
            </button>
          </span>
        );
      },
    },
  ];

  return (
    <>
      <TablaDensa
        titulo={titulo}
        filas={items}
        claveFila={(t) => t.id}
        columnas={columnas}
        alElegir={(t) => (esMovil() ? setAcciones(t) : abrirMovimiento(t))}
        vacio={vacio}
        grupo={agruparPorDia ? (t) => t.fecha.slice(0, 10) : undefined}
        cabeceraGrupo={(dia, filas) => {
          const total = filas.filter((t) => !esNeutro(t)).reduce((s, t) => s + t.monto, 0);
          return (
            <span className="mov-dia">
              <span>{encabezadoDia(dia)}</span>
              <span className="cd-num">{formatoCOP(total, { signo: true })}</span>
            </span>
          );
        }}
      />
      {borrando && <ConfirmarEliminar t={borrando} alCerrar={() => setBorrando(null)} />}
      {acciones && (
        <Hoja
          titulo={acciones.descripcion || acciones.categoria_ruta.at(-1) || "Movimiento"}
          onCerrar={() => setAcciones(null)}
        >
          <p className="mov-acciones-resumen">
            <span>
              {fechaCorta(acciones.fecha, true)} · {acciones.cuenta}
            </span>
            <Monto t={acciones} />
          </p>
          <div className="mov-acciones-lista">
            <button
              type="button"
              className="cd-btn cd-btn--secondary"
              onClick={() => {
                const t = acciones;
                setAcciones(null);
                abrirMovimiento(t);
              }}
            >
              <Icono nombre="lapiz" pequeno /> Editar
            </button>
            <button
              type="button"
              className="cd-btn cd-btn--secondary"
              onClick={() => {
                const t = acciones;
                setAcciones(null);
                duplicar(t);
              }}
            >
              <Icono nombre="copiar" pequeno /> Duplicar
            </button>
            <button
              type="button"
              className="cd-btn cd-btn--peligro-suave"
              onClick={() => {
                const t = acciones;
                setAcciones(null);
                setBorrando(t);
              }}
            >
              <Icono nombre="basura" pequeno /> Eliminar
            </button>
          </div>
        </Hoja>
      )}
    </>
  );
}
