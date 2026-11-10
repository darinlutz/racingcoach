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
/// The collector's window. Its Dashboard tab has the status of iRacing, lap recording, uploads and track positions;
/// the session, car and conditions; live inputs; this session's laps; and the activity log. Its Live Racing tab has
/// the track's map with the car going round it, and whether the driving is shared live with the website (LiveRacing.cs). It runs a CollectorEngine
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
    // The language the window is shown in: the account's Preferred Language (CollectorEngine.Language); null until
    // the first Refresh applies it
    private string? _language;
    // Texts set once and shown again in a new language: the update banner and its button, the upload key prompt's
    // intro and status, and why uploads are off
    private Func<string>? _updateMessage;
    private string _updateButtonKey = "main.download";
    private string? _keyIntroKey;
    private string? _keyStatusKey;
    private string? _offReasonKey;

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
    // Beeps before braking: the engine's BrakeBeepsLoaded the controls show, and the volume slider has to rest this
    // long before its value is saved, so dragging it saves once
    private int _beepsShown = -1;
    private readonly DispatcherTimer _beepsVolumeSave = new() { Interval = TimeSpan.FromMilliseconds(400) };
    private readonly DispatcherTimer _satelliteSave = new() { Interval = TimeSpan.FromMilliseconds(400) };
    private int _satelliteSaved;
    // The microphone's level bar: a recorder that keeps nothing, open only while it's shown (RefreshMic)
    private readonly MicRecorder _micMeter = new();
    private bool _micMeterOn;
    private DateTime _micRetryAt;
    private double _micShown;
    private bool _micListing;
    private readonly ObservableCollection<LapRow> _laps = [];
    private readonly ObservableCollection<ActivityRow> _activity = [];
    private Task? _run;

    private string _siteUrl = CollectorSettings.DefaultSiteUrl;
    private UploadSetupState _uploadState = UploadSetupState.Checking;
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
    private RotationWindow? _rotationWindow;
    private BrakePracticeWindow? _brakePracticeWindow;
    private TargetTelemetryWindow? _targetTelemetryWindow;
    private SteeringWindow? _steeringWindow;
    // Driver Radio over the sim, while it's recording and for a few seconds after; and Set Wheel Button waiting for a press
    private RadioWindow? _radioWindow;
    private bool _pickingRadioButton;
    private static readonly TimeSpan RadioSaidShownFor = TimeSpan.FromSeconds(8);
    // Long enough to read the Race Engineer's answer while it's said
    private static readonly TimeSpan RadioReplyShownFor = TimeSpan.FromSeconds(14);
    private static readonly TimeSpan RadioProblemShownFor = TimeSpan.FromSeconds(6);
    // TelemetryEngine.js for the Target Telemetry window's overlay boxes, while it's open
    private OverlayFeed? _overlayFeed;

    internal MainWindow(CollectorOptions options)
    {
        InitializeComponent();
        _options = options;
        Title = $"RacingCoach.app Collector {UpdateCheck.Current}";
        LapsList.ItemsSource = _laps;
        ActivityList.ItemsSource = _activity;

        ActivityLog.Shared.Added += entry => Dispatcher.BeginInvoke(() => AddActivity(entry));
        _engine = new CollectorEngine(
            options,
            (message, isError) => ActivityLog.Shared.Write(message, isError),
            laps => Dispatcher.BeginInvoke(() => OnLapsChanged(laps)));

        _timer.Tick += (_, _) => Refresh();
        _beepsVolumeSave.Tick += (_, _) => SaveBeepsVolume();
        TrackMap.Imagery = new SatelliteTiles(() => _engine.Api);
        _satelliteSaved = Math.Clamp(CollectorSettings.Load().SatelliteOpacity, 0, 100);
        SatelliteSlider.Value = _satelliteSaved;
        TrackMap.ImageryOpacity = SatelliteSlider.Value / 100;
        _satelliteSave.Tick += (_, _) => SaveSatelliteOpacity();
        ListMicrophones();
        foreach (var (id, name) in CollectorEngine.PickableSimulators)
            SimulatorCombo.Items.Add(new System.Windows.Controls.ComboBoxItem { Content = name, Tag = id });
        SimulatorCombo.SelectedItem = SimulatorCombo.Items.Cast<System.Windows.Controls.ComboBoxItem>()
            .FirstOrDefault(item => (string)item.Tag == _engine.Simulator);
        SimulatorCombo.IsEnabled = _engine.CanPickSimulator;
        ShowSteeringRange();
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
        ActivityLog.Shared.Write($"RacingCoach.app Collector {UpdateCheck.Current} started. Laps are saved to {_engine.LapsFolder}");

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
            ShowManualUpdate(() => T("main.updateAvailable", update.Version, UpdateCheck.Current));
            return;
        }

        UpdateButton.Visibility = Visibility.Collapsed;
        ShowUpdateMessage(() => T("main.downloading", update.Version));
        var progress = new Progress<double>(fraction =>
            ShowUpdateMessage(() => $"{T("main.downloading", update.Version)} {fraction.ToString("P0", Loc.Culture(_language ?? Loc.English))}"));
        try
        {
            await SelfUpdater.DownloadAsync(update, progress, _stop.Token);
            ActivityLog.Shared.Write($"Downloaded RacingCoach.app Collector {update.Version}; it installs when you restart or close the collector.");
            ShowUpdateMessage(() => T("main.updateReady", update.Version, UpdateCheck.Current)
                + (SelfUpdater.UsesInstaller ? T("main.updateAllow") : ""));
            ShowUpdateButton("main.restartNow");
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested)
        {
            // closing
        }
        catch (Exception e)
        {
            ActivityLog.Shared.Write($"Couldn't download RacingCoach.app Collector {update.Version}: {e.Message}", isError: true);
            ShowManualUpdate(() => T("main.updateDownloadFailed", update.Version, e.Message));
        }
    }

    private void ShowManualUpdate(Func<string> message)
    {
        ShowUpdateMessage(message);
        ShowUpdateButton("main.download");
    }

    // The banner's text, made again in a new language
    private void ShowUpdateMessage(Func<string> message)
    {
        _updateMessage = message;
        UpdateText.Text = message();
    }

    private void ShowUpdateButton(string key)
    {
        _updateButtonKey = key;
        UpdateButton.Content = T(key);
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
        if (_engine.State == SimState.Connected && MessageBox.Show(this, T("main.restartConfirm"), T("main.updateTitle"),
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
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
                ? $"Started the RacingCoach.app Collector {_update?.Version} installer."
                : $"Installed RacingCoach.app Collector {_update?.Version}.");
        }
        catch (Exception e)
        {
            ActivityLog.Shared.Write($"Couldn't install RacingCoach.app Collector {_update?.Version}: {e.Message}", isError: true);
            if (_restartForUpdate)
                MessageBox.Show(T("main.installFailed", e.Message, _updateUrl ?? UpdateCheck.ReleasesPage),
                    T("main.updateTitle"), MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // ---------------------------------------------------------------- Uploads and the upload key

    private async Task SetUpUploadsAsync()
    {
        if (_options.NoUpload || (_options.Playback && !_options.Upload))
        {
            SetUploadsOff(_options.NoUpload ? "main.noUploadFlag" : "main.playbackNoUpload");
            return;
        }

        var settings = CollectorSettings.Load();
        _siteUrl = (_options.SiteUrl ?? settings.SiteUrl).TrimEnd('/');
        var key = _options.SetKey ? null : settings.GetUploadKey();
        if (key is null)
        {
            _uploadState = UploadSetupState.NoKey;
            ShowKeyPanel(_options.SetKey ? "main.keyNew" : "main.keyNeeded");
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
                ShowKeyPanel("main.keyRefusedSaved");
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

    // reasonKey: a Loc key
    private void SetUploadsOff(string reasonKey)
    {
        _uploadState = UploadSetupState.Off;
        _offReasonKey = reasonKey;
        KeyButton.IsEnabled = false;
        RefreshLaps();
    }

    // introKey: a Loc key
    private void ShowKeyPanel(string introKey)
    {
        _keyIntroKey = introKey;
        _keyStatusKey = null;
        KeyIntro.Text = T(introKey);
        KeyStatusText.Text = "";
        KeyBox.Text = "";
        KeySkipButton.Content = T(_uploadState == UploadSetupState.Active ? "main.cancel" : "main.skip");
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
            ShowKeyStatus("main.keyInvalid", Red);
            return;
        }

        KeyConnectButton.IsEnabled = false;
        ShowKeyStatus("main.keyChecking", Muted);
        try
        {
            var check = await UploadSetup.CheckAsync(_siteUrl, key);
            if (check.Status == KeyStatus.Refused)
            {
                ShowKeyStatus("main.keyUnknown", Red);
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

    // key: a Loc key
    private void ShowKeyStatus(string key, Brush brush)
    {
        _keyStatusKey = key;
        KeyStatusText.Text = T(key);
        KeyStatusText.Foreground = brush;
    }

    private void KeySkip_Click(object sender, RoutedEventArgs e)
    {
        KeyOverlay.Visibility = Visibility.Collapsed;
        if (_uploadState != UploadSetupState.Active)
            ActivityLog.Shared.Write("Laps are only saved on this PC for now. Press Upload Key to add your key.");
    }

    private void ChangeKey_Click(object sender, RoutedEventArgs e) =>
        ShowKeyPanel(_uploadState == UploadSetupState.Active ? "main.keyReplace" : "main.keyNeededShort");

    // ---------------------------------------------------------------- Display

    private void Refresh()
    {
        if (_engine.Language != _language)
            ApplyLanguage(_engine.Language);
        RefreshStatus();
        RefreshSession();
        RefreshLive();
        RefreshRadio();
        RefreshMic();
        if (LivePanel.Visibility == Visibility.Visible)
            RefreshLiveRacing();
    }

    // Shows the window in the account's Preferred Language: the XAML's texts (Loc.Key), and the ones set once
    private void ApplyLanguage(string language)
    {
        _language = language;
        Loc.Apply(this, language);
        if (_engine.Playback)
            SubtitleText.Text = T("main.playingBack", Path.GetFileName(_engine.PlaybackFile), _options.Speed);
        if (_updateMessage is not null)
            UpdateText.Text = _updateMessage();
        UpdateButton.Content = T(_updateButtonKey);
        if (_keyIntroKey is not null)
            KeyIntro.Text = T(_keyIntroKey);
        KeyStatusText.Text = _keyStatusKey is null ? "" : T(_keyStatusKey);
        KeySkipButton.Content = T(_uploadState == UploadSetupState.Active ? "main.cancel" : "main.skip");
        ListMicrophones(); // Windows default, in this language
        ShowSteeringRangeHint(null);
        RefreshLaps();
    }

    // The text for a Loc key in the window's language, with {0}, {1}... filled in
    private string T(string key, params object?[] args) =>
        args.Length == 0 ? Loc.T(_language ?? Loc.English, key) : Loc.T(_language ?? Loc.English, key, args);

    // ---------------------------------------------------------------- Microphone

    // Windows default, then Windows' microphones; one picked earlier that isn't connected now stays listed and picked
    private void ListMicrophones()
    {
        _micListing = true;
        var names = MicRecorder.Devices().ToList();
        var picked = MicRecorder.DeviceName;
        if (!string.IsNullOrEmpty(picked) && !names.Contains(picked))
            names.Add(picked);
        MicCombo.Items.Clear();
        MicCombo.Items.Add(new System.Windows.Controls.ComboBoxItem { Content = T("main.micDefault") });
        foreach (var name in names)
            MicCombo.Items.Add(new System.Windows.Controls.ComboBoxItem { Content = name, Tag = name });
        MicCombo.SelectedIndex = string.IsNullOrEmpty(picked) ? 0 : names.IndexOf(picked) + 1;
        _micListing = false;
    }

    // A microphone plugged in since shows when the list opens
    private void MicCombo_DropDownOpened(object sender, EventArgs e) => ListMicrophones();

    private void MicCombo_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (_micListing || MicCombo.SelectedItem is not System.Windows.Controls.ComboBoxItem item)
            return;
        var name = item.Tag as string;
        if (name == MicRecorder.DeviceName)
            return;
        MicRecorder.DeviceName = name; // Driver Radio's next recording
        var settings = CollectorSettings.Load();
        settings.Microphone = name;
        settings.Save();
        ActivityLog.Shared.Write($"Driver Radio microphone: {name ?? "Windows default"}", false);
        StopMicMeter(); // the bar listens to the new one at the next refresh
        _micRetryAt = DateTime.MinValue;
    }

    // The level bar listens while this window is in front on the Dashboard, so the microphone isn't open all session
    // behind the sim; while Driver Radio records, its own recording moves the bar too. Quiet (under about -44 dB,
    // room noise) shows no bar; above it, the bar is the level on a 50 dB scale, amber near clipping.
    private void RefreshMic()
    {
        var listen = IsActive && WindowState != WindowState.Minimized && DashboardPanel.Visibility == Visibility.Visible;
        if (listen && !_micMeterOn && DateTime.UtcNow >= _micRetryAt)
        {
            try
            {
                _micMeter.Start(0);
                _micMeterOn = true;
                MicProblemText.Visibility = Visibility.Collapsed;
            }
            catch (InvalidOperationException e)
            {
                _micRetryAt = DateTime.UtcNow.AddSeconds(5);
                MicProblemText.Text = T("main.micFailed", e.Message);
                MicProblemText.Visibility = Visibility.Visible;
            }
        }
        else if (!listen && _micMeterOn)
            StopMicMeter();

        var peak = Math.Max(_micMeter.Level, _engine.Radio.MicLevel);
        var level = peak < 0.006 ? 0 : Math.Clamp((20 * Math.Log10(peak) + 50) / 50, 0, 1);
        _micShown = Math.Max(level, _micShown * 0.6); // up at once, down smoothly
        if (_micShown < 0.02)
            _micShown = 0;
        MicLevelBar.Width = ((FrameworkElement)MicLevelBar.Parent).ActualWidth * _micShown;
        MicLevelBar.Background = (Brush)FindResource(peak >= 0.9 ? "AmberBrush" : "GreenBrush");
    }

    private void StopMicMeter()
    {
        _micMeter.Stop();
        _micMeterOn = false;
    }

    // ---------------------------------------------------------------- Driver Radio

    // The Radio window over the sim while Driver Radio records, sends, and for a few seconds after; and the Live
    // Racing tab's Driver Radio section
    private void RefreshRadio()
    {
        var status = _engine.Radio.Status;
        var age = DateTime.UtcNow - status.Since;
        var show = status.State switch
        {
            RadioState.Recording or RadioState.Sending => true,
            RadioState.Said => age < (status.Reply is null ? RadioSaidShownFor : RadioReplyShownFor),
            RadioState.Problem => age < RadioProblemShownFor,
            _ => false,
        };
        if (show && !_closing)
        {
            if (_radioWindow is null)
            {
                _radioWindow = new RadioWindow();
                _radioWindow.Left = Math.Max(0, (SystemParameters.PrimaryScreenWidth - _radioWindow.Width) / 2);
                _radioWindow.Closed += (_, _) => _radioWindow = null;
            }
            _radioWindow.Display(status, _language ?? Loc.English);
        }
        else
            _radioWindow?.Hide();

        RadioText.Text = status.State switch
        {
            RadioState.Recording => T("main.radioRecording"),
            RadioState.Sending => T("main.radioSending"),
            RadioState.Said when status.Reply is not null => $"{T("main.radioYouSaid", status.Text)}\n{T("main.radioEngineer", status.Reply)}",
            RadioState.Said => T("main.radioYouSaid", status.Text),
            RadioState.Problem => RadioWindow.ProblemText(status, _language ?? Loc.English),
            _ => T("main.radioIdle"),
        };
        var button = _engine.Radio.Button;
        RadioButtonText.Text = _pickingRadioButton ? T("main.radioPicking")
            : button is null ? T("main.radioNoButton")
            : T("main.radioButton", button.Controller, button.Button);
        SetRadioButton.IsEnabled = !_pickingRadioButton;
        ClearRadioButton.IsEnabled = !_pickingRadioButton && button is not null;
    }

    private void SetRadioButton_Click(object sender, RoutedEventArgs e)
    {
        _pickingRadioButton = true;
        _engine.Radio.PickButton(picked => Dispatcher.BeginInvoke(() =>
        {
            _pickingRadioButton = false;
            if (picked is null)
            {
                ActivityLog.Shared.Write("Driver Radio: no button was pressed, so the wheel button wasn't changed.");
                return;
            }
            SaveRadioButton(picked);
            ActivityLog.Shared.Write($"Driver Radio: hold {picked} to talk.");
        }));
    }

    private void ClearRadioButton_Click(object sender, RoutedEventArgs e)
    {
        SaveRadioButton(null);
        ActivityLog.Shared.Write("Driver Radio: wheel button cleared; iRacing's radio button still works.");
    }

    private void SaveRadioButton(WheelButton? button)
    {
        _engine.Radio.Button = button;
        var settings = CollectorSettings.Load();
        settings.RadioButton = button;
        settings.Save();
    }

    // ---------------------------------------------------------------- Live Racing tab

    private void Tab_Checked(object sender, RoutedEventArgs e)
    {
        // Checked fires for the default tab inside InitializeComponent, before the panels exist
        if (DashboardPanel is null || LivePanel is null)
            return;
        var live = LiveRacingTab.IsChecked == true;
        DashboardPanel.Visibility = live ? Visibility.Collapsed : Visibility.Visible;
        LivePanel.Visibility = live ? Visibility.Visible : Visibility.Collapsed;
        // The map's dot moves every frame while the tab shows
        CompositionTarget.Rendering -= OnLiveRacingFrame;
        if (live)
        {
            CompositionTarget.Rendering += OnLiveRacingFrame;
            RefreshLiveRacing();
        }
    }

    private void OnLiveRacingFrame(object? sender, EventArgs e)
    {
        TrackMap.Map = _engine.Live.Map;
        TrackMap.CarPct = _engine.TryGetLatest(out var d) && d.IsOnTrack == true && d.LapDistPct is { } pct and >= 0 ? pct : null;
    }

    private void RefreshLiveRacing()
    {
        var live = _engine.Live;
        var session = _engine.Session;
        MapTrackText.Text = session is null ? "—" : session.TrackConfig is null ? session.Track : $"{session.Track} · {session.TrackConfig}";
        var map = live.Map;
        MapKindText.Text = map is null ? "" : map.Exact ? "" : T("main.approximateMap");
        MapEmptyText.Text = map is not null ? ""
            : session is null ? T("main.mapStart")
            : T("main.mapDrive");
        SatelliteRow.Visibility = map is { Mercator: not null } && TrackMap.Imagery?.Available is not null ? Visibility.Visible : Visibility.Collapsed;
        MapNoteText.Text = map is { Exact: false }
            ? T("main.mapApproximateNote")
            : "";

        // The collector's own problems are Loc keys; the site's and the network's are shown as they are
        var problem = live.Problem is { } p ? Loc.TOr(_language ?? Loc.English, p, p) : null;
        if (live.Sharing)
            SetTile(ShareDot, ShareText, ShareDetail, Green, T("main.sharing"),
                live.Watchers switch { 0 => T("main.watchersNone"), 1 => T("main.watchersOne"), var n => T("main.watchersMany", n) });
        else if (_engine.State is SimState.Waiting or SimState.PlaybackFinished || session is null)
            SetTile(ShareDot, ShareText, ShareDetail, Grey, T("main.notSharing"), problem ?? T("main.sharingStarts"));
        else
            SetTile(ShareDot, ShareText, ShareDetail, problem is null ? Amber : Red, T("main.notSharing"), problem ?? T("main.connecting"));

        if (!_engine.TryGetLatest(out var d) || d.IsOnTrack != true)
        {
            LiveSpeedText.Text = LiveGearText.Text = LiveCurrentText.Text = LiveLastText.Text = LiveBestText.Text = LiveDeltaText.Text = LiveAreaText.Text = "—";
            LiveDeltaText.Foreground = Fg;
            LiveLapText.Text = session is null ? T("main.lapNone") : T("main.inGarage");
            return;
        }
        var metric = _engine.Metric;
        LiveSpeedUnitText.Text = Loc.SpeedUnit(metric);
        LiveSpeedText.Text = d.Speed is { } speed
            ? Math.Round(speed * (metric ? MetersPerSecondToKph : MetersPerSecondToMph)).ToString("0", Culture)
            : "—";
        LiveGearText.Text = d.Gear switch { null => "—", -1 => "R", 0 => "N", var g => g.Value.ToString(Culture) };
        var pct = Math.Clamp(d.LapDistPct ?? 0, 0, 1);
        LiveLapText.Text = (d.Lap is { } lap ? T("main.lap", lap) : T("main.lapNone"))
            + (d.PlayerCarPosition is > 0 and var position ? $" · P{position}" : "")
            + $" · {T("main.around", pct * 100)}"
            + (d.OnPitRoad == true ? $" · {T("main.pitRoad")}" : "");
        LiveCurrentText.Text = LapTime(d.LapCurrentLapTime);
        LiveLastText.Text = LapTime(d.LapLastLapTime);
        LiveBestText.Text = LapTime(d.LapBestLapTime);
        if (d.LapBestLapTime is > 0 && d.LapDeltaToBestLap is { } delta)
        {
            LiveDeltaText.Text = $"{(delta > 0 ? "+" : delta < 0 ? "−" : "")}{Math.Abs(delta):0.000}";
            LiveDeltaText.Foreground = delta > 0.0005 ? Red : delta < -0.0005 ? Green : Fg;
        }
        else
        {
            LiveDeltaText.Text = "—";
            LiveDeltaText.Foreground = Fg;
        }
        LiveAreaText.Text = TrackMap.AreaAt(pct)?.Name ?? (map is { Areas.Count: > 0 } ? T("main.betweenAreas") : "—");
    }

    private void Satellite_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        // XAML sets Value inside InitializeComponent, before the map exists
        if (SatelliteText is null || TrackMap is null)
            return;
        SatelliteText.Text = $"{(int)SatelliteSlider.Value}%";
        TrackMap.ImageryOpacity = SatelliteSlider.Value / 100;
        _satelliteSave.Stop();
        if ((int)SatelliteSlider.Value != _satelliteSaved)
            _satelliteSave.Start();
    }

    private void SaveSatelliteOpacity()
    {
        _satelliteSave.Stop();
        _satelliteSaved = (int)SatelliteSlider.Value;
        var settings = CollectorSettings.Load();
        settings.SatelliteOpacity = _satelliteSaved;
        settings.Save();
    }

    private void OpenLiveRacing_Click(object sender, RoutedEventArgs e) => Open($"{_siteUrl}/live-racing");

    private void SimulatorCombo_SelectionChanged(object sender, System.Windows.Controls.SelectionChangedEventArgs e)
    {
        if (!IsLoaded || SimulatorCombo.SelectedItem is not System.Windows.Controls.ComboBoxItem { Tag: string id } || id == _engine.Simulator)
            return;
        // The lap being driven is only saved once it's complete
        if (_engine.State == SimState.Connected && MessageBox.Show(this, T("main.switchSimulatorConfirm"), T("main.simulatorTitle"),
                MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes)
        {
            SimulatorCombo.SelectedItem = SimulatorCombo.Items.Cast<System.Windows.Controls.ComboBoxItem>()
                .First(item => (string)item.Tag == _engine.Simulator);
            return;
        }
        _engine.SelectSimulator(id);
        ShowSteeringRange();
    }

    // ACC's and AC's Wheel rotation: shown while either is picked, with the saved value (picking one saves the default
    // the first time)
    private void ShowSteeringRange()
    {
        var kunos = _engine.Simulator is Simulators.AccFrameBuilder.SimulatorId or Simulators.AcFrameBuilder.SimulatorId;
        SteeringRangePanel.Visibility = kunos ? Visibility.Visible : Visibility.Collapsed;
        SteeringRangeBox.Text = _engine.SteeringRange?.ToString(CultureInfo.InvariantCulture) ?? "";
        ShowSteeringRangeHint(null);
    }

    // key: a Loc key for a problem with what was typed, else the box's own state
    private void ShowSteeringRangeHint(string? key)
    {
        key ??= _engine.SteeringRange is null ? "main.wheelRotationMissing" : null;
        SteeringRangeHint.Visibility = key is null ? Visibility.Collapsed : Visibility.Visible;
        SteeringRangeHint.Foreground = key is null ? Muted : Amber;
        SteeringRangeHint.Text = key is null ? "" : T(key);
    }

    private void SteeringRangeBox_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter)
            SaveSteeringRange();
    }

    private void SteeringRangeBox_LostFocus(object sender, KeyboardFocusChangedEventArgs e) => SaveSteeringRange();

    private void SaveSteeringRange()
    {
        var text = SteeringRangeBox.Text.Trim();
        if (text.Length == 0)
        {
            _engine.SetSteeringRange(null);
            ShowSteeringRangeHint(null);
            return;
        }
        if (!int.TryParse(text, NumberStyles.None, CultureInfo.InvariantCulture, out var degrees)
            || degrees < Simulators.AccFrameBuilder.MinSteeringRange || degrees > Simulators.AccFrameBuilder.MaxSteeringRange)
        {
            ShowSteeringRangeHint("main.wheelRotationInvalid");
            return;
        }
        _engine.SetSteeringRange(degrees);
        ShowSteeringRangeHint(null);
    }

    private void RefreshStatus()
    {
        PoliciesBanner.Visibility = _engine.PoliciesAccepted == false ? Visibility.Visible : Visibility.Collapsed;
        RefreshRotationButton();
        var iRacing = _engine.Simulator == IRacingAdapter.Id;
        var ac = _engine.Simulator == Simulators.AcFrameBuilder.SimulatorId;
        var connected = _engine.State is SimState.Connected or SimState.PlayingBack;
        switch (_engine.State)
        {
            case SimState.Waiting:
                SetTile(SimDot, SimText, SimDetail, Amber, T(iRacing ? "main.waitingForIRacing" : ac ? "main.waitingForAc" : "main.waitingForAcc"),
                    T(iRacing ? "main.startIRacing" : ac ? "main.startAc" : "main.startAcc"));
                break;
            case SimState.Connected:
                SetTile(SimDot, SimText, SimDetail, Green, T("main.connected"), T("main.samplesPerSecond", _engine.SamplesPerSecond));
                break;
            case SimState.PlayingBack:
                SetTile(SimDot, SimText, SimDetail, Blue, T("main.playingBackShort"), Path.GetFileName(_engine.PlaybackFile) ?? "");
                break;
            case SimState.PlaybackFinished:
                SetTile(SimDot, SimText, SimDetail, Grey, T("main.playbackFinished"), Path.GetFileName(_engine.PlaybackFile) ?? "");
                break;
        }

        var lapCount = _currentLaps?.Laps.Count ?? 0;
        var saved = lapCount switch { 0 => T("main.noLapsSaved"), 1 => T("main.lapsSavedOne"), _ => T("main.lapsSavedMany", lapCount) };
        var status = _engine.RecorderStatus;
        if (!connected)
            SetTile(RecordDot, RecordText, RecordDetail, Grey, T("main.notRecording"), saved);
        else if (status.StartsWith("lap", StringComparison.Ordinal))
            SetTile(RecordDot, RecordText, RecordDetail, Green, T("main.recordingLap", status.Split(' ')[1]), saved);
        else
            SetTile(RecordDot, RecordText, RecordDetail, Amber, T("main.ready"), T("main.recordingStarts"));

        var uploader = _engine.Uploader;
        switch (_uploadState)
        {
            case UploadSetupState.Checking:
                SetTile(UploadDot, UploadText, UploadDetail, Amber, T("main.checkingKey"), _siteUrl);
                break;
            case UploadSetupState.Off:
                SetTile(UploadDot, UploadText, UploadDetail, Grey, T("main.off"), _offReasonKey is null ? "" : T(_offReasonKey));
                break;
            case UploadSetupState.NoKey:
                SetTile(UploadDot, UploadText, UploadDetail, Amber, T("main.noKey"), T("main.pressUploadKey"));
                break;
            case UploadSetupState.Refused:
                SetTile(UploadDot, UploadText, UploadDetail, Red, T("main.keyNotAccepted"), T("main.pressUploadKeyNew"));
                break;
            case UploadSetupState.Active when uploader is null:
                break;
            case UploadSetupState.Active when uploader.KeyRejected:
                SetTile(UploadDot, UploadText, UploadDetail, Red, T("main.keyNotAccepted"), T("main.pressUploadKeyNew"));
                break;
            case UploadSetupState.Active when uploader.Offline:
                SetTile(UploadDot, UploadText, UploadDetail, Amber, T("main.siteUnreachable"), T("main.lapsWaiting", uploader.Pending));
                break;
            case UploadSetupState.Active:
                SetTile(UploadDot, UploadText, UploadDetail, Green, _account ?? T("main.uploading"), uploader.Pending > 0
                    ? T("main.uploadingLaps", uploader.Pending)
                    : T("main.allUploaded"));
                break;
        }

        var showPreferences = _uploadState == UploadSetupState.Active && _account is not null;
        PreferencesText.Visibility = showPreferences ? Visibility.Visible : Visibility.Collapsed;
        if (showPreferences)
            PreferencesText.Text = T("main.preferences", T("main.languageName"), T(_engine.Metric ? "main.metric" : "main.standard"));
        BeepsPanel.Visibility = PreferencesText.Visibility;
        // Put the controls back to the account's setting when it loads, unless a volume change is about to be saved
        if (showPreferences && _beepsShown != _engine.BrakeBeepsLoaded && !_beepsVolumeSave.IsEnabled)
            ShowBeeps();

        if (!iRacing)
            SetTile(IbtDot, IbtText, IbtDetail, Grey, T("main.iRacingOnly"), T(ac ? "main.positionsIRacingOnlyAc" : "main.positionsIRacingOnly"));
        else if (_engine.IbtFolder is null)
            SetTile(IbtDot, IbtText, IbtDetail, Grey, T(_engine.Playback ? "main.fromFile" : "main.off"),
                T(_engine.Playback ? "main.playbackHasPositions" : "main.positionsOff"));
        else if (_engine.RecordingIbt)
            SetTile(IbtDot, IbtText, IbtDetail, Green, T("main.recordingIbt"), T("main.ibtAdded"));
        else
            SetTile(IbtDot, IbtText, IbtDetail, Grey, T("main.notRecording"), T(connected ? "main.startsOnTrack" : "main.startsInCar"));
    }

    private void ShowBeeps()
    {
        _beepsShown = _engine.BrakeBeepsLoaded;
        BeepsCheck.IsChecked = _engine.BrakeBeepsOn;
        BeepsVolumeRow.Visibility = _engine.BrakeBeepsOn ? Visibility.Visible : Visibility.Collapsed;
        BeepsVolumeSlider.Value = _engine.BrakeBeepsVolume; // ValueChanged saves nothing that's already saved
        BeepsVolumeText.Text = $"{_engine.BrakeBeepsVolume}%";
    }

    private void BeepsCheck_Click(object sender, RoutedEventArgs e)
    {
        var on = BeepsCheck.IsChecked == true;
        BeepsVolumeRow.Visibility = on ? Visibility.Visible : Visibility.Collapsed;
        _engine.SetBrakeBeeps(on: on);
    }

    private void BeepsVolume_ValueChanged(object sender, RoutedPropertyChangedEventArgs<double> e)
    {
        // XAML sets Minimum/Value inside InitializeComponent, before _engine exists
        if (BeepsVolumeText is null || _engine is null)
            return; // still being built
        BeepsVolumeText.Text = $"{(int)BeepsVolumeSlider.Value}%";
        _beepsVolumeSave.Stop();
        if ((int)BeepsVolumeSlider.Value != _engine.BrakeBeepsVolume)
            _beepsVolumeSave.Start();
    }

    private void SaveBeepsVolume()
    {
        _beepsVolumeSave.Stop();
        var volume = (int)BeepsVolumeSlider.Value;
        if (volume != _engine.BrakeBeepsVolume)
            _engine.SetBrakeBeeps(volume: volume);
    }

    private void TestBeeps_Click(object sender, RoutedEventArgs e) => BrakeBeeps.PlayTest((int)BeepsVolumeSlider.Value);

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
        SkiesText.Text = session.Skies is { } skies ? Loc.TOr(_language ?? Loc.English, $"skies.{skies}", skies) : "";

        var hasSample = _engine.TryGetLatest(out var d);
        var type = hasSample && d.SessionNum is { } num ? session.SessionTypes.GetValueOrDefault(num) : null;
        SessionText.Text = type is null ? "—" : Loc.TOr(_language ?? Loc.English, $"sessionType.{type}", type);
        SessionDetail.Text = session.SubSessionId > 0 ? T("main.subsession", session.SubSessionId) : T("main.offlineSession");
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
            LapNumberText.Text = T("main.lapNone");
            LapProgressText.Text = "";
            CurrentLapText.Text = LastLapText.Text = BestLapText.Text = DeltaText.Text = "—";
            DeltaText.Foreground = Fg;
            return;
        }

        // In the user's Preferred Units (Account page): mph, or kph for Metric
        var metric = _engine.Metric;
        SpeedUnitText.Text = Loc.SpeedUnit(metric);
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
        SteeringText.Text = Math.Abs(steering) < 0.5 ? "0°" : $"{Math.Abs(steering):0}°{T(steering > 0 ? "left" : "right")}";

        var pct = Math.Clamp(d.LapDistPct ?? 0, 0, 1);
        LapScale.ScaleX = pct;
        LapNumberText.Text = d.Lap is { } lap ? T("main.lap", lap) + (d.PlayerCarPosition is > 0 and var p ? $" · P{p}" : "") : T("main.lapNone");
        LapProgressText.Text = T("main.around", pct * 100);

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
            >= UnlimitedSeconds => T("main.unlimited"),
            var s => TimeSpan.FromSeconds(s.Value).ToString(s >= 3600 ? @"h\:mm\:ss" : @"m\:ss", Culture),
        };
        LapsLeftText.Text = d.SessionLapsRemainEx switch
        {
            null or < 0 => "—",
            >= UnlimitedLaps => T("main.unlimited"),
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

        LapsTitle.Text = $"{T(_lapSavedThisRun ? "main.lapsThisSession" : "main.lastSession")} · {laps.Track.ToUpperInvariant()}";
        var best = laps.Laps.Count > 0 ? laps.Laps.Min(l => l.LapTimeSeconds) : 0;
        var uploading = _uploadState == UploadSetupState.Active;
        var positionsOn = _engine.IbtFolder is not null;

        // Newest first
        foreach (var lap in laps.Laps.OrderByDescending(l => l.RecordedAt))
        {
            var isBest = lap.LapTimeSeconds == best;
            var notes = new List<string>();
            if (lap.PitRoad) notes.Add(T("main.pitRoad"));
            if (lap.OffTrack) notes.Add(T("main.offTrack"));
            if (lap.MissingSamples > 0) notes.Add(T("main.samplesMissing", lap.MissingSamples));

            var (upload, uploadBrush, uploadTip) = lap switch
            {
                { Uploaded: true, CsvDeleted: true } => (T("main.uploaded"), Green, T("main.uploadedCsvDeleted")),
                { Uploaded: true } => (T("main.uploaded"), Green, T("main.onSite")),
                { UploadError: { } error } when error.StartsWith("track and car unknown", StringComparison.Ordinal) => (T("main.savedOnly"), Grey, error),
                { UploadError: { } error } => (T("main.notUploaded"), Red, error),
                _ when uploading => (T("main.waiting"), Amber, T("main.queued")),
                _ => (T("main.savedOnPc"), Grey, T("main.uploadingOff")),
            };
            var (positions, positionsBrush, positionsTip) = lap switch
            {
                { HasPosition: true } => (T("main.added"), Green, T("main.addedTip")),
                { PositionMissing: true } => (T("main.notAvailable"), Grey, T("main.notAvailableTip")),
                _ when positionsOn => (T("main.afterStint"), Amber, T("main.afterStintTip")),
                _ => ("—", Grey, T("main.positionsOffTip")),
            };

            _laps.Add(new LapRow
            {
                Lap = lap.LapNumber.ToString(Culture),
                Time = LapTime(lap.LapTimeSeconds),
                Gap = isBest ? T("main.bestLap") : $"+{lap.LapTimeSeconds - best:0.000}",
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
        LapsSummaryText.Text = T(laps.Laps.Count == 1 ? "main.lapsSummaryOne" : "main.lapsSummaryMany", laps.Laps.Count, LapTime(best), uploaded);
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

    private void OpenLogFile_Click(object sender, RoutedEventArgs e) => Open(ActivityLog.Shared.FilePath);
    private void OpenSite_Click(object sender, RoutedEventArgs e) => Open(_siteUrl);
    private void OpenAccount_Click(object sender, RoutedEventArgs e) => Open($"{_siteUrl}/account");

    // The running TelemetryEngine.js, or a new one (null if it doesn't load)
    private OverlayFeed? OpenOverlayFeed()
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
            return null;
        }
        ActivityLog.Shared.Write($"Overlay opened (TelemetryEngine.js: {overlay.ScriptSource}).");
        _engine.Overlay = overlay;
        return _overlayFeed = new OverlayFeed(_engine, overlay);
    }

    // Stops TelemetryEngine.js once the Target Telemetry window has closed
    private void CloseOverlayFeed()
    {
        if (_targetTelemetryWindow is not null || _overlayFeed is null)
            return;
        if (_engine.Overlay == _overlayFeed.Overlay)
            _engine.Overlay = null;
        _overlayFeed = null;
    }

    // Rotation Overlay is for Coaches and Admins: shown once the upload key's account is known to be one, and its
    // window closed if the account stops being one
    private void RefreshRotationButton()
    {
        var allowed = _uploadState == UploadSetupState.Active && _engine.CanCoach;
        RotationButton.Visibility = allowed ? Visibility.Visible : Visibility.Collapsed;
        if (!allowed && _rotationWindow is not null)
            _rotationWindow.Close();
    }

    // Opens the Rotation window (or brings it to the front): live steering, yaw, velocities, accelerations and pedals
    private void Rotation_Click(object sender, RoutedEventArgs e)
    {
        if (!_engine.CanCoach)
            return;
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
        _targetTelemetryWindow = new TargetTelemetryWindow(_engine, OpenOverlayFeed());
        _targetTelemetryWindow.Closed += (_, _) =>
        {
            _targetTelemetryWindow = null;
            CloseOverlayFeed();
        };
        _targetTelemetryWindow.Show();
    }

    // Opens the Steering Overlay (or brings it to the front): the Target Lap's steering (blue) and the driver's
    // (orange) scrolling past the car's position on track, with the difference between them
    private void Steering_Click(object sender, RoutedEventArgs e)
    {
        if (_steeringWindow is not null)
        {
            _steeringWindow.Activate();
            return;
        }
        _steeringWindow = new SteeringWindow(_engine);
        _steeringWindow.Closed += (_, _) => _steeringWindow = null;
        _steeringWindow.Show();
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
        _rotationWindow?.Close();
        _brakePracticeWindow?.Close();
        _targetTelemetryWindow?.Close();
        _steeringWindow?.Close();
        _radioWindow?.Close();
        ClosingOverlay.Visibility = Visibility.Visible;
        _timer.Stop();
        _micMeter.Dispose();
        CompositionTarget.Rendering -= OnLiveRacingFrame;
        if (_satelliteSave.IsEnabled)
            SaveSatelliteOpacity();
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
