; Instalador de Caudal para Windows (Inno Setup 6). Lo llama construir.ps1 después de PyInstaller.
; Se instala por usuario (sin administrador) en %LOCALAPPDATA%\Programs\Caudal. Los datos viven aparte, en
; %LOCALAPPDATA%\Caudal\datos: actualizar o desinstalar no los borra.

#define Nombre "Caudal"
; construir.ps1 -Version pasa /DVersion=… (la etiqueta de la versión en la CI).
#ifndef Version
  #define Version "0.1.0"
#endif

[Setup]
AppId={{6E7C2A4B-3F1D-4C8E-9A57-0D2B6C9F1E43}
AppName={#Nombre}
AppVersion={#Version}
AppPublisher=Caudal
DefaultDirName={localappdata}\Programs\{#Nombre}
DefaultGroupName={#Nombre}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=salida
OutputBaseFilename=Caudal-{#Version}-instalador
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
UninstallDisplayIcon={app}\Caudal.exe
SetupIconFile=caudal.ico
CloseApplications=yes

[Languages]
Name: "es"; MessagesFile: "compiler:Languages\Spanish.isl"

[Tasks]
Name: "escritorio"; Description: "Crear un acceso directo en el escritorio"; Flags: unchecked

[Files]
Source: "salida\Caudal\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{autoprograms}\{#Nombre}"; Filename: "{app}\Caudal.exe"
Name: "{autodesktop}\{#Nombre}"; Filename: "{app}\Caudal.exe"; Tasks: escritorio

[Run]
Filename: "{app}\Caudal.exe"; Description: "Abrir Caudal"; Flags: nowait postinstall skipifsilent
