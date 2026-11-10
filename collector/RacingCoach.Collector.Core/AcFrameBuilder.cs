using System.Numerics;

namespace RacingCoach.Collector.Simulators;

/// <summary>
/// What Kunos's AC Shared Memory Documentation doesn't say about units, signs and axes, as the raw recording of
/// 2026-11-10 showed them (Ferrari 488 GT3 at Spa, AC 1.16.4, shared memory 1.7: ac-20261110-000304, AcSpaRecordingTests).
/// Each was checked against something independent in that recording, not against ACC: the axes against the car's own
/// motion (the world velocity turned by heading, the change of speed, yaw rate times speed), the lap time against the
/// game's 2:32.163, the temperatures against the game's 26 °C and 34 °C. A channel reaches a lap file only once it's
/// marked collected in simulators/capabilities.json (ChannelGate). Change a convention here, never in the frame builder.
/// </summary>
public static class AcConventions
{
    /// <summary>0 reverse, 1 neutral, 2 first, as documented (reversing in the pit box read 0). iRacing's is -1, 0, 1.</summary>
    public const int GearOffset = -1;

    /// <summary>steerAngle is the driver's input, -1 to +1 over the wheel rotation set in AC's controls, + right (La
    /// Source, a right-hander, read +0.5; it runs against the yaw rate, r = -0.96), so it's negated into the frame's
    /// positive-left. It reached 1.0 at the off, and La Source took 0.38 on average, 171° of a 900° wheel (the
    /// driver's), as in ACC's Spa recordings, so as with ACC the wheel's angle is the input times half the wheel
    /// rotation (the builder's steering range), which AC doesn't share.</summary>
    public const float SteeringInputSign = -1;

    /// <summary>localVelocity: x across the car (+ left), y up, z forward. The world velocity turned into the car by
    /// heading matches x to r = 0.99998; z is the speed (45.72 against 45.73 m/s) and goes negative in reverse.</summary>
    public const int ForwardAxis = 2;
    public const int LeftAxis = 0;
    public const float LeftSign = 1;
    public const int UpAxis = 1;
    /// <summary>localAngularVel's y is positive turning left, as iRacing's YawRate: it's the negative of heading's change.</summary>
    public const float YawRateSign = 1;

    /// <summary>accG, in g: x lateral (+ left: yaw rate times speed is 9.90 m/s² per g of it, r = 0.99), y vertical,
    /// z longitudinal (+ forward: the change of speed is 9.74 m/s² per g, r = 0.99).</summary>
    public const int LatAxis = 0;
    public const int VertAxis = 1;
    public const int LongAxis = 2;
    public const float LatSign = 1;
    public const float LongSign = 1;
    /// <summary>The vertical averages 0.02 g over a lap, so there's no gravity in it; 1 g is added to match iRacing's VertAccel.</summary>
    public const bool VerticalIncludesGravity = false;

    /// <summary>heading grows turning right (the direction of travel in carCoordinates is atan2(x, z) = -heading, to
    /// within 0.18 rad round the lap), so it's negated into iRacing's Yaw.</summary>
    public const float YawSign = -1;

    /// <summary>wheelsPressure is psi: 24.6 on blanket-warm tyres set to 16 cold, 19.6 to 24 on track.</summary>
    public const bool PressureInPsi = true;

    /// <summary>clutch is documented as the pedal but, like ACC's, it's engagement: 1 while driving, 0 standing still
    /// with the automatic clutch open, in between pulling away.</summary>
    public const bool ClutchIsPedal = false;

    /// <summary>trackSPlineLength is meters: 6946 at Spa (iRacing's Spa is 7004), and the car's world position moved
    /// 6905 m in a lap.</summary>
    public const bool SplineLengthInMeters = true;

    /// <summary>numberOfTyresOut counts the wheels off the track; all 4 is off track, as iRacing's OffTrack. The
    /// recording's one off went to 3, then 4 for 1.2 s; kerbs give 1 or 2.</summary>
    public const int OffTrackTyres = 4;
}

/// <summary>
/// Turns AC's three shared memory pages into TelemetryFrames and the SimulatorSession, the same for live reading
/// (AcAdapter) and a raw recording (AcRawRecording). No I/O and not thread safe: one per connection, fed in order.
///
/// Like ACC, AC's pages have no session clock or sample counter that matches the reads, so frames are timed by the
/// reader's own clock and Tick stays null; laps end on AC's own events (completedLaps going up, with iLastTime). Unlike
/// ACC, AC has no session index or lap validity: sessions are counted here (a new one when the session type changes or
/// the lap count goes back), and a lap's validity is left unsaid.
/// </summary>
public sealed class AcFrameBuilder(float? steeringRangeDegrees = null)
{
    public const string SimulatorId = "ac";

    // Half the driver's wheel rotation in radians, or null when it isn't set, so no angle is made
    private float? _halfRangeRadians = HalfRangeRadians(steeringRangeDegrees);

    /// <summary>The wheel rotation set in AC's controls, lock to lock in degrees (outside AccFrameBuilder's
    /// MinSteeringRange-MaxSteeringRange, or null: no steering angle). Changeable while reading.</summary>
    public float? SteeringRangeDegrees
    {
        set => _halfRangeRadians = HalfRangeRadians(value);
    }

    private static float? HalfRangeRadians(float? degrees) => degrees is >= AccFrameBuilder.MinSteeringRange and <= AccFrameBuilder.MaxSteeringRange
        ? degrees.Value / 2 * MathF.PI / 180
        : null;

    private int? _completedLaps;
    private AcSessionType? _sessionType;
    private int _lastPhysicsPacket = int.MinValue;
    // Where AC's timing line is on its track spline (normalizedCarPosition when completedLaps goes up), so the lap
    // position counts from it as iRacing's does. Learned from the first lap AC counts, as ACC's is.
    private float? _timingLine;

    /// <summary>The session number frames carry: 0 for the first session read, one more for each after it.</summary>
    public int SessionNumber { get; private set; }

    /// <summary>Whether the pages have changed since the first read, so AC itself is writing them. The maps outlive the
    /// game that wrote them while any other program (an overlay app, say) has them open, and AC, ACC and AC Rally share
    /// their names: starting AC within one of ACC's sessions read ACC's last pages for 8 s (Brands Hatch, shared memory
    /// 1.9) until AC wrote its own. Until then nothing read from them is AC's, the static page included.</summary>
    public bool PagesAreLive { get; private set; }

    /// <summary>The frame for these pages, or null when physics hasn't moved on since the last call (the game is
    /// paused, in a menu, or read again before its next step), so a repeat isn't counted as a sample. The first read
    /// is never a frame: it may be another game's pages (PagesAreLive).</summary>
    public TelemetryFrame? Next(AcPhysics physics, AcGraphics graphics, double readerSeconds)
    {
        if (physics.PacketId == _lastPhysicsPacket)
            return null;
        var first = _lastPhysicsPacket == int.MinValue;
        _lastPhysicsPacket = physics.PacketId;
        if (first)
            return null;
        PagesAreLive = true;

        // AC has no session index: a change of session type, or the lap count going back (a restart), is a new session
        if (_sessionType is { } type && (type != graphics.Session || graphics.CompletedLaps < _completedLaps))
        {
            SessionNumber++;
            _completedLaps = null;
        }
        _sessionType = graphics.Session;

        NativeLapEvent? ended = null;
        if (_completedLaps is { } before && graphics.CompletedLaps == before + 1)
            ended = new NativeLapEvent(graphics.CompletedLaps, graphics.LastTimeMs > 0 ? graphics.LastTimeMs / 1000.0 : null, null);
        _completedLaps = graphics.CompletedLaps;
        if (ended is not null && graphics.NormalizedCarPosition is var line && (line > 1 - AccFrameBuilder.TimingLineNearZero || line < AccFrameBuilder.TimingLineNearZero))
            _timingLine = line;

        var local = physics.LocalVelocity;
        var angular = physics.LocalAngularVelocity;
        var g = physics.AccG;
        var world = graphics.CarCoordinates;
        return new TelemetryFrame
        {
            SimulatorId = SimulatorId,
            SessionTimeSeconds = readerSeconds,
            SessionNumber = SessionNumber,
            // iRacing's Lap is the lap being driven, 1 on the first
            LapNumber = graphics.CompletedLaps + 1,
            LapDistancePct = FromTimingLine(graphics.NormalizedCarPosition),
            WorldX = world.X,
            WorldY = world.Y,
            WorldZ = world.Z,
            SpeedMps = Units.KmhToMps(physics.SpeedKmh),
            VelocityForwardMps = Axis(local, AcConventions.ForwardAxis),
            VelocityLeftMps = AcConventions.LeftSign * Axis(local, AcConventions.LeftAxis),
            LatAccelMps2 = Units.GToMps2(AcConventions.LatSign * Axis(g, AcConventions.LatAxis)),
            LongAccelMps2 = Units.GToMps2(AcConventions.LongSign * Axis(g, AcConventions.LongAxis)),
            VertAccelMps2 = Units.GToMps2(Axis(g, AcConventions.VertAxis) + (AcConventions.VerticalIncludesGravity ? 0 : 1)),
            YawRadians = AcConventions.YawSign * physics.Heading,
            YawRateRadiansPerSecond = AcConventions.YawRateSign * Axis(angular, AcConventions.UpAxis),
            Throttle = physics.Gas,
            Brake = physics.Brake,
            ClutchEngagement = AcConventions.ClutchIsPedal ? 1 - physics.Clutch : physics.Clutch,
            SteeringWheelAngleRadians = AcConventions.SteeringInputSign * physics.SteerAngle * _halfRangeRadians,
            SteeringInput = AcConventions.SteeringInputSign * physics.SteerAngle,
            Gear = physics.Gear + AcConventions.GearOffset,
            Rpm = physics.Rpm,
            // abs is the ABS setting's slip ratio limit, not ABS working
            AbsActive = null,
            FrontLeft = Wheel(physics.WheelsPressure.FrontLeft),
            FrontRight = Wheel(physics.WheelsPressure.FrontRight),
            RearLeft = Wheel(physics.WheelsPressure.RearLeft),
            RearRight = Wheel(physics.WheelsPressure.RearRight),
            // AC's page has no water or oil temperature
            WaterTempC = null,
            FuelLiters = physics.Fuel,
            IsOnTrack = graphics.Status == AcStatus.Live,
            IsReplay = graphics.Status == AcStatus.Replay,
            OnPitRoad = graphics.IsInPitLane || graphics.IsInPit,
            OffTrack = physics.NumberOfTyresOut >= AcConventions.OffTrackTyres,
            // AC has no incident count or lap validity
            IncidentCount = null,
            LapValid = null,
            LapJustEnded = ended,
            AirTempC = physics.AirTemp,
            TrackTempC = physics.RoadTemp,
            // windSpeed has no unit in the document
            WindSpeedMps = null,
            WindDirectionRadians = null,
        };
    }

    /// <summary>The session from the static page, with the graphics page's session type under this builder's number.</summary>
    public static SimulatorSession Session(AcStatic info, AcGraphics graphics, int sessionNumber) => new()
    {
        SimulatorId = SimulatorId,
        NativeTrackId = TrackId(info),
        Track = info.TrackConfiguration.Length > 0 ? $"{info.Track} ({info.TrackConfiguration})" : info.Track,
        TrackLayout = info.TrackConfiguration.Length > 0 ? info.TrackConfiguration : null,
        TrackLengthMeters = AcConventions.SplineLengthInMeters && info.TrackSplineLength > 0 ? info.TrackSplineLength : null,
        NativeCarId = info.CarModel,
        // AC's pages have only the car's folder name; the website maps it to Car Data (simulatorMappings.ts)
        Car = info.CarModel,
        Driver = $"{info.PlayerName} {info.PlayerSurname}".Trim(),
        SessionTypes = new Dictionary<int, string> { [sessionNumber] = graphics.Session.ToString() },
    };

    /// <summary>AC's id of the track and layout: the track's folder, and the layout's after a slash on multi-layout
    /// tracks (e.g. ks_nurburgring/layout_gp_a), as Content Manager names them.</summary>
    public static string TrackId(AcStatic info) =>
        info.TrackConfiguration.Length > 0 ? $"{info.Track}/{info.TrackConfiguration}" : info.Track;

    /// <summary>Whether two sessions are the same one, so it's only sent again when it changes.</summary>
    public static bool SameSession(SimulatorSession a, SimulatorSession? b) => AccFrameBuilder.SameSession(a, b);

    /// <summary>A completed lap's frames as the lap file holds them, shaped as ACC's are (AC shows neutral in the middle
    /// of a shift too, at 227 km/h between sixth and seventh, which is bridged), and starting where AC counted the lap.
    /// AC counts a lap just past its spline's 0 (Spa: 0.0005, 4 reads later), so before the line is known the lap
    /// tracker starts the first lap at the spline's 0 and the reads until AC's count, still the lap before's, are left
    /// out; ACC's line is before the spline's 0, so its laps never have them.</summary>
    public static IReadOnlyList<TelemetryFrame> ForLapFile(IReadOnlyList<TelemetryFrame> frames)
    {
        var lap = frames.Count > 2 ? frames[frames.Count / 2].LapNumber : null;
        var start = 0;
        while (lap is not null && start < frames.Count / 2 && frames[start].LapNumber == lap - 1)
            start++;
        return AccFrameBuilder.ForLapFile(start == 0 ? frames : frames.Skip(start).ToList());
    }

    private float FromTimingLine(float pct)
    {
        if (_timingLine is not { } line || pct < 0) return pct;
        var shifted = pct - line;
        if (shifted < 0) shifted += 1;
        return shifted >= 1 ? shifted - 1 : shifted;
    }

    private static float Axis(Vector3 v, int axis) => axis switch { 0 => v.X, 1 => v.Y, _ => v.Z };

    private static WheelTelemetry Wheel(float pressure) => new()
    {
        PressureKpa = AcConventions.PressureInPsi ? Units.PsiToKpa(pressure) : pressure,
    };

    /// <summary>How AC's frames are split into laps: its own lap events, and gaps by time (no tick).</summary>
    public static LapTrackerOptions LapTrackerOptions => AccFrameBuilder.LapTrackerOptions;
}
