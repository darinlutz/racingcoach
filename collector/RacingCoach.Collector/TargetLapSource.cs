namespace RacingCoach.Collector;

/// <summary>
/// The user's Target Lap for the Target Telemetry window: loads it from
/// /api/collector/target-lap for the track being driven, again when the track or the upload key changes, 30 seconds
/// after a failed load, and on Reload, and says what the window should show while it has no trace to draw. Call
/// <see cref="Update"/> every frame, on the UI thread.
/// </summary>
internal sealed class TargetLapSource(CollectorEngine engine)
{
    private static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);

    // What the Target Lap was loaded for: a different track or upload key loads it again
    private (string? Track, RacingCoachApi? Api)? _loadedFor;
    private RacingCoachApi? _site;
    private bool _loading;
    private string? _loadError;
    private DateTime _retryAt;
    private double _trackDataFeet;

    /// <summary>The Target Lap, or null when the user has none or it isn't loaded (yet).</summary>
    public TargetLapTrace? Lap { get; private set; }

    /// <summary>The user's Preferred Units are Metric.</summary>
    public bool Metric { get; private set; }

    /// <summary>The name the collector gives laps on this track, e.g. "Road Atlanta (Full Course)", or null before
    /// session info.</summary>
    public string? Track { get; private set; }

    /// <summary>Raised after each load: a new Target Lap (or none) and the units.</summary>
    public event Action? Loaded;

    /// <summary>The track's length: Track Data's, or iRacing's when Track Data has none (0 when neither is known).</summary>
    public double LengthFeet => _trackDataFeet > 0 ? _trackDataFeet : BrakeBeeps.IRacingLengthFeet(engine.Session?.TrackLength);

    /// <summary>Starts a load when the track or upload key changed, or a failed load is due again.</summary>
    public void Update()
    {
        Track = TrackName(engine.Session);
        _site = engine.Api;
        if (!_loading && (_loadedFor != (Track, _site) || (_loadError is not null && DateTime.UtcNow >= _retryAt)))
            _ = LoadAsync(Track, _site);
    }

    /// <summary>Loads the Target Lap again on the next frame, e.g. after changing it on the Account page.</summary>
    public void Reload()
    {
        if (!_loading)
            _loadedFor = null;
    }

    /// <summary>The user's Preferred Language, which the windows are in.</summary>
    public string Language => engine.Language;

    /// <summary>The status line under the window's title, the message to show over the plot instead of the trace
    /// (null to show the trace), and whether the status is a warning; in the user's Preferred Language.</summary>
    public (string Status, string? Message, bool Warning) Status(bool live, bool onTrack)
    {
        var language = Language;
        string status;
        string? message = null;
        var warning = false;
        if (_site is null)
            message = status = Loc.T(language, "target.noKey");
        else if (Lap is null && _loadError is not null)
        {
            status = Loc.T(language, "target.loadFailed", _loadError);
            message = Loc.T(language, "target.loadFailedShort");
        }
        else if (Lap is null)
            message = status = Loc.T(language, _loading ? "target.loading" : "target.none");
        else if (Lap.SameTrack == false)
        {
            status = Loc.T(language, "target.otherTrack", Lap.Track, Track);
            warning = true;
        }
        else if (LengthFeet <= 0)
            message = status = Loc.T(language, "target.waitingForTrack");
        else
            status = live ? Lap.FileName : Loc.T(language, "target.waitingForIRacing", Lap.FileName);
        if (Lap is not null && !onTrack && message is null)
            message = Loc.T(language, "target.waitingForCar");
        return (status, message, warning);
    }

    private static string? TrackName(SessionDetails? session) =>
        session is null || session.Track == "Unknown Track" ? null
        : session.TrackConfig is null ? session.Track
        : $"{session.Track} ({session.TrackConfig})";

    private async Task LoadAsync(string? track, RacingCoachApi? site)
    {
        _loadedFor = (track, site);
        _loadError = null;
        if (site is null)
        {
            SetLap(null);
            return; // loads once a key is entered
        }

        _loading = true;
        try
        {
            var response = await site.GetTargetLapAsync(track, CancellationToken.None);
            if (_loadedFor != (track, site))
                return; // the track or key changed meanwhile; that load is next
            _trackDataFeet = response.TrackLengthFeet;
            Metric = response.Units == "metric";
            SetLap(response.TargetLap);
            if (response.TargetLap is { } lap)
                ActivityLog.Shared.Write($"Target Lap loaded: {lap.FileName}");
        }
        catch (UnauthorizedAccessException)
        {
            // the main window asks for a new key; it loads again with it
            SetLap(null);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            _loadError = e.Message;
            _retryAt = DateTime.UtcNow + RetryAfter;
        }
        finally
        {
            _loading = false;
        }
    }

    private void SetLap(TargetLapTrace? lap)
    {
        Lap = lap;
        Loaded?.Invoke();
    }
}
