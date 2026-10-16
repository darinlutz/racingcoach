using System.Collections.Concurrent;
using System.Globalization;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// "Beeps before braking" from the window (saved to the account): on the approach to where the user's Target Lap first brakes in
/// each focus area (its first braking zone there; from /api/collector/brake-beeps), or without a Target Lap, each
/// focus area's target brakepoint from Track Data, a beep 300, 200 and 100 ft before it, and a higher one at the
/// brakepoint, at the volume of the slider under it (10-100%, in decibels: see Gain). The overlay used to show this as row colors (GetBrakepointAlertColor in
/// TelemetryEngine.js, now always Transparent); this runs whether the overlay is open or not. The brakepoints load
/// when the track or the upload key changes, and again every couple of minutes so a new Target Lap (or the
/// setting, changed on another PC) takes effect during a session. OnSample is called
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
    // The slider moves in decibels, as loudness is heard on a log scale: 100% is full volume, each 10 below it 4 dB
    // quieter. The window's Test button (PlayTest) plays at the same gain
    private const double VolumeRangeDb = 40;
    /// <summary>A new account's volume (DEFAULT_BRAKE_BEEPS_VOLUME in src/lib/brakeBeepsVolume.ts).</summary>
    public const int DefaultVolume = 65;
    // The test beeps' spacing, start to start: about as far apart as 100 ft takes at 110 mph
    private const int TestSpacingMs = 600;

    // Brakepoints as fractions of a lap, for the track being driven; replaced whole, so the telemetry thread reads
    // it without a lock. Null when beeps are off or there's nothing to beep for.
    private sealed record Loaded(double LengthFeet, IReadOnlyList<double> Brakepoints, double Volume);

    private readonly object _lock = new();
    private volatile Loaded? _loaded;
    private string? _track;
    private string? _iRacingLength;
    private string? _loadedTrack;
    private RacingCoachApi? _loadedWith;
    private DateTime _reloadAt = DateTime.MaxValue;
    private bool _loading;
    private bool _reloadWhenLoaded;
    private string? _lastStatus;

    // Only touched on the telemetry thread
    private volatile bool _resetLive;
    private float? _lastPct;

    // One beep at a time, in order, without holding up the telemetry thread
    private readonly BlockingCollection<(int Hz, int Ms, double Volume)> _beeps = [];
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

    /// <summary>Loads the targets again now, e.g. after the setting or volume was changed in the window.</summary>
    public void Reload()
    {
        lock (_lock)
        {
            if (_loading)
            {
                _reloadWhenLoaded = true; // the load under way may have the old setting
                return;
            }
            _reloadAt = DateTime.MinValue;
        }
        Refresh();
    }

    /// <summary>The window's Test button: the three warning beeps and the brakepoint one, at a slider volume, on
    /// their own thread.</summary>
    public static void PlayTest(int volumePercent) => Task.Run(() =>
    {
        try
        {
            using var tones = new TonePlayer();
            var volume = Gain(volumePercent);
            for (var i = 0; i < WarningFeet.Length; i++)
            {
                tones.Play(WarningHz, BeepMs, volume);
                Thread.Sleep(TestSpacingMs - BeepMs);
            }
            tones.Play(BrakepointHz, BrakepointBeepMs, volume);
        }
        catch (Exception e) when (e is InvalidOperationException or DllNotFoundException or EntryPointNotFoundException)
        {
            // no sound device
        }
    });

    private async Task LoadAsync(string track, string? iRacingLength, RacingCoachApi site)
    {
        var retry = ReloadEvery;
        try
        {
            var targets = await site.GetBrakeTargetsAsync(track, CancellationToken.None);
            // iRacing's length, or the site's (also iRacing's, from uploaded laps) when session info has none
            var lengthFeet = IRacingLengthFeet(iRacingLength) is > 0 and var feet ? feet : targets.TrackLengthFeet;
            // The Target Lap's come as fractions of a lap; Track Data's (without a Target Lap) in feet
            var brakepoints = lengthFeet > 0
                ? (targets.Brakepoints ?? [])
                    .Select(b => b.Pct ?? (b.Feet is { } feet && feet < lengthFeet ? feet / lengthFeet : -1))
                    .Where(pct => pct is >= 0 and < 1)
                    .ToList()
                : [];
            var areas = $"{brakepoints.Count} focus area{(brakepoints.Count == 1 ? "" : "s")}";

            string status;
            Loaded? loaded = null;
            if (!targets.Enabled)
                status = "Brake beeps are off (Beeps before braking, under your Language and Units).";
            else if (targets.TargetLap is { } lap && targets.SameTrack == false)
                status = $"Brake beeps: your Target Lap is from {lap.Track}, not {track}.";
            else if (lengthFeet <= 0)
                status = $"Brake beeps: no track length for {track}.";
            else if (brakepoints.Count == 0)
                status = targets.TargetLap is null
                    ? $"Brake beeps: no Target Lap, and no target brakepoints for {track} in your Track Data."
                    : $"Brake beeps: your Target Lap doesn't brake in any of {track}'s focus areas in your Track Data.";
            else
            {
                var volume = Math.Clamp(targets.Volume ?? DefaultVolume, 10, 100);
                status = targets.TargetLap is null
                    ? $"Brake beeps on for {track} at {volume}% volume: no Target Lap, so your Track Data target brakepoints in {areas}."
                    : $"Brake beeps on for {track} at {volume}% volume: the Target Lap's first braking in {areas}.";
                loaded = new Loaded(lengthFeet, brakepoints, Gain(volume));
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
            bool again;
            lock (_lock)
            {
                _loading = false;
                again = _reloadWhenLoaded;
                _reloadWhenLoaded = false;
                _reloadAt = again ? DateTime.MinValue : DateTime.UtcNow + retry;
            }
            if (again)
                Refresh();
        }
    }

    /// <summary>The slider's volume (10-100%) as the amplitude to play at, 0-1 of full: 50% is -20 dB, a tenth of
    /// full amplitude, and 10% is -36 dB.</summary>
    internal static double Gain(double volumePercent) => Math.Pow(10, (volumePercent - 100) / 100 * VolumeRangeDb / 20);

    /// <summary>iRacing's track length (e.g. "4.0900 km") in feet, or 0 if it can't be read.</summary>
    internal static double IRacingLengthFeet(string? length)
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
                        Play(BrakepointHz, BrakepointBeepMs, loaded.Volume);
                        continue;
                    }
                    foreach (var feet in WarningFeet)
                    {
                        if (before > feet && after <= feet)
                            Play(WarningHz, BeepMs, loaded.Volume);
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

    private void Play(int hz, int ms, double volume)
    {
        if (_player is null)
        {
            _player = new Thread(PlayAll) { IsBackground = true, Name = "Brake beeps" };
            _player.Start();
        }
        _beeps.Add((hz, ms, volume));
    }

    private void PlayAll()
    {
        using var tones = new TonePlayer();
        foreach (var (hz, ms, volume) in _beeps.GetConsumingEnumerable())
        {
            try
            {
                tones.Play(hz, ms, volume);
            }
            catch (Exception e) when (e is InvalidOperationException or DllNotFoundException or EntryPointNotFoundException)
            {
                // no sound device
            }
        }
    }
}
