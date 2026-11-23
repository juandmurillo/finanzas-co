/**
 * Zona de un gráfico con periodo. En el celular, deslizar a los lados recorre la serie como si fuera continua:
 * solo la serie dibujada y las etiquetas del eje X (las capas `.capa-desliza`) siguen al dedo; el marco, el eje
 * Y, el título, la leyenda y el botón de filtro quedan fijos. Al soltar pasado el umbral, la serie sale por un
 * lado, el periodo cambia (encabezado y datos a la vez) y la del periodo nuevo entra por el otro; si no, vuelve
 * a su lugar. En el primer periodo con datos o en el actual, el arrastre ofrece resistencia, rebota y avisa.
 *
 * El gesto horizontal no compite con el desplazamiento vertical (`touch-action: pan-y`) ni con el toque que
 * consulta un dato (un deslizamiento corto o vertical no cuenta, y el clic que acompaña al gesto se descarta).
 * Las flechas ‹ › del control de periodo son la alternativa accesible. Sin capas marcadas, se mueve el gráfico
 * completo.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

import { CURVA_SALIDA, intensidadActual } from "@/shared/lib/movimiento";

import { enLimiteAtras, usePrimerMes, type NavPeriodo } from "./Periodo";

const UMBRAL = 56; // px horizontales para cambiar de periodo
const DECIDIR = 10; // px antes de decidir si el gesto es horizontal o vertical
const DURACION = { ninguna: 0, reducida: 110, maxima: 240 } as const;

export function ZonaPeriodo({
  nav,
  cargando = false,
  children,
}: {
  nav: NavPeriodo;
  /** Datos del periodo nuevo aún en camino (se muestran los anteriores, atenuados). */
  cargando?: boolean;
  children: ReactNode;
}) {
  const primerMes = usePrimerMes();
  const navegable = nav.preset !== "todo" && Boolean(nav.periodo.desde);
  const limiteAtras = enLimiteAtras(nav, primerMes);
  const limiteAdelante = nav.pasos === 0;
  const contenido = useRef<HTMLDivElement>(null);
  const zona = useRef<HTMLDivElement>(null);
  /** Mientras se arrastra (y tras cambiar de periodo, hasta el siguiente toque) no se muestra el globo de consulta. */
  // Va en un atributo (no en className): React reescribe className al cambiar el estado de carga.
  const marcar = (gesto: "arrastrando" | "deslizado", si: boolean) => {
    const el = zona.current;
    if (!el) return;
    if (si) el.dataset.gesto = gesto;
    else if (el.dataset.gesto === gesto) delete el.dataset.gesto;
  };
  const gesto = useRef<{ x: number; y: number; eje: "h" | "v" | null; dx: number; bruto: number } | null>(null);
  const deslizo = useRef(false);
  const entrada = useRef<{ clave: string; desde: number } | null>(null);
  // Cada rebote trae su propia marca de tiempo: el aviso se reinicia aunque el texto sea el mismo.
  const [aviso, setAviso] = useState<{ texto: string; t: number } | null>(null);
  const clave = `${nav.periodo.desde ?? ""}|${nav.periodo.hasta ?? ""}`;

  /** Capas que se deslizan (serie y eje X); sin ellas, el contenido completo. */
  const capas = (): HTMLElement[] => {
    const raiz = contenido.current;
    if (!raiz) return [];
    const marcadas = [...raiz.querySelectorAll<HTMLElement>(".capa-desliza")];
    return marcadas.length ? marcadas : [raiz];
  };
  const fijar = (x: number) => capas().forEach((c) => (c.style.transform = x ? `translateX(${x}px)` : ""));
  const mover = (desde: number, hasta: number, alTerminar?: () => void) => {
    const dur = DURACION[intensidadActual()];
    const lista = capas();
    lista.forEach((c) => {
      c.getAnimations?.().forEach((a) => a.cancel());
      c.style.transform = "";
    });
    if (!dur || typeof lista[0]?.animate !== "function") {
      fijar(hasta);
      alTerminar?.();
      return;
    }
    lista.forEach((c) =>
      c.animate([{ transform: `translateX(${desde}px)` }, { transform: `translateX(${hasta}px)` }], {
        duration: dur,
        easing: CURVA_SALIDA,
        fill: "forwards",
      }),
    );
    // El cierre corre una sola vez al acabar el movimiento (por tiempo: no depende de que el motor emita «finish»).
    if (alTerminar) setTimeout(alTerminar, dur);
  };

  useEffect(() => {
    if (!aviso) return;
    const t = setTimeout(() => setAviso(null), 1800);
    return () => clearTimeout(t);
  }, [aviso]);

  // Llegaron los datos del periodo nuevo: la serie entra desde el lado opuesto al que salió.
  useLayoutEffect(() => {
    const e = entrada.current;
    if (!e || cargando || e.clave === clave) return;
    entrada.current = null;
    mover(e.desde, 0, () => capas().forEach((c) => c.getAnimations?.().forEach((a) => a.cancel())));
  });

  const rebotar = (texto: string, desde: number) => {
    setAviso({ texto, t: Date.now() });
    mover(desde, 0, () => capas().forEach((c) => c.getAnimations?.().forEach((a) => a.cancel())));
  };
  /** `bruto`: lo que se movió el dedo (decide); `dx`: dónde quedó la serie (con resistencia en un límite). */
  const soltar = (bruto: number, dx: number) => {
    const ancho = contenido.current?.clientWidth ?? 320;
    if (Math.abs(bruto) < UMBRAL) {
      mover(dx, 0, () => capas().forEach((c) => c.getAnimations?.().forEach((a) => a.cancel())));
      return;
    }
    deslizo.current = true;
    const atras = bruto > 0;
    if (atras && limiteAtras) return rebotar("No hay datos antes de este periodo", dx);
    if (!atras && limiteAdelante) return rebotar("Ya estás en el periodo actual", dx);
    // Sale por el lado del gesto; la serie nueva entrará por el contrario cuando lleguen sus datos.
    const salida = atras ? ancho : -ancho;
    mover(dx, salida, () => {
      entrada.current = { clave, desde: -salida };
      if (atras) nav.anterior();
      else nav.siguiente();
    });
  };

  if (!navegable) return <>{children}</>;
  return (
    <div
      ref={zona}
      className={`zona-periodo ${cargando ? "actualizando" : ""}`}
      aria-busy={cargando || undefined}
      onPointerDown={(e) => {
        if (e.pointerType === "mouse") return; // con mouse se usan ‹ ›
        gesto.current = { x: e.clientX, y: e.clientY, eje: null, dx: 0, bruto: 0 };
        deslizo.current = false;
        marcar("deslizado", false);
      }}
      onPointerMove={(e) => {
        const g = gesto.current;
        if (!g) return;
        const dx = e.clientX - g.x;
        const dy = e.clientY - g.y;
        if (!g.eje && Math.max(Math.abs(dx), Math.abs(dy)) > DECIDIR) {
          g.eje = Math.abs(dx) > Math.abs(dy) * 1.2 ? "h" : "v";
          if (g.eje === "h") {
            marcar("arrastrando", true);
            capas().forEach((c) => c.getAnimations?.().forEach((a) => a.cancel()));
          }
        }
        if (g.eje !== "h") return;
        // Sigue al dedo; hacia un lado sin datos, con resistencia.
        const sinDatos = (dx > 0 && limiteAtras) || (dx < 0 && limiteAdelante);
        g.bruto = dx;
        g.dx = sinDatos ? dx * 0.25 : dx;
        fijar(g.dx);
      }}
      onPointerUp={() => {
        const g = gesto.current;
        gesto.current = null;
        marcar("arrastrando", false);
        if (g?.eje === "h") {
          marcar("deslizado", Math.abs(g.bruto) >= UMBRAL);
          soltar(g.bruto, g.dx);
        }
      }}
      onPointerCancel={() => {
        const g = gesto.current;
        gesto.current = null;
        marcar("arrastrando", false);
        if (g?.eje === "h") mover(g.dx, 0);
      }}
      // Tras un deslizamiento, el clic que lo acompaña no debe consultar ni abrir una barra.
      onClickCapture={(e) => {
        if (!deslizo.current) return;
        deslizo.current = false;
        e.stopPropagation();
        e.preventDefault();
      }}
    >
      <p className="sr-only">Desliza a los lados para cambiar de periodo, o usa el botón de periodo.</p>
      <div ref={contenido} className="zona-periodo-contenido">
        {children}
      </div>
      <p className={`zona-periodo-aviso ${aviso ? "visible" : ""}`} role="status" aria-live="polite">
        {aviso?.texto}
      </p>
    </div>
  );
}
