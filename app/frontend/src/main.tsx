// La fuente va empaquetada: la app no pide nada a internet y funciona sin conexión (también en Android).
import "@fontsource-variable/plus-jakarta-sans/wght.css";
import "./styles/app.css";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { router } from "./app/router";
import { CapturaProvider } from "./features/captura";
import { Avisos } from "./shared/ui/Avisos";
import { intensidadActual } from "./shared/lib/movimiento";
import { acentoInicial, pintarApariencia, temaInicial } from "./shared/lib/tema";

pintarApariencia(temaInicial(), acentoInicial());
intensidadActual(); // fija data-movimiento en <html> antes del primer render

// Los datos se refrescan por eventos SSE; no hace falta refetch al volver a la ventana.
const cliente = new QueryClient({
  defaultOptions: { queries: { staleTime: 30_000, refetchOnWindowFocus: false, retry: 1 } },
});

const contenedor = document.getElementById("root");
if (!contenedor) throw new Error("Falta #root en index.html");

createRoot(contenedor).render(
  <StrictMode>
    <QueryClientProvider client={cliente}>
      <CapturaProvider>
        <RouterProvider router={router} />
      </CapturaProvider>
      <Avisos />
    </QueryClientProvider>
  </StrictMode>,
);

// PWA: solo en producción (en desarrollo el service worker estorbaría la recarga en caliente).
// El navegador lo exige en un origen seguro: localhost o HTTPS.
if (import.meta.env.PROD && "serviceWorker" in navigator && window.isSecureContext) {
  window.addEventListener("load", () => void navigator.serviceWorker.register("/sw.js"));
}
