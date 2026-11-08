using RacingCoach.Collector.Simulators;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>Command line options. A played-back .ibt file (with a speed multiplier) replaces live iRacing.
/// Simulator is --simulator: null is the window's Simulator picker (iRacing unless ACC was picked); "auto" looks for a
/// running simulator, and otherwise it's a simulator's id, which the picker then remembers.</summary>
internal sealed record CollectorOptions(string? IbtFile, int Speed, bool SetKey, bool NoUpload, bool Upload, string? SiteUrl, bool NoPositions, string? Simulator = null, bool RecordRaw = false, int? SteeringRange = null)
{
    public const string AutoSimulator = "auto";
    public bool Playback => IbtFile is not null;
}

/// <summary>The simulators this build can read. Adding one is adding its adapter here.</summary>
internal static class SimulatorRegistry
{
    /// <summary>iRacing, which --simulator auto chooses from, plus ACC unless it's auto: ACC is supported
    /// (simulators/capabilities.json, so the website takes its laps), but detecting it beside iRacing isn't proven, so
    /// it's only read when picked (the window's Simulator picker, or --simulator acc).</summary>
    /// <param name="named">ACC's id to include it, or null for auto.</param>
    /// <param name="rawRecordingFolder">--record-raw: where adapters that can write their simulator's raw data (ACC's
    /// shared memory pages) do, else null.</param>
    /// <param name="steeringRange">The driver's wheel rotation, lock to lock in degrees, for ACC's steering angle.</param>
    public static IReadOnlyList<ISimulatorAdapter> Create(IRacingAdapter iRacing, string? named = null, string? rawRecordingFolder = null, Action<string>? log = null, int? steeringRange = null) =>
        named == AccFrameBuilder.SimulatorId ? [iRacing, new AccAdapter(rawRecordingFolder, log, steeringRange)] : [iRacing];
}

/// <summary>Track, car, driver and session details from iRacing's session info, for the window.</summary>
internal sealed record SessionDetails(
    string Track,
    string? TrackConfig,
    string? TrackLength,
    string? TrackLocation,
    string Car,
    string? CarNumber,
    string? CarClass,
    string Driver,
    string? Skies,
    IReadOnlyDictionary<int, string> SessionTypes,
    int SessionId,
    int SubSessionId);

/// <summary>Connected to iRacing (or playing a file back), and whether iRacing is recording an .ibt file.</summary>
internal enum SimState
{
    Waiting,
    Connected,
    PlayingBack,
    PlaybackFinished,
}

/// <summary>
/// Everything the collector does, without any UI: reads telemetry (live, or from a played-back .ibt file),
/// splits it into laps (LapRecorder), saves them (LapWriter), uploads them (LapUploader), adds track
/// positions from iRacing's .ibt files (IbtEnricher) and saves and uploads race results (RaceResultTracker). The window shows its state: it reads Latest, Session
/// and the other properties on a timer, and gets messages and lap changes through callbacks, which are
/// called on background threads.
/// </summary>
internal sealed class CollectorEngine
{
    private readonly CollectorOptions _options;
    private readonly Action<string, bool> _log;
    private readonly LapWriter _writer;
    private readonly LapRecorder _recorder;
    private readonly IbtEnricher? _enricher;
    private readonly SessionDebrief _debrief;
    private readonly InCarCoach _coach;
    private readonly BrakeBeeps _brakeBeeps;
    private readonly RaceResultTracker? _races;
    private readonly LogUploader _logs;
    private readonly string _documents;
    private readonly object _sampleLock = new();
    private TelemetryData _latest;
    private bool _hasLatest;
    private LapUploader? _uploader;
    private readonly IRacingAdapter _iRacing;
    private readonly IReadOnlyList<ISimulatorAdapter> _adapters;

    // The Simulator picker: which simulator is read, and the run that reads it, cancelled to switch
    private string _simulator = IRacingAdapter.Id;
    private CancellationTokenSource? _simulatorRun;
    private static readonly TimeSpan SimulatorRetry = TimeSpan.FromSeconds(2);
    // Another simulator's session (ACC's), its Track Data mapping and the key it was looked up with, and the tracks
    // already logged as not mapped
    private SimulatorSession? _canonicalSession;
    private (string Track, RacingCoachApi? Api)? _mappedFor;
    private readonly HashSet<string> _unmappedLogged = new(StringComparer.OrdinalIgnoreCase);
    private string _canonicalStatus = "waiting for the start/finish line";
    // The track and Track Data key the coach and brake beeps were last given (ApplyCanonicalTrack)
    private string? _appliedTrack;
    private string? _appliedKey;

    // .ibt recording: asked for once per connection (so turning it off with Alt+L sticks), and
    // a finished recording is the cue to add track positions to the stint's laps
    private bool _askedForIbt;
    private bool _wasRecordingIbt;
    // Getting back in the car in the same iRacing session can leave recording turned on but not recording (no
    // .ibt file, so the stint's laps never get positions): then it's started again, once per time in the car
    private static readonly TimeSpan IbtStartGrace = TimeSpan.FromSeconds(5);
    // How often the Preferred Units and Language are loaded again while telemetry is coming in
    private static readonly TimeSpan UnitsReloadEvery = TimeSpan.FromMinutes(1);
    private DateTime _unitsLoadedAt;
    private DateTime? _inCarSince;
    private bool _restartedIbt;

    // Samples per second, measured over the last second
    private int _samplesInWindow;
    private DateTime _windowStart = DateTime.UtcNow;

    /// <param name="log">Called with each activity message, and whether it's an error.</param>
    /// <param name="lapsChanged">Called when a session folder's laps change (saved, uploaded, positions added).</param>
    /// <param name="documents">The Documents folder (the user's own, unless a test gives it another).</param>
    /// <param name="adapters">The simulators to choose from with --simulator (the registry's, unless a test gives others).</param>
    public CollectorEngine(CollectorOptions options, Action<string, bool> log, Action<SessionLaps> lapsChanged, string? documents = null, IReadOnlyList<ISimulatorAdapter>? adapters = null)
    {
        _options = options;
        _log = log;
        _iRacing = new IRacingAdapter(options.IbtFile, options.Speed);
        documents ??= Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var settings = CollectorSettings.Load();
        // --steering-range is remembered, so it's given once
        if (options.SteeringRange is { } range && range != settings.SteeringRange)
        {
            settings.SteeringRange = range;
            settings.Save();
        }
        _adapters = adapters ?? SimulatorRegistry.Create(_iRacing, options.Simulator == CollectorOptions.AutoSimulator ? null : AccFrameBuilder.SimulatorId, options.RecordRaw ? Path.Combine(documents, "RacingCoach", "Raw") : null, message => Log(message), settings.UsableSteeringRange);
        SteeringRange = settings.UsableSteeringRange;
        // The live features read ACC's samples as TelemetryData, like iRacing's
        foreach (var acc in _adapters.OfType<AccAdapter>())
            acc.Live = OnLiveSample;
        // The picker's simulator; --simulator <id> picks it for this run and is remembered (not with a test's own
        // adapters, which mustn't change the PC's settings), and a played-back file is iRacing's
        if (adapters is null && options.Simulator is { } named && IsPickable(named) && named != settings.Simulator)
        {
            settings.Simulator = named;
            settings.Save();
        }
        _simulator = options.Playback || (options.Simulator is { } given && !IsPickable(given))
            ? IRacingAdapter.Id
            : options.Simulator ?? (IsPickable(settings.Simulator) ? settings.Simulator : IRacingAdapter.Id);
        if (adapters is null)
            DefaultSteeringRange(); // a first ACC run gets a steering angle (not a test's, which mustn't change the PC's settings)
        _documents = documents;
        LapsFolder = Path.Combine(documents, "RacingCoach", "Laps");

        // Live telemetry has no track positions; iRacing only writes them to its .ibt files, so live laps get
        // them from there after each stint. Played-back laps have them already.
        _enricher = options.Playback || options.NoPositions
            ? null
            : new IbtEnricher(Path.Combine(documents, "iRacing", "telemetry"), message => Log(message));
        _writer = new LapWriter(LapsFolder, _enricher, message => Log(message))
        {
            LapsChanged = lapsChanged,
            PlaybackStartedAt = options.IbtFile is null ? null : PlaybackStart(options.IbtFile),
        };
        _recorder = new LapRecorder(_writer.Enqueue, message => Log(message));
        _debrief = new SessionDebrief(() => Api, message => Log(message));
        _coach = new InCarCoach(() => Api, message => Log(message));
        _brakeBeeps = new BrakeBeeps(() => Api, message => Log(message));
        // Played-back races are past ones, maybe not the user's, so only with --upload
        _races = options.Playback && !options.Upload
            ? null
            : new RaceResultTracker(Path.Combine(documents, "RacingCoach", "Races"), message => Log(message));
        Rotation = new RotationMonitor(message => Log(message));
        Live = new LiveRacing(() => Api, message => Log(message));
        MicRecorder.DeviceName = settings.Microphone;
        Radio = new DriverRadio(() => Api, _coach.SessionLaps, Log, settings.RadioButton);
        Voice.UseSite(() => Api, () => Language, message => Log(message)); // speech in the user's coach voice
        _logs = new LogUploader(() => Api); // the activity log, to the user's account
    }

    public string LapsFolder { get; }
    /// <summary>Where iRacing's .ibt files are read from, or null when track positions are off.</summary>
    public string? IbtFolder => _enricher?.IbtFolder;
    public bool Playback => _options.Playback;

    // When the played-back file's session started, for its laps' times; null if the file doesn't say (they get now)
    private static DateTimeOffset? PlaybackStart(string ibtFile)
    {
        try
        {
            return new IbtFile(ibtFile).StartedAt;
        }
        catch (Exception e) when (e is IOException or InvalidDataException or UnauthorizedAccessException)
        {
            return null;
        }
    }
    public string? PlaybackFile => _options.IbtFile;

    public SimState State { get; private set; } = SimState.Waiting;
    public SessionDetails? Session { get; private set; }
    /// <summary>iRacing is writing an .ibt file right now.</summary>
    public bool RecordingIbt { get; private set; }
    public string RecorderStatus => _simulator == IRacingAdapter.Id ? _recorder.Status : _canonicalStatus;

    /// <summary>The simulators the window's Simulator picker offers, by id, with their names.</summary>
    public static readonly IReadOnlyList<(string Id, string Name)> PickableSimulators =
        [(IRacingAdapter.Id, "iRacing"), (AccFrameBuilder.SimulatorId, "Assetto Corsa Competizione")];

    private static bool IsPickable(string id) => PickableSimulators.Any(s => s.Id == id);

    /// <summary>The simulator being read: the picker's ("iracing" or "acc").</summary>
    public string Simulator => _simulator;
    /// <summary>The picker can change the simulator: not while playing an .ibt file back, or with --simulator auto.</summary>
    public bool CanPickSimulator => !Playback && (_options.Simulator is null || IsPickable(_options.Simulator));
    /// <summary>The upload key's account is a Coach or an Admin (the Rotation Overlay button is theirs only). Loaded
    /// with the units; false without a key.</summary>
    public bool CanCoach { get; private set; }

    /// <summary>The window's Simulator picker: saves it and reads that simulator from now on. A lap in progress isn't
    /// saved; laps already completed are.</summary>
    public void SelectSimulator(string id)
    {
        if (!CanPickSimulator || !IsPickable(id) || id == _simulator)
            return;
        var settings = CollectorSettings.Load();
        settings.Simulator = id;
        settings.Save();
        _simulator = id;
        Log($"Simulator: {PickableSimulators.First(s => s.Id == id).Name}.");
        DefaultSteeringRange();
        _simulatorRun?.Cancel(); // RunAsync starts reading the new one
    }

    /// <summary>ACC's steering angle is its input times half the driver's wheel rotation, which ACC doesn't share: the
    /// window's Wheel rotation, lock to lock in degrees (saved as steeringRange; --steering-range sets it too), or null
    /// for no steering angle.</summary>
    public int? SteeringRange { get; private set; }

    /// <summary>The rotation a first ACC session gets until the driver sets their own: most direct-drive wheels'.</summary>
    public const int DefaultSteeringRangeDegrees = 900;

    /// <summary>The window's Wheel rotation: saved, and ACC's steering angle uses it from the next sample. Null (an
    /// empty box) leaves the angle out, and says so.</summary>
    public void SetSteeringRange(int? degrees)
    {
        if (degrees is { } d && (d < AccFrameBuilder.MinSteeringRange || d > AccFrameBuilder.MaxSteeringRange))
            return;
        if (degrees == SteeringRange)
            return;
        var settings = CollectorSettings.Load();
        settings.SteeringRange = degrees ?? CollectorSettings.SteeringRangeCleared;
        settings.Save();
        UseSteeringRange(degrees);
        Log(degrees is { } set
            ? $"Wheel rotation: {set}°, for ACC's steering angle."
            : "Wheel rotation cleared: ACC laps and overlays have no steering angle until it's set.", isError: degrees is null);
    }

    private void UseSteeringRange(int? degrees)
    {
        SteeringRange = degrees;
        foreach (var acc in _adapters.OfType<AccAdapter>())
            acc.SteeringRange = degrees;
    }

    // Reading ACC with no wheel rotation ever saved gives it the default, so a new driver gets a steering angle without
    // knowing about it; the window shows it to change. One the driver cleared stays cleared.
    private void DefaultSteeringRange()
    {
        var settings = CollectorSettings.Load();
        if (_simulator != AccFrameBuilder.SimulatorId || settings.SteeringRange is not null)
            return;
        settings.SteeringRange = DefaultSteeringRangeDegrees;
        settings.Save();
        UseSteeringRange(DefaultSteeringRangeDegrees);
        Log($"Wheel rotation set to {DefaultSteeringRangeDegrees}° for ACC's steering angle. If your wheel is set to another rotation in ACC, change it under the Simulator picker.");
    }
    public double SamplesPerSecond { get; private set; }
    public LapUploader? Uploader => _uploader;
    /// <summary>The site connection for the upload key in use, or null without one (the overlay loads Track Data with it).</summary>
    public RacingCoachApi? Api { get; private set; }
    /// <summary>The In-Car AI Coach: the user's instructions as rules on live telemetry, and lap feedback.</summary>
    public InCarCoach Coach => _coach;
    /// <summary>The Rotation Model on live telemetry: understeer and oversteer for the overlay and Rotation window.</summary>
    public RotationMonitor Rotation { get; }
    /// <summary>Live Racing: the driver's live position, sent to the website, and the track's map for the Live Racing tab.</summary>
    public LiveRacing Live { get; }
    /// <summary>Driver Radio: hold the radio button and speak, and it's shown as text in the sim and on Live Racing.</summary>
    public DriverRadio Radio { get; }
    /// <summary>The user's Preferred Units on the Account page are Metric (meters, kph, °C, liters) rather than
    /// Standard (feet, mph, °F, gallons). Loaded with the upload key, again at each new track or car, and every
    /// minute while telemetry comes in, so a change on the Account page shows within a minute; Standard without a
    /// key.</summary>
    public bool Metric { get; private set; }
    /// <summary>The user's Preferred Language on the Account page ("en", "pt", "es" or "de"), which the overlays are in.
    /// Loaded with the units; Windows' display language (when it's one of those, else English) without a key.</summary>
    public string Language { get; private set; } = Loc.SystemLanguage;
    /// <summary>"Beeps before braking" and its volume (10-100%), shown and changed under the Preferred Language and
    /// Units in the window and saved to the account (SetBrakeBeeps). Loaded with the units.</summary>
    public bool BrakeBeepsOn { get; private set; } = true;
    public int BrakeBeepsVolume { get; private set; } = BrakeBeeps.DefaultVolume;
    /// <summary>Goes up each time the beeps setting is loaded from the account, so the window puts its controls back
    /// to it.</summary>
    public int BrakeBeepsLoaded { get; private set; }
    /// <summary>False when the upload key's account hasn't accepted the current Terms of Service and Privacy Policy
    /// (the window then asks the user to review them on the website); null until known, or without a key. Loaded with
    /// the units, after reporting the installer's acceptance (<see cref="LegalAcceptance"/>).</summary>
    public bool? PoliciesAccepted { get; private set; }
    // The upload key whose account the installer's acceptance was reported to (once per key and run)
    private RacingCoachApi? _legalReportedTo;
    /// <summary>TelemetryEngine.js while the Target Telemetry window is open; it gets every telemetry sample.</summary>
    public OverlayEngine? Overlay { get; set; }

    /// <summary>The latest telemetry sample, if there's been one since connecting.</summary>
    public bool TryGetLatest(out TelemetryData data)
    {
        lock (_sampleLock)
        {
            data = _latest;
            return _hasLatest;
        }
    }

    /// <summary>Uploads laps with this key from now on (null: stop uploading). Laps that haven't uploaded
    /// yet, including earlier runs', are queued again.</summary>
    public void UseApi(RacingCoachApi? api)
    {
        var old = _uploader;
        Api = api;
        _uploader = api is null ? null : new LapUploader(api, (item, error) =>
        {
            _writer.RecordUploadResult(item, error);
            _debrief.OnUploaded(item, error);
            _coach.OnUploaded(item, error);
        }, message => Log(message));
        _writer.SetUploader(_uploader);
        _races?.UseApi(api);
        _coach.Refresh(); // the plan comes from the account the key belongs to
        _brakeBeeps.Refresh(); // and so do the brakepoints and the beeps setting
        Live.Refresh(); // and the track's map
        RefreshUnits(); // and the units and language
        if (_canonicalSession is { } session)
            MapCanonicalTrack(session); // and which Track Data track ACC's is
        if (old is not null)
            _ = old.DisposeAsync().AsTask(); // its queued laps are queued again on the new one
    }

    // Loads the user's Preferred Units and Language in the background; until then (or if the site can't be reached)
    // the last ones stay
    private void RefreshUnits()
    {
        _unitsLoadedAt = DateTime.UtcNow;
        if (Api is not { } api)
        {
            Metric = false;
            Language = Loc.SystemLanguage;
            BrakeBeepsOn = true;
            BrakeBeepsVolume = BrakeBeeps.DefaultVolume;
            BrakeBeepsLoaded++;
            PoliciesAccepted = null;
            CanCoach = false;
            return;
        }
        _ = Task.Run(async () =>
        {
            try
            {
                await ReportLegalAcceptanceAsync(api);
                var preferences = await api.GetPreferencesAsync(CancellationToken.None);
                if (Api == api)
                {
                    Metric = preferences.Metric;
                    Language = preferences.Language;
                    var beepsOn = preferences.BrakeBeeps ?? true;
                    var beepsVolume = Math.Clamp(preferences.BrakeBeepsVolume ?? BrakeBeeps.DefaultVolume, 10, 100);
                    // Only when they've changed, so the reload every minute doesn't move the controls under the user
                    if (beepsOn != BrakeBeepsOn || beepsVolume != BrakeBeepsVolume || BrakeBeepsLoaded == 0)
                    {
                        BrakeBeepsOn = beepsOn;
                        BrakeBeepsVolume = beepsVolume;
                        BrakeBeepsLoaded++;
                    }
                    PoliciesAccepted = preferences.PoliciesAccepted;
                    CanCoach = preferences.CanCoach;
                }
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UnauthorizedAccessException or System.Text.Json.JsonException)
            {
                // the window asks for a new key when it's refused; otherwise the next track tries again
            }
        });
    }

    // Tells the key's account which Terms of Service and Privacy Policy versions this PC's installer accepted, once
    // per key; tried again at the next track if the site can't be reached
    private async Task ReportLegalAcceptanceAsync(RacingCoachApi api)
    {
        if (_legalReportedTo == api || LegalAcceptance.Read() is not { } acceptance)
            return;
        try
        {
            if (await api.ReportLegalAcceptanceAsync(acceptance, CancellationToken.None))
                Log($"Recorded on your account: the Terms of Service ({acceptance.TermsVersion}) and Privacy Policy ({acceptance.PrivacyVersion}) accepted when the collector was installed.");
            _legalReportedTo = api;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            // the preferences still load; reported at the next track
        }
    }

    /// <summary>The window's "Beeps before braking" checkbox (on) or volume slider (volume, 10-100): saved to the
    /// account in the background, and the beeps take it up as soon as it's saved. If it can't be saved, the account's
    /// setting is loaded back into the window.</summary>
    /// <summary>Loads the brake beeps' brakepoints again now, e.g. after picking a new Target Lap on the site.</summary>
    public void ReloadBrakeBeeps() => _brakeBeeps.Reload();

    public void SetBrakeBeeps(bool? on = null, int? volume = null)
    {
        if (Api is not { } api)
            return;
        if (on is { } o)
            BrakeBeepsOn = o;
        if (volume is { } v)
            BrakeBeepsVolume = v;
        _ = Task.Run(async () =>
        {
            try
            {
                await api.SaveBrakeBeepsAsync(on, volume, CancellationToken.None);
                _brakeBeeps.Reload();
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UnauthorizedAccessException)
            {
                Log($"Couldn't save the beeps setting ({e.Message}).", isError: true);
                RefreshUnits();
            }
        });
    }

    /// <summary>Runs until cancelled (or a played-back file ends), then finishes saving laps and gives queued
    /// uploads a few seconds.</summary>
    public async Task RunAsync(CancellationToken cancel)
    {
        _writer.Start();
        var playback = _options.IbtFile is not null;

        Log(_options.Simulator == CollectorOptions.AutoSimulator ? "Looking for a simulator…" : playback ? $"Playing back {Path.GetFileName(_options.IbtFile)}…" : WaitingMessage());
        if (playback)
            State = SimState.PlayingBack;
        if (_enricher is not null)
            Log($"Track positions are added after each stint from iRacing's .ibt files in {_enricher.IbtFolder}");
        // Not while playing a file back, which may be an old .ibt from that folder
        if (!playback)
        {
            var ibtFolder = Path.Combine(_documents, "iRacing", "telemetry");
            _ = Task.Run(() => IbtEnricher.DeleteOldIbtFiles(ibtFolder, message => Log(message)));
        }

        var live = Live.RunAsync(cancel);
        try
        {
            if (playback)
                await _iRacing.RunNativeAsync(Handlers(), cancel);
            else if (_options.Simulator is { } named && !IsPickable(named))
                await RunSelectedAsync(named, cancel); // auto, or an id with no adapter, which is an error, never iRacing instead
            else
                await RunPickedAsync(cancel);
            if (playback)
            {
                State = SimState.PlaybackFinished;
                Log("Playback finished.");
            }
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            // closing
        }
        finally
        {
            await _writer.FlushAsync(); // finish saving laps already completed (which queues their uploads)
            if (_races is not null)
            {
                _races.SaveUnfinished(); // a race still going, as it stands
                await _races.FinishUploadsAsync(TimeSpan.FromSeconds(5));
            }
            if (_uploader is not null)
                await _uploader.DisposeAsync(); // give queued uploads a few seconds; the rest go next run
            await _writer.DisposeAsync(); // record the last upload results in session.json
            await Task.WhenAny(live, Task.Delay(TimeSpan.FromSeconds(5))); // Live Racing: the driver has gone
            Radio.Dispose();
            await _logs.DisposeAsync(); // the last activity log lines
        }
    }

    private string WaitingMessage() => _simulator == IRacingAdapter.Id ? "Waiting for iRacing…" : "Waiting for Assetto Corsa Competizione…";

    // The picker's simulator, until closing; picking another (SelectSimulator) cancels this run and starts its own.
    // iRacing keeps its own path, with .ibt track positions and race results; ACC's laps go through the shared
    // pipeline, and its samples to the same live features (OnLiveSample).
    private async Task RunPickedAsync(CancellationToken cancel)
    {
        while (!cancel.IsCancellationRequested)
        {
            using var run = CancellationTokenSource.CreateLinkedTokenSource(cancel);
            _simulatorRun = run;
            var simulator = _simulator;
            try
            {
                if (simulator == IRacingAdapter.Id)
                    await _iRacing.RunNativeAsync(Handlers(), run.Token);
                else
                    await new SimulatorSupervisor(_adapters, simulator, Log).RunAsync(RunCanonicalAsync, run.Token);
            }
            catch (OperationCanceledException) when (run.IsCancellationRequested && !cancel.IsCancellationRequested)
            {
                // switched to another simulator
            }
            finally
            {
                _simulatorRun = null;
            }
            if (cancel.IsCancellationRequested)
                break;
            Stopped(simulator);
            if (simulator == _simulator)
                await Task.Delay(SimulatorRetry, cancel); // it ended on its own; try again
            else
                Log(WaitingMessage());
        }
    }

    // A simulator's reading ended because another was picked: what its disconnecting would have done
    private void Stopped(string simulator)
    {
        lock (_sampleLock)
            _hasLatest = false;
        Rotation.Clear();
        State = SimState.Waiting;
        Session = null;
        _canonicalSession = null;
        _canonicalStatus = "waiting for the start/finish line";
        Live.OnDisconnected();
        if (simulator == IRacingAdapter.Id)
        {
            RecordingIbt = _wasRecordingIbt = false;
            _writer.AddPositionsFromIbt();
            _races?.SaveUnfinished();
        }
    }

    // --simulator auto: runs whichever simulator is found, one at a time
    private Task RunSelectedAsync(string simulator, CancellationToken cancel)
    {
        var manual = simulator == CollectorOptions.AutoSimulator ? null : simulator;
        var supervisor = new SimulatorSupervisor(_adapters, manual, Log);
        return supervisor.RunAsync(async (adapter, ct) =>
        {
            if (adapter is IRacingAdapter iRacing)
            {
                await iRacing.RunNativeAsync(Handlers(), ct);
                return;
            }
            await RunCanonicalAsync(adapter, ct);
        }, cancel);
    }

    // A simulator other than iRacing: laps through the shared pipeline; its adapter gives the live features its samples
    private async Task RunCanonicalAsync(ISimulatorAdapter adapter, CancellationToken cancel)
    {
        State = SimState.Connected;
        try
        {
            await new CanonicalLapPipeline(adapter, _writer.Enqueue, Log) { SessionChanged = OnCanonicalSession }.RunAsync(cancel);
        }
        finally
        {
            State = SimState.Waiting;
            Session = null;
            _canonicalSession = null;
            lock (_sampleLock)
                _hasLatest = false;
            Rotation.Clear();
            Live.OnDisconnected();
        }
    }

    // ACC's session: the window's details, and the track for the live features once its Track Data mapping is known
    private void OnCanonicalSession(SimulatorSession s)
    {
        var previous = Session;
        Session = new SessionDetails(s.Track, s.TrackLayout, LengthText(TrackKeys.LengthFeet(s.Track)), null, s.Car, null, null,
            s.Driver, null, s.SessionTypes, s.SessionId, s.SubSessionId);
        _canonicalSession = s;
        Rotation.SetCar(s.NativeCarId, s.Car); // no Rotation Model calibration for ACC's cars yet, so it stays UNKNOWN
        Live.SetField(0, null, []);
        Live.SetSetup(null, null, null);
        if (previous is null || previous.Track != s.Track || previous.Car != s.Car)
        {
            Log($"Session: {s.Track} / {s.Car}");
            RefreshUnits();
            if (s.SimulatorId == AccFrameBuilder.SimulatorId && SteeringRange is null)
                Log("No wheel rotation is set, so this session's ACC laps and overlays have no steering angle. Set your wheel's rotation (as in ACC, e.g. 900) under the Simulator picker.", isError: true);
        }
        MapCanonicalTrack(s);
    }

    // Finds the Track Data track ACC's is mapped to (the Coach page's Simulator Mapping), so the coach, brake beeps,
    // overlays and Live Racing get its focus areas, Target Lap and map as iRacing's do; then gives them the track.
    // Looked up again with a new upload key.
    private void MapCanonicalTrack(SimulatorSession s)
    {
        var api = Api;
        if (_mappedFor is { } done && done.Track == s.Track && done.Api == api)
        {
            ApplyCanonicalTrack(s, TrackKeys.For(s.Track) is null ? null : LiveTrackName(s.Track));
            return;
        }
        _mappedFor = (s.Track, api);
        if (api is null || s.NativeTrackId is not { } nativeKey)
        {
            TrackKeys.SetMapped(s.Track, null, null);
            ApplyCanonicalTrack(s, null);
            return;
        }
        _ = Task.Run(async () =>
        {
            SimulatorTrackInfo? site = null;
            try
            {
                site = await api.GetSimulatorTrackAsync(s.SimulatorId, nativeKey, s.Track, CancellationToken.None);
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UnauthorizedAccessException or System.Text.Json.JsonException)
            {
                Log($"Couldn't find which Track Data track {s.Track} is ({e.Message}); trying again with the next session.", isError: true);
                _mappedFor = null;
            }
            if (_canonicalSession?.Track != s.Track || Api != api)
                return; // moved on meanwhile
            TrackKeys.SetMapped(s.Track, site?.TrackKey, site?.LengthFeet);
            _siteTrackNames[s.Track] = site?.TrackName ?? s.Track;
            if (site is null && _mappedFor is not null && _unmappedLogged.Add(s.Track))
                Log($"{s.Track} isn't mapped to a Track Data track yet, so the In-Car AI Coach, brake beeps and overlays have no focus areas or Target Lap for it. A Coach can map it in the Coach page's Simulator Mapping.");
            else if (site is not null)
                Log($"{s.Track} is Track Data's {site.TrackName ?? site.TrackKey}.");
            ApplyCanonicalTrack(s, site is null ? null : LiveTrackName(s.Track));
        });
    }

    private readonly System.Collections.Concurrent.ConcurrentDictionary<string, string> _siteTrackNames = new(StringComparer.OrdinalIgnoreCase);
    private string LiveTrackName(string track) => _siteTrackNames.TryGetValue(track, out var name) ? name : track;

    private void ApplyCanonicalTrack(SimulatorSession s, string? siteName)
    {
        var length = LengthText(TrackKeys.LengthFeet(s.Track));
        if (Session is { } details && details.Track == s.Track)
            Session = details with { TrackLength = length };
        // The coach and brake beeps ask the site by the laps' name, with Track Data's key (TrackKeys); a key found
        // after they loaded (the same name) loads them again
        var key = TrackKeys.For(s.Track);
        var keyChanged = _appliedTrack == s.Track && _appliedKey != key;
        (_appliedTrack, _appliedKey) = (s.Track, key);
        _coach.SetTrack(s.Track);
        _brakeBeeps.SetTrack(s.Track, length);
        if (keyChanged)
        {
            _coach.Reload();
            _brakeBeeps.Reload();
        }
        Live.SetTrack(siteName ?? s.Track, TrackKeys.For(s.Track), s.Car, s.SessionTypes, new Dictionary<int, string>(), null);
    }

    // A length in feet as iRacing's session info writes it ("7.00 km"), which the beeps and overlays read
    private static string? LengthText(double? feet) =>
        feet is > 0 and var f ? (f / 3.28084 / 1000).ToString("0.000", System.Globalization.CultureInfo.InvariantCulture) + " km" : null;

    private TelemetryHandlers<TelemetryData> Handlers() => new()
    {
        OnConnectStateChanged = state =>
        {
            _askedForIbt = false;
            _inCarSince = null;
            _restartedIbt = false;
            lock (_sampleLock)
                _hasLatest = false;
            Rotation.Clear();
            if (state == ConnectState.Connected)
            {
                if (!Playback)
                    State = SimState.Connected;
                Log(Playback ? "Reading the file." : "Connected to iRacing.");
            }
            else if (!Playback)
            {
                State = SimState.Waiting;
                Session = null;
                RecordingIbt = _wasRecordingIbt = false;
                Log("Disconnected from iRacing. Waiting for iRacing…");
                _writer.AddPositionsFromIbt(); // iRacing closed its .ibt file
                _races?.SaveUnfinished(); // left a race before its result was official
                Live.OnDisconnected();
            }
            return Task.CompletedTask;
        },
        OnSessionInfoUpdate = session =>
        {
            var weekend = session.WeekendInfo;
            var track = weekend?.TrackDisplayName ?? "Unknown Track";
            var config = string.IsNullOrWhiteSpace(weekend?.TrackConfigName) ? null : weekend.TrackConfigName;
            var driverIdx = session.DriverInfo?.DriverCarIdx;
            var driver = session.DriverInfo?.Drivers?.FirstOrDefault(d => d.CarIdx == driverIdx);
            var sessionTypes = session.SessionInfo?.Sessions?.ToDictionary(s => s.SessionNum, s => s.SessionType) ?? [];
            var location = string.Join(", ", new[] { weekend?.TrackCity, weekend?.TrackCountry }.Where(s => !string.IsNullOrWhiteSpace(s)));

            var previous = Session;
            Session = new SessionDetails(
                track,
                config,
                weekend?.TrackLength,
                location.Length > 0 ? location : null,
                driver?.CarScreenName ?? "Unknown Car",
                driver?.CarNumber,
                string.IsNullOrWhiteSpace(driver?.CarClassShortName) ? null : driver.CarClassShortName,
                driver?.UserName ?? "Unknown Driver",
                weekend?.TrackSkies,
                sessionTypes,
                weekend?.SessionID ?? 0,
                weekend?.SubSessionID ?? 0);

            _recorder.Session = new SessionContext(
                config is null ? track : $"{track} ({config})",
                Session.Car,
                Session.Driver,
                Session.SessionId,
                Session.SubSessionId,
                sessionTypes,
                session.DriverInfo?.DriverCarFuelKgPerLtr,
                session.SessionInfo?.Sessions?
                    .Where(s => !string.IsNullOrWhiteSpace(s.SessionTrackRubberState))
                    .ToDictionary(s => s.SessionNum, s => s.SessionTrackRubberState!.Trim()),
                // iRacing's folder for the car (e.g. mercedesw13), which the site finds its picture by, as CarScreenName varies
                CarKey: string.IsNullOrWhiteSpace(driver?.CarPath) ? null : driver.CarPath.Trim());

            TrackKeys.Set(_recorder.Session.Track, weekend?.TrackName, weekend?.TrackLength, weekend?.TrackLatitude, weekend?.TrackLongitude); // before anything asks the site about the track
            _coach.SetTrack(_recorder.Session.Track);
            _brakeBeeps.SetTrack(_recorder.Session.Track, Session.TrackLength);
            _races?.OnSessionInfo(session, _recorder.Session.Track, Session.Car);
            Rotation.SetCar(string.IsNullOrWhiteSpace(driver?.CarPath) ? null : driver.CarPath, Session.Car);
            var sessionNames = session.SessionInfo?.Sessions?
                .Where(s => !string.IsNullOrWhiteSpace(s.SessionName))
                .ToDictionary(s => s.SessionNum, s => s.SessionName!.Trim()) ?? [];
            Live.SetTrack(_recorder.Session.Track, TrackKeys.For(_recorder.Session.Track), Session.Car, sessionTypes, sessionNames,
                string.IsNullOrWhiteSpace(weekend?.TrackWeatherType) ? null : weekend.TrackWeatherType.Trim());
            Live.SetField(weekend?.SubSessionID ?? 0, driverIdx, FieldDrivers(session));
            Live.SetSetup(session.DriverInfo?.DriverSetupName, session.DriverInfo?.DriverSetupLoadTypeName,
                session.DriverInfo?.DriverSetupIsModified is { } modified ? modified != 0 : null);

            // iRacing re-sends session info every few seconds (flags, driver list, ...); only log changes
            if (previous is null || previous.Track != Session.Track || previous.TrackConfig != Session.TrackConfig || previous.Car != Session.Car)
            {
                Log($"Session: {_recorder.Session.Track} / {Session.Car}");
                RefreshUnits(); // a change on the Account page shows from the next session
            }
            return Task.CompletedTask;
        },
        OnTelemetryUpdate = data =>
        {
            _recorder.OnSample(data);
            _races?.OnSample(data.SessionNum, data.SessionTime);
            OnLiveSample(data);
            var now = DateTime.UtcNow;

            if (_enricher is not null)
            {
                // iRacing only records while the driver is in the car
                if (!_askedForIbt && data.IsOnTrack == true && data.IsDiskLoggingEnabled == false)
                {
                    _askedForIbt = true;
                    _iRacing.StartDiskRecording();
                    Log("Turned on iRacing's telemetry recording (.ibt) for track positions.");
                }
                var recordingIbt = data.IsDiskLoggingActive == true;
                if (data.IsOnTrack == true)
                {
                    _inCarSince ??= now;
                    if (!_restartedIbt && !recordingIbt && data.IsDiskLoggingEnabled == true && now - _inCarSince >= IbtStartGrace)
                    {
                        _restartedIbt = true;
                        _iRacing.StartDiskRecording();
                        Log("iRacing's telemetry recording (.ibt) was on but not recording; started it again for track positions.");
                    }
                }
                else
                {
                    _inCarSince = null;
                    _restartedIbt = false;
                }
                if (_wasRecordingIbt && !recordingIbt)
                    _writer.AddPositionsFromIbt(); // left the car: the stint's .ibt file is done
                RecordingIbt = _wasRecordingIbt = recordingIbt;
            }
            return Task.CompletedTask;
        },
        OnError = error =>
        {
            Log($"SDK error: {error.Message}", isError: true);
            return Task.CompletedTask;
        },
    };

    // Every live sample, iRacing's or ACC's (AccLiveTelemetry): the overlays, coach, brake beeps, Rotation Model, Live
    // Racing, Driver Radio and the window. On the thread reading telemetry.
    private void OnLiveSample(TelemetryData data)
    {
        Overlay?.OnSample(data, Session);
        _coach.OnSample(data);
        if (!Playback)
            _brakeBeeps.OnSample(data); // a played-back file can run far faster than real time
        Rotation.OnSample(data);
        Live.OnSample(data);
        Radio.OnSample(data);
        lock (_sampleLock)
        {
            _latest = data;
            _hasLatest = true;
        }
        if (_simulator != IRacingAdapter.Id)
            _canonicalStatus = data.IsOnTrack == true && data.OnPitRoad != true && data.Lap is { } lap
                ? $"lap {lap}"
                : "waiting for the start/finish line";

        _samplesInWindow++;
        var now = DateTime.UtcNow;
        if (now - _windowStart >= TimeSpan.FromSeconds(1))
        {
            SamplesPerSecond = _samplesInWindow / (now - _windowStart).TotalSeconds;
            _samplesInWindow = 0;
            _windowStart = now;
        }
        // A change of units or language on the Account page shows within a minute, not only at the next session
        if (Api is not null && now - _unitsLoadedAt >= UnitsReloadEvery)
            RefreshUnits();
    }

    private void Log(string message, bool isError = false) => _log(message, isError);

    // Every car in the session for Live Racing's field, leaving out the pace car and spectators
    private static List<FieldDriver> FieldDrivers(TelemetrySessionInfo session) =>
        session.DriverInfo?.Drivers?
            .Where(d => d.CarIsPaceCar != 1 && d.IsSpectator != 1 && !string.IsNullOrWhiteSpace(d.UserName))
            .Select(d => new FieldDriver(
                d.CarIdx,
                d.UserName!.Trim(),
                string.IsNullOrWhiteSpace(d.CarNumber) ? null : d.CarNumber.Trim(),
                string.IsNullOrWhiteSpace(d.CarScreenNameShort) ? d.CarScreenName : d.CarScreenNameShort,
                string.IsNullOrWhiteSpace(d.CarClassShortName) ? null : d.CarClassShortName.Trim(),
                d.CarClassColor > 0 ? $"#{d.CarClassColor & 0xFFFFFF:x6}" : null,
                d.IRating > 0 ? d.IRating : null,
                string.IsNullOrWhiteSpace(d.LicString) ? null : d.LicString.Trim(),
                string.IsNullOrWhiteSpace(d.FlairName) ? null : d.FlairName.Trim()))
            .ToList() ?? [];
}
