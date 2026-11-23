import type { Session } from "@supabase/supabase-js";
import { auth } from "./cuentaCaudal";

const SIN_VINCULAR = "Libro sin vincular";
const OTRO_LIBRO = "Tu cuenta usa otro libro";

export type DecisionUnion = "subir" | "cuenta" | "equipo" | "combinar";
export interface ResumenLibro {
  cuentas?: number;
  movimientos?: number;
  guardada_en?: string | null;
}
export interface SituacionUnion {
  caso: "nuevo" | "mismo" | "descargar" | "elegir" | "sin_instantanea";
  decisiones: DecisionUnion[];
  equipo: ResumenLibro;
  cuenta: ResumenLibro | null;
}
export interface ResultadoUnion {
  decision: DecisionUnion;
  respaldo: string | null;
  combinado: { cuentas: number; categorias: number; movimientos: number; repetidos: number; sueltos: number } | null;
}

const eventos = new EventTarget();
let estado = "";
let titular = "";
let ocupado = false;
export const estadoActual = () => estado;
export function escuchar(fn: () => void) {
  eventos.addEventListener("estado", fn);
  return () => eventos.removeEventListener("estado", fn);
}
function mostrar(texto: string) {
  estado = texto;
  eventos.dispatchEvent(new Event("estado"));
}
export async function pasar(sesion: Session, vincular = false) {
  if (ocupado || sesion.user.id !== titular) return;
  if (!window.isSecureContext) {
    mostrar("La sincronización requiere HTTPS o acceso local.");
    return;
  }
  if (!navigator.onLine) {
    mostrar("Sin conexión. Cambios guardados en este equipo.");
    return;
  }
  ocupado = true;
  mostrar("Comprobando sincronización…");
  try {
    // Tras un reinicio o un rato sin red el token pudo caducar: getSession lo renueva antes de usarlo.
    const vigente = auth ? await auth.getSession() : { data: { session: sesion }, error: null };
    if (vigente.error) {
      mostrar("No se pudo conectar. Los cambios siguen en este equipo.");
      return;
    }
    if (!vigente.data.session) {
      mostrar("Vuelve a iniciar sesión para sincronizar. Los cambios siguen en este equipo.");
      return;
    }
    const respuesta = await fetch("/api/v1/sync/ejecutar" + (vincular ? "?vincular=true" : ""), {
      method: "POST",
      headers: { Authorization: `Bearer ${vigente.data.session.access_token}` },
    });
    const datos = await respuesta.json();
    if (titular !== sesion.user.id) return;
    if (!respuesta.ok) {
      mostrar(datos.detail || "No se pudo sincronizar");
      return;
    }
    const revisar = Number(datos.por_revisar ?? 0);
    mostrar(
      datos.estado === "sin_vincular"
        ? SIN_VINCULAR
        : datos.estado === "otro_libro"
          ? OTRO_LIBRO
          : revisar > 0
            ? `Sincronizado. ${revisar === 1 ? "1 cambio por revisar" : `${revisar} cambios por revisar`}`
            : "Cambios compatibles sincronizados",
    );
    if (datos.cambios === "si") window.dispatchEvent(new Event("caudal:sincronizado"));
  } catch {
    if (titular === sesion.user.id) mostrar("No se pudo conectar. Los cambios siguen en este equipo.");
  } finally {
    ocupado = false;
  }
}

export function iniciarSync() {
  if (!auth) return;
  let sesion: Session | null = null;
  function actualizar() {
    if (sesion && !document.hidden) void pasar(sesion);
  }
  auth.onAuthStateChange((_evento, actual) => {
    sesion = actual;
    titular = actual?.user.id ?? "";
    mostrar("");
    actualizar();
  });
  window.addEventListener("online", actualizar);
  document.addEventListener("visibilitychange", actualizar);
  window.setInterval(() => {
    if (estado !== SIN_VINCULAR && estado !== OTRO_LIBRO) actualizar();
  }, 15000);
}

/** Este equipo aún no se ha unido al libro de la cuenta (o la cuenta pasó a usar otro). */
export const necesitaUnirse = (texto: string) => texto === SIN_VINCULAR || texto === OTRO_LIBRO;

async function conSesion(ruta: string, init: RequestInit = {}) {
  const vigente = auth ? await auth.getSession() : null;
  const token = vigente?.data.session?.access_token;
  if (!token) throw new Error("Vuelve a iniciar sesión.");
  const respuesta = await fetch(ruta, {
    ...init,
    headers: { ...init.headers, Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
  });
  const datos = await respuesta.json();
  if (!respuesta.ok) throw new Error(typeof datos.detail === "string" ? datos.detail : "No se pudo completar");
  return datos;
}

export const situacionUnion = (): Promise<SituacionUnion> => conSesion("/api/v1/sync/union");

export async function unirLibro(decision: DecisionUnion): Promise<ResultadoUnion> {
  const resultado = (await conSesion("/api/v1/sync/union", {
    method: "POST",
    body: JSON.stringify({ decision }),
  })) as ResultadoUnion;
  window.dispatchEvent(new Event("caudal:sincronizado"));
  return resultado;
}
