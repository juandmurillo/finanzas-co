# Frontend · Caudal

Interfaz web de la app: React 19, Vite, TypeScript estricto, TanStack Query y Router, y CSS propio con tokens.

## Uso

```bash
cd app/frontend
npm install                                # con TLS interceptado: NODE_OPTIONS=--use-system-ca
npm run dev                                # http://localhost:5173 (proxy /api → 127.0.0.1:8000)
```

O desde la raíz: `iniciar.bat`, que levanta la API y la web y abre el navegador.

Para usarla desde el celular en la misma red Wi-Fi: `npm run dev:lan` y entra a la IP del PC con el puerto 5173. **No tiene contraseña todavía**: úsalo solo en redes de confianza (el PIN llega en la fase 5).

## Estructura

```
src/
  app/          router, layout (sidebar + topbar + barra móvil), secciones "próximamente"
  features/     captura · dashboard · transacciones · cuentas · deudas
  shared/
    api/        types.gen.ts (generado) + tipos.ts (reportes)
    lib/        api.ts, formato.ts (es-CO), queryKeys.ts, useEventosDominio.ts (SSE), tema.ts
    ui/         Icono, Dinero, Estados (cargando, vacío, error)
  styles/       tokens Caudal, componentes Caudal, app.css
```

## Cómo se actualiza solo

1. Una mutación (por ejemplo, la captura rápida) ajusta el saldo al instante (actualización optimista).
2. El backend guarda y publica un evento de dominio.
3. `useEventosDominio` lo recibe por `/api/v1/events` (SSE) e invalida solo las consultas afectadas (`queryKeys.ts`).

Resultado: registras un gasto en el celular y el dashboard del PC cambia sin recargar.

## Calidad

```bash
npm run typecheck && npm run lint && npm test
npm run api:tipos   # tras cambiar la API: cd ../backend && uv run --system-certs finanzas openapi
```
