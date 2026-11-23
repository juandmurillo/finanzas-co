import { expect, it, vi } from "vitest";
import type { Session } from "@supabase/supabase-js";

it("al recuperar conexión consulta el vínculo y solo lo crea con confirmación", async () => {
  const sesion = { user: { id: "persona" }, access_token: "prueba" } as Session;
  vi.doMock("./cuentaCaudal", () => ({
    auth: {
      onAuthStateChange: (fn: (e: string, s: Session) => void) => fn("SIGNED_IN", sesion),
      getSession: async () => ({ data: { session: sesion }, error: null }),
    },
  }));
  const peticiones = vi
    .fn<typeof fetch>()
    .mockImplementation(async () => new Response(JSON.stringify({ estado: "sin_vincular" })));
  vi.stubGlobal("fetch", peticiones);
  vi.stubGlobal("isSecureContext", true);
  try {
    const { iniciarSync, pasar, estadoActual } = await import("./syncCaudal");
    iniciarSync();
    await vi.waitFor(() => expect(estadoActual()).toBe("Libro sin vincular"));
    window.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(peticiones).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(estadoActual()).toBe("Libro sin vincular"));
    for (const llamada of peticiones.mock.calls) expect(llamada[0]).toBe("/api/v1/sync/ejecutar");
    await pasar(sesion, true);
    expect(peticiones).toHaveBeenLastCalledWith("/api/v1/sync/ejecutar?vincular=true", expect.anything());
  } finally {
    vi.unstubAllGlobals();
    vi.doUnmock("./cuentaCaudal");
  }
});
