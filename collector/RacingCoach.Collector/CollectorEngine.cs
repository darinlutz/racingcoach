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
/// splits it into laps (LapRecorder), saves them (LapWriter), uploads them (LapUploader) and adds track
/// positions from iRacing's .ibt files (IbtEnricher). The window shows its state: it reads Latest, Session
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
    private readonly object _sampleLock = new();
    private TelemetryData _latest;
    private bool _hasLatest;
    private LapUploader? _uploader;
    private ITelemetryClient<TelemetryData>? _client;

    // .ibt recording: asked for once per connection (so turning it off with Alt+L sticks), and
    // a finished recording is the cue to add track positions to the stint's laps
    private bool _askedForIbt;
    private bool _wasRecordingIbt;

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
        Rotation = new RotationMonitor(message => Log(message));
        Voice.UseSite(() => Api, message => Log(message)); // speech in the user's coach voice
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
    /// <summary>The overlay's TelemetryEngine.js while the overlay is open; it gets every telemetry sample.</summary>
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
        _coach.Refresh(); // the plan comes from the account the key belongs to
        if (old is not null)
            _ = old.DisposeAsync().AsTask(); // its queued laps are queued again on the new one
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
            if (_uploader is not null)
                await _uploader.DisposeAsync(); // give queued uploads a few seconds; the rest go next run
            await _writer.DisposeAsync(); // record the last upload results in session.json
        }
    }

    private TelemetryHandlers<TelemetryData> Handlers() => new()
    {
        OnConnectStateChanged = state =>
        {
            _askedForIbt = false;
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

            _coach.SetTrack(_recorder.Session.Track);
            Rotation.SetCar(string.IsNullOrWhiteSpace(driver?.CarPath) ? null : driver.CarPath, Session.Car);

            // iRacing re-sends session info every few seconds (flags, driver list, ...); only log changes
            if (previous is null || previous.Track != Session.Track || previous.TrackConfig != Session.TrackConfig || previous.Car != Session.Car)
                Log($"Session: {_recorder.Session.Track} / {Session.Car}");
            return Task.CompletedTask;
        },
        OnTelemetryUpdate = data =>
        {
            _recorder.OnSample(data);
            Overlay?.OnSample(data, Session);
            _coach.OnSample(data);
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
