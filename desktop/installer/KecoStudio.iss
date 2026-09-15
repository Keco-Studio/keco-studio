#define AppName "Keco Studio"
#define AppVersion GetEnv('KECO_DESKTOP_VERSION')
#define SourceDir GetEnv('KECO_DESKTOP_SOURCE_DIR')
[Setup]
AppId={{BDE8A907-6D79-4E4D-98F3-07A564CE0A10}
AppName={#AppName}
AppVersion={#AppVersion}
DefaultDirName={localappdata}\Programs\Keco Studio
PrivilegesRequired=lowest
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64
OutputBaseFilename=Keco-Studio-Setup-{#AppVersion}-windows-x64
[Files]
Source: "{#SourceDir}\*"; DestDir: "{app}"; Flags: recursesubdirs ignoreversion
Source: "{#SourceDir}\WebView2Bootstrapper.exe"; DestDir: "{tmp}"; Flags: deleteafterinstall
[Icons]
Name: "{autoprograms}\Keco Studio"; Filename: "{app}\bin\keco-studio.exe"
[Run]
Filename: "{tmp}\WebView2Bootstrapper.exe"; Parameters: "/silent /install"; Check: not WebView2RuntimeInstalled; Flags: waituntilterminated
[UninstallDelete]
Type: filesandordirs; Name: "{app}"
[Code]
function WebView2RuntimeInstalled: Boolean;
var Version: String;
begin
  Result := RegQueryStringValue(HKLM64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7A0B8-1D0A-4D8E-9D35-BE49B5A7A7C1}', 'pv', Version) or RegQueryStringValue(HKCU64, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F1E7A0B8-1D0A-4D8E-9D35-BE49B5A7A7C1}', 'pv', Version);
end;
