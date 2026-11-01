namespace RacingCoach.Collector.Simulators;

/// <summary>How a simulator's stream of frames is split into laps. The defaults are iRacing's (LapRecorder).</summary>
public sealed record LapTrackerOptions
{
    /// <summary>LapDistancePct moving more than this in one frame means the car was moved (reset, tow). Depends on the
    /// simulator's rate: iRacing's is for 60 Hz.</summary>
    public float MaxPctStepPerFrame { get; init; } = 0.02f;
    /// <summary>A jump in Tick larger than this means telemetry stopped (pause, alt-tab, reconnect). Used when frames have ticks.</summary>
    public int MaxTickGap { get; init; } = 30;
    /// <summary>A jump in SessionTimeSeconds larger than this means the same, for frames without ticks.</summary>
    public double MaxTimeGapSeconds { get; init; } = 0.5;
    /// <summary>Shorter "laps" come from rocking back and forth over the line.</summary>
    public double MinLapSeconds { get; init; } = 10;
    /// <summary>The simulator's own lap events end laps (TelemetryFrame.LapJustEnded), rather than crossing the line.</summary>
    public bool UseNativeLapEvents { get; init; }
}

/// <summary>Whether a lap started or ended in the pits.</summary>
public enum LapKind
{
    Flying,
    OutLap,
    InLap,
    OutAndInLap,
}

/// <summary>A complete lap. LapTimeSeconds is the simulator's own when it reported one, else worked out by interpolating
/// the line crossings (Estimated true).</summary>
public sealed record TrackedLap(
    IReadOnlyList<TelemetryFrame> Frames,
    int LapNumber,
    int SessionNumber,
    double LapTimeSeconds,
    bool LapTimeEstimated,
    int MissingFrames,
    int Incidents,
    bool OnPitRoad,
    bool OffTrack,
    bool? Valid,
    LapKind Kind);

/// <summary>
/// Splits any simulator's frames into complete laps: only a drive from the start/finish line all the way round to it
/// again counts, and a reset, tow, session change, replay or gap throws the lap in progress away. Does no I/O and isn't
/// thread safe: call it from one thread. The same rules as iRacing's LapRecorder, which stays iRacing's own; a test
/// feeds both the same telemetry and checks they agree.
/// </summary>
public sealed class FrameLapTracker(Action<TrackedLap> onLap, Action<string> onDiscarded, LapTrackerOptions? options = null)
{
    private readonly LapTrackerOptions _options = options ?? new LapTrackerOptions();
    private List<TelemetryFrame>? _lap;
    private double _lapStartTime;
    private int _missing;
    private TelemetryFrame? _prev;

    public void OnFrame(TelemetryFrame f)
    {
        var prev = _prev;
        _prev = f;

        if (f.IsOnTrack != true || f.IsReplay == true || f.LapDistancePct is not { } pct || pct < 0 || f.SessionTimeSeconds is not { } time)
        {
            Discard("left the car or watching a replay");
            _prev = null;
            return;
        }
        if (prev is not { LapDistancePct: { } prevPct, SessionTimeSeconds: { } prevTime })
            return; // first usable frame; need two to detect a crossing

        if (f.SessionNumber != prev.SessionNumber)
        {
            Discard("session changed");
            return;
        }
        var gapFrames = 0;
        if (f.Tick is { } tick && prev.Tick is { } prevTick)
        {
            if (tick <= prevTick || time < prevTime)
            {
                Discard("session time went backwards");
                return;
            }
            if (tick - prevTick > _options.MaxTickGap)
            {
                Discard("telemetry paused");
                return;
            }
            gapFrames = tick - prevTick - 1;
        }
        else
        {
            if (time <= prevTime)
            {
                Discard("session time went backwards");
                return;
            }
            if (time - prevTime > _options.MaxTimeGapSeconds)
            {
                Discard("telemetry paused");
                return;
            }
        }

        var crossedForward = prevPct > 0.9f && pct < 0.1f;
        var crossedBackward = prevPct < 0.1f && pct > 0.9f;
        if (crossedBackward)
        {
            Discard("drove backwards over the start/finish line");
            return;
        }
        if (!crossedForward && Math.Abs(pct - prevPct) > _options.MaxPctStepPerFrame)
        {
            Discard("car was moved (reset or tow)");
            return;
        }

        if (_lap is not null)
        {
            _missing += gapFrames;
            _lap.Add(f); // on a crossing this is the first frame of the next lap
        }
        if (_options.UseNativeLapEvents)
        {
            // The simulator says when the lap ends, but a lap can only start being recorded at the line
            if (crossedForward && _lap is null)
                StartLap(f, time);
            else if (f.LapJustEnded is { } ended)
                EndNativeLap(ended);
            return;
        }
        if (!crossedForward)
            return;

        // Interpolate the moment the car was exactly on the line
        var fraction = (1 - prevPct) / ((1 - prevPct) + pct);
        var crossingTime = prevTime + fraction * (time - prevTime);
        if (_lap is not null)
        {
            var lapTime = crossingTime - _lapStartTime;
            if (lapTime >= _options.MinLapSeconds)
                onLap(Complete(_lap, lapTime, estimated: true, null));
        }
        StartLap(f, crossingTime);
    }

    // The simulator says a lap just ended. The next lap starts at the latest frame.
    private void EndNativeLap(NativeLapEvent lap)
    {
        if (_lap is not { Count: > 0 } frames)
            return;
        var last = frames[^1];
        var measured = (last.SessionTimeSeconds ?? _lapStartTime) - _lapStartTime;
        var seconds = lap.LapTimeSeconds ?? measured;
        if (seconds >= _options.MinLapSeconds)
            onLap(Complete(frames, seconds, lap.LapTimeSeconds is null, lap));
        StartLap(last, last.SessionTimeSeconds ?? _lapStartTime);
    }

    private void StartLap(TelemetryFrame first, double time)
    {
        _lap = [first];
        _lapStartTime = time;
        _missing = 0;
    }

    private TrackedLap Complete(List<TelemetryFrame> frames, double lapTime, bool estimated, NativeLapEvent? native)
    {
        var first = frames[0];
        var last = frames[^1];
        var kind = (first.OnPitRoad == true, last.OnPitRoad == true) switch
        {
            (true, true) => LapKind.OutAndInLap,
            (true, false) => LapKind.OutLap,
            (false, true) => LapKind.InLap,
            _ => LapKind.Flying,
        };
        // Not every simulator judges laps: unknown stays null rather than counting as valid
        bool? valid = native?.Valid ?? (frames.Any(f => f.LapValid == false) ? false : frames.Any(f => f.LapValid == true) ? true : null);
        return new TrackedLap(
            frames,
            // The lap counter can lag the line by a sample, so take it from mid-lap
            native?.LapNumber ?? frames[frames.Count / 2].LapNumber ?? 0,
            first.SessionNumber ?? 0,
            lapTime,
            estimated,
            _missing,
            Math.Max(0, (last.IncidentCount ?? 0) - (first.IncidentCount ?? 0)),
            frames.Any(f => f.OnPitRoad == true),
            frames.Any(f => f.OffTrack == true),
            valid,
            kind);
    }

    private void Discard(string reason)
    {
        if (_lap is { Count: > 0 } lap)
            onDiscarded($"Lap {lap[^1].LapNumber} not saved: {reason}.");
        _lap = null;
    }
}
