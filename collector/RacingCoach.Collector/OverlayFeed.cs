namespace RacingCoach.Collector;

/// <summary>
/// TelemetryEngine.js (OverlayEngine) and the user's Track Data for the current track, shared by the windows that
/// show its values: the overlay, and the Target Telemetry window's copies of its boxes. One engine runs however
/// many of them are open, since the script is slow (MainWindow creates it for the first and drops it after the
/// last). Each window calls <see cref="Refresh"/> from its own timer; the track loads again whenever it changes.
/// </summary>
internal sealed class OverlayFeed
{
    // After the site couldn't be reached, try loading the track again this often
    private static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);

    private readonly CollectorEngine _engine;

    // The track (and connection) Track Data was last asked for, and how that went
    private string? _loadedTrack;
    private RacingCoachApi? _loadedWith;
    private bool _loading;
    // Why the focus areas aren't showing: a Loc key, and what fills its {0}
    private (string Key, string? Arg)? _loadProblem;
    private DateTime _retryAt;

    public OverlayFeed(CollectorEngine engine, OverlayEngine overlay)
    {
        _engine = engine;
        Overlay = overlay;
    }

    public OverlayEngine Overlay { get; }

    /// <summary>The track as the collector names the session's laps, which is how Track Data names tracks; null
    /// before session info arrives.</summary>
    public string? Track
    {
        get
        {
            var session = _engine.Session;
            return session is null ? null : session.TrackConfig is null ? session.Track : $"{session.Track} ({session.TrackConfig})";
        }
    }

    /// <summary>Loads the track's Track Data when it (or the upload key) changed, or again after a problem, and
    /// answers what the script shows now, in the user's Preferred Language.</summary>
    public OverlaySnapshot Refresh()
    {
        var track = Track;
        var api = _engine.Api;
        if (track is not null && !_loading && (track != _loadedTrack || api != _loadedWith || (_loadProblem is not null && DateTime.UtcNow >= _retryAt)))
            _ = LoadTrackAsync(track, api);
        Overlay.Language = _engine.Language;
        return Overlay.Snapshot();
    }

    /// <summary>Why the focus areas aren't showing (or that they're loading), or null when they are.</summary>
    public string? Status(string language, OverlaySnapshot snapshot) =>
        snapshot.Error is not null ? $"TelemetryEngine.js: {snapshot.Error}"
        : Track is null ? null
        : _loadProblem is { } problem ? Loc.T(language, problem.Key, problem.Arg)
        : _loading && snapshot.Track is null ? Loc.T(language, "overlay.loading") : null;

    private async Task LoadTrackAsync(string track, RacingCoachApi? api)
    {
        _loading = true;
        _loadedTrack = track;
        _loadedWith = api;
        try
        {
            if (api is null)
            {
                Overlay.SetTrack(track, null, metric: false);
                _loadProblem = ("overlay.noKey", null);
                _retryAt = DateTime.MaxValue; // loads again once a key is entered (the connection changes)
                return;
            }
            var (json, metric) = await api.GetTrackJsonAsync(track, CancellationToken.None);
            Overlay.SetTrack(track, json, metric);
            _loadProblem = json is null ? ("overlay.noTrack", track) : null;
            // Checked again now and then, so a track added on the site shows up without reopening the overlay
            _retryAt = DateTime.UtcNow + RetryAfter;
            if (json is not null)
                ActivityLog.Shared.Write($"Overlay: loaded the focus areas for {track}.");
        }
        catch (UnauthorizedAccessException)
        {
            Overlay.SetTrack(track, null, metric: false);
            _loadProblem = ("overlay.keyRefused", null);
            _retryAt = DateTime.MaxValue;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _loadProblem = ("overlay.unreachable", e.Message);
            _retryAt = DateTime.UtcNow + RetryAfter;
        }
        finally
        {
            _loading = false;
        }
    }
}
