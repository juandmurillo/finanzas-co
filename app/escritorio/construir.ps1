<#
.SYNOPSIS
  Construye Caudal de escritorio para Windows: carpeta ejecutable (PyInstaller) e instalador (Inno Setup).

.DESCRIPTION
  Usa un entorno propio (app\escritorio\.venv) para no tocar el del backend. Requisitos: uv, Node (para
  compilar la interfaz) e Inno Setup 6 (winget install JRSoftware.InnoSetup) para el instalador.

.PARAMETER Web
  Carpeta con la interfaz compilada. Por defecto compila app\frontend (npm run build).

.PARAMETER SyncJson
  Opcional: sync.json con {"receptor": "supabase+https://…", "apikey": "sb_publishable_…"}.

.EXAMPLE
  .\construir.ps1
  .\construir.ps1 -Web ..\..\data\piloto\web -SyncJson ..\..\data\piloto\sync.json
#>
param(
    [string]$Web,
    [string]$SyncJson,
    [string]$Version = "0.1.0",
    [switch]$SinInstalador
)

# Firma opcional: con CAUDAL_PFX (ruta a un certificado de firma de código .pfx) y CAUDAL_PFX_PASSWORD se firman
# Caudal.exe y el instalador. Sin certificado, Windows SmartScreen advertirá al instalar.
function Firmar([string]$archivo) {
    if (-not $env:CAUDAL_PFX) { return }
    $signtool = Get-ChildItem "${env:ProgramFiles(x86)}\Windows Kits\10\bin\*\x64\signtool.exe" -ErrorAction SilentlyContinue |
        Sort-Object FullName | Select-Object -Last 1
    if (-not $signtool) { throw "Hay certificado pero falta signtool (Windows SDK)" }
    & $signtool.FullName sign /fd SHA256 /td SHA256 /tr "http://timestamp.digicert.com" `
        /f $env:CAUDAL_PFX /p $env:CAUDAL_PFX_PASSWORD $archivo
    if ($LASTEXITCODE -ne 0) { throw "No se pudo firmar $archivo" }
}
# Sin ErrorActionPreference=Stop: en PowerShell 5.1 la salida informativa de uv y npm (stderr) contaría como
# error. Cada paso revisa $LASTEXITCODE.
$aqui = $PSScriptRoot
$app = Split-Path $aqui -Parent

if (-not (Test-Path "$aqui\.venv\Scripts\python.exe")) {
    uv venv "$aqui\.venv" --python 3.13 --system-certs
}
uv pip install --system-certs --python "$aqui\.venv\Scripts\python.exe" -e "$app\backend" "pywebview>=5" "pyinstaller>=6" "pillow>=10"
if ($LASTEXITCODE -ne 0) { throw "No se pudo preparar el entorno de compilación" }
if (-not (Test-Path "$aqui\caudal.ico")) { & "$aqui\.venv\Scripts\python.exe" "$aqui\icono.py" }

if (-not $Web) {
    $env:NODE_OPTIONS = "--use-system-ca"
    Push-Location "$app\frontend"
    npm run build
    $codigo = $LASTEXITCODE
    Pop-Location
    if ($codigo -ne 0) { throw "No se pudo compilar la interfaz" }
    $Web = "$app\frontend\dist"
}
$env:CAUDAL_WEB = (Resolve-Path $Web).Path
if ($SyncJson) { $env:CAUDAL_SYNC_JSON = (Resolve-Path $SyncJson).Path } else { Remove-Item Env:CAUDAL_SYNC_JSON -ErrorAction SilentlyContinue }

& "$aqui\.venv\Scripts\pyinstaller.exe" "$aqui\caudal.spec" --noconfirm --clean `
    --workpath "$aqui\salida\trabajo" --distpath "$aqui\salida"
if ($LASTEXITCODE -ne 0) { throw "PyInstaller falló" }
Firmar "$aqui\salida\Caudal\Caudal.exe"
Write-Host "Carpeta lista: $aqui\salida\Caudal\Caudal.exe"

if ($SinInstalador) { return }
$iscc = @(
    "$env:LOCALAPPDATA\Programs\Inno Setup 6\ISCC.exe",
    "${env:ProgramFiles(x86)}\Inno Setup 6\ISCC.exe",
    "$env:ProgramFiles\Inno Setup 6\ISCC.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $iscc) { throw "Falta Inno Setup 6: winget install JRSoftware.InnoSetup" }
& $iscc "/DVersion=$Version" "$aqui\caudal.iss"
if ($LASTEXITCODE -ne 0) { throw "Inno Setup falló" }
Firmar "$aqui\salida\Caudal-$Version-instalador.exe"
Write-Host "Instalador listo: $aqui\salida\Caudal-$Version-instalador.exe"
