# ADR-0003 — Recálculo automático: derivados en vistas + eventos de dominio + SSE

- **Estado:** aceptada · 28-oct-2026
- **Contexto:** el usuario quiere que todo se actualice solo al registrar ingresos o salidas, en el PC y en el celular a la vez. Persistir totales trae el riesgo de que se desincronicen.
- **Decisión:**
  1. **Los derivados no se persisten:** saldos, totales y disponible salen de vistas SQL indexadas (`v_saldo_cuenta`, `v_movimiento_mensual`, `v_presupuesto_mes`).
  2. Los cálculos pesados (proyección de créditos, Sankey de 12 meses) se guardan en `cache_agregados` con versión y se invalidan por evento.
  3. Cada caso de uso, al confirmar el UnitOfWork, publica `DominioCambio{entidades, version}` en un bus en memoria.
  4. El endpoint `GET /api/v1/events` (Server-Sent Events) reenvía los eventos a todos los clientes.
  5. El frontend mantiene un mapa `entidad → queryKeys` y llama a `queryClient.invalidateQueries` solo para lo afectado. Las mutaciones propias usan actualización optimista.
- **Alternativas:**
  - **WebSockets:** son bidireccionales y no se necesitan; SSE reconecta solo y basta.
  - **Polling:** gasta recursos y tiene latencia.
  - **Triggers SQL que actualizan totales:** frágiles y difíciles de probar.
- **Consecuencias:**
  - Toda escritura debe pasar por un servicio que publique el evento; está prohibido escribir directo desde los routers.
  - Hay prueba de contrato: cada caso de uso declara qué entidades invalida.
