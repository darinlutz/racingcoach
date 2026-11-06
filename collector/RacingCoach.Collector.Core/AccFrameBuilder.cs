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
    // Checked against the Spa recording of 2026-11-05 (smVersion 1.9, Huracán GT3 Evo; docs/multi-simulator.md) where
    // marked "Spa:". The 1.8 layout read every field of it sensibly, so 1.9 moved nothing this reads.

    /// <summary>"Current gear", no encoding given: 0 reverse, 1 neutral, 2 first, as the community readers have it;
    /// iRacing's is -1, 0, 1. Spa: 1 standing still, 2 pulling away, 7 at the top of a six-speed car.</summary>
    public const int GearOffset = -1;

    /// <summary>steerAngle is the input, -1 to 1, with no direction given; +1 is full right lock, so it's negated into
    /// the frame's positive-left. Spa: +0.48 through La Source, a right hairpin. Spa 18:36: full lock either way read
    /// ±0.752, not ±1, so it's a share of the wheel's range, not of the car's lock, and no angle can be made from it.</summary>
    public const float SteeringInputSign = -1;

    /// <summary>localVelocity and localAngularVel are "in local coordinates", with no axes given: x across the car
    /// (+ left), y up, z forward. Spa: z reaches the top speed in m/s, and yaw rate about y tracks lateral g at 0.93
    /// and the steering at -0.94.</summary>
    public const int ForwardAxis = 2;
    public const int LeftAxis = 0;
    public const float LeftSign = 1;
    /// <summary>Yaw rate is about y (up); iRacing's YawRate is positive turning left. Spa: -0.8 rad/s through La Source.</summary>
    public const int UpAxis = 1;
    public const float YawRateSign = 1;

    /// <summary>accG is documented as "in global coordinates" without a unit, but it's the car's own g: x lateral
    /// (+ left), y vertical, z longitudinal (+ forward). Spa: 1.4 g through La Source, matching speed × yaw rate;
    /// negative under braking.</summary>
    public const int LatAxis = 0;
    public const int VertAxis = 1;
    public const int LongAxis = 2;
    public const float LatSign = 1;
    public const float LongSign = 1;
    /// <summary>Whether accG's vertical includes gravity, as iRacing's VertAccel does. Spa: it averages 0.02 g on the
    /// move, so it doesn't, and 1 g is added.</summary>
    public const bool VerticalIncludesGravity = false;

    /// <summary>heading is "car yaw orientation" in radians, -π to π. Spa: it grows turning right (its rate is exactly
    /// minus the yaw rate), the reverse of iRacing's Yaw, so it's negated. Spa 18:36: it's atan2(-x, z) of the
    /// world velocity to within 0.05 rad, so 0 is ACC's world +z, not north; the website works Yaw's zero out from
    /// each lap's own positions anyway, as iRacing's isn't north either.</summary>
    public const float YawSign = -1;

    /// <summary>wheelPressure has no unit; ACC's own UI and every community tool show psi. Spa: 26-27 hot.</summary>
    public const bool PressureInPsi = true;

    /// <summary>clutch is documented as "clutch pedal input", but it's engagement like iRacing's Clutch: Spa: 1.00
    /// throughout driving, lower only pulling away.</summary>
    public const bool ClutchIsPedal = false;

    /// <summary>abs is "ABS in action" with no range; anything above this is taken as ABS working. Spa 18:36: only ever
    /// 0 or 1, in short bursts under heavy braking (99% of its samples with the brake on).</summary>
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
    private int? _sessionIndex;
    // ACC resets isValidLap as the car crosses the line (iCurrentTime back to 0), which can be a read before
    // completedLaps goes up (Spa 18:36: 881.12 s, then 881.15 s), so a lap's validity is latched from the line rather
    // than read off the frame before its event. A crossing with no lap counted (the out lap from the garage) just
    // starts the latch again.
    private int? _currentTimeMs;
    private bool _lapInvalid;
    private bool _endedLapInvalid;
    private bool _crossedSinceEvent;
    private int _lastPhysicsPacket = int.MinValue;
    // Where ACC's timing line is on its track spline (normalizedCarPosition when completedLaps goes up), so the lap
    // position can count from it as iRacing's does. Learned from the first lap ACC counts; kept across sessions, as
    // it belongs to the track and one builder reads one connection.
    private float? _timingLine;

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
            _currentTimeMs = null;
            _lapInvalid = _endedLapInvalid = _crossedSinceEvent = false;
        }
        var crossed = _currentTimeMs is { } msBefore && graphics.CurrentTimeMs < msBefore;
        _currentTimeMs = graphics.CurrentTimeMs;
        if (crossed)
        {
            _endedLapInvalid = _lapInvalid;
            _lapInvalid = false;
            _crossedSinceEvent = true;
        }
        NativeLapEvent? ended = null;
        if (_completedLaps is { } before && graphics.CompletedLaps == before + 1)
        {
            var invalid = _crossedSinceEvent ? _endedLapInvalid : _lapInvalid;
            ended = new NativeLapEvent(graphics.CompletedLaps, graphics.LastTimeMs > 0 ? graphics.LastTimeMs / 1000.0 : null, !invalid);
            if (!_crossedSinceEvent)
                _lapInvalid = false; // no line crossing seen: the next lap starts here
            _crossedSinceEvent = false;
        }
        _completedLaps = graphics.CompletedLaps;
        _lapInvalid |= !graphics.IsValidLap;
        // Spa 2026-11-05: ACC counts the lap at 0.99625 of its spline, 27 m before the spline's own 0
        if (ended is not null && graphics.NormalizedCarPosition is var line && (line > 1 - TimingLineNearZero || line < TimingLineNearZero))
            _timingLine = line;

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
            LapDistancePct = FromTimingLine(graphics.NormalizedCarPosition),
            SpeedMps = Units.KmhToMps(physics.SpeedKmh),
            VelocityForwardMps = Axis(local, AccConventions.ForwardAxis),
            VelocityLeftMps = AccConventions.LeftSign * Axis(local, AccConventions.LeftAxis),
            LatAccelMps2 = Units.GToMps2(AccConventions.LatSign * Axis(g, AccConventions.LatAxis)),
            LongAccelMps2 = Units.GToMps2(AccConventions.LongSign * Axis(g, AccConventions.LongAxis)),
            VertAccelMps2 = Units.GToMps2(Axis(g, AccConventions.VertAxis) + (AccConventions.VerticalIncludesGravity ? 0 : 1)),
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
            // ACC has only a core temperature per tire (not a carcass one) and no oil temperature. Fuel is documented
            // as kg, but it's liters: Spa 18:36 had 62 with fuelXLap (documented liters) 4.24 and fuelEstimatedLaps
            // 14.6 = 62 / 4.24, and the Huracán's maxFuel 120 is its 120 L tank
            FuelLiters = physics.Fuel,
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
            // windSpeed and windDirection read 0 throughout both Spa sessions: unknown until wind is seen in them
            WindSpeedMps = null,
            WindDirectionRadians = null,
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

    /// <summary>How far from the spline's 0 ACC's timing line may be and still be taken for it: a lap counted further
    /// away (a lap event read late after a pause, say) isn't where the line is.</summary>
    public const float TimingLineNearZero = 0.05f;

    /// <summary>The spline position as a share of the lap from ACC's timing line, 0 to 1 like iRacing's LapDistPct.
    /// Until ACC has counted a lap the line isn't known, and the spline's own is given: the lap in progress then
    /// ends at the first count (its file starts at the spline's 0, so it's shorter than its time), and every lap
    /// after it starts on the line.</summary>
    private float FromTimingLine(float pct)
    {
        if (_timingLine is not { } line || pct < 0) return pct;
        var shifted = pct - line;
        if (shifted < 0) shifted += 1;
        return shifted >= 1 ? shifted - 1 : shifted;
    }

    /// <summary>
    /// A completed lap's frames as the lap file holds them, the same as iRacing's would be:
    /// - ACC shows neutral for a few reads in the middle of every shift (Spa: 4, 0, 0, 0, 5), where iRacing's gear
    ///   goes straight to the next one. A neutral that short between two gears, with the car moving, keeps the gear
    ///   before it, so a shift is one change and the gear charts and shift points read as iRacing's.
    /// - ACC's spline position stops at 1 and then 0 for a few reads either side of the spline's 0 (Spa: 4 reads each,
    ///   ~0.13 s at 47 m/s), with the car still moving. Those reads get the position worked out from the time between
    ///   the reads either side, so distances through there aren't squashed.
    /// </summary>
    public static IReadOnlyList<TelemetryFrame> ForLapFile(IReadOnlyList<TelemetryFrame> frames)
    {
        var result = frames.ToArray();
        BridgeShiftNeutrals(result);
        UnstickPosition(result);
        return result;
    }

    /// <summary>The longest neutral taken for part of a shift (Spa: 50-100 ms).</summary>
    public const double MaxShiftNeutralSeconds = 0.3;
    private const float MovingMps = 2;

    private static void BridgeShiftNeutrals(TelemetryFrame[] frames)
    {
        for (var i = 1; i < frames.Length; i++)
        {
            if (frames[i].Gear != 0 || frames[i - 1].Gear is not { } before || before < 1) continue;
            var end = i;
            while (end < frames.Length && frames[end].Gear == 0) end++;
            if (end == frames.Length || frames[end].Gear is not { } after || after < 1) { i = end; continue; }
            var seconds = frames[end].SessionTimeSeconds - frames[i - 1].SessionTimeSeconds;
            var moving = frames[i..end].All(f => f.SpeedMps > MovingMps);
            if (seconds <= MaxShiftNeutralSeconds && moving)
                for (var j = i; j < end; j++) frames[j] = frames[j] with { Gear = before };
            i = end;
        }
    }

    private static void UnstickPosition(TelemetryFrame[] frames)
    {
        for (var i = 1; i < frames.Length; i++)
        {
            if (frames[i].LapDistancePct != frames[i - 1].LapDistancePct || !(frames[i].SpeedMps > MovingMps)) continue;
            // frames[i - 1] is the first of a run of one position; find the read after it that moved on
            var from = i - 1;
            var end = i;
            while (end < frames.Length && frames[end].LapDistancePct == frames[from].LapDistancePct) end++;
            if (from == 0 || end == frames.Length) { i = end; continue; }
            var (a, b) = (frames[from - 1], frames[end]);
            if (a.LapDistancePct is not { } pa || b.LapDistancePct is not { } pb || a.SessionTimeSeconds is not { } ta || b.SessionTimeSeconds is not { } tb || tb <= ta)
            {
                i = end;
                continue;
            }
            // Across the line (before the timing line is known) the position wraps from near 1 to near 0
            var span = pb - pa;
            if (span < -0.5f) span += 1;
            if (span <= 0 || span > 0.02f) { i = end; continue; }
            for (var j = from; j < end; j++)
            {
                var share = (frames[j].SessionTimeSeconds!.Value - ta) / (tb - ta);
                var pct = pa + (float)share * span;
                frames[j] = frames[j] with { LapDistancePct = pct >= 1 ? pct - 1 : pct };
            }
            i = end;
        }
    }

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
