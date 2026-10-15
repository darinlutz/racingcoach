using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// The collector's window: status of iRacing, lap recording, uploads and track positions; the session,
/// car and conditions; live inputs; this session's laps; and the activity log. It runs a CollectorEngine
/// and reads its state ten times a second. Also asks for the upload key the first time, or when
/// RacingCoach.app stops accepting it.
/// </summary>
public partial class MainWindow : Window
{
    private const double MetersPerSecondToMph = 2.23694;
    private const double MetersPerSecondToKph = 3.6;
    private const double LitersPerGallon = 3.78541;
    // How far the steering marker goes: a full lock this far either way reaches the end of its track
    private const double SteeringRangeDegrees = 270;
    // iRacing reports "no limit" as very large time and lap counts
    private const double UnlimitedSeconds = 86400 * 7 - 1;
    private const int UnlimitedLaps = 32767;
    private const int MaxActivityLines = 500;
    private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-US");

    private static readonly Brush Green = Brush("#2EB872");
    private static readonly Brush Amber = Brush("#E3A82B");
    private static readonly Brush Red = Brush("#F0707A");
    private static readonly Brush Blue = Brush("#3B8BFF");
    private static readonly Brush Grey = Brush("#6B6D74");
    private static readonly Brush Fg = Brush("#F3F4F6");
    private static readonly Brush Muted = Brush("#9A9CA3");
    private static readonly Brush BestRow = Brush("#1C2A40");

    private enum UploadSetupState { Checking, Off, NoKey, Refused, Active }

    private readonly CollectorOptions _options;
    private readonly CollectorEngine _engine;
    private readonly CancellationTokenSource _stop = new();
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    private readonly ObservableCollection<LapRow> _laps = [];
    private readonly ObservableCollection<ActivityRow> _activity = [];
    private Task? _run;

    private string _siteUrl = CollectorSettings.DefaultSiteUrl;
    private UploadSetupState _uploadState = UploadSetupState.Checking;
    private string? _offReason;
    private string? _account;
    // The session folder laps were last saved to this run; the lap list shows it
    private string? _currentFolder;
    private SessionLaps? _currentLaps;
    private bool _lapSavedThisRun;
    private string? _updateUrl;
    // The newer release being downloaded or installed, and whether closing should start it (Restart Now)
    private AvailableUpdate? _update;
    private bool _restartForUpdate;
    private bool _closing;
    private bool _closed;
    private OverlayWindow? _overlayWindow;
    private RotationWindow? _rotationWindow;
    private BrakePracticeWindow? _brakePracticeWindow;
    private TargetTelemetryWindow? _targetTelemetryWindow;
    // TelemetryEngine.js for the overlay and the Target Telemetry window's copies of its boxes, while either is open
    private OverlayFeed? _overlayFeed;

    internal MainWindow(CollectorOptions options)
    {
        InitializeComponent();
        _options = options;
        Title = $"RacingCoach Collector {UpdateCheck.Current}";
        LapsList.ItemsSource = _laps;
        ActivityList.ItemsSource = _activity;

        ActivityLog.Shared.Added += entry => Dispatcher.BeginInvoke(() => AddActivity(entry));
        _engine = new CollectorEngine(
            options,
            (message, isError) => ActivityLog.Shared.Write(message, isError),
            laps => Dispatcher.BeginInvoke(() => OnLapsChanged(laps)));

        _timer.Tick += (_, _) => Refresh();
        Loaded += async (_, _) => await StartAsync();
        SourceInitialized += (_, _) => UseDarkTitleBar();
    }

    // Windows 10 (20H1+) and 11 draw the title bar dark when asked; older versions ignore this
    private void UseDarkTitleBar()
    {
        const int DwmwaUseImmersiveDarkMode = 20;
        var enabled = 1;
        _ = DwmSetWindowAttribute(new System.Windows.Interop.WindowInteropHelper(this).Handle, DwmwaUseImmersiveDarkMode, ref enabled, sizeof(int));
    }

    [System.Runtime.InteropServices.DllImport("dwmapi.dll")]
    private static extern int DwmSetWindowAttribute(IntPtr hwnd, int attribute, ref int value, int size);

    private async Task StartAsync()
    {
        ActivityLog.Shared.Write($"RacingCoach Collector {UpdateCheck.Current} started. Laps are saved to {_engine.LapsFolder}");
        if (_engine.Playback)
            SubtitleText.Text = $"Playing back {Path.GetFileName(_engine.PlaybackFile)} at {_options.Speed}x";

        _run = Task.Run(async () =>
        {
            try
            {
                await _engine.RunAsync(_stop.Token);
            }
            catch (Exception e)
            {
                ActivityLog.Shared.Write($"The collector stopped: {e.Message}", isError: true);
            }
        });
        _timer.Start();
        Refresh();

        await SetUpUploadsAsync();

        if (await UpdateCheck.FindNewerAsync() is { } update)
            await GetUpdateAsync(update);
    }

    // ---------------------------------------------------------------- Updates

    // Downloads a newer release in the background; it installs on Restart Now or when the window closes.
    // Builds that can't replace themselves (dotnet run), and failed downloads, offer the release page instead.
    private async Task GetUpdateAsync(AvailableUpdate update)
    {
        _update = update;
        _updateUrl = update.PageUrl;
        UpdateBanner.Visibility = Visibility.Visible;
        if (!SelfUpdater.CanUpdate || update.DownloadUrl is null)
        {
            ShowManualUpdate($"RacingCoach Collector {update.Version} is available (you have {UpdateCheck.Current}). Download it, close this one and run the new one.");
            return;
        }

        UpdateButton.Visibility = Visibility.Collapsed;
        UpdateText.Text = $"Downloading RacingCoach Collector {update.Version}…";
        var progress = new Progress<double>(fraction =>
            UpdateText.Text = $"Downloading RacingCoach Collector {update.Version}… {fraction:P0}");
        try
        {
            await SelfUpdater.DownloadAsync(update, progress, _stop.Token);
            ActivityLog.Shared.Write($"Downloaded RacingCoach Collector {update.Version}; it installs when you restart or close the collector.");
            UpdateText.Text = $"RacingCoach Collector {update.Version} is ready (you have {UpdateCheck.Current}). Restart now to update, or it installs itself when you close the collector."
                + (SelfUpdater.UsesInstaller ? " Windows will ask you to allow it." : "");
            UpdateButton.Content = "Restart Now";
            UpdateButton.Visibility = Visibility.Visible;
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested)
        {
            // closing
        }
        catch (Exception e)
        {
            ActivityLog.Shared.Write($"Couldn't download RacingCoach Collector {update.Version}: {e.Message}", isError: true);
            ShowManualUpdate($"RacingCoach Collector {update.Version} is available, but downloading it failed ({e.Message}). Download it yourself, close this one and run the new one.");
        }
    }

    private void ShowManualUpdate(string text)
    {
        UpdateText.Text = text;
        UpdateButton.Content = "Download";
        UpdateButton.Visibility = Visibility.Visible;
    }

    private void UpdateButton_Click(object sender, RoutedEventArgs e)
    {
        if (!SelfUpdater.Ready)
        {
            Open(_updateUrl ?? UpdateCheck.ReleasesPage);
            return;
        }
        // The lap being driven is only saved once it's complete
        if (_engine.State == SimState.Connected && MessageBox.Show(this,
                "Restarting stops recording for a few seconds, and the lap you're on won't be saved. Restart now?",
                "Update RacingCoach Collector", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
            return;
        _restartForUpdate = true;
        Close();
    }

    // Called once the last laps are saved: swaps in the downloaded exe, and starts it after Restart Now
    private void InstallUpdate()
    {
        if (!SelfUpdater.Ready)
            return;
        try
        {
            SelfUpdater.Install(_restartForUpdate, Environment.GetCommandLineArgs().Skip(1));
            ActivityLog.Shared.Write(SelfUpdater.UsesInstaller
                ? $"Started the RacingCoach Collector {_update?.Version} installer."
                : $"Installed RacingCoach Collector {_update?.Version}.");
        }
        catch (Exception e)
        {
            ActivityLog.Shared.Write($"Couldn't install RacingCoach Collector {_update?.Version}: {e.Message}", isError: true);
            if (_restartForUpdate)
                MessageBox.Show($"The update couldn't be installed ({e.Message}). This version will keep working; download the new one from {_updateUrl ?? UpdateCheck.ReleasesPage}.",
                    "Update RacingCoach Collector", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // ---------------------------------------------------------------- Uploads and the upload key

    private async Task SetUpUploadsAsync()
    {
        if (_options.NoUpload || (_options.Playback && !_options.Upload))
        {
            SetUploadsOff(_options.NoUpload ? "Uploading is off for this run (--no-upload)" : "Played-back laps aren't uploaded (add --upload)");
            return;
        }

        var settings = CollectorSettings.Load();
        _siteUrl = (_options.SiteUrl ?? settings.SiteUrl).TrimEnd('/');
        var key = _options.SetKey ? null : settings.GetUploadKey();
        if (key is null)
        {
            _uploadState = UploadSetupState.NoKey;
            ShowKeyPanel(_options.SetKey
                ? "Enter your new upload key."
                : "To send your laps to your RacingCoach.app account, the collector needs your upload key. Laps are recorded either way.");
            return;
        }

        _uploadState = UploadSetupState.Checking;
        var check = await UploadSetup.CheckAsync(_siteUrl, key);
        switch (check.Status)
        {
            case KeyStatus.Accepted:
                UseKey(key, check.AccountName);
                ActivityLog.Shared.Write($"Uploading laps to {check.AccountName}'s account on {_siteUrl}.");
                break;
            case KeyStatus.Unreachable:
                UseKey(key, null);
                ActivityLog.Shared.Write($"Could not reach {_siteUrl} to check your upload key ({check.Problem}). Laps will upload when it's reachable.");
                break;
            default:
                _uploadState = UploadSetupState.Refused;
                ActivityLog.Shared.Write("RacingCoach.app no longer accepts your saved upload key.", isError: true);
                ShowKeyPanel("RacingCoach.app no longer accepts your saved upload key (it may have been replaced or revoked). Enter your current one.");
                break;
        }
    }

    private void UseKey(string key, string? account)
    {
        // The previous key's client stays with its uploader until that has finished
        _engine.UseApi(new RacingCoachApi(_siteUrl, key));
        _account = account;
        _uploadState = UploadSetupState.Active;
        RefreshLaps();
    }

    private void SetUploadsOff(string reason)
    {
        _uploadState = UploadSetupState.Off;
        _offReason = reason;
        KeyButton.IsEnabled = false;
        RefreshLaps();
    }

    private void ShowKeyPanel(string intro)
    {
        KeyIntro.Text = intro;
        KeyStatusText.Text = "";
        KeyBox.Text = "";
        KeySkipButton.Content = _uploadState == UploadSetupState.Active ? "Cancel" : "Skip for now";
        KeyOverlay.Visibility = Visibility.Visible;
        KeyBox.Focus();
    }

    private async void KeyConnect_Click(object sender, RoutedEventArgs e) => await ConnectKeyAsync();

    private async void KeyBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
            await ConnectKeyAsync();
    }

    private async Task ConnectKeyAsync()
    {
        var key = KeyBox.Text.Trim();
        if (!CollectorSettings.LooksLikeUploadKey(key))
        {
            ShowKeyStatus("That isn't an upload key. Keys start with rck_ and are 47 characters long.", Red);
            return;
        }

        KeyConnectButton.IsEnabled = false;
        ShowKeyStatus("Checking the key with RacingCoach.app…", Muted);
        try
        {
            var check = await UploadSetup.CheckAsync(_siteUrl, key);
            if (check.Status == KeyStatus.Refused)
            {
                ShowKeyStatus("RacingCoach.app doesn't recognise that key. Check you copied all of it, or create a new one.", Red);
                return;
            }

            var settings = CollectorSettings.Load();
            settings.SetUploadKey(key);
            settings.Save();
            UseKey(key, check.AccountName);
            KeyOverlay.Visibility = Visibility.Collapsed;
            ActivityLog.Shared.Write(check.Status == KeyStatus.Accepted
                ? $"Key accepted. Uploading laps to {check.AccountName}'s account."
                : $"Could not reach {_siteUrl} to check the key ({check.Problem}). Saved it anyway; laps will upload when it's reachable.");
        }
        finally
        {
            KeyConnectButton.IsEnabled = true;
        }
    }

    private void ShowKeyStatus(string text, Brush brush)
    {
        KeyStatusText.Text = text;
        KeyStatusText.Foreground = brush;
    }

    private void KeySkip_Click(object sender, RoutedEventArgs e)
    {
        KeyOverlay.Visibility = Visibility.Collapsed;
        if (_uploadState != UploadSetupState.Active)
            ActivityLog.Shared.Write("Laps are only saved on this PC for now. Press Upload Key to add your key.");
    }

    private void ChangeKey_Click(object sender, RoutedEventArgs e) =>
        ShowKeyPanel(_uploadState == UploadSetupState.Active
            ? "Enter a new upload key, e.g. after replacing it on your Account page."
            : "To send your laps to your RacingCoach.app account, the collector needs your upload key.");

    // ---------------------------------------------------------------- Display

    private void Refresh()
    {
        RefreshStatus();
        RefreshSession();
        RefreshLive();
    }

    private void RefreshStatus()
    {
        var connected = _engine.State is SimState.Connected or SimState.PlayingBack;
        switch (_engine.State)
        {
            case SimState.Waiting:
                SetTile(SimDot, SimText, SimDetail, Amber, "Waiting for iRacing", "Start iRacing and get in the car");
                break;
            case SimState.Connected:
                SetTile(SimDot, SimText, SimDetail, Green, "Connected", $"{_engine.SamplesPerSecond:0} samples/s");
                break;
            case SimState.PlayingBack:
                SetTile(SimDot, SimText, SimDetail, Blue, "Playing back", Path.GetFileName(_engine.PlaybackFile) ?? "");
                break;
            case SimState.PlaybackFinished:
                SetTile(SimDot, SimText, SimDetail, Grey, "Playback finished", Path.GetFileName(_engine.PlaybackFile) ?? "");
                break;
        }

        var lapCount = _currentLaps?.Laps.Count ?? 0;
        var saved = lapCount == 0 ? "No laps saved yet" : $"{lapCount} lap{(lapCount == 1 ? "" : "s")} saved this session";
        var status = _engine.RecorderStatus;
        if (!connected)
            SetTile(RecordDot, RecordText, RecordDetail, Grey, "Not recording", saved);
        else if (status.StartsWith("lap", StringComparison.Ordinal))
            SetTile(RecordDot, RecordText, RecordDetail, Green, $"Recording {status.Split(' ')[0]} {status.Split(' ')[1]}", saved);
        else
            SetTile(RecordDot, RecordText, RecordDetail, Amber, "Ready", "Recording starts at the start/finish line");

        var uploader = _engine.Uploader;
        switch (_uploadState)
        {
            case UploadSetupState.Checking:
                SetTile(UploadDot, UploadText, UploadDetail, Amber, "Checking key…", _siteUrl);
                break;
            case UploadSetupState.Off:
                SetTile(UploadDot, UploadText, UploadDetail, Grey, "Off", _offReason ?? "");
                break;
            case UploadSetupState.NoKey:
                SetTile(UploadDot, UploadText, UploadDetail, Amber, "No upload key", "Press Upload Key to connect");
                break;
            case UploadSetupState.Refused:
                SetTile(UploadDot, UploadText, UploadDetail, Red, "Key not accepted", "Press Upload Key to enter a new one");
                break;
            case UploadSetupState.Active when uploader is null:
                break;
            case UploadSetupState.Active when uploader.KeyRejected:
                SetTile(UploadDot, UploadText, UploadDetail, Red, "Key not accepted", "Press Upload Key to enter a new one");
                break;
            case UploadSetupState.Active when uploader.Offline:
                SetTile(UploadDot, UploadText, UploadDetail, Amber, "Can't reach the site", $"{uploader.Pending} lap(s) waiting; retrying");
                break;
            case UploadSetupState.Active:
                SetTile(UploadDot, UploadText, UploadDetail, Green, _account ?? "Uploading", uploader.Pending > 0
                    ? $"Uploading {uploader.Pending} lap(s)…"
                    : "All laps uploaded");
                break;
        }

        if (_engine.IbtFolder is null)
            SetTile(IbtDot, IbtText, IbtDetail, Grey, _engine.Playback ? "From the file" : "Off",
                _engine.Playback ? "Played-back laps have positions already" : "Turned off for this run (--no-positions)");
        else if (_engine.RecordingIbt)
            SetTile(IbtDot, IbtText, IbtDetail, Green, "Recording .ibt", "Added to your laps when you leave the car");
        else
            SetTile(IbtDot, IbtText, IbtDetail, Grey, "Not recording", connected ? "Starts when you're on track" : "Starts when you get in the car");
    }

    private static void SetTile(System.Windows.Shapes.Ellipse dot, System.Windows.Controls.TextBlock text,
        System.Windows.Controls.TextBlock detail, Brush color, string value, string description)
    {
        dot.Fill = color;
        text.Text = value;
        detail.Text = description;
        // The tiles are narrow; the full text is a hover away
        detail.ToolTip = string.IsNullOrEmpty(description) ? null : description;
    }

    private void RefreshSession()
    {
        var session = _engine.Session;
        if (session is null)
        {
            TrackText.Text = CarText.Text = SessionText.Text = "—";
            TrackDetail.Text = CarDetail.Text = SessionDetail.Text = SkiesText.Text = "";
            return;
        }

        TrackText.Text = session.TrackConfig is null ? session.Track : $"{session.Track} · {session.TrackConfig}";
        TrackDetail.Text = Join(TrackLength(session.TrackLength), session.TrackLocation);
        CarText.Text = session.Car;
        CarDetail.Text = Join(session.CarNumber is null ? null : $"#{session.CarNumber}", session.CarClass, session.Driver);
        SkiesText.Text = session.Skies ?? "";

        var hasSample = _engine.TryGetLatest(out var d);
        var type = hasSample && d.SessionNum is { } num ? session.SessionTypes.GetValueOrDefault(num) : null;
        SessionText.Text = type ?? "—";
        SessionDetail.Text = session.SubSessionId > 0 ? $"Session {session.SubSessionId}" : "Offline session";
    }

    private void RefreshLive()
    {
        if (!_engine.TryGetLatest(out var d))
        {
            SpeedText.Text = GearText.Text = "—";
            RpmText.Text = "— RPM";
            ThrottleText.Text = BrakeText.Text = SteeringText.Text = "";
            ThrottleScale.ScaleX = BrakeScale.ScaleX = LapScale.ScaleX = FuelScale.ScaleX = 0;
            SteeringShift.X = 0;
            FuelText.Text = TrackTempText.Text = AirTempText.Text = TimeLeftText.Text = LapsLeftText.Text = "—";
            FuelPctText.Text = "";
            LapNumberText.Text = "Lap —";
            LapProgressText.Text = "";
            CurrentLapText.Text = LastLapText.Text = BestLapText.Text = DeltaText.Text = "—";
            DeltaText.Foreground = Fg;
            return;
        }

        // In the user's Preferred Units (Account page): mph, or kph for Metric
        var metric = _engine.Metric;
        SpeedUnitText.Text = metric ? " KPH" : " MPH";
        SpeedText.Text = d.Speed is { } speed
            ? Math.Round(speed * (metric ? MetersPerSecondToKph : MetersPerSecondToMph)).ToString("0", Culture)
            : "—";
        GearText.Text = d.Gear switch { null => "—", -1 => "R", 0 => "N", var g => g.Value.ToString(Culture) };
        RpmText.Text = d.RPM is { } rpm ? $"{rpm.ToString("N0", Culture)} RPM" : "— RPM";

        var throttle = Math.Clamp(d.Throttle ?? 0, 0, 1);
        var brake = Math.Clamp(d.Brake ?? 0, 0, 1);
        ThrottleScale.ScaleX = throttle;
        BrakeScale.ScaleX = brake;
        ThrottleText.Text = $"{throttle * 100:0}%";
        BrakeText.Text = $"{brake * 100:0}%";

        // iRacing's steering angle is in radians, positive to the left
        var steering = (d.SteeringWheelAngle ?? 0) * 180 / Math.PI;
        var half = Math.Max(0, SteeringTrack.ActualWidth / 2 - 5);
        SteeringShift.X = -Math.Clamp(steering / SteeringRangeDegrees, -1, 1) * half;
        SteeringText.Text = Math.Abs(steering) < 0.5 ? "0°" : $"{Math.Abs(steering):0}°{(steering > 0 ? "L" : "R")}";

        var pct = Math.Clamp(d.LapDistPct ?? 0, 0, 1);
        LapScale.ScaleX = pct;
        LapNumberText.Text = d.Lap is { } lap ? $"Lap {lap}" + (d.PlayerCarPosition is > 0 and var p ? $" · P{p}" : "") : "Lap —";
        LapProgressText.Text = $"{pct * 100:0}% around";

        CurrentLapText.Text = LapTime(d.LapCurrentLapTime);
        LastLapText.Text = LapTime(d.LapLastLapTime);
        BestLapText.Text = LapTime(d.LapBestLapTime);
        if (d.LapBestLapTime is > 0 && d.LapDeltaToBestLap is { } delta)
        {
            DeltaText.Text = $"{(delta > 0 ? "+" : delta < 0 ? "−" : "")}{Math.Abs(delta):0.000}";
            DeltaText.Foreground = delta > 0.0005 ? Red : delta < -0.0005 ? Green : Fg;
        }
        else
        {
            DeltaText.Text = "—";
            DeltaText.Foreground = Fg;
        }

        if (d.FuelLevel is { } liters)
        {
            FuelText.Text = metric ? $"{liters:0.0} L" : $"{liters / LitersPerGallon:0.0} gal";
            FuelPctText.Text = d.FuelLevelPct is { } fp ? $"{fp * 100:0}%" : "";
            FuelScale.ScaleX = Math.Clamp(d.FuelLevelPct ?? 0, 0, 1);
        }
        TrackTempText.Text = Temperature(d.TrackTempCrew);
        AirTempText.Text = Temperature(d.AirTemp);
        TimeLeftText.Text = d.SessionTimeRemain switch
        {
            null or < 0 => "—",
            >= UnlimitedSeconds => "Unlimited",
            var s => TimeSpan.FromSeconds(s.Value).ToString(s >= 3600 ? @"h\:mm\:ss" : @"m\:ss", Culture),
        };
        LapsLeftText.Text = d.SessionLapsRemainEx switch
        {
            null or < 0 => "—",
            >= UnlimitedLaps => "Unlimited",
            var l => l.Value.ToString(Culture),
        };
    }

    // ---------------------------------------------------------------- Laps

    private void OnLapsChanged(SessionLaps laps)
    {
        // Until a lap is saved this run, the most recent session's laps (the writer reports them at startup)
        if (laps.NewLap && !_lapSavedThisRun)
            _lapSavedThisRun = true;
        if (laps.NewLap || _currentFolder is null)
            _currentFolder = laps.Folder;
        if (laps.Folder != _currentFolder)
            return; // positions added to an earlier session's laps
        _currentLaps = laps;
        RefreshLaps();
    }

    private void RefreshLaps()
    {
        var laps = _currentLaps;
        _laps.Clear();
        NoLapsText.Visibility = laps is { Laps.Count: > 0 } ? Visibility.Collapsed : Visibility.Visible;
        if (laps is null)
            return;

        LapsTitle.Text = $"{(_lapSavedThisRun ? "LAPS THIS SESSION" : "LAST SESSION")} · {laps.Track.ToUpperInvariant()}";
        var best = laps.Laps.Count > 0 ? laps.Laps.Min(l => l.LapTimeSeconds) : 0;
        var uploading = _uploadState == UploadSetupState.Active;
        var positionsOn = _engine.IbtFolder is not null;

        // Newest first
        foreach (var lap in laps.Laps.OrderByDescending(l => l.RecordedAt))
        {
            var isBest = lap.LapTimeSeconds == best;
            var notes = new List<string>();
            if (lap.PitRoad) notes.Add("pit road");
            if (lap.OffTrack) notes.Add("off track");
            if (lap.MissingSamples > 0) notes.Add($"{lap.MissingSamples} samples missing");

            var (upload, uploadBrush, uploadTip) = lap switch
            {
                { Uploaded: true } => ("✓ Uploaded", Green, "On RacingCoach.app"),
                { UploadError: { } error } when error.StartsWith("track and car unknown", StringComparison.Ordinal) => ("Saved only", Grey, error),
                { UploadError: { } error } => ("Not uploaded", Red, error),
                _ when uploading => ("Waiting…", Amber, "Queued for upload"),
                _ => ("Saved on PC", Grey, "Uploading is off"),
            };
            var (positions, positionsBrush, positionsTip) = lap switch
            {
                { HasPosition: true } => ("✓ Added", Green, "Lat/Lon/Alt are in the lap's CSV"),
                { PositionMissing: true } => ("Not available", Grey, "iRacing's .ibt file didn't cover the whole lap"),
                _ when positionsOn => ("After the stint", Amber, "Added from iRacing's .ibt file when you leave the car"),
                _ => ("—", Grey, "Track positions are off for this run"),
            };

            _laps.Add(new LapRow
            {
                Lap = lap.LapNumber.ToString(Culture),
                Time = LapTime(lap.LapTimeSeconds),
                Gap = isBest ? "Best" : $"+{lap.LapTimeSeconds - best:0.000}",
                GapBrush = isBest ? Blue : Muted,
                Incidents = lap.Incidents > 0 ? $"{lap.Incidents}x" : "",
                Notes = string.Join(", ", notes),
                Upload = upload,
                UploadBrush = uploadBrush,
                UploadTip = uploadTip,
                Positions = positions,
                PositionsBrush = positionsBrush,
                PositionsTip = positionsTip,
                RowBackground = isBest ? BestRow : Brushes.Transparent,
            });
        }

        var uploaded = laps.Laps.Count(l => l.Uploaded);
        LapsSummaryText.Text = $"{laps.Laps.Count} lap{(laps.Laps.Count == 1 ? "" : "s")} · best {LapTime(best)} · {uploaded} uploaded";
    }

    // ---------------------------------------------------------------- Activity

    private void AddActivity(LogEntry entry)
    {
        var atBottom = ActivityScroll.VerticalOffset >= ActivityScroll.ScrollableHeight - 4;
        _activity.Add(new ActivityRow(entry.Time.ToString("HH:mm:ss", Culture), entry.Message, entry.IsError ? Red : Fg));
        while (_activity.Count > MaxActivityLines)
            _activity.RemoveAt(0);
        if (atBottom)
            ActivityScroll.ScrollToEnd(); // keep following new messages unless the user scrolled up
    }

    // ---------------------------------------------------------------- Buttons and links

    private void OpenLapsFolder_Click(object sender, RoutedEventArgs e)
    {
        Directory.CreateDirectory(_currentFolder ?? _engine.LapsFolder);
        Open(_currentFolder ?? _engine.LapsFolder);
    }

    private void OpenLogFile_Click(object sender, RoutedEventArgs e) => Open(ActivityLog.Shared.FilePath);
    private void OpenSite_Click(object sender, RoutedEventArgs e) => Open(_siteUrl);
    private void OpenAccount_Click(object sender, RoutedEventArgs e) => Open($"{_siteUrl}/account");

    // Opens the overlay (or brings it to the front): focus areas and brake points from TelemetryEngine.js
    private void LaunchOverlay_Click(object sender, RoutedEventArgs e)
    {
        if (_overlayWindow is not null)
        {
            _overlayWindow.Activate();
            return;
        }
        if (OpenOverlayFeed(showError: true) is not { } feed)
            return;
        _overlayWindow = new OverlayWindow(_engine, feed);
        _overlayWindow.Closed += (_, _) =>
        {
            _overlayWindow = null;
            CloseOverlayFeed();
        };
        _overlayWindow.Show();
    }

    // The running TelemetryEngine.js, or a new one (null if it doesn't load)
    private OverlayFeed? OpenOverlayFeed(bool showError)
    {
        if (_overlayFeed is not null)
            return _overlayFeed;
        OverlayEngine overlay;
        try
        {
            overlay = new OverlayEngine((message, isError) => ActivityLog.Shared.Write(message, isError));
        }
        catch (Exception ex)
        {
            ActivityLog.Shared.Write($"Couldn't start the overlay: TelemetryEngine.js didn't load ({ex.Message}).", isError: true);
            if (showError)
                MessageBox.Show(this, $"TelemetryEngine.js didn't load:\n\n{ex.Message}", "RacingCoach Overlay", MessageBoxButton.OK, MessageBoxImage.Error);
            return null;
        }
        ActivityLog.Shared.Write($"Overlay opened (TelemetryEngine.js: {overlay.ScriptSource}).");
        _engine.Overlay = overlay;
        return _overlayFeed = new OverlayFeed(_engine, overlay);
    }

    // Stops TelemetryEngine.js once neither window that shows it is open
    private void CloseOverlayFeed()
    {
        if (_overlayWindow is not null || _targetTelemetryWindow is not null || _overlayFeed is null)
            return;
        if (_engine.Overlay == _overlayFeed.Overlay)
            _engine.Overlay = null;
        _overlayFeed = null;
    }

    // Opens the Rotation window (or brings it to the front): live steering, yaw, velocities, accelerations and pedals
    private void Rotation_Click(object sender, RoutedEventArgs e)
    {
        if (_rotationWindow is not null)
        {
            _rotationWindow.Activate();
            return;
        }
        _rotationWindow = new RotationWindow(_engine);
        _rotationWindow.Closed += (_, _) => _rotationWindow = null;
        _rotationWindow.Show();
    }

    // Opens the Brake Practice window (or brings it to the front): calibrates the Simucube brake pedal, then graphs
    // the brake % as it's pressed, read straight from the pedals so iRacing needn't be running
    private void BrakePractice_Click(object sender, RoutedEventArgs e)
    {
        if (_brakePracticeWindow is not null)
        {
            _brakePracticeWindow.Activate();
            return;
        }
        _brakePracticeWindow = new BrakePracticeWindow(_engine);
        _brakePracticeWindow.Closed += (_, _) => _brakePracticeWindow = null;
        _brakePracticeWindow.Show();
    }

    // Opens the Target Telemetry window (or brings it to the front): the Target Lap's brake and throttle traces scrolling past the
    // car's position on track
    private void TargetTelemetry_Click(object sender, RoutedEventArgs e)
    {
        if (_targetTelemetryWindow is not null)
        {
            _targetTelemetryWindow.Activate();
            return;
        }
        // Without the overlay's boxes if TelemetryEngine.js doesn't load (logged)
        _targetTelemetryWindow = new TargetTelemetryWindow(_engine, OpenOverlayFeed(showError: false));
        _targetTelemetryWindow.Closed += (_, _) =>
        {
            _targetTelemetryWindow = null;
            CloseOverlayFeed();
        };
        _targetTelemetryWindow.Show();
    }

    private static void Open(string target)
    {
        try
        {
            Process.Start(new ProcessStartInfo(target) { UseShellExecute = true });
        }
        catch (Exception ex) when (ex is Win32Exception or InvalidOperationException)
        {
            ActivityLog.Shared.Write($"Could not open {target}: {ex.Message}", isError: true);
        }
    }

    // ---------------------------------------------------------------- Closing

    protected override async void OnClosing(CancelEventArgs e)
    {
        if (_closed)
            return;
        // Keep the window until the last laps are saved and queued uploads have had their few seconds
        e.Cancel = true;
        if (_closing)
            return;
        _closing = true;
        _overlayWindow?.Close();
        _rotationWindow?.Close();
        _brakePracticeWindow?.Close();
        _targetTelemetryWindow?.Close();
        ClosingOverlay.Visibility = Visibility.Visible;
        _timer.Stop();
        _stop.Cancel();
        if (_run is not null)
            await Task.WhenAny(_run, Task.Delay(TimeSpan.FromSeconds(30)));
        InstallUpdate();
        _closed = true;
        Close();
    }

    // ---------------------------------------------------------------- Formatting

    private static string Join(params string?[] parts) =>
        string.Join(" · ", parts.Where(p => !string.IsNullOrWhiteSpace(p)));

    // 109.479 -> "1:49.479"
    private static string LapTime(double? seconds)
    {
        if (seconds is not > 0)
            return "—";
        var t = TimeSpan.FromMilliseconds(Math.Round(seconds.Value * 1000));
        return $"{(int)t.TotalMinutes}:{t.Seconds:00}.{t.Milliseconds:000}";
    }

    private static string LapTime(float? seconds) => LapTime((double?)seconds);

    // iRacing gives the length as e.g. "4.7466 km": "2.95 mi", or "4.75 km" for Metric
    private string? TrackLength(string? length)
    {
        var parts = length?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        if (parts is not [var number, "km"] || !double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var km))
            return length;
        return _engine.Metric ? $"{km:0.00} km" : $"{km * 0.621371:0.00} mi";
    }

    // iRacing temperatures are °C: "77°F", or "25°C" for Metric
    private string Temperature(float? celsius) =>
        celsius is not { } c ? "—" : _engine.Metric ? $"{c:0}°C" : $"{c * 9 / 5 + 32:0}°F";

    private static SolidColorBrush Brush(string hex)
    {
        var brush = (SolidColorBrush)new BrushConverter().ConvertFromString(hex)!;
        brush.Freeze();
        return brush;
    }

    private sealed class LapRow
    {
        public string Lap { get; init; } = "";
        public string Time { get; init; } = "";
        public string Gap { get; init; } = "";
        public Brush GapBrush { get; init; } = Brushes.Transparent;
        public string Incidents { get; init; } = "";
        public string Notes { get; init; } = "";
        public string Upload { get; init; } = "";
        public Brush UploadBrush { get; init; } = Brushes.Transparent;
        public string UploadTip { get; init; } = "";
        public string Positions { get; init; } = "";
        public Brush PositionsBrush { get; init; } = Brushes.Transparent;
        public string PositionsTip { get; init; } = "";
        public Brush RowBackground { get; init; } = Brushes.Transparent;
    }

    private sealed record ActivityRow(string Time, string Message, Brush Brush);
}
