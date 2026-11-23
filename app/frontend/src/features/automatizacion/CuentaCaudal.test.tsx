import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";

it("solicita un código, mantiene la sesión y avisa lo pendiente antes de cerrarla", async () => {
  vi.stubEnv("VITE_SUPABASE_URL", "https://prueba.example");
  vi.stubEnv("VITE_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_prueba");
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ vinculado: true, titular: "t", pendientes: 2, por_revisar: 0 })),
  );
  const email = "persona@example.org";
  let actualizar: (evento: string, sesion: object | null) => void = () => {};
  const cliente = {
    onAuthStateChange: (fn: typeof actualizar) => {
      actualizar = fn;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    },
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    verifyOtp: vi
      .fn()
      .mockResolvedValueOnce({ error: {} })
      .mockImplementationOnce(async () => {
        const session = { user: { email } };
        actualizar("SIGNED_IN", session);
        return { data: { session }, error: null };
      }),
    signOut: vi.fn(async () => {
      actualizar("SIGNED_OUT", null);
      return { error: null };
    }),
  };
  vi.doMock("@supabase/supabase-js", () => ({ createClient: () => ({ auth: cliente }) }));
  try {
    const { CuentaCaudal } = await import("./CuentaCaudal");
    render(
      <QueryClientProvider client={new QueryClient()}>
        <CuentaCaudal />
      </QueryClientProvider>,
    );
    fireEvent.change(screen.getByLabelText("Correo electrónico"), { target: { value: email } });
    fireEvent.click(screen.getByRole("button", { name: "Enviar código" }));
    const codigo = await screen.findByLabelText("Código o enlace del correo");
    fireEvent.change(codigo, { target: { value: "123456" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar código" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    fireEvent.change(codigo, { target: { value: "654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Verificar código" }));
    fireEvent.click(await screen.findByRole("button", { name: "Cerrar sesión en este equipo" }));
    // Nada se cierra con un clic: primero se dice qué queda solo en este equipo.
    const confirmar = await screen.findByRole("group", { name: "Cerrar sesión" });
    expect(confirmar).toHaveTextContent("2 cambios están solo en este equipo");
    expect(cliente.signOut).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    expect(await screen.findByRole("button", { name: "Enviar código" })).toBeInTheDocument();
    expect(cliente.signInWithOtp).toHaveBeenCalledWith({ email });
    expect(cliente.verifyOtp).toHaveBeenLastCalledWith({ email, token: "654321", type: "email" });
    expect(cliente.signOut).toHaveBeenCalledWith({ scope: "local" });
  } finally {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.doUnmock("@supabase/supabase-js");
  }
});

it("acepta el código o el enlace del correo del mismo proyecto", async () => {
  const { verificacionDelCorreo } = await import("@/shared/lib/cuentaCaudal");
  const proyecto = "https://proyecto.supabase.co";
  const enlace = `${proyecto}/auth/v1/verify?token=abc123&type=magiclink&redirect_to=http://localhost:3000`;
  expect(verificacionDelCorreo(" 123456 ", proyecto)).toEqual({ token: "123456" });
  expect(verificacionDelCorreo(enlace, proyecto)).toEqual({ token_hash: "abc123", type: "magiclink" });
  expect(verificacionDelCorreo(enlace.replace("magiclink", "signup"), proyecto)).toEqual({
    token_hash: "abc123",
    type: "signup",
  });
  expect(verificacionDelCorreo(enlace.replace(proyecto, "https://otro.example"), proyecto)).toBeNull();
  expect(verificacionDelCorreo(enlace.replace("abc123", "pkce_abc"), proyecto)).toBeNull();
  expect(verificacionDelCorreo(enlace.replace("magiclink", "recovery"), proyecto)).toBeNull();
  expect(verificacionDelCorreo("hola", proyecto)).toBeNull();
});

it("guarda la sesión en la API local y sin respuesta actúa como si no hubiera", async () => {
  const { almacenSesion } = await import("@/shared/lib/cuentaCaudal");
  const peticiones = vi.fn<typeof fetch>(async (_url, init) =>
    init?.method ? new Response(null, { status: 204 }) : Response.json({ valor: "sesion" }),
  );
  vi.stubGlobal("fetch", peticiones);
  try {
    await almacenSesion.setItem("sb-proyecto-auth-token", "sesion");
    expect(peticiones).toHaveBeenLastCalledWith("/api/v1/sync/sesion/sb-proyecto-auth-token", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ valor: "sesion" }),
    });
    expect(await almacenSesion.getItem("sb-proyecto-auth-token")).toBe("sesion");
    peticiones.mockRejectedValueOnce(new TypeError("sin red"));
    expect(await almacenSesion.getItem("sb-proyecto-auth-token")).toBeNull();
    await almacenSesion.removeItem("sb-proyecto-auth-token");
    expect(peticiones).toHaveBeenLastCalledWith("/api/v1/sync/sesion/sb-proyecto-auth-token", { method: "DELETE" });
  } finally {
    vi.unstubAllGlobals();
  }
});
