namespace RacingCoach.Collector.Simulators;

/// <summary>
/// Notices the driver sitting still in the car. A lap in progress while they do (in the pit stall, waiting in the
/// garage area with the car on track, away from the sim for hours) would grow by 60 rows a second, become too big to
/// upload and hold nothing worth analysing, so the lap recorders (LapRecorder, FrameLapTracker) throw it away once the
/// car has been still for longer than MaxStillSeconds, and LapWriter deletes saved laps that have such a stop
/// (HasLongStop). Recording starts again at the next start/finish line crossing. Not thread safe.
/// </summary>
public sealed class StandstillWatch
{
    /// <summary>Below this speed (m/s, about 1 mph) the car counts as still.</summary>
    public const float StillSpeedMps = 0.5f;
    /// <summary>Still for longer than this (10 minutes) and the lap in progress isn't saved.</summary>
    public const double MaxStillSeconds = 600;

    private double? _stillSince;

    /// <summary>Takes the latest sample's speed and session time; true while the car has been still for longer than
    /// MaxStillSeconds. An unknown speed doesn't count as still.</summary>
    public bool Update(float? speedMps, double sessionTime)
    {
        if (speedMps is not { } speed || Math.Abs(speed) >= StillSpeedMps)
        {
            _stillSince = null;
            return false;
        }
        if (_stillSince is not { } since || sessionTime < since)
            _stillSince = since = sessionTime;
        return sessionTime - since > MaxStillSeconds;
    }

    public void Reset() => _stillSince = null;

    /// <summary>Whether a lap's samples, as (session time, speed), have the car still for longer than MaxStillSeconds.</summary>
    public static bool HasLongStop(IEnumerable<(double Time, float? Speed)> samples)
    {
        var watch = new StandstillWatch();
        foreach (var (time, speed) in samples)
            if (watch.Update(speed, time))
                return true;
        return false;
    }
}
