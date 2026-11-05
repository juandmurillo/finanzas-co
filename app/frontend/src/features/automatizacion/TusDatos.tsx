/** Tus datos: exportar, cargar con vista previa, importar Cashew y borrar todo. Nada se reemplaza sin confirmarlo
 * y el backend guarda un respaldo antes de cada cambio. */
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { toast } from "sonner";

import type { VistaPreviaDatos } from "@/shared/api/tipos";
import { api } from "@/shared/lib/api";
import { Hoja } from "@/shared/ui/Hoja";
import { Icono } from "@/shared/ui/Icono";

const EXPORTES = [
  { href: "/api/v1/datos/exportar/json", texto: "Todo en JSON", nota: "Para volver a cargarlo aquí" },
  { href: "/api/v1/datos/exportar/sqlite", texto: "Copia de la base", nota: "Archivo SQLite completo" },
  { href: "/api/v1/exportar/excel", texto: "Excel", nota: "Reportes para leer" },
];
const PALABRA = "BORRAR";

function VistaPrevia({ archivo, previa, alCerrar }: { archivo: File; previa: VistaPreviaDatos; alCerrar: () => void }) {
  const cliente = useQueryClient();
  const cargar = useMutation({
    mutationFn: () => api.cargarDatos(archivo),
    onSuccess: () => {
      toast.success("Datos cargados. Tus datos anteriores quedaron en un respaldo.");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries(),
  });
  return (
    <Hoja
      titulo="Revisa antes de cargar"
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button className="cd-btn cd-btn--peligro" disabled={cargar.isPending} onClick={() => cargar.mutate()}>
            Reemplazar mis datos
          </button>
        </>
      }
    >
      <p className="cd-delta-note" style={{ margin: 0 }}>
        <b>{archivo.name}</b> reemplazará todo lo que hay ahora. Antes se guarda un respaldo automático.
      </p>
      <table className="datos-comparar">
        <thead>
          <tr>
            <th scope="col">Dato</th>
            <th scope="col">Ahora</th>
            <th scope="col">En el archivo</th>
          </tr>
        </thead>
        <tbody>
          {previa.entra.map((f) => (
            <tr key={f.tabla}>
              <td>{f.nombre}</td>
              <td className="cd-num">{previa.actual.find((a) => a.tabla === f.tabla)?.filas ?? 0}</td>
              <td className="cd-num">{f.filas}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </Hoja>
  );
}

function BorrarTodo({ alCerrar }: { alCerrar: () => void }) {
  const cliente = useQueryClient();
  const [descargo, setDescargo] = useState(false);
  const [texto, setTexto] = useState("");
  const borrar = useMutation({
    mutationFn: () => api.borrarTodo(texto),
    onSuccess: () => {
      toast.success("Datos borrados. Quedó un respaldo en la carpeta de respaldos.");
      alCerrar();
    },
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries(),
  });
  return (
    <Hoja
      titulo="Borrar todos mis datos"
      onCerrar={alCerrar}
      pie={
        <>
          <button className="cd-btn cd-btn--ghost" onClick={alCerrar}>
            Cancelar
          </button>
          <button
            className="cd-btn cd-btn--peligro"
            disabled={!descargo || texto !== PALABRA || borrar.isPending}
            onClick={() => borrar.mutate()}
          >
            Borrar todo
          </button>
        </>
      }
    >
      <p className="cd-delta-note" style={{ margin: 0 }}>
        Se borran cuentas, movimientos, créditos, presupuestos, metas y activos. La app volverá a la pantalla de
        bienvenida, donde puedes empezar de cero o explorar con datos de ejemplo.
      </p>
      <a
        className="cd-btn cd-btn--secondary"
        href="/api/v1/datos/exportar/json"
        download
        onClick={() => setDescargo(true)}
      >
        <Icono nombre="descargar" pequeno />
        {descargo ? "Copia descargada" : "1. Descargar mi copia"}
      </a>
      <label className="cd-stack" style={{ gap: 6 }}>
        <span className="cd-kpi-label">2. Escribe {PALABRA} para confirmar</span>
        <input
          className="cd-input"
          autoComplete="off"
          disabled={!descargo}
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </label>
    </Hoja>
  );
}

export function TusDatos() {
  const cliente = useQueryClient();
  const entrada = useRef<HTMLInputElement>(null);
  const entradaCashew = useRef<HTMLInputElement>(null);
  const [archivo, setArchivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<VistaPreviaDatos | null>(null);
  const [borrando, setBorrando] = useState(false);
  const revisar = useMutation({
    mutationFn: (f: File) => api.vistaPreviaDatos(f),
    onSuccess: setPrevia,
    onError: (e) => toast.error(e.message),
  });
  const cashew = useMutation({
    mutationFn: (f: File) => api.importarCashew(f),
    onSuccess: (r) =>
      toast.success(
        r.archivo_repetido
          ? "Ese archivo ya estaba importado: no se duplicó nada."
          : `Importados: ${r.creadas} movimientos nuevos y ${r.duplicadas} que ya existían.`,
      ),
    onError: (e) => toast.error(e.message),
    onSettled: () => void cliente.invalidateQueries(),
  });
  return (
    <section className="cd-card cd-stack" style={{ gap: 14 }}>
      <div>
        <h3 className="cd-card-title">Tus datos</h3>
        <p className="cd-delta-note" style={{ margin: "4px 0 0" }}>
          Son tuyos y viven en este computador. Antes de cargar o borrar se guarda un respaldo automático.
        </p>
      </div>
      <div className="datos-exportar">
        {EXPORTES.map((e) => (
          <a key={e.href} className="datos-opcion" href={e.href} download>
            <Icono nombre="descargar" pequeno />
            <span>
              <b>{e.texto}</b>
              <small>{e.nota}</small>
            </span>
          </a>
        ))}
      </div>
      <div className="cd-row" style={{ gap: 8 }}>
        <button
          className="cd-btn cd-btn--secondary cd-btn--sm"
          disabled={revisar.isPending}
          onClick={() => entrada.current?.click()}
        >
          Cargar copia
        </button>
        <button
          className="cd-btn cd-btn--secondary cd-btn--sm"
          disabled={cashew.isPending}
          onClick={() => entradaCashew.current?.click()}
        >
          {cashew.isPending ? "Importando…" : "Importar de Cashew"}
        </button>
        <button className="cd-btn cd-btn--peligro-suave cd-btn--sm" onClick={() => setBorrando(true)}>
          Borrar todo
        </button>
      </div>
      <input
        ref={entrada}
        type="file"
        hidden
        aria-label="Copia a cargar"
        accept=".json,.db,application/json"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) {
            setArchivo(f);
            revisar.mutate(f);
          }
        }}
      />
      <input
        ref={entradaCashew}
        type="file"
        hidden
        aria-label="Archivo de Cashew"
        accept=".csv,text/csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (f) cashew.mutate(f);
        }}
      />
      {archivo && previa && (
        <VistaPrevia
          archivo={archivo}
          previa={previa}
          alCerrar={() => {
            setArchivo(null);
            setPrevia(null);
          }}
        />
      )}
      {borrando && <BorrarTodo alCerrar={() => setBorrando(false)} />}
    </section>
  );
}
