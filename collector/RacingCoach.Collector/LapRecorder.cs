using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>Track, car and session details from iRacing's session info, saved with each lap.</summary>
internal sealed record SessionContext(
    string Track,
    string Car,
    string Driver,
    int SessionId,
    int SubSessionId,
    IReadOnlyDictionary<int, string> SessionTypes);

/// <summary>A finished lap, handed from the recorder to the writer.</summary>
internal sealed record CompletedLap(
    SessionContext? Session,
    int LapNumber,
    int SessionNum,
    double LapTimeSeconds,
    List<TelemetryData> Samples,
    int MissingSamples,
    int Incidents,
    bool OnPitRoad,
    bool OffTrack);

/// <summary>
/// Splits the 60 Hz telemetry stream into laps. A lap is only completed when the car
/// drives from the start/finish line all the way around to it again without a break:
/// resets, tows, session changes, replays and gaps throw the lap in progress away.
/// Called only from the SDK's telemetry handler, so it needs no locking; it does no I/O.
/// </summary>
internal sealed class LapRecorder(Action<CompletedLap> onLapCompleted, Action<string> onLapDiscarded)
{
    // LapDistPct moving more than this in one 1/60 s sample means the car was moved (reset, tow).
    private const float MaxPctStepPerSample = 0.02f;
    // A tick gap this large (0.5 s) means telemetry stopped (pause, alt-tab, reconnect).
    private const int MaxTickGap = 30;
    // Shorter "laps" come from rocking back and forth over the line.
    private const double MinLapSeconds = 10;

    private List<TelemetryData>? _lap;   // samples since the last start/finish crossing; null until the car crosses it
    private double _lapStartTime;         // interpolated SessionTime of that crossing
    private int _missingSamples;
    private TelemetryData? _prev;

    /// <summary>Latest session info; replaced from the SDK's session info handler (another thread).</summary>
    public volatile SessionContext? Session;

    public string Status => _lap is null
        ? "waiting for the start/finish line"
        : $"lap {_lap[^1].Lap} ({_lap.Count:N0} samples)";

    public void OnSample(in TelemetryData d)
    {
        var prev = _prev;
        _prev = d;

        // Only record the player driving: not in the garage, not watching a replay.
        if (d.IsOnTrack != true || d.IsReplayPlaying == true || d.LapDistPct is not { } pct || pct < 0
            || d.SessionTime is not { } time || d.SessionTick is not { } tick)
        {
            Discard("left the car or watching a replay");
            _prev = null;
            return;
        }
        if (prev is not { LapDistPct: { } prevPct, SessionTime: { } prevTime, SessionTick: { } prevTick } p)
            return; // first usable sample; need two to detect a crossing

        if (d.SessionNum != p.SessionNum)
        {
            Discard("session changed");
            return;
        }
        if (tick <= prevTick || time < prevTime)
        {
            Discard("session time went backwards");
            return;
        }
        if (tick - prevTick > MaxTickGap)
        {
            Discard("telemetry paused");
            return;
        }

        var crossedForward = prevPct > 0.9f && pct < 0.1f;
        var crossedBackward = prevPct < 0.1f && pct > 0.9f;
        if (crossedBackward)
        {
            Discard("drove backwards over the start/finish line");
            return;
        }
        if (!crossedForward && Math.Abs(pct - prevPct) > MaxPctStepPerSample)
        {
            Discard("car was moved (reset or tow)");
            return;
        }

        if (_lap is not null)
        {
            _missingSamples += tick - prevTick - 1;
            _lap.Add(d); // on a crossing this is the first sample of the next lap
        }
        if (!crossedForward)
            return;

        // Interpolate the moment the car was exactly on the line.
        var fraction = (1 - prevPct) / ((1 - prevPct) + pct);
        var crossingTime = prevTime + fraction * (time - prevTime);

        if (_lap is not null)
        {
            var lapTime = crossingTime - _lapStartTime;
            if (lapTime >= MinLapSeconds)
                onLapCompleted(Complete(_lap, lapTime));
        }

        _lap = [d];
        _lapStartTime = crossingTime;
        _missingSamples = 0;
    }

    private CompletedLap Complete(List<TelemetryData> samples, double lapTime)
    {
        var first = samples[0];
        var last = samples[^1];
        return new CompletedLap(
            Session,
            // The lap counter can lag the line by a sample, so take it from mid-lap.
            LapNumber: samples[samples.Count / 2].Lap ?? 0,
            SessionNum: first.SessionNum ?? 0,
            LapTimeSeconds: lapTime,
            Samples: samples,
            MissingSamples: _missingSamples,
            Incidents: Math.Max(0, (last.PlayerCarMyIncidentCount ?? 0) - (first.PlayerCarMyIncidentCount ?? 0)),
            OnPitRoad: samples.Any(s => s.OnPitRoad == true),
            OffTrack: samples.Any(s => s.PlayerTrackSurface == TrackLocation.OffTrack));
    }

    private void Discard(string reason)
    {
        if (_lap is { Count: > 0 } lap)
            onLapDiscarded($"Lap {lap[^1].Lap} not saved: {reason}.");
        _lap = null;
    }
}
