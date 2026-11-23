/**
 * «Más › Personalizar menú»: las cinco posiciones de la barra inferior. «Más» siempre está; las otras cuatro se
 * eligen entre todas las secciones. El orden se cambia arrastrando el asa de cada fila (con el dedo o el mouse);
 * con el teclado, el asa enfocada sube o baja con ↑ ↓. Cada cambio se ve al instante en la barra y se guarda en
 * este dispositivo.
 */
import { useEffect, useRef, useState, type PointerEvent as EventoPuntero } from "react";

import { guardarMenu, MENU_INICIAL, useMenuMovil, type Posicion } from "@/shared/lib/menuMovil";
import { DESTINOS_MENU, SECCIONES } from "@/shared/lib/secciones";
import { Desplegable } from "@/shared/ui/Desplegable";
import { Icono, type NombreIcono } from "@/shared/ui/Icono";

import { CabeceraMas } from "./MasPage";

const nombre = (p: Posicion) => (p === "mas" ? "Más" : SECCIONES[p].etiqueta);
const icono = (p: Posicion): NombreIcono => (p === "mas" ? "menu" : SECCIONES[p].icono);

/** Mueve el elemento de `desde` a `hasta` (los demás se corren). */
function mover<T>(lista: T[], desde: number, hasta: number): T[] {
  const nueva = [...lista];
  const [x] = nueva.splice(desde, 1);
  if (x !== undefined) nueva.splice(hasta, 0, x);
  return nueva;
}

export function PersonalizarMenuPage() {
  const menu = useMenuMovil();
  const [aviso, setAviso] = useState("");
  const [arrastre, setArrastre] = useState<{ i: number; dy: number; alto: number } | null>(null);
  const inicio = useRef(0);
  const asas = useRef(new Map<Posicion, HTMLButtonElement>());
  const enfocar = useRef<Posicion | null>(null);

  // Tras mover con el teclado, el foco sigue en el asa de la fila movida (las filas se reordenan en el DOM).
  useEffect(() => {
    if (!enfocar.current) return;
    asas.current.get(enfocar.current)?.focus();
    enfocar.current = null;
  }, [menu]);

  const reordenar = (desde: number, hasta: number) => {
    if (hasta === desde || hasta < 0 || hasta >= menu.length) return;
    const p = menu[desde] as Posicion;
    guardarMenu(mover(menu, desde, hasta));
    setAviso(`${nombre(p)}: posición ${hasta + 1} de ${menu.length}`);
  };
  const cambiar = (i: number, destino: Posicion) => {
    const nuevo = [...menu];
    const ya = nuevo.indexOf(destino);
    // Si ya estaba en la barra, intercambian lugar: nunca hay dos iguales.
    if (ya >= 0) nuevo[ya] = nuevo[i] as Posicion;
    nuevo[i] = destino;
    guardarMenu(nuevo);
    setAviso(`Posición ${i + 1}: ${nombre(destino)}`);
  };

  // Arrastre con el puntero: la fila sigue al dedo y las demás se corren para dejarle sitio.
  const destino = arrastre
    ? Math.max(0, Math.min(menu.length - 1, arrastre.i + Math.round(arrastre.dy / arrastre.alto)))
    : -1;
  const empezar = (i: number) => (e: EventoPuntero<HTMLButtonElement>) => {
    const fila = e.currentTarget.closest("li");
    if (!fila) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    inicio.current = e.clientY;
    setArrastre({ i, dy: 0, alto: fila.getBoundingClientRect().height });
  };
  const seguir = (e: EventoPuntero<HTMLButtonElement>) => {
    if (!arrastre) return;
    setArrastre({ ...arrastre, dy: e.clientY - inicio.current });
  };
  const soltar = () => {
    if (!arrastre) return;
    reordenar(arrastre.i, destino);
    setArrastre(null);
  };
  const desplazamiento = (k: number): number => {
    if (!arrastre) return 0;
    if (k === arrastre.i) return arrastre.dy;
    if (arrastre.i < k && k <= destino) return -arrastre.alto;
    if (destino <= k && k < arrastre.i) return arrastre.alto;
    return 0;
  };
  const igualInicial = menu.every((p, i) => p === MENU_INICIAL[i]);

  return (
    <div className="ajustes">
      <CabeceraMas titulo="Personalizar menú" />
      <p className="ajustes-nota" id="menu-instrucciones">
        Cinco accesos en la barra inferior, de izquierda a derecha. Arrastra el asa ⠿ para cambiar el orden (con el
        teclado: enfócala y usa ↑ ↓). Lo que quites sigue en «Más».
      </p>
      <ol
        className={`menu-posiciones ${arrastre ? "arrastrando" : ""}`}
        aria-label="Barra inferior, de izquierda a derecha"
      >
        {menu.map((p, i) => (
          <li
            key={p}
            className={`menu-posicion ${arrastre?.i === i ? "levantada" : ""}`}
            style={{ transform: desplazamiento(i) ? `translateY(${desplazamiento(i)}px)` : undefined }}
          >
            <button
              type="button"
              ref={(el) => {
                if (el) asas.current.set(p, el);
                else asas.current.delete(p);
              }}
              className="menu-asa"
              aria-label={`Mover ${nombre(p)}, posición ${i + 1} de ${menu.length}`}
              aria-describedby="menu-instrucciones"
              onPointerDown={empezar(i)}
              onPointerMove={seguir}
              onPointerUp={soltar}
              onPointerCancel={() => setArrastre(null)}
              onKeyDown={(e) => {
                const paso = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
                if (!paso) return;
                e.preventDefault();
                enfocar.current = p;
                reordenar(i, i + paso);
              }}
            >
              <span aria-hidden className="menu-asa-puntos" />
            </button>
            <span className="menu-posicion-ico" aria-hidden>
              <Icono nombre={icono(p)} pequeno />
            </span>
            {p === "mas" ? (
              <span className="menu-posicion-fija">
                Más <small>siempre visible</small>
              </span>
            ) : (
              <Desplegable
                className="cd-input menu-posicion-destino"
                aria-label={`Destino de la posición ${i + 1}`}
                value={p}
                onChange={(e) => cambiar(i, e.target.value as Posicion)}
              >
                {DESTINOS_MENU.map((id) => (
                  <option key={id} value={id}>
                    {SECCIONES[id].etiqueta}
                  </option>
                ))}
              </Desplegable>
            )}
          </li>
        ))}
      </ol>
      <p className="sr-only" aria-live="assertive">
        {aviso}
      </p>
      <button
        type="button"
        className="cd-btn cd-btn--ghost cd-btn--sm"
        disabled={igualInicial}
        onClick={() => {
          guardarMenu(MENU_INICIAL);
          setAviso("Menú restablecido");
        }}
      >
        Restablecer menú
      </button>
    </div>
  );
}
