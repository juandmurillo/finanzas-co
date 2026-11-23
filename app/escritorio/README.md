# Caudal de escritorio (Windows)

Una ventana nativa con WebView2, el que ya trae Windows, sobre la API portátil. Es la misma de Android: `finanzas/portatil.py`, con un secreto nuevo en cada arranque y la interfaz servida por la API. El código está en `app/backend/src/finanzas/escritorio.py`.

- **Datos.** Viven en `%LOCALAPPDATA%\Caudal\datos`, fuera de la carpeta de instalación: actualizar o desinstalar no los borra. `CAUDAL_DATOS` cambia la carpeta.
- **Instancia única.** Abrir Caudal dos veces sobre la misma base muestra un aviso, y la segunda no arranca.
- **Cierre limpio.** Al cerrar la ventana se detiene la API. El registro queda en `escritorio.log`, en la carpeta de datos.
- **Instalación.** Es por usuario y sin administrador, en `%LOCALAPPDATA%\Programs\Caudal`.

## Compilar

Requisitos: `uv`, Node (para la interfaz) e Inno Setup 6 (`winget install JRSoftware.InnoSetup`). No hace falta Rust ni Visual Studio.

```powershell
.\construir.ps1
```

Crea un entorno propio (`.venv`, aparte del backend), compila la interfaz y deja en `salida\` la carpeta ejecutable (`Caudal\Caudal.exe`, ~47 MB) y el instalador (`Caudal-0.1.0-instalador.exe`, ~26 MB). `caudal.ico` se genera con `icono.py` si falta.

Para el piloto de sincronización: `.\construir.ps1 -Web ..\..\data\piloto\web -SyncJson ..\..\data\piloto\sync.json`. El archivo `sync.json` lleva `{"receptor": "supabase+https://…", "apikey": "sb_publishable_…"}`.

`-Version 1.2.3` define la versión del instalador. Con `CAUDAL_PFX` (un certificado `.pfx` de firma de código) y `CAUDAL_PFX_PASSWORD` se firman `Caudal.exe` y el instalador con `signtool`. La CI pública (`.github/workflows/paquetes.yml` en finanzas-co) hace lo mismo en cada etiqueta `v*`.

## Probar sin instalar

```powershell
$env:CAUDAL_DATOS = "C:\ruta\a\una\copia"; .venv\Scripts\python.exe -m finanzas.escritorio
```
