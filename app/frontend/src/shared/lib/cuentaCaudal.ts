import { createClient, type SupportedStorage } from "@supabase/supabase-js";

const RUTA = "/api/v1/sync/sesion/";

/**
 * La sesión no va a localStorage: la API local la guarda cifrada por el sistema junto al libro.
 * Así sobrevive a reinicios y, sin red, el equipo vinculado sigue registrando con su copia local.
 * Si la API no responde, se comporta como si no hubiera sesión guardada.
 */
export const almacenSesion: SupportedStorage = {
  async getItem(clave) {
    try {
      const r = await fetch(RUTA + encodeURIComponent(clave), { cache: "no-store" });
      return r.ok ? (((await r.json()) as { valor: string | null }).valor ?? null) : null;
    } catch {
      return null;
    }
  },
  async setItem(clave, valor) {
    await fetch(RUTA + encodeURIComponent(clave), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valor }),
    });
  },
  async removeItem(clave) {
    await fetch(RUTA + encodeURIComponent(clave), { method: "DELETE" });
  },
};

const origen = import.meta.env.VITE_SUPABASE_URL;
const clave = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

const TIPOS_ENLACE = ["magiclink", "signup", "email", "invite"] as const;
export type Verificacion = { token: string } | { token_hash: string; type: (typeof TIPOS_ENLACE)[number] };

/**
 * Lo que la persona pega tras recibir el correo: el código de 6 dígitos o el enlace «Sign in».
 * Del enlace solo se usa su token de un solo uso, verificado sin abrir el navegador (sirve igual en
 * el teléfono). Un enlace de otro dominio se rechaza.
 */
export function verificacionDelCorreo(texto: string, proyecto: string | undefined = origen): Verificacion | null {
  const limpio = texto.trim();
  if (/^\d{6,10}$/.test(limpio)) return { token: limpio };
  let url: URL;
  try {
    url = new URL(limpio);
  } catch {
    return null;
  }
  if (!proyecto || url.origin !== new URL(proyecto).origin || !url.pathname.endsWith("/auth/v1/verify")) return null;
  const token = url.searchParams.get("token") ?? "";
  const tipo = url.searchParams.get("type") ?? "email";
  // pkce_: el enlace exige el verificador del navegador que lo pidió; este cliente usa el flujo implícito.
  if (!token || token.startsWith("pkce_")) return null;
  return TIPOS_ENLACE.includes(tipo as (typeof TIPOS_ENLACE)[number])
    ? { token_hash: token, type: tipo as (typeof TIPOS_ENLACE)[number] }
    : null;
}
const configurado =
  typeof origen === "string" &&
  origen.startsWith("https://") &&
  typeof clave === "string" &&
  clave.startsWith("sb_publishable_");

/** Clave fija de la sesión: la misma para cualquier navegador que abra este equipo. */
export const CLAVE_SESION = configurado ? `sb-${new URL(origen).hostname.split(".")[0]}-auth-token` : "";

export const auth = configurado
  ? createClient(origen, clave, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // Abrir el enlace del correo vuelve a este equipo con la sesión en la URL: se recoge y se
        // guarda en la API local, así la ve también la pestaña que pidió el correo.
        detectSessionInUrl: true,
        flowType: "implicit",
        storage: almacenSesion,
        storageKey: CLAVE_SESION,
      },
    }).auth
  : null;
