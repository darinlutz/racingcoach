; Installer for the RacingCoach.app Collector (Inno Setup 6.6 or later): installs RacingCoach.Collector.exe in
; Program Files\RacingCoach.app Collector with a Start menu shortcut (and a desktop one if wanted) and an uninstaller.
; Built by .github/workflows/collector-release.yml:
;   node scripts/exportLegal.mjs <legal folder>
;   ISCC /DAppVersion=1.2.3 /DPublishDir=<folder with the published exe> /DLegalDir=<legal folder> /O<output folder>
;        [/DSignTool=artifactsigning "/Sartifactsigning=<signtool command> $f"] RacingCoach.Collector.iss
; With SignTool, the compiler signs the uninstaller and the installer, and refuses an unsigned exe (signcheck).
; Laps (Documents\RacingCoach) and settings (%APPDATA%\RacingCoach) aren't touched by installing or uninstalling.
;
; Pages: Welcome, Terms of Service and Privacy Policy (an unchecked box that must be checked to go on), install
; folder (fresh installs only), desktop shortcut, Ready (with what the collector does over the network), Finish.
; Accepting writes HKLM\Software\RacingCoach.app\Collector\LegalAcceptance (the versions, when in UTC, the
; installer's version), which the collector reports to the user's account (src/app/api/collector/policy-acceptance).
;
; The collector updates itself by running this installer (SelfUpdater.cs) with
;   /SILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE=1 [/LAUNCH=1]
; /UPDATE=1 waits for the running collector to save its last laps and close; /LAUNCH=1 starts the new one after.
; A silent install where the collector isn't installed yet must accept the terms with /ACCEPTTERMS=1; a silent
; update keeps the acceptance recorded before.
;
; Branding (the RacingCoach.app logo, at every display scale) is in branding\, made by branding\generate.mjs.

#if Ver < EncodeVer(6, 6, 0)
  #error Inno Setup 6.6 or later is needed (its wizard image sizes and dark mode)
#endif

#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif
#ifndef PublishDir
  #define PublishDir "..\RacingCoach.Collector\bin\publish"
#endif
; The Terms of Service and Privacy Policy as HTML, and versions.iss with their versions (scripts/exportLegal.mjs)
#ifndef LegalDir
  #define LegalDir "legal"
#endif
#include AddBackslash(LegalDir) + "versions.iss"

#define AppName "RacingCoach.app Collector"
#define Publisher "Clarivex LLC"
#define AppExe "RacingCoach.Collector.exe"
; The collector's single-instance mutex (Program.SingleInstanceName)
#define AppMutex "Local\RacingCoach.Collector"
; Never change the AppId: it's how Windows knows a new version replaces the installed one
#define AppId "{42DAF25B-80E9-43D3-8FBD-39561BCB6EDE}"

#ifdef SignTool
  ; signcheck: the build fails if the collector's exe wasn't signed before the installer was built
  #define ExeFlags "ignoreversion signcheck"
#else
  #define ExeFlags "ignoreversion"
#endif

[Setup]
AppId={{#AppId}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#Publisher}
AppPublisherURL=https://racingcoach.app
AppSupportURL=https://racingcoach.app/support
AppUpdatesURL=https://github.com/darinlutz/racingcoach/releases/latest
AppCopyright=© 2026 {#Publisher}
VersionInfoVersion={#AppVersion}
VersionInfoCompany={#Publisher}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} Setup
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; The welcome page carries the logo (modern wizards hide it by default); the folder page shows on fresh installs
; only, as an update keeps the folder
DisableWelcomePage=no
DisableDirPage=auto
PrivilegesRequired=admin
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0
OutputBaseFilename=RacingCoach.Collector.Setup
SetupIconFile=..\RacingCoach.Collector\Assets\collector.ico
UninstallDisplayIcon={app}\{#AppExe}
UninstallDisplayName={#AppName}
Compression=lzma2/max
SolidCompression=yes
; Light or dark like Windows; the images suit both
WizardStyle=modern dynamic
; One image per display scale (100% to 250%); Setup picks the closest, so the logo stays sharp
WizardImageFile=branding\wizard-202x386.png,branding\wizard-269x515.png,branding\wizard-336x643.png,branding\wizard-403x772.png,branding\wizard-430x824.png,branding\wizard-498x953.png,branding\wizard-534x1022.png
WizardSmallImageFile=branding\header-58.png,branding\header-73.png,branding\header-87.png,branding\header-102.png,branding\header-116.png,branding\header-131.png,branding\header-145.png
#ifdef SignTool
SignTool={#SignTool}
SignedUninstaller=yes
#endif

[Messages]
WelcomeLabel1=Welcome to [name]
WelcomeLabel2=RacingCoach.app Collector connects your sim-racing telemetry to your AI-powered racing coach.%n%nThis will install [name/ver] on your computer.%n%nClose the collector before continuing if it's running.
FinishedLabel=[name] is installed. Open it from the Start menu, enter the upload key from your RacingCoach.app Account page, and your laps go to your coach as you drive.
ClickFinish=Click Finish to close Setup.

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "{#PublishDir}\{#AppExe}"; DestDir: "{app}"; Flags: {#ExeFlags}
; Offline copies of the documents accepted on the legal page (also opened from it, before installing)
Source: "{#LegalDir}\terms.html"; DestDir: "{app}\legal"; Flags: ignoreversion
Source: "{#LegalDir}\privacy.html"; DestDir: "{app}\legal"; Flags: ignoreversion

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon
Name: "{app}\legal\Terms of Service (online)"; Filename: "https://racingcoach.app/terms"
Name: "{app}\legal\Privacy Policy (online)"; Filename: "https://racingcoach.app/privacy"

[InstallDelete]
; The shortcuts from before the app was named RacingCoach.app Collector
Type: files; Name: "{autoprograms}\RacingCoach Collector.lnk"
Type: files; Name: "{autodesktop}\RacingCoach Collector.lnk"

[Registry]
; The acceptance of the Terms of Service and Privacy Policy on the legal page (or /ACCEPTTERMS=1), only when it was
; accepted in this run: a silent update keeps the one recorded before
Root: HKLM; Subkey: "Software\RacingCoach.app"; Flags: uninsdeletekeyifempty
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector"; Flags: uninsdeletekeyifempty
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector\LegalAcceptance"; Flags: uninsdeletekey; Check: AcceptedInThisRun
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector\LegalAcceptance"; ValueType: string; ValueName: "TermsVersion"; ValueData: "{#TermsVersion}"; Check: AcceptedInThisRun
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector\LegalAcceptance"; ValueType: string; ValueName: "PrivacyVersion"; ValueData: "{#PrivacyVersion}"; Check: AcceptedInThisRun
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector\LegalAcceptance"; ValueType: string; ValueName: "AcceptedAtUtc"; ValueData: "{code:AcceptedAtUtc}"; Check: AcceptedInThisRun
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector\LegalAcceptance"; ValueType: string; ValueName: "InstallerVersion"; ValueData: "{#AppVersion}"; Check: AcceptedInThisRun
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector\LegalAcceptance"; ValueType: string; ValueName: "AppVersion"; ValueData: "{#AppVersion}"; Check: AcceptedInThisRun
Root: HKLM; Subkey: "Software\RacingCoach.app\Collector\LegalAcceptance"; ValueType: string; ValueName: "Method"; ValueData: "{code:AcceptanceMethod}"; Check: AcceptedInThisRun

[Run]
Filename: "{app}\{#AppExe}"; Description: "Launch {#AppName}"; Flags: nowait postinstall skipifsilent runasoriginaluser
; An update started with Restart Now
Filename: "{app}\{#AppExe}"; Flags: nowait runasoriginaluser; Check: LaunchAfterUpdate

[UninstallDelete]
; Left by the collector's own exe-replacing update, from before it was installed here
Type: files; Name: "{app}\{#AppExe}.old"
Type: files; Name: "{app}\{#AppExe}.new"
Type: files; Name: "{app}\{#AppExe}.download"

[Code]
type
  TSystemTime = record
    Year, Month, DayOfWeek, Day, Hour, Minute, Second, Milliseconds: Word;
  end;

procedure GetSystemTime(var SystemTime: TSystemTime);
  external 'GetSystemTime@kernel32.dll stdcall';

var
  LegalPage: TInputOptionWizardPage;
  Accepted: Boolean;
  AcceptedAt: String;
  Method: String;

function CollectorRunning(): Boolean;
begin
  Result := CheckForMutexes('{#AppMutex}');
end;

// Asks until the collector is closed; False if the user cancels
function AskToCloseCollector(): Boolean;
begin
  Result := True;
  while CollectorRunning() do
    if SuppressibleMsgBox('RacingCoach.app Collector is running. Close it, then click OK.',
        mbError, MB_OKCANCEL, IDCANCEL) = IDCANCEL then
    begin
      Result := False;
      Exit;
    end;
end;

// The collector is installed already (this is an update)
function PreviouslyInstalled(): Boolean;
begin
  Result := RegKeyExists(HKLM64, 'Software\Microsoft\Windows\CurrentVersion\Uninstall\{#AppId}_is1');
end;

function UtcNow(): String;
var
  Now: TSystemTime;
begin
  GetSystemTime(Now);
  Result := Format('%.4d-%.2d-%.2dT%.2d:%.2d:%.2dZ', [Now.Year, Now.Month, Now.Day, Now.Hour, Now.Minute, Now.Second]);
end;

procedure Accept(How: String);
begin
  Accepted := True;
  AcceptedAt := UtcNow();
  Method := How;
  Log(Format('Terms of Service %s and Privacy Policy %s accepted (%s) at %s', ['{#TermsVersion}', '{#PrivacyVersion}', How, AcceptedAt]));
end;

function InitializeSetup(): Boolean;
var
  Waited: Integer;
begin
  // Installing silently needs the terms accepted on the command line, unless this updates an installed collector
  // (whose user accepted them when it was installed)
  if WizardSilent() then
  begin
    if ExpandConstant('{param:ACCEPTTERMS|0}') = '1' then
      Accept('silent install with /ACCEPTTERMS=1')
    else if not PreviouslyInstalled() then
    begin
      Log('Silent install refused: the Terms of Service and Privacy Policy weren''t accepted (/ACCEPTTERMS=1)');
      SuppressibleMsgBox('Installing RacingCoach.app Collector silently requires accepting the RacingCoach.app Terms of Service ' +
        '(https://racingcoach.app/terms) and Privacy Policy (https://racingcoach.app/privacy) with /ACCEPTTERMS=1.',
        mbCriticalError, MB_OK, IDOK);
      Result := False;
      Exit;
    end;
  end;

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

// Opens a document online (an href) or its offline copy in this installer (an id: terms or privacy), in the
// user's own browser rather than as administrator
procedure LegalLinkClick(Sender: TObject; const Link: string; LinkType: TSysLinkType);
var
  Target: String;
  ErrorCode: Integer;
begin
  if LinkType = sltID then
  begin
    ExtractTemporaryFile(Link + '.html');
    Target := ExpandConstant('{tmp}\') + Link + '.html';
  end
  else
    Target := Link;
  if not ShellExecAsOriginalUser('open', Target, '', '', SW_SHOWNORMAL, ewNoWait, ErrorCode) then
    MsgBox('Couldn''t open ' + Target + ': ' + SysErrorMessage(ErrorCode), mbError, MB_OK);
end;

// Next only works once the box is checked
procedure UpdateLegalNext();
begin
  if WizardForm.CurPageID = LegalPage.ID then
    WizardForm.NextButton.Enabled := LegalPage.Values[0];
end;

procedure LegalCheckClick(Sender: TObject);
begin
  UpdateLegalNext();
end;

procedure InitializeWizard();
var
  Links: TNewLinkLabel;
begin
  // A checklist rather than a plain checkbox, as only its items wrap onto a second line
  LegalPage := CreateInputOptionPage(wpWelcome,
    'Terms of Service and Privacy Policy',
    'Please read and accept them to install RacingCoach.app Collector.',
    'RacingCoach.app Collector is provided by {#Publisher} under the RacingCoach.app Terms of Service. ' +
      'Once you enter your upload key, it uploads the laps you drive, your race results and its activity log to ' +
      'your RacingCoach.app account; the Privacy Policy explains what is collected and how it is used.',
    False, False);
  LegalPage.Add('I have read and agree to the RacingCoach.app Terms of Service and acknowledge the Privacy Policy.');
  LegalPage.Values[0] := False;
  LegalPage.CheckListBox.OnClickCheck := @LegalCheckClick;

  Links := TNewLinkLabel.Create(LegalPage);
  Links.Parent := LegalPage.Surface;
  Links.Left := 0;
  Links.Top := LegalPage.SubCaptionLabel.Top + LegalPage.SubCaptionLabel.Height + ScaleY(12);
  Links.Width := LegalPage.SurfaceWidth;
  Links.Caption :=
    'Terms of Service (version {#TermsVersion}): <a href="https://racingcoach.app/terms">read online</a> · <a id="terms">offline copy</a>' + #13#10 +
    'Privacy Policy (version {#PrivacyVersion}): <a href="https://racingcoach.app/privacy">read online</a> · <a id="privacy">offline copy</a>';
  Links.OnLinkClick := @LegalLinkClick;
  WizardForm.AdjustLinkLabelHeight(Links);

  LegalPage.CheckListBox.Top := Links.Top + Links.Height + ScaleY(16);
  LegalPage.CheckListBox.Height := LegalPage.SurfaceHeight - LegalPage.CheckListBox.Top;
end;

procedure CurPageChanged(CurPageID: Integer);
begin
  if CurPageID = LegalPage.ID then
    UpdateLegalNext();
end;

function NextButtonClick(CurPageID: Integer): Boolean;
begin
  Result := True;
  // A silent install accepted (or was refused) in InitializeSetup
  if (CurPageID = LegalPage.ID) and not WizardSilent() then
  begin
    Result := LegalPage.Values[0];
    if Result then
      Accept('legal page in the installer');
  end;
end;

// Ready page: what the collector does once installed, before anything is installed
function UpdateReadyMemo(Space, NewLine, MemoUserInfoInfo, MemoDirInfo, MemoTypeInfo, MemoComponentsInfo,
  MemoGroupInfo, MemoTasksInfo: String): String;
begin
  Result := '';
  if MemoDirInfo <> '' then
    Result := Result + MemoDirInfo + NewLine + NewLine;
  if MemoTasksInfo <> '' then
    Result := Result + MemoTasksInfo + NewLine + NewLine;
  // The memo doesn't wrap, so each line fits its width
  Result := Result + 'What RacingCoach.app Collector does:' + NewLine +
    Space + 'Runs only while it''s open: no background service, no start with Windows' + NewLine +
    Space + 'Records your iRacing laps and, once you enter your upload key, uploads' + NewLine +
    Space + Space + 'them, your race results and its activity log to RacingCoach.app' + NewLine +
    Space + 'Gets AI coaching and the coach''s voice from RacingCoach.app' + NewLine +
    Space + 'Turns on iRacing''s telemetry recording (.ibt files) for track positions' + NewLine +
    Space + 'Checks GitHub for new versions; Windows asks you to allow each update';
end;

function AcceptedInThisRun(): Boolean;
begin
  Result := Accepted;
end;

function AcceptedAtUtc(Param: String): String;
begin
  Result := AcceptedAt;
end;

function AcceptanceMethod(Param: String): String;
begin
  Result := Method;
end;

function InitializeUninstall(): Boolean;
begin
  Result := AskToCloseCollector();
end;

function LaunchAfterUpdate(): Boolean;
begin
  Result := ExpandConstant('{param:LAUNCH|0}') = '1';
end;
