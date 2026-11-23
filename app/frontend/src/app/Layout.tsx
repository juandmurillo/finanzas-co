/**
 * Shell de Caudal: barra lateral contraíble + barra superior en escritorio. En el celular, barra inferior de
 * cinco accesos (elegidos y ordenados en «Más › Personalizar menú», con «Más» siempre presente) y el botón «+»
 * flotante a la derecha, justo encima de ella. Cada página entra con la transición que fija la intensidad de
 * animación (Configuración › Apariencia).
 */
import { Link, Outlet, useRouter, useRouterState } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useCaptura } from "@/features/captura";
import { PrimerUso } from "@/features/sistema/PrimerUso";
import { useMenuMovil, type Posicion } from "@/shared/lib/menuMovil";
import { GRUPOS_ESCRITORIO, SECCIONES, type ItemNav } from "@/shared/lib/secciones";
import type { EstadoConexion } from "@/shared/lib/useEventosDominio";
import { useEventosDominio } from "@/shared/lib/useEventosDominio";
import { useSistema } from "@/shared/lib/useSistema";
import { Icono } from "@/shared/ui/Icono";

import { Alertas } from "./Alertas";
import "./navegacion.css";

const CLAVE_BARRA = "caudal-barra-contraida";

function barraInicial(): boolean {
  try {
    return localStorage.getItem(CLAVE_BARRA) === "1";
  } catch {
    return false;
  }
}

function Nav({ items, etiqueta, contraida }: { items: ItemNav[]; etiqueta: string; contraida: boolean }) {
  return (
    <div>
      <div className="cd-nav-group">{etiqueta}</div>
      <nav className="cd-nav" aria-label={etiqueta}>
        {items.map((item) => (
          <Link
            key={item.a}
            to={item.a}
            activeOptions={{ exact: item.a === "/" }}
            activeProps={{ "aria-current": "page" }}
            aria-label={contraida ? item.etiqueta : undefined}
            data-etiqueta={item.etiqueta}
          >
            <Icono nombre={item.icono} />
            <span className="nav-texto">{item.etiqueta}</span>
          </Link>
        ))}
      </nav>
    </div>
  );
}

const TEXTO_CONEXION: Record<EstadoConexion, string> = {
  "en-vivo": "En vivo",
  conectando: "Conectando…",
  "sin-conexion": "Sin conexión",
};

export function Logo() {
  return (
    <span className="cd-logo">
      <span className="cd-logo-mark" aria-hidden>
        <i />
      </span>
      <span className="nav-texto">Caudal</span>
    </span>
  );
}

export function Layout() {
  const conexion = useEventosDominio();
  const sistema = useSistema();
  const { abrir } = useCaptura();
  const router = useRouter();
  // «Atrás» solo si hay a dónde volver dentro de la app (la primera página no tiene anterior).
  const puedeVolver = useRouterState({ select: (e) => e.location.state.__TSR_index > 0 });
  const [contraida, setContraida] = useState(barraInicial);
  const menu = useMenuMovil();
  const ruta = useRouterState({ select: (e) => e.location.pathname });

  useEffect(() => {
    try {
      localStorage.setItem(CLAVE_BARRA, contraida ? "1" : "0");
    } catch {
      /* almacenamiento no disponible */
    }
  }, [contraida]);

  if (sistema.data?.primer_uso) return <PrimerUso />;

  return (
    <div className="cd-app" data-barra={contraida ? "contraida" : "expandida"}>
      <a className="saltar-contenido" href="#contenido">
        Saltar al contenido
      </a>
      <aside className="cd-sidebar">
        <div className="barra-cabeza">
          <Link to="/" className="barra-logo" aria-label="Caudal, ir a Inicio">
            <Logo />
          </Link>
          <button
            className="cd-icon-btn barra-alternar"
            aria-label={contraida ? "Expandir la barra lateral" : "Contraer la barra lateral"}
            aria-expanded={!contraida}
            title={contraida ? "Expandir" : "Contraer"}
            onClick={() => setContraida((c) => !c)}
          >
            <Icono nombre="barra" />
          </button>
        </div>
        {GRUPOS_ESCRITORIO.map((g) => (
          <Nav key={g.etiqueta} items={g.items} etiqueta={g.etiqueta} contraida={contraida} />
        ))}
      </aside>

      <div className="cd-main">
        <header className="cd-topbar">
          <span className="solo-movil">
            <Logo />
          </span>
          <nav className="historial-nav" aria-label="Historial">
            <button
              type="button"
              className="cd-icon-btn"
              aria-label="Página anterior"
              title="Atrás"
              disabled={!puedeVolver}
              onClick={() => router.history.back()}
            >
              ‹
            </button>
            <button
              type="button"
              className="cd-icon-btn"
              aria-label="Página siguiente"
              title="Adelante"
              onClick={() => router.history.forward()}
            >
              ›
            </button>
          </nav>
          <span
            className={`cd-badge conexion-${conexion} ${conexion === "en-vivo" ? "cd-badge--positive" : conexion === "conectando" ? "cd-badge--warning" : "cd-badge--negative"}`}
            title={
              conexion === "sin-conexion"
                ? "No hay conexión con el servidor de Caudal. Lo que ves puede estar desactualizado; se reconecta solo."
                : "Los datos se actualizan solos cuando registras algo, en cualquier pestaña o dispositivo"
            }
          >
            {TEXTO_CONEXION[conexion]}
          </span>
          {sistema.data?.es_demo && (
            <span className="cd-badge cd-badge--info" title="Una persona ficticia: nada de esto es real">
              <span className="demo-largo">Datos de demostración</span>
              <span className="demo-corto">Demo</span>
            </span>
          )}
          <div className="cd-user">
            <Alertas />
            <button className="cd-btn cd-btn--primary solo-escritorio" onClick={() => abrir()}>
              <Icono nombre="mas" />
              Registrar
              <kbd className="atajo">N</kbd>
            </button>
          </div>
        </header>
        {conexion === "sin-conexion" && (
          <div className="aviso-conexion" role="status">
            <Icono nombre="wifi" />
            <span>
              Se perdió la conexión con el servidor de Caudal. Lo que ves puede estar desactualizado y los cambios no se
              guardarán hasta que vuelva; se reconecta solo.
            </span>
          </div>
        )}
        <main className="cd-content" id="contenido" tabIndex={-1}>
          {/* La página nueva entra con su transición; la clave la reinicia en cada cambio de ruta. */}
          <div className="pagina" key={ruta}>
            <Outlet />
          </div>
        </main>
      </div>

      <nav className="app-movil-nav" aria-label="Principal">
        {menu.map((p) => (
          <EnlaceMovil key={p} posicion={p} />
        ))}
      </nav>
      <button className="fab-registrar" aria-label="Registrar movimiento" onClick={() => abrir()}>
        <Icono nombre="mas" />
      </button>
    </div>
  );
}

/** Un acceso de la barra inferior. «Más» abre su pantalla completa (y queda activo en sus subpantallas). */
function EnlaceMovil({ posicion }: { posicion: Posicion }) {
  const item: ItemNav = posicion === "mas" ? { a: "/mas", etiqueta: "Más", icono: "menu" } : SECCIONES[posicion];
  return (
    <Link
      to={item.a}
      activeOptions={{ exact: item.a === "/" }}
      className="movil-item"
      activeProps={{ "aria-current": "page" }}
    >
      <Icono nombre={item.icono} />
      <span>{item.corta ?? item.etiqueta}</span>
    </Link>
  );
}
