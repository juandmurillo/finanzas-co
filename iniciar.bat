@echo off
REM Inicia Caudal · Finanzas: API en http://127.0.0.1:8000 y web en http://localhost:5173
REM La API respalda y migra la base antes de arrancar. Cierra las dos ventanas para detener todo.
cd /d "%~dp0"
start "Finanzas API" cmd /k "cd /d app\backend && uv run --system-certs finanzas servir"
start "Finanzas Web" cmd /k "cd /d app\frontend && npm run dev"
timeout /t 4 /nobreak >nul
start "" http://localhost:5173
