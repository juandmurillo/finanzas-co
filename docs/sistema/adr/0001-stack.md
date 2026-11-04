# ADR-0001 — Stack: FastAPI + SQLite + React/Vite

- **Estado:** aceptada · 28-oct-2026
- **Contexto:** app local de un solo usuario. Ya existe lógica en Python: clasificación de movimientos, amortización de créditos y exportación a Excel con openpyxl. La interfaz se diseña aparte y se entrega en React/HTML + Tailwind. En el equipo hay Node 24 y Python 3.14.
- **Decisión:**
  - Backend en Python con FastAPI, SQLAlchemy 2, Pydantic v2 y Alembic, sobre SQLite.
  - Frontend con React 19, TypeScript, Vite, Tailwind v4, shadcn/ui, TanStack Query/Router y ECharts.
  - Tipos del frontend generados desde el OpenAPI del backend.
- **Alternativas descartadas:**
  - **Full-stack TypeScript** (Next.js/Hono + Drizzle): habría que reescribir la lógica Python ya validada y el exportador Excel.
  - **Firefly III o Actual Budget autoalojados:** no cubren créditos colombianos ni el análisis propio, y personalizar su interfaz es costoso.
  - **Postgres:** demasiada administración para un solo usuario local.
- **Consecuencias:**
  - Hay dos runtimes (Python y Node) que se arrancan juntos con `iniciar.bat`.
  - Si Python 3.14 no tiene wheels de alguna dependencia, el backend usa un entorno virtual con Python 3.12 gestionado por `uv`.
