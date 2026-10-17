using Microsoft.Extensions.Logging.Abstractions;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>Command line options. A played-back .ibt file (with a speed multiplier) replaces live iRacing.</summary>
internal sealed record CollectorOptions(string? IbtFile, int Speed, bool SetKey, bool NoUpload, bool Upload, string? SiteUrl, bool NoPositions)
{
    public bool Playback => IbtFile is not null;
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
    private readonly object _sampleLock = new();
    private TelemetryData _latest;
    private bool _hasLatest;
    private LapUploader? _uploader;
    private ITelemetryClient<TelemetryData>? _client;

    // .ibt recording: asked for once per connection (so turning it off with Alt+L sticks), and
    // a finished recording is the cue to add track positions to the stint's laps
    private bool _askedForIbt;
    private bool _wasRecordingIbt;
    // Getting back in the car in the same iRacing session can leave recording turned on but not recording (no
    // .ibt file, so the stint's laps never get positions): then it's started again, once per time in the car
    private static readonly TimeSpan IbtStartGrace = TimeSpan.FromSeconds(5);
    private DateTime? _inCarSince;
    private bool _restartedIbt;

    // Samples per second, measured over the last second
    private int _samplesInWindow;
    private DateTime _windowStart = DateTime.UtcNow;

    /// <param name="log">Called with each activity message, and whether it's an error.</param>
    /// <param name="lapsChanged">Called when a session folder's laps change (saved, uploaded, positions added).</param>
    public CollectorEngine(CollectorOptions options, Action<string, bool> log, Action<SessionLaps> lapsChanged)
    {
        _options = options;
        _log = log;
        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        LapsFolder = Path.Combine(documents, "RacingCoach", "Laps");

        // Live telemetry has no track positions; iRacing only writes them to its .ibt files, so live laps get
        // them from there after each stint. Played-back laps have them already.
        _enricher = options.Playback || options.NoPositions
            ? null
            : new IbtEnricher(Path.Combine(documents, "iRacing", "telemetry"), message => Log(message));
        _writer = new LapWriter(LapsFolder, _enricher, message => Log(message)) { LapsChanged = lapsChanged };
        _recorder = new LapRecorder(_writer.Enqueue, message => Log(message));
        _debrief = new SessionDebrief(() => Api, message => Log(message));
        _coach = new InCarCoach(() => Api, message => Log(message));
        _brakeBeeps = new BrakeBeeps(() => Api, message => Log(message));
        // Played-back races are past ones, maybe not the user's, so only with --upload
        _races = options.Playback && !options.Upload
            ? null
            : new RaceResultTracker(Path.Combine(documents, "RacingCoach", "Races"), message => Log(message));
        Rotation = new RotationMonitor(message => Log(message));
        Voice.UseSite(() => Api, message => Log(message)); // speech in the user's coach voice
        _logs = new LogUploader(() => Api); // the activity log, to the user's account
    }

    public string LapsFolder { get; }
    /// <summary>Where iRacing's .ibt files are read from, or null when track positions are off.</summary>
    public string? IbtFolder => _enricher?.IbtFolder;
    public bool Playback => _options.Playback;
    public string? PlaybackFile => _options.IbtFile;

    public SimState State { get; private set; } = SimState.Waiting;
    public SessionDetails? Session { get; private set; }
    /// <summary>iRacing is writing an .ibt file right now.</summary>
    public bool RecordingIbt { get; private set; }
    public string RecorderStatus => _recorder.Status;
    public double SamplesPerSecond { get; private set; }
    public LapUploader? Uploader => _uploader;
    /// <summary>The site connection for the upload key in use, or null without one (the overlay loads Track Data with it).</summary>
    public RacingCoachApi? Api { get; private set; }
    /// <summary>The In-Car AI Coach: the user's instructions as rules on live telemetry, and lap feedback.</summary>
    public InCarCoach Coach => _coach;
    /// <summary>The Rotation Model on live telemetry: understeer and oversteer for the overlay and Rotation window.</summary>
    public RotationMonitor Rotation { get; }
    /// <summary>The user's Preferred Units on the Account page are Metric (meters, kph, °C, liters) rather than
    /// Standard (feet, mph, °F, gallons). Loaded with the upload key, and again at each new track or car so a
    /// change on the Account page shows from the next session; Standard without a key.</summary>
    public bool Metric { get; private set; }
    /// <summary>The user's Preferred Language on the Account page ("en", "pt" or "es"), which the overlays are in.
    /// Loaded with the units; English without a key.</summary>
    public string Language { get; private set; } = Loc.English;
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
        RefreshUnits(); // and the units and language
        if (old is not null)
            _ = old.DisposeAsync().AsTask(); // its queued laps are queued again on the new one
    }

    // Loads the user's Preferred Units and Language in the background; until then (or if the site can't be reached)
    // the last ones stay
    private void RefreshUnits()
    {
        if (Api is not { } api)
        {
            Metric = false;
            Language = Loc.English;
            BrakeBeepsOn = true;
            BrakeBeepsVolume = BrakeBeeps.DefaultVolume;
            BrakeBeepsLoaded++;
            PoliciesAccepted = null;
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
                    BrakeBeepsOn = preferences.BrakeBeeps ?? true;
                    BrakeBeepsVolume = Math.Clamp(preferences.BrakeBeepsVolume ?? BrakeBeeps.DefaultVolume, 10, 100);
                    BrakeBeepsLoaded++;
                    PoliciesAccepted = preferences.PoliciesAccepted;
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
        IBTOptions? ibtOptions = _options.IbtFile is null ? null : new IBTOptions(_options.IbtFile, _options.Speed);
        // Playback waits for each handler call instead of dropping samples when it runs faster than we keep up.
        var clientOptions = ibtOptions is null ? new ClientOptions() : new ClientOptions { DeliveryMode = TelemetryDeliveryMode.Synchronous };

        Log(ibtOptions is null ? "Waiting for iRacing…" : $"Playing back {Path.GetFileName(_options.IbtFile)}…");
        if (ibtOptions is not null)
            State = SimState.PlayingBack;
        if (_enricher is not null)
            Log($"Track positions are added after each stint from iRacing's .ibt files in {_enricher.IbtFolder}");

        try
        {
            await using var client = TelemetryClient<TelemetryData>.Create(NullLogger.Instance, ibtOptions, clientOptions);
            _client = client;
            await client.Monitor(Handlers(), cancel);
            if (ibtOptions is not null)
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
            _client = null;
            await _writer.FlushAsync(); // finish saving laps already completed (which queues their uploads)
            if (_races is not null)
            {
                _races.SaveUnfinished(); // a race still going, as it stands
                await _races.FinishUploadsAsync(TimeSpan.FromSeconds(5));
            }
            if (_uploader is not null)
                await _uploader.DisposeAsync(); // give queued uploads a few seconds; the rest go next run
            await _writer.DisposeAsync(); // record the last upload results in session.json
            await _logs.DisposeAsync(); // the last activity log lines
        }
    }

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
                sessionTypes);

            TrackKeys.Set(_recorder.Session.Track, weekend?.TrackName, weekend?.TrackLength, weekend?.TrackLatitude, weekend?.TrackLongitude); // before anything asks the site about the track
            _coach.SetTrack(_recorder.Session.Track);
            _brakeBeeps.SetTrack(_recorder.Session.Track, Session.TrackLength);
            _races?.OnSessionInfo(session, _recorder.Session.Track, Session.Car);
            Rotation.SetCar(string.IsNullOrWhiteSpace(driver?.CarPath) ? null : driver.CarPath, Session.Car);

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
            Overlay?.OnSample(data, Session);
            _coach.OnSample(data);
            if (!Playback)
                _brakeBeeps.OnSample(data); // a played-back file can run far faster than real time
            _races?.OnSample(data.SessionNum, data.SessionTime);
            Rotation.OnSample(data);
            lock (_sampleLock)
            {
                _latest = data;
                _hasLatest = true;
            }

            _samplesInWindow++;
            var now = DateTime.UtcNow;
            if (now - _windowStart >= TimeSpan.FromSeconds(1))
            {
                SamplesPerSecond = _samplesInWindow / (now - _windowStart).TotalSeconds;
                _samplesInWindow = 0;
                _windowStart = now;
            }

            if (_enricher is not null)
            {
                // iRacing only records while the driver is in the car
                if (!_askedForIbt && data.IsOnTrack == true && data.IsDiskLoggingEnabled == false)
                {
                    _askedForIbt = true;
                    _client?.SimControl.TelemetryRecording.Start();
                    Log("Turned on iRacing's telemetry recording (.ibt) for track positions.");
                }
                var recordingIbt = data.IsDiskLoggingActive == true;
                if (data.IsOnTrack == true)
                {
                    _inCarSince ??= now;
                    if (!_restartedIbt && !recordingIbt && data.IsDiskLoggingEnabled == true && now - _inCarSince >= IbtStartGrace)
                    {
                        _restartedIbt = true;
                        _client?.SimControl.TelemetryRecording.Start();
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

    private void Log(string message, bool isError = false) => _log(message, isError);
}
