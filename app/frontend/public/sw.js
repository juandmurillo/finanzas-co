/* Service worker de la PWA (fase 5).
 * - La interfaz (HTML, JS, CSS, íconos) se guarda para abrir sin red.
 * - La API nunca se guarda: los datos siempre vienen de tu base local, al día. */
const VERSION = "caudal-v1";
const NUCLEO = ["/", "/manifest.webmanifest", "/iconos/icono-192.png", "/iconos/icono-512.png"];

self.addEventListener("install", (evento) => {
  evento.waitUntil(caches.open(VERSION).then((c) => c.addAll(NUCLEO)));
  self.skipWaiting();
});

self.addEventListener("activate", (evento) => {
  evento.waitUntil(
    caches
      .keys()
      .then((claves) => Promise.all(claves.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (evento) => {
  const { request } = evento;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    // Red primero: si no hay, la última interfaz guardada (las rutas son del lado del cliente).
    evento.respondWith(
      fetch(request)
        .then((r) => {
          const copia = r.clone();
          caches.open(VERSION).then((c) => c.put("/", copia));
          return r;
        })
        .catch(() => caches.match("/")),
    );
    return;
  }
  // Archivos con hash de Vite y fuentes: caché primero.
  evento.respondWith(
    caches.match(request).then(
      (guardado) =>
        guardado ??
        fetch(request).then((r) => {
          if (r.ok) {
            const copia = r.clone();
            caches.open(VERSION).then((c) => c.put(request, copia));
          }
          return r;
        }),
    ),
  );
});
