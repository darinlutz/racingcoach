using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Tests;

/// <summary>What every simulator adapter must do, whichever simulator it reads. Run it over a new adapter's frames,
/// recorded from the real simulator, alongside its own tests (docs/multi-simulator.md).</summary>
internal static class AdapterContract
{
    // The channels a frame can carry, so the matrix can be checked against what an adapter actually sends
    private static readonly Dictionary<string, Func<TelemetryFrame, object?>> Values = new()
    {
        ["speed"] = f => f.SpeedMps,
        ["lapDistance"] = f => f.LapDistanceMeters,
        ["lapDistancePct"] = f => f.LapDistancePct,
        ["longAccel"] = f => f.LongAccelMps2,
        ["latAccel"] = f => f.LatAccelMps2,
        ["vertAccel"] = f => f.VertAccelMps2,
        ["yaw"] = f => f.YawRadians,
        ["yawRate"] = f => f.YawRateRadiansPerSecond,
        ["velocityLocal"] = f => f.VelocityForwardMps ?? f.VelocityLeftMps,
        ["geoPosition"] = f => f.Latitude ?? f.Longitude,
        ["throttle"] = f => f.Throttle,
        ["brake"] = f => f.Brake,
        ["clutch"] = f => f.ClutchEngagement,
        ["steeringAngle"] = f => f.SteeringWheelAngleRadians,
        ["steeringInput"] = f => f.SteeringInput,
        ["gear"] = f => f.Gear,
        ["rpm"] = f => f.Rpm,
        ["absActive"] = f => f.AbsActive,
        ["tirePressure"] = f => f.FrontLeft.PressureKpa,
        ["tireCarcassTemp"] = f => f.FrontLeft.CarcassTempMiddleC,
        ["rideHeightCorner"] = f => f.FrontLeft.RideHeightMeters,
        ["waterTemp"] = f => f.WaterTempC,
        ["oilTemp"] = f => f.OilTempC,
        ["fuelLevel"] = f => f.FuelLiters,
        ["fuelUse"] = f => f.FuelUseKgPerHour,
        ["lapNumber"] = f => f.LapNumber,
        ["lapValid"] = f => f.LapValid,
        ["pitLane"] = f => f.OnPitRoad,
        ["incidents"] = f => f.IncidentCount,
    };

    /// <summary>Everything wrong with these frames; empty when they meet the contract.</summary>
    public static List<string> Violations(string simulatorId, IReadOnlyList<TelemetryFrame> frames, SimulatorDescription? description)
    {
        var problems = new List<string>();
        if (frames.Count == 0)
            problems.Add("no frames");
        if (frames.Any(f => f.SimulatorId != simulatorId))
            problems.Add("a frame says it's from another simulator");

        // Sampling order: the clock never goes backwards within one session
        foreach (var session in frames.GroupBy(f => f.SessionNumber))
        {
            double? last = null;
            foreach (var frame in session)
            {
                if (frame.SessionTimeSeconds < last)
                {
                    problems.Add($"time went backwards in session {session.Key}");
                    break;
                }
                last = frame.SessionTimeSeconds ?? last;
            }
        }

        // In range, or absent; never NaN or out of range standing in for missing
        foreach (var frame in frames)
        {
            if (frame.Throttle is < 0 or > 1 || frame.Brake is < 0 or > 1)
                problems.Add("a pedal outside 0-1");
            if (frame.LapDistancePct > 1)
                problems.Add("LapDistancePct over 1");
            if (frame.SteeringInput is < -1 or > 1)
                problems.Add("SteeringInput outside -1 to 1");
            if (frame.SpeedMps is { } speed && !float.IsFinite(speed))
                problems.Add("Speed not a number");
        }

        // A channel the matrix says the simulator doesn't give must not be filled in
        if (description is not null)
        {
            foreach (var (channel, value) in Values)
            {
                var support = description.Support(channel);
                if (support is ChannelSupport.Unavailable or ChannelSupport.Unknown && frames.Any(f => value(f) is not null))
                    problems.Add($"{channel} is {support} in the matrix but has values");
            }
        }
        return problems.Distinct().ToList();
    }
}

/// <summary>An adapter that plays out a script of frames, standing in for a simulator in tests. Not a real simulator
/// and never registered in the collector.</summary>
internal sealed class ScriptedAdapter(string id, IReadOnlyList<TelemetryFrame> frames, SimulatorSession? session = null) : ISimulatorAdapter
{
    public string SimulatorId => id;
    public string DisplayName => $"Scripted {id}";
    public string AdapterVersion => "test-1";
    public SimulatorProbe ProbeResult { get; set; } = new(true, true, true, true);
    public int Runs { get; private set; }
    public int Running;
    public int MostAtOnce;
    public Exception? FailWith { get; set; }
    /// <summary>Keeps running after the script until cancelled, as a live simulator does.</summary>
    public bool HoldOpen { get; init; }

    public SimulatorProbe Probe() => ProbeResult;

    public async Task RunAsync(ITelemetrySink sink, CancellationToken cancel)
    {
        Runs++;
        MostAtOnce = Math.Max(MostAtOnce, Interlocked.Increment(ref Running));
        try
        {
            if (FailWith is { } failure)
                throw failure;
            sink.OnConnectionChanged(true);
            if (session is not null)
                sink.OnSession(session);
            var sent = 0;
            foreach (var frame in frames)
            {
                cancel.ThrowIfCancellationRequested();
                sink.OnFrame(frame);
                // Not flat out: faster than any simulator, but a real stream rather than a burst
                if (++sent % 100 == 0)
                    await Task.Delay(1, cancel);
            }
            if (HoldOpen)
                await Task.Delay(Timeout.Infinite, cancel);
            sink.OnConnectionChanged(false);
        }
        finally
        {
            Interlocked.Decrement(ref Running);
        }
    }

    /// <summary>Clean laps of a simulator with fewer channels: no ticks, steering only as an input, no ride heights.</summary>
    public static List<TelemetryFrame> Laps(string id, int laps, double lapSeconds = 20, int hz = 60, double startPct = 0.95)
    {
        var frames = new List<TelemetryFrame>();
        var total = (int)((laps + 0.1) * lapSeconds * hz);
        for (var i = 0; i < total; i++)
        {
            var progress = startPct + i / (lapSeconds * hz);
            var lap = (int)Math.Floor(progress);
            frames.Add(new TelemetryFrame
            {
                SimulatorId = id,
                SessionTimeSeconds = i / (double)hz,
                SessionNumber = 0,
                LapNumber = lap,
                LapDistancePct = (float)(progress - lap),
                SpeedMps = Units.KmhToMps(150f),
                Throttle = 0.5f,
                Brake = 0f,
                SteeringInput = 0.1f,
                Gear = 3,
                Rpm = 6000,
                IsOnTrack = true,
                IsReplay = false,
                OnPitRoad = false,
                LapValid = true,
                TrackTempC = 30,
                AirTempC = 20,
            });
        }
        return frames;
    }

    public static SimulatorSession SessionFor(string id) => new()
    {
        SimulatorId = id,
        NativeTrackId = "native_track",
        Track = "Native Track",
        NativeCarId = "native_car",
        Car = "Native Car",
        Driver = "Test Driver",
        SessionTypes = new Dictionary<int, string> { [0] = "Practice" },
    };
}

/// <summary>Keeps what an adapter sends.</summary>
internal sealed class RecordingSink : ITelemetrySink
{
    public List<TelemetryFrame> Frames { get; } = [];
    public List<SimulatorSession> Sessions { get; } = [];
    public List<bool> Connections { get; } = [];
    public List<string> Errors { get; } = [];
    public void OnConnectionChanged(bool connected) => Connections.Add(connected);
    public void OnSession(SimulatorSession session) => Sessions.Add(session);
    public void OnFrame(TelemetryFrame frame) => Frames.Add(frame);
    public void OnError(string message) => Errors.Add(message);
}
