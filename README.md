# Caudal · Finanzas

App local de finanzas personales para Colombia: tus datos viven en tu computador, en una base SQLite. Hecha para
quien tiene ingresos irregulares, créditos caros y quiere ver con claridad a dónde se va la plata.

> Las capturas y la demo usan datos **ficticios**: una persona inventada, generada con semilla fija.

![Registrar un gasto y ver cómo se recalculan el saldo y los gastos](docs/capturas/caudal-demo.gif)



https://github.com/user-attachments/assets/19c2f237-1216-46fd-a10f-8276519e8d2f



![Inicio](docs/capturas/inicio.jpg)

| Gráficas de Inicio | Gráficas de flujo de caja |
|---|---|
| ![Gráficas de Inicio](docs/capturas/inicio-graficas.jpg) | ![Gráficas de flujo de caja](docs/capturas/flujo-graficas.jpg) |

| Deudas | Asistente |
|---|---|
| ![Deudas con simulador de abonos](docs/capturas/deudas.jpg) | ![Asistente](docs/capturas/agente.jpg) ![Proveedor y privacidad del asistente](docs/capturas/agente-proveedores.jpg) |

<img src="docs/capturas/celular.jpg" alt="Inicio en el celular" width="280">

## Qué hace

- **Captura rápida** de gastos, ingresos y transferencias, con sugerencia de categoría y actualización en vivo.
- **Inicio y flujo de caja**: Ingresos y Gastos con todo incluido, vencidos, próximos pagos, donas y mapa de calor.
- **Patrimonio neto**: cuentas, lo que te deben y activos, menos créditos y préstamos.
- **Activos e inversiones**: CDT, fondos, acciones, cripto, cesantías, inmuebles y vehículos, con valor, ganancia y
  rentabilidad. Aportar o vender no cuenta como gasto ni como ingreso.
- **Deudas**: amortización con extractos, costo real frente a la tasa de usura y simulador avalancha o bola de nieve.
- **Presupuesto** por grupos de categorías, **recurrentes** con calendario y saldo proyectado, y **metas**.
- **Préstamos con personas**, con alerta de costo tipo gota a gota.
- **Renta y aportes**: termómetro en UVT con tus activos, seguridad social e ingresos en USD con la TRM oficial.
- **Tus datos**: exporta en JSON, SQLite o Excel; carga con vista previa, restaura respaldos o borra todo.
- **Asistente opcional** con tu propia clave: Gemini, Groq, OpenRouter, Claude u Ollama en tu computador. Solo propone:
  tú revisas y confirmas.
- **PWA instalable** y respaldos diarios.

## Probarla

Requisitos: [uv](https://docs.astral.sh/uv/) y Node 22 o superior.

```bash
git clone https://github.com/juandmurillo/finanzas-co.git
cd finanzas-co/app/backend
uv sync
uv run finanzas migrar
uv run finanzas sembrar
uv run finanzas servir        # API en http://127.0.0.1:8000
```

En otra terminal:

```bash
cd finanzas-co/app/frontend
npm install
npm run dev                   # http://localhost:5173
```

La primera vez eliges entre **empezar con tus datos** o **explorar con datos de ejemplo** (también con
`uv run finanzas demo`). Después de instalar, `iniciar.bat` (Windows) o `./iniciar.sh` (macOS y Linux) levantan las dos
partes. Si tu red intercepta TLS, usa `uv --system-certs` y `NODE_OPTIONS=--use-system-ca`.

## Arquitectura

FastAPI, SQLAlchemy 2, Alembic y SQLite en el backend; React 19, Vite, TypeScript, TanStack Query y Router en el
frontend, con gráficos SVG propios. El dinero se guarda en centavos y las vistas se recalculan solas: cada cambio
publica un evento de dominio y la interfaz refresca por SSE solo lo afectado. Decisiones en
[`docs/sistema/adr/`](docs/sistema/adr/) y esquema en [`docs/sistema/03_MODELO_DATOS.sql`](docs/sistema/03_MODELO_DATOS.sql).

## Privacidad y seguridad

- La API solo escucha en `127.0.0.1` y rechaza escrituras de otros orígenes y hosts ajenos.
- La única llamada externa por defecto es la TRM en datos.gov.co.
- El asistente está apagado hasta que aceptas, y cambiar de proveedor pide aceptar de nuevo. La clave es tuya, se guarda
  fuera de la base, no viaja en las copias y la API no la devuelve. Con Ollama, nada sale de tu computador.
- Un archivo cargado se valida en una base temporal antes de tocar tus datos, y antes de reemplazarlos se hace un
  respaldo.
- `data/` y `.env` están fuera del repositorio. Las pruebas usan datos ficticios y CI corre gitleaks.
- Sin PIN por ahora: si la abres en tu red local, hazlo solo en una Wi-Fi de confianza.

No es asesoría financiera, tributaria ni legal; verifica los valores vigentes (UVT, usura, TRM). La moneda y las reglas
son de Colombia.

## Calidad

```bash
cd app/backend && uv run pytest -q && uv run ruff check src tests && uv run mypy src
cd app/frontend && npm run typecheck && npm run lint && npm test
```

## Licencia

[MIT](LICENSE)
