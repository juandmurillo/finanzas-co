# ADR-0002 — Dinero como entero en centavos

- **Estado:** aceptada · 28-oct-2026
- **Contexto:** los extractos bancarios traen centavos (ej. intereses de $ 1.234,56). Un `float` acumula errores, y las sumas deben cuadrar al peso con el análisis de referencia.
- **Decisión:**
  - Todo monto se guarda y se transporta como **entero en centavos**, con la moneda aparte. En la API: `{"monto": 4695118, "moneda": "COP"}`.
  - En el dominio, el value object `Dinero` (inmutable) es el único que hace aritmética.
  - Redondeo bancario (`ROUND_HALF_EVEN`) solo al convertir tasas o dividir.
  - En la UI se formatea con `Intl.NumberFormat('es-CO', {style:'currency', currency:'COP', maximumFractionDigits:0})`; los centavos se muestran únicamente en el detalle de créditos.
- **Consecuencias:**
  - Ninguna columna `REAL` guarda montos; las tasas sí son `REAL`.
  - Las pruebas con hypothesis verifican la propiedad: Σ divisiones = monto.
