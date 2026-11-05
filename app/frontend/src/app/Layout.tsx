/** Shell de Caudal: sidebar + topbar en escritorio; barra inferior con "+" en móvil. */
import { useSistema } from "@/shared/lib/useSistema";
import { PrimerUso } from "@/features/sistema/PrimerUso";
import { Link, Outlet } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { useCaptura } from "@/features/captura";
import { aplicarTema, temaInicial, type Tema } from "@/shared/lib/tema";
import type { EstadoConexion } from "@/shared/lib/useEventosDominio";
import { useEventosDominio } from "@/shared/lib/useEventosDominio";
import { Icono, type NombreIcono } from "@/shared/ui/Icono";

import { Alertas } from "./Alertas";

interface ItemNav {
  a: string;
  etiqueta: string;
  icono: NombreIcono;
}

const MENU: ItemNav[] = [
  { a: "/", etiqueta: "Inicio", icono: "inicio" },
  { a: "/movimientos", etiqueta: "Movimientos", icono: "movimientos" },
  { a: "/presupuesto", etiqueta: "Presupuesto", icono: "presupuesto" },
  { a: "/deudas", etiqueta: "Deudas", icono: "deudas" },
  { a: "/prestamos", etiqueta: "Préstamos", icono: "persona" },
  { a: "/activos", etiqueta: "Activos", icono: "activos" },
  { a: "/recurrentes", etiqueta: "Recurrentes", icono: "recurrentes" },
  { a: "/metas", etiqueta: "Metas y hábitos", icono: "meta" },
];
const ANALISIS: ItemNav[] = [
  { a: "/flujo", etiqueta: "Flujo de caja", icono: "flujo" },
  { a: "/categorias", etiqueta: "Categorías", icono: "categorias" },
  { a: "/revision", etiqueta: "Revisión mensual", icono: "documento" },
  { a: "/impuestos", etiqueta: "Renta y aportes", icono: "escudo" },
  { a: "/asistente", etiqueta: "Asistente", icono: "info" },
  { a: "/cuentas", etiqueta: "Cuentas", icono: "cuentas" },
  { a: "/configuracion", etiqueta: "Configuración", icono: "ajustes" },
];
const MOVIL: ItemNav[] = [
  { a: "/", etiqueta: "Inicio", icono: "inicio" },
  { a: "/movimientos", etiqueta: "Movimientos", icono: "movimientos" },
  { a: "/deudas", etiqueta: "Deudas", icono: "deudas" },
];
// En el celular, "Más" abre el resto de secciones (todo lo que no cabe en la barra).
const EN_MAS: ItemNav[] = [...MENU, ...ANALISIS].filter((i) => !MOVIL.some((m) => m.a === i.a));

function Nav({ items, etiqueta }: { items: ItemNav[]; etiqueta: string }) {
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
          >
            <Icono nombre={item.icono} />
            {item.etiqueta}
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

export function Layout() {
  const conexion = useEventosDominio();
  const sistema = useSistema();
  const { abrir } = useCaptura();
  const [tema, setTema] = useState<Tema>(temaInicial);
  const [masAbierto, setMasAbierto] = useState(false);

  useEffect(() => aplicarTema(tema), [tema]);

  if (sistema.data?.primer_uso) return <PrimerUso />;

  return (
    <div className="cd-app">
      <aside className="cd-sidebar">
        <div className="cd-logo">
          <span className="cd-logo-mark">
            <i />
          </span>
          Caudal
        </div>
        <Nav items={MENU} etiqueta="Menú" />
        <Nav items={ANALISIS} etiqueta="Análisis" />
      </aside>

      <div className="cd-main">
        <header className="cd-topbar">
          <span
            className={`cd-badge ${conexion === "en-vivo" ? "cd-badge--positive" : conexion === "conectando" ? "cd-badge--warning" : "cd-badge--negative"}`}
            title="Los datos se actualizan solos cuando registras algo, en cualquier pestaña o dispositivo"
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
            <button
              className="cd-icon-btn"
              aria-label={tema === "dark" ? "Usar tema claro" : "Usar tema oscuro"}
              onClick={() => setTema(tema === "dark" ? "light" : "dark")}
            >
              <Icono nombre={tema === "dark" ? "sol" : "luna"} />
            </button>
            <button className="cd-btn cd-btn--primary solo-escritorio" onClick={() => abrir()}>
              <Icono nombre="mas" />
              Registrar
              <kbd style={{ opacity: 0.7, font: "600 12px var(--font-sans)" }}>N</kbd>
            </button>
          </div>
        </header>
        <main className="cd-content">
          <Outlet />
        </main>
      </div>

      <nav
        className="app-movil-nav"
        aria-label="Principal"
        style={{
          position: "fixed",
          left: 0,
          right: 0,
          bottom: 0,
          height: 84,
          padding: "8px 8px 20px",
          background: "var(--card)",
          borderTop: "1px solid var(--border)",
          gridTemplateColumns: "repeat(5, minmax(0, 1fr))",
          alignItems: "center",
          zIndex: 20,
        }}
      >
        {[MOVIL[0], MOVIL[1], null, MOVIL[2], "mas" as const].map((item, i) =>
          item === "mas" ? (
            <button
              key="mas"
              aria-expanded={masAbierto}
              aria-controls="menu-mas"
              onClick={() => setMasAbierto((x) => !x)}
              className="cd-stack"
              style={{
                alignItems: "center",
                gap: 4,
                border: 0,
                background: "none",
                color: masAbierto ? "var(--ink)" : "var(--ink-muted)",
                fontSize: 11,
                fontWeight: 600,
                font: "inherit",
              }}
            >
              <Icono nombre="menu" />
              <span style={{ fontSize: 11, fontWeight: 600 }}>Más</span>
            </button>
          ) : item ? (
            <Link
              key={item.a}
              to={item.a}
              activeOptions={{ exact: item.a === "/" }}
              className="cd-stack"
              style={{
                alignItems: "center",
                gap: 4,
                textDecoration: "none",
                color: "var(--ink-muted)",
                fontSize: 11,
                fontWeight: 600,
              }}
              activeProps={{ style: { color: "var(--ink)" }, "aria-current": "page" }}
            >
              <Icono nombre={item.icono} />
              {item.etiqueta}
            </Link>
          ) : (
            <button
              key={`mas-${i}`}
              aria-label="Registrar"
              onClick={() => abrir()}
              style={{
                justifySelf: "center",
                width: 56,
                height: 56,
                marginTop: -26,
                borderRadius: 999,
                border: 0,
                background: "var(--accent)",
                color: "var(--on-accent)",
                display: "grid",
                placeItems: "center",
                boxShadow: "var(--shadow-pop)",
              }}
            >
              <Icono nombre="mas" />
            </button>
          ),
        )}
      </nav>
      {masAbierto && (
        <div className="app-movil-mas" onClick={() => setMasAbierto(false)}>
          <nav
            id="menu-mas"
            aria-label="Más secciones"
            className="cd-card"
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              left: 12,
              right: 12,
              bottom: 96,
              display: "grid",
              gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
              gap: 6,
              padding: 12,
              zIndex: 30,
              boxShadow: "var(--shadow-pop)",
            }}
          >
            {EN_MAS.map((item) => (
              <Link
                key={item.a}
                to={item.a}
                onClick={() => setMasAbierto(false)}
                className="cd-stack"
                style={{
                  alignItems: "center",
                  gap: 6,
                  padding: "12px 4px",
                  borderRadius: "var(--radius-md)",
                  textDecoration: "none",
                  color: "var(--ink-muted)",
                  fontSize: 12,
                  fontWeight: 600,
                  textAlign: "center",
                }}
                activeProps={{
                  style: { color: "var(--ink)", background: "var(--card-raised)" },
                  "aria-current": "page",
                }}
              >
                <Icono nombre={item.icono} />
                {item.etiqueta}
              </Link>
            ))}
          </nav>
        </div>
      )}
    </div>
  );
}
