using System.Collections.Concurrent;
using System.Globalization;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// "Play beeps before braking" from the Account page: on the approach to each focus area's target brakepoint (Track
/// Data, from /api/collector/track) a beep 300, 200 and 100 ft before it, and a higher one at the brakepoint. The
/// overlay used to show this as row colors (GetBrakepointAlertColor in TelemetryEngine.js, now always Transparent);
/// this runs whether the overlay is open or not. The targets load when the track or the upload key changes, and
/// again every couple of minutes so a change on the Account page takes effect during a session. OnSample is called
/// on the telemetry thread for every sample, so it only compares numbers; the beeps play on their own thread.
/// </summary>
internal sealed class BrakeBeeps(Func<RacingCoachApi?> api, Action<string> log)
{
    /// <summary>Feet before the brakepoint that get a warning beep, farthest first.</summary>
    private static readonly double[] WarningFeet = [300, 200, 100];
    private const int WarningHz = 1000;
    private const int BrakepointHz = 2000; // higher than the warnings
    private const int BeepMs = 120;
    private const int BrakepointBeepMs = 200;
    private const double FeetPerMeter = 3.280839895;
    private static readonly TimeSpan ReloadEvery = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(1);

    // Brakepoints as fractions of a lap, for the track being driven; replaced whole, so the telemetry thread reads
    // it without a lock. Null when beeps are off or there's nothing to beep for.
    private sealed record Loaded(double LengthFeet, IReadOnlyList<double> Brakepoints);

    private readonly object _lock = new();
    private volatile Loaded? _loaded;
    private string? _track;
    private string? _iRacingLength;
    private string? _loadedTrack;
    private RacingCoachApi? _loadedWith;
    private DateTime _reloadAt = DateTime.MaxValue;
    private bool _loading;
    private string? _lastStatus;

    // Only touched on the telemetry thread
    private volatile bool _resetLive;
    private float? _lastPct;

    // One beep at a time, in order, without holding up the telemetry thread
    private readonly BlockingCollection<(int Hz, int Ms)> _beeps = [];
    private Thread? _player;

    /// <summary>The track being driven (the name the collector gives its laps) and iRacing's length for it
    /// (e.g. "4.0900 km", used when Track Data has no length), from each session info update.</summary>
    public void SetTrack(string? track, string? iRacingLength)
    {
        lock (_lock)
        {
            _track = track;
            _iRacingLength = iRacingLength;
        }
        Refresh();
    }

    /// <summary>Loads the targets again if the track or the upload key changed, or a reload is due.</summary>
    public void Refresh()
    {
        string track;
        string? iRacingLength;
        RacingCoachApi? site;
        lock (_lock)
        {
            site = api();
            if (_track is null || _loading)
                return;
            var changed = _track != _loadedTrack || site != _loadedWith;
            if (!changed && DateTime.UtcNow < _reloadAt)
                return;
            if (changed)
            {
                _loaded = null;
                _resetLive = true;
            }
            track = _track;
            iRacingLength = _iRacingLength;
            _loadedTrack = track;
            _loadedWith = site;
            _reloadAt = DateTime.MaxValue;
            if (site is null)
                return; // loads once a key is entered
            _loading = true;
        }
        _ = Task.Run(() => LoadAsync(track, iRacingLength, site));
    }

    private async Task LoadAsync(string track, string? iRacingLength, RacingCoachApi site)
    {
        var retry = ReloadEvery;
        try
        {
            var targets = await site.GetBrakeTargetsAsync(track, CancellationToken.None);
            var lengthFeet = targets.TrackLengthFeet > 0 ? targets.TrackLengthFeet : IRacingLengthFeet(iRacingLength);
            var brakepoints = lengthFeet > 0
                ? targets.Brakepoints.Where(b => b.Feet < lengthFeet).Select(b => b.Feet / lengthFeet).ToList()
                : [];

            string status;
            Loaded? loaded = null;
            if (!targets.Enabled)
                status = "Brake beeps are off (Play beeps before braking on the Account page).";
            else if (brakepoints.Count == 0)
                status = $"Brake beeps: no target brakepoints for {track} in your Track Data" +
                         (lengthFeet > 0 ? "." : ", or no track length.");
            else
            {
                status = $"Brake beeps on for {track}: {brakepoints.Count} target brakepoint{(brakepoints.Count == 1 ? "" : "s")}.";
                loaded = new Loaded(lengthFeet, brakepoints);
            }

            lock (_lock)
            {
                if (_loadedTrack != track || _loadedWith != site)
                    return;
                _loaded = loaded;
                if (status == _lastStatus)
                    return;
                _lastStatus = status;
            }
            log(status);
        }
        catch (UnauthorizedAccessException)
        {
            // the window asks for a new key; the targets load again with it
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            log($"Brake beeps couldn't load the brakepoints for {track} ({e.Message}). Trying again in a minute.");
            retry = RetryAfter;
        }
        finally
        {
            lock (_lock)
            {
                _loading = false;
                _reloadAt = DateTime.UtcNow + retry;
            }
        }
    }

    // iRacing gives the length as e.g. "4.0900 km"
    private static double IRacingLengthFeet(string? length)
    {
        var parts = length?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts is [var number, "km"] && double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var km)
            ? km * 1000 * FeetPerMeter
            : 0;
    }

    /// <summary>Every telemetry sample: beeps when the car passes 300, 200 and 100 ft before a target brakepoint,
    /// and higher at it.</summary>
    public void OnSample(in TelemetryData data)
    {
        if (_resetLive)
        {
            _resetLive = false;
            _lastPct = null;
        }
        if (_loaded is not { } loaded || data.IsReplayPlaying == true || data.IsOnTrack != true || data.OnPitRoad == true
            || data.LapDistPct is not { } pct || pct < 0)
        {
            _lastPct = null;
            return;
        }

        if (_lastPct is { } previous)
        {
            var moved = pct - previous;
            if (moved < -0.5f)
                moved += 1; // across the start/finish line
            // Only driving forward; a tow or reset jumps the car, and that's not approaching anything
            if (moved > 0 && moved <= 0.05f)
            {
                foreach (var brakepoint in loaded.Brakepoints)
                {
                    var before = Ahead(previous, brakepoint) * loaded.LengthFeet;
                    var after = Ahead(pct, brakepoint) * loaded.LengthFeet;
                    if (after > before)
                    {
                        // Went past it: the distance ahead jumped from nothing to almost a lap
                        Play(BrakepointHz, BrakepointBeepMs);
                        continue;
                    }
                    foreach (var feet in WarningFeet)
                    {
                        if (before > feet && after <= feet)
                            Play(WarningHz, BeepMs);
                    }
                }
            }
        }
        _lastPct = pct;
    }

    // How far ahead of position the brakepoint is, as a fraction of a lap (0 to 1, around the start/finish line)
    private static double Ahead(double position, double brakepoint)
    {
        var ahead = brakepoint - position;
        return ahead < 0 ? ahead + 1 : ahead;
    }

    private void Play(int hz, int ms)
    {
        if (_player is null)
        {
            _player = new Thread(PlayAll) { IsBackground = true, Name = "Brake beeps" };
            _player.Start();
        }
        _beeps.Add((hz, ms));
    }

    private void PlayAll()
    {
        foreach (var (hz, ms) in _beeps.GetConsumingEnumerable())
        {
            try
            {
                Console.Beep(hz, ms);
            }
            catch (Exception e) when (e is InvalidOperationException or PlatformNotSupportedException)
            {
                // no sound device
            }
        }
    }
}
