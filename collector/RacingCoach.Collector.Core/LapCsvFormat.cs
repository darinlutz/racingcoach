using System.Globalization;

namespace RacingCoach.Collector.Simulators;

/// <summary>
/// The lap CSV the website reads (src/lib/lapData.ts), from canonical frames: the same columns, order and number format
/// as iRacing's. What a simulator doesn't give stays an empty cell, never 0. A test checks this writes iRacing's lap
/// CSVs byte for byte.
/// </summary>
public static class LapCsvFormat
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private static readonly (string Name, Func<TelemetryFrame, string> Value)[] Columns =
    [
        ("Speed", f => F(f.SpeedMps)),
        ("LapDistPct", f => F(f.LapDistancePct)),
        ("Brake", f => F(f.Brake)),
        ("Throttle", f => F(f.Throttle)),
        ("RPM", f => F(f.Rpm)),
        ("SteeringWheelAngle", f => F(f.SteeringWheelAngleRadians)),
        ("Gear", f => I(f.Gear)),
        ("Clutch", f => F(f.ClutchEngagement)),
        ("ABSActive", f => B(f.AbsActive)),
        ("LatAccel", f => F(f.LatAccelMps2)),
        ("LongAccel", f => F(f.LongAccelMps2)),
        ("VertAccel", f => F(f.VertAccelMps2)),
        ("Yaw", f => F(f.YawRadians)),
        ("YawRate", f => F(f.YawRateRadiansPerSecond)),
        ("VelocityX", f => F(f.VelocityForwardMps)),
        ("VelocityY", f => F(f.VelocityLeftMps)),
        ("LFtempCL", f => F(f.FrontLeft.CarcassTempLeftC)),
        ("LFtempCM", f => F(f.FrontLeft.CarcassTempMiddleC)),
        ("LFtempCR", f => F(f.FrontLeft.CarcassTempRightC)),
        ("RFtempCL", f => F(f.FrontRight.CarcassTempLeftC)),
        ("RFtempCM", f => F(f.FrontRight.CarcassTempMiddleC)),
        ("RFtempCR", f => F(f.FrontRight.CarcassTempRightC)),
        ("LRtempCL", f => F(f.RearLeft.CarcassTempLeftC)),
        ("LRtempCM", f => F(f.RearLeft.CarcassTempMiddleC)),
        ("LRtempCR", f => F(f.RearLeft.CarcassTempRightC)),
        ("RRtempCL", f => F(f.RearRight.CarcassTempLeftC)),
        ("RRtempCM", f => F(f.RearRight.CarcassTempMiddleC)),
        ("RRtempCR", f => F(f.RearRight.CarcassTempRightC)),
        ("FuelLevel", f => F(f.FuelLiters)),
        ("FuelUsePerHour", f => F(f.FuelUseKgPerHour)),
        ("WaterTemp", f => F(f.WaterTempC)),
        ("OilTemp", f => F(f.OilTempC)),
        ("LFrideHeight", f => F(f.FrontLeft.RideHeightMeters)),
        ("RFrideHeight", f => F(f.FrontRight.RideHeightMeters)),
        ("LRrideHeight", f => F(f.RearLeft.RideHeightMeters)),
        ("RRrideHeight", f => F(f.RearRight.RideHeightMeters)),
        ("LFpressure", f => F(f.FrontLeft.PressureKpa)),
        ("RFpressure", f => F(f.FrontRight.PressureKpa)),
        ("LRpressure", f => F(f.RearLeft.PressureKpa)),
        ("RRpressure", f => F(f.RearRight.PressureKpa)),
        ("Lap", f => I(f.LapNumber)),
        ("LapDist", f => F(f.LapDistanceMeters)),
        ("SessionTime", f => f.SessionTimeSeconds?.ToString(Inv) ?? ""),
        ("SessionTick", f => I(f.Tick)),
        ("Lat", f => D(f.Latitude)),
        ("Lon", f => D(f.Longitude)),
        ("Alt", f => D(f.AltitudeMeters)),
    ];

    /// <summary>The header row, ending with the car's fuel density.</summary>
    public static string Header { get; } = string.Join(',', Columns.Select(c => c.Name)) + ",FuelKgPerLtr";

    /// <summary>One row; fuelKgPerLiter is the same on every row, or null.</summary>
    public static string Row(TelemetryFrame frame, double? fuelKgPerLiter) =>
        string.Join(',', Columns.Select(c => c.Value(frame))) + "," + (fuelKgPerLiter is { } density ? density.ToString(Inv) : "");

    private static string F(float? v) => v?.ToString(Inv) ?? "";
    private static string D(double? v) => v?.ToString(Inv) ?? "";
    private static string I(int? v) => v?.ToString(Inv) ?? "";
    private static string B(bool? v) => v is { } b ? (b ? "true" : "false") : "";
}
