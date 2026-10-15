; Installer for the RacingCoach Collector (Inno Setup 6): installs RacingCoach.Collector.exe in
; Program Files\RacingCoach Collector with a Start menu shortcut (and a desktop one if wanted) and an uninstaller.
; Built by .github/workflows/collector-release.yml:
;   ISCC /DAppVersion=1.2.3 /DPublishDir=<folder with the published exe> /O<output folder> RacingCoach.Collector.iss
; Laps (Documents\RacingCoach) and settings (%APPDATA%\RacingCoach) aren't touched by installing or uninstalling.
;
; The collector updates itself by running this installer (SelfUpdater.cs) with
;   /SILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE=1 [/LAUNCH=1]
; /UPDATE=1 waits for the running collector to save its last laps and close; /LAUNCH=1 starts the new one after.

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\RacingCoach.Collector\bin\publish"
#endif

#define AppName "RacingCoach Collector"
#define AppExe "RacingCoach.Collector.exe"
; The collector's single-instance mutex (Program.SingleInstanceName)
#define AppMutex "Local\RacingCoach.Collector"

[Setup]
; Never change the AppId: it's how Windows knows a new version replaces the installed one
AppId={{42DAF25B-80E9-43D3-8FBD-39561BCB6EDE}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=RacingCoach.app
VersionInfoVersion={#AppVersion}
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
OutputBaseFilename=RacingCoach.Collector.Setup
SetupIconFile=..\RacingCoach.Collector\Assets\collector.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#PublishDir}\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "Start {#AppName}"; Flags: nowait postinstall skipifsilent
; An update started with Restart Now
Filename: "{app}\{#AppExe}"; Flags: nowait runasoriginaluser; Check: LaunchAfterUpdate

[UninstallDelete]
; Left by the collector's own exe-replacing update, from before it was installed here
Type: files; Name: "{app}\{#AppExe}.old"
Type: files; Name: "{app}\{#AppExe}.new"
Type: files; Name: "{app}\{#AppExe}.download"

[Code]
function CollectorRunning(): Boolean;
begin
  Result := CheckForMutexes('{#AppMutex}');
end;

// Asks until the collector is closed; False if the user cancels
function AskToCloseCollector(): Boolean;
begin
  Result := True;
  while CollectorRunning() do
    if SuppressibleMsgBox('The RacingCoach Collector is running. Close it, then click OK.',
        mbError, MB_OKCANCEL, IDCANCEL) = IDCANCEL then
    begin
      Result := False;
      Exit;
    end;
end;

function InitializeSetup(): Boolean;
var
  Waited: Integer;
begin
  // Started by the collector's update: it's still saving its last laps and giving uploads a few seconds
  if ExpandConstant('{param:UPDATE|0}') = '1' then
  begin
    Waited := 0;
    while CollectorRunning() and (Waited < 60000) do
    begin
      Sleep(250);
      Waited := Waited + 250;
    end;
  end;
  Result := AskToCloseCollector();
end;

function InitializeUninstall(): Boolean;
begin
  Result := AskToCloseCollector();
end;

function LaunchAfterUpdate(): Boolean;
begin
  Result := ExpandConstant('{param:LAUNCH|0}') = '1';
end;
