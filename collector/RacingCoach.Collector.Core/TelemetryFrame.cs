namespace RacingCoach.Collector.Simulators;

/// <summary>
/// One sample of the player's car in simulator-independent form. Null always means the simulator didn't give the value
/// (see SimulatorCatalog for which it can't): an adapter never fills a gap with 0 or an estimate.
///
/// Units and signs are SI and iRacing's own conventions, because everything downstream already reads those (the lap
/// CSVs, the website's analysis, the Rotation Model): an adapter for another simulator converts into them
/// (see Units), and iRacing's maps across unchanged. docs/multi-simulator.md has what each field means.
/// </summary>
public sealed record TelemetryFrame
{
    /// <summary>ISimulatorAdapter.SimulatorId of the adapter that made the frame. Frames of different simulators are
    /// never mixed in one session.</summary>
    public required string SimulatorId { get; init; }

    // Timing
    /// <summary>Seconds since the session started, on the simulator's own clock. Must not go backwards within a session number.</summary>
    public double? SessionTimeSeconds { get; init; }
    /// <summary>The simulator's sample counter, when it has one; samples missed show as a jump in it.</summary>
    public int? Tick { get; init; }
    /// <summary>Which session of the event this is (iRacing's SessionNum).</summary>
    public int? SessionNumber { get; init; }
    public int? LapNumber { get; init; }

    // Where the car is
    /// <summary>Fraction of the lap, 0 at the start/finish line up to 1. Negative or null: not on track.</summary>
    public float? LapDistancePct { get; init; }
    /// <summary>Meters from the start/finish line.</summary>
    public float? LapDistanceMeters { get; init; }
    /// <summary>Degrees and meters above sea level. Never worked out from a simulator's own world coordinates.</summary>
    public double? Latitude { get; init; }
    public double? Longitude { get; init; }
    public double? AltitudeMeters { get; init; }
    /// <summary>The car's position in the simulator's own world, meters, exactly as the simulator gives it (ACC's
    /// carCoordinates: y up, x and z across the ground, mirrored against east and north). Not latitude and longitude:
    /// the website places these on the earth itself (src/lib/worldAlignment.ts), from the mapped iRacing track.</summary>
    public float? WorldX { get; init; }
    public float? WorldY { get; init; }
    public float? WorldZ { get; init; }

    // Motion
    public float? SpeedMps { get; init; }
    /// <summary>The car's velocity in its own frame, m/s: forward (iRacing's VelocityX), left (VelocityY).</summary>
    public float? VelocityForwardMps { get; init; }
    public float? VelocityLeftMps { get; init; }
    /// <summary>m/s², in the car's frame, with iRacing's signs: LatAccel, LongAccel, VertAccel (includes gravity).</summary>
    public float? LatAccelMps2 { get; init; }
    public float? LongAccelMps2 { get; init; }
    public float? VertAccelMps2 { get; init; }
    /// <summary>Radians, as iRacing's Yaw.</summary>
    public float? YawRadians { get; init; }
    /// <summary>Radians per second, positive turning left.</summary>
    public float? YawRateRadiansPerSecond { get; init; }

    // Driver inputs
    /// <summary>0-1.</summary>
    public float? Throttle { get; init; }
    /// <summary>0-1.</summary>
    public float? Brake { get; init; }
    /// <summary>As iRacing's Clutch: 1 is fully engaged (pedal up), 0 disengaged.</summary>
    public float? ClutchEngagement { get; init; }
    /// <summary>The steering wheel's angle in radians, positive to the left. Null for a simulator that only gives the
    /// input as a fraction of lock (see SteeringInput): turning one into the other needs the car's lock.</summary>
    public float? SteeringWheelAngleRadians { get; init; }
    /// <summary>The steering input as a fraction of full lock, -1 to 1, positive to the left.</summary>
    public float? SteeringInput { get; init; }
    /// <summary>-1 reverse, 0 neutral, 1 first.</summary>
    public int? Gear { get; init; }
    public float? Rpm { get; init; }
    public bool? AbsActive { get; init; }

    // Wheels
    public WheelTelemetry FrontLeft { get; init; }
    public WheelTelemetry FrontRight { get; init; }
    public WheelTelemetry RearLeft { get; init; }
    public WheelTelemetry RearRight { get; init; }

    // Engine and fuel
    public float? WaterTempC { get; init; }
    public float? OilTempC { get; init; }
    public float? FuelLiters { get; init; }
    public float? FuelUseKgPerHour { get; init; }

    // State
    /// <summary>The player is driving the car (not in the garage or a menu).</summary>
    public bool? IsOnTrack { get; init; }
    public bool? IsReplay { get; init; }
    public bool? OnPitRoad { get; init; }
    public bool? OffTrack { get; init; }
    /// <summary>The simulator's running count of the player's incidents, in its own scale.</summary>
    public int? IncidentCount { get; init; }
    /// <summary>The simulator says the current lap counts for timing; null where it has no such idea.</summary>
    public bool? LapValid { get; init; }
    /// <summary>Set on the frame after a lap ends, by an adapter whose simulator says when that is.</summary>
    public NativeLapEvent? LapJustEnded { get; init; }

    // Weather
    public float? TrackTempC { get; init; }
    public float? AirTempC { get; init; }
    /// <summary>0-1.</summary>
    public float? RelativeHumidity { get; init; }
    public float? WindSpeedMps { get; init; }
    /// <summary>Radians, as iRacing's WindDir.</summary>
    public float? WindDirectionRadians { get; init; }
}

/// <summary>One corner of the car. Across the tire, left and right are as seen from behind the car, like iRacing's
/// tempCL/CM/CR, so which is the outer edge depends on the side of the car.</summary>
public readonly record struct WheelTelemetry
{
    /// <summary>kPa.</summary>
    public float? PressureKpa { get; init; }
    /// <summary>Meters, this corner's own. A simulator with one value per axle leaves these null.</summary>
    public float? RideHeightMeters { get; init; }
    /// <summary>°C, carcass temperature across the tire. Only a simulator's real carcass values go here, not a "core" temperature.</summary>
    public float? CarcassTempLeftC { get; init; }
    public float? CarcassTempMiddleC { get; init; }
    public float? CarcassTempRightC { get; init; }
}

/// <summary>Unit conversions into TelemetryFrame's units, so each adapter does them the same way. Each maps null to null.</summary>
public static class Units
{
    public static float? KmhToMps(float? kmh) => kmh / 3.6f;
    public static float? PsiToKpa(float? psi) => psi * 6.894757f;
    public static float? GToMps2(float? g) => g * 9.80665f;
    public static float? MmToMeters(float? mm) => mm / 1000f;
    public static float? DegreesToRadians(float? degrees) => degrees * MathF.PI / 180f;
}
