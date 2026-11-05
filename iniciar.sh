#!/usr/bin/env sh
# Inicia Caudal · Finanzas en macOS o Linux: API en http://127.0.0.1:8000 y web en http://localhost:5173.
# La API respalda y migra la base antes de arrancar. Ctrl+C detiene las dos.
set -e
cd "$(dirname "$0")"
(cd app/backend && uv run finanzas servir) &
API=$!
trap 'kill "$API" 2>/dev/null || true' EXIT INT TERM
cd app/frontend
[ -d node_modules ] || npm install
npm run dev
