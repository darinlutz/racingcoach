using System.Numerics;

namespace RacingCoach.Collector.Simulators;

/// <summary>
/// What Kunos's documentation (ACC Shared Memory v1.8.12) doesn't say about units, signs and axes, and what each
/// conversion assumes until it's been checked in the game. Each one is a channel still "documented" in
/// simulators/capabilities.json, so ChannelGate keeps it out of lap files whatever it says here; a raw recording at
/// Spa (--record-raw, AccRawRecording) is how each gets confirmed, then the channel is marked collected. Change an
/// assumption here, never in the frame builder.
/// </summary>
public static class AccConventions
{
    /// <summary>"Current gear", no encoding given. The community readers all use 0 reverse, 1 neutral, 2 first;
    /// iRacing's is -1, 0, 1.</summary>
    public const int GearOffset = -1;

    /// <summary>steerAngle is the input, -1 to 1, with no direction given. +1 is taken to be full right lock, so it's
    /// negated into the frame's positive-left.</summary>
    public const float SteeringInputSign = -1;

    /// <summary>localVelocity and localAngularVel are "in local coordinates", with no axes given. AC's are taken:
    /// x across the car (+ left), y up, z forward. Forward is z; left is x.</summary>
    public const int ForwardAxis = 2;
    public const int LeftAxis = 0;
    public const float LeftSign = 1;
    /// <summary>Yaw rate is about y (up); iRacing's YawRate is positive turning left.</summary>
    public const int UpAxis = 1;
    public const float YawRateSign = 1;

    /// <summary>accG is documented as "in global coordinates" without a unit, though the community readers treat it as
    /// the car's own g: x lateral, y vertical, z longitudinal. Taken as that, in g; the Spa recording decides.</summary>
    public const int LatAxis = 0;
    public const int VertAxis = 1;
    public const int LongAxis = 2;
    public const float LatSign = 1;
    public const float LongSign = 1;

    /// <summary>heading is "car yaw orientation", radians assumed; whether it matches iRacing's Yaw (its zero and
    /// direction) isn't known, so it's passed as it is.</summary>
    public const float YawSign = 1;

    /// <summary>wheelPressure has no unit; ACC's own UI and every community tool show psi.</summary>
    public const bool PressureInPsi = true;

    /// <summary>clutch is "clutch pedal input" from 0 to 1, so 1 is taken to be the pedal fully down (disengaged),
    /// the reverse of iRacing's Clutch.</summary>
    public const bool ClutchIsPedal = true;

    /// <summary>abs is "ABS in action" with no range; anything above this is taken as ABS working.</summary>
    public const float AbsActiveAbove = 0;
}

/// <summary>
/// Turns ACC's three shared memory pages into TelemetryFrames and the SimulatorSession, the same for live reading
/// (AccAdapter) and a raw recording (AccRawRecording). No I/O and not thread safe: one per connection, fed in order.
///
/// ACC's pages have no session clock, so SessionTimeSeconds is the reader's own (seconds since it started reading,
/// passed in), and no sample counter that matches the reads (physics' packetId counts physics steps), so Tick stays
/// null and gaps are found by time. Lap times are ACC's own (iLastTime), on the frame after completedLaps goes up.
/// </summary>
public sealed class AccFrameBuilder
{
    public const string SimulatorId = "acc";

    private int? _completedLaps;
    private bool? _lastValid;
    private int? _sessionIndex;
    private int _lastPhysicsPacket = int.MinValue;

    /// <summary>The frame for these pages, or null when physics hasn't moved on since the last call (the game is
    /// paused, in a menu, or read again before its next step), so a repeat isn't counted as a sample.</summary>
    public TelemetryFrame? Next(AccPhysics physics, AccGraphics graphics, double readerSeconds)
    {
        if (physics.PacketId == _lastPhysicsPacket)
            return null;
        _lastPhysicsPacket = physics.PacketId;

        // A new session counts laps from 0 again
        if (_sessionIndex != graphics.SessionIndex)
        {
            _sessionIndex = graphics.SessionIndex;
            _completedLaps = null;
        }
        NativeLapEvent? ended = null;
        if (_completedLaps is { } before && graphics.CompletedLaps == before + 1)
            ended = new NativeLapEvent(graphics.CompletedLaps, graphics.LastTimeMs > 0 ? graphics.LastTimeMs / 1000.0 : null, _lastValid);
        _completedLaps = graphics.CompletedLaps;
        _lastValid = graphics.IsValidLap;

        var local = physics.LocalVelocity;
        var angular = physics.LocalAngularVelocity;
        var g = physics.AccG;
        return new TelemetryFrame
        {
            SimulatorId = SimulatorId,
            SessionTimeSeconds = readerSeconds,
            SessionNumber = graphics.SessionIndex,
            // iRacing's Lap is the lap being driven, 1 on the first
            LapNumber = graphics.CompletedLaps + 1,
            LapDistancePct = graphics.NormalizedCarPosition,
            SpeedMps = Units.KmhToMps(physics.SpeedKmh),
            VelocityForwardMps = Axis(local, AccConventions.ForwardAxis),
            VelocityLeftMps = AccConventions.LeftSign * Axis(local, AccConventions.LeftAxis),
            LatAccelMps2 = Units.GToMps2(AccConventions.LatSign * Axis(g, AccConventions.LatAxis)),
            LongAccelMps2 = Units.GToMps2(AccConventions.LongSign * Axis(g, AccConventions.LongAxis)),
            VertAccelMps2 = Units.GToMps2(Axis(g, AccConventions.VertAxis)),
            YawRadians = AccConventions.YawSign * physics.Heading,
            YawRateRadiansPerSecond = AccConventions.YawRateSign * Axis(angular, AccConventions.UpAxis),
            Throttle = physics.Gas,
            Brake = physics.Brake,
            ClutchEngagement = AccConventions.ClutchIsPedal ? 1 - physics.Clutch : physics.Clutch,
            // ACC gives only the input; an angle needs the car's lock (AccCars), which is an estimate for consumers
            SteeringWheelAngleRadians = null,
            SteeringInput = AccConventions.SteeringInputSign * physics.SteerAngle,
            Gear = physics.Gear + AccConventions.GearOffset,
            Rpm = physics.Rpm,
            AbsActive = physics.Abs > AccConventions.AbsActiveAbove,
            FrontLeft = Wheel(physics.WheelPressure.FrontLeft),
            FrontRight = Wheel(physics.WheelPressure.FrontRight),
            RearLeft = Wheel(physics.WheelPressure.RearLeft),
            RearRight = Wheel(physics.WheelPressure.RearRight),
            WaterTempC = physics.WaterTemp,
            // ACC has only a core temperature per tire (not a carcass one), no oil temperature, and fuel in kg with
            // no density to make it liters
            FuelLiters = null,
            IsOnTrack = graphics.Status == AccStatus.Live,
            IsReplay = graphics.Status == AccStatus.Replay,
            OnPitRoad = graphics.IsInPitLane || graphics.IsInPit,
            // numberOfTyresOut is marked not used, and ACC has no incident count
            OffTrack = null,
            IncidentCount = null,
            LapValid = graphics.IsValidLap,
            LapJustEnded = ended,
            AirTempC = physics.AirTemp,
            TrackTempC = physics.RoadTemp,
            WindSpeedMps = graphics.WindSpeed,
            WindDirectionRadians = graphics.WindDirection,
        };
    }

    /// <summary>The session from the static page, with the graphics page's session type.</summary>
    public static SimulatorSession Session(AccStatic info, AccGraphics graphics) => new()
    {
        SimulatorId = SimulatorId,
        NativeTrackId = info.Track,
        // ACC's track id is all the static page has; the website maps it to Track Data (simulatorMappings.ts)
        Track = info.Track,
        // trackSplineLength is marked not used
        TrackLengthMeters = null,
        NativeCarId = info.CarModel,
        Car = AccCars.Find(info.CarModel)?.Name ?? info.CarModel,
        Driver = $"{info.PlayerName} {info.PlayerSurname}".Trim(),
        SessionTypes = new Dictionary<int, string> { [graphics.SessionIndex] = graphics.Session.ToString() },
    };

    /// <summary>Whether two sessions are the same one, so it's only sent again when it changes.</summary>
    public static bool SameSession(SimulatorSession a, SimulatorSession? b) =>
        b is not null && a.NativeTrackId == b.NativeTrackId && a.NativeCarId == b.NativeCarId && a.Driver == b.Driver
        && a.SessionTypes.SequenceEqual(b.SessionTypes);

    private static float Axis(Vector3 v, int axis) => axis switch { 0 => v.X, 1 => v.Y, _ => v.Z };

    private static WheelTelemetry Wheel(float pressure) => new()
    {
        PressureKpa = AccConventions.PressureInPsi ? Units.PsiToKpa(pressure) : pressure,
    };

    /// <summary>How ACC's frames are split into laps: its own lap events, and gaps by time (no tick).</summary>
    public static LapTrackerOptions LapTrackerOptions { get; } = new()
    {
        UseNativeLapEvents = true,
        MaxTimeGapSeconds = 0.5,
    };
}
