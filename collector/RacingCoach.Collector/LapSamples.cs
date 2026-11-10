using System.Globalization;
using RacingCoach.Collector.Simulators;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>A completed lap's samples as LapWriter needs them, whichever simulator they came from.</summary>
internal abstract class LapSamples
{
    public abstract int Count { get; }
    /// <summary>The CSV's header row.</summary>
    public abstract string Header { get; }
    /// <summary>Writes one CSV row per sample; fuelKgPerLiter is the same on every row.</summary>
    public abstract void WriteRows(TextWriter writer, double? fuelKgPerLiter);
    /// <summary>The simulator's clock at the last sample, or null.</summary>
    public abstract double? LastSessionTime { get; }
    /// <summary>Every sample has a track position.</summary>
    public abstract bool HasPosition { get; }
    /// <summary>A lap without track positions can get them later (iRacing's .ibt files), so it isn't finished with yet.</summary>
    public abstract bool PositionsMayFollow { get; }
    /// <summary>The weather on the last sample; null when there's none.</summary>
    public abstract LapConditions? Conditions(string? trackUsage, IReadOnlyDictionary<int, string>? tireTypes = null);
}

/// <summary>An iRacing lap, written from iRacing's own samples.</summary>
internal sealed class IRacingLapSamples(List<TelemetryData> samples) : LapSamples
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    // Same names and units as iRacing: Speed in m/s, pedals 0..1, LapDistPct 0..1.
    private static readonly (string Name, Func<TelemetryData, string> Value)[] Columns =
    [
        ("Speed", d => F(d.Speed)),
        ("LapDistPct", d => F(d.LapDistPct)),
        ("Brake", d => F(d.Brake)),
        ("Throttle", d => F(d.Throttle)),
        ("RPM", d => F(d.RPM)),
        ("SteeringWheelAngle", d => F(d.SteeringWheelAngle)),
        ("Gear", d => I(d.Gear)),
        ("Clutch", d => F(d.Clutch)),
        ("ABSActive", d => B(d.BrakeABSactive)),
        ("LatAccel", d => F(d.LatAccel)),
        ("LongAccel", d => F(d.LongAccel)),
        ("VertAccel", d => F(d.VertAccel)),
        ("Yaw", d => F(d.Yaw)),
        ("YawRate", d => F(d.YawRate)),
        // The car's velocity, forward and to the left (m/s): the Rotation Model's sideslip on the website
        ("VelocityX", d => F(d.VelocityX)),
        ("VelocityY", d => F(d.VelocityY)),
        // Each tire's carcass temperature (°C), left, middle and right across it: Lap Compare's Tire Temp charts
        ("LFtempCL", d => F(d.LFtempCL)),
        ("LFtempCM", d => F(d.LFtempCM)),
        ("LFtempCR", d => F(d.LFtempCR)),
        ("RFtempCL", d => F(d.RFtempCL)),
        ("RFtempCM", d => F(d.RFtempCM)),
        ("RFtempCR", d => F(d.RFtempCR)),
        ("LRtempCL", d => F(d.LRtempCL)),
        ("LRtempCM", d => F(d.LRtempCM)),
        ("LRtempCR", d => F(d.LRtempCR)),
        ("RRtempCL", d => F(d.RRtempCL)),
        ("RRtempCM", d => F(d.RRtempCM)),
        ("RRtempCR", d => F(d.RRtempCR)),
        // Lap Compare's Engine charts: fuel in liters, fuel use in kg/h, temperatures in °C (RPM is above)
        ("FuelLevel", d => F(d.FuelLevel)),
        ("FuelUsePerHour", d => F(d.FuelUsePerHour)),
        ("WaterTemp", d => F(d.WaterTemp)),
        ("OilTemp", d => F(d.OilTemp)),
        // Each corner's ride height (m): Lap Compare's Ride Heights charts
        ("LFrideHeight", d => F(d.LFrideHeight)),
        ("RFrideHeight", d => F(d.RFrideHeight)),
        ("LRrideHeight", d => F(d.LRrideHeight)),
        ("RRrideHeight", d => F(d.RRrideHeight)),
        // Each tire's pressure (kPa): Lap Compare's Tire Pressure charts
        ("LFpressure", d => F(d.LFpressure)),
        ("RFpressure", d => F(d.RFpressure)),
        ("LRpressure", d => F(d.LRpressure)),
        ("RRpressure", d => F(d.RRpressure)),
        ("Lap", d => I(d.Lap)),
        ("LapDist", d => F(d.LapDist)),
        ("SessionTime", d => d.SessionTime?.ToString(Inv) ?? ""),
        ("SessionTick", d => I(d.SessionTick)),
        // Empty in live laps until IbtEnricher fills them in from the session's .ibt file
        ("Lat", d => D(d.Lat)),
        ("Lon", d => D(d.Lon)),
        ("Alt", d => D(d.Alt)),
    ];

    public override int Count => samples.Count;
    // Last, the car's fuel density from session info, the same on every row
    public override string Header => string.Join(',', Columns.Select(c => c.Name)) + ",FuelKgPerLtr";
    public override double? LastSessionTime => samples[^1].SessionTime;
    // Only played-back .ibt files have them already
    public override bool HasPosition => samples.All(s => s.Lat is { } lat && s.Lon is { } lon && (lat != 0 || lon != 0));
    public override bool PositionsMayFollow => true;

    public override void WriteRows(TextWriter writer, double? fuelKgPerLiter)
    {
        var fuelKgPerLtr = fuelKgPerLiter is { } density ? density.ToString(Inv) : "";
        foreach (var sample in samples)
            writer.WriteLine(string.Join(',', Columns.Select(c => c.Value(sample))) + "," + fuelKgPerLtr);
    }

    public override LapConditions? Conditions(string? trackUsage, IReadOnlyDictionary<int, string>? tireTypes = null)
    {
        var last = samples[^1];
        var compound = last.PlayerTireCompound;
        return LapConditions.Create(last.TrackTempCrew, last.AirTemp, last.RelativeHumidity, last.WindVel, last.WindDir, trackUsage,
            last.Precipitation, last.TrackWetness is { } wetness ? (int)wetness : null, last.WeatherDeclaredWet,
            compound, compound is { } index ? tireTypes?.GetValueOrDefault(index) : null);
    }

    private static string F(float? v) => v?.ToString(Inv) ?? "";
    private static string D(double? v) => v?.ToString(Inv) ?? "";
    private static string I(int? v) => v?.ToString(Inv) ?? "";
    private static string B(bool? v) => v is { } b ? (b ? "true" : "false") : "";
}

/// <summary>A lap from any other simulator's adapter, written from canonical frames in the same CSV format.</summary>
internal sealed class CanonicalLapSamples(IReadOnlyList<TelemetryFrame> rawFrames) : LapSamples
{
    // Only the channels the matrix marks collected for the simulator reach the lap file (ChannelGate)
    private readonly IReadOnlyList<TelemetryFrame> frames = rawFrames.Count == 0
        ? rawFrames
        : rawFrames.Select(f => ChannelGate.ForLapFile(f, SimulatorCatalog.Shared.Find(f.SimulatorId))).ToList();

    // World coordinates (ACC's) go in columns of their own after the rest, for the website to place on the earth
    private bool HasWorld => hasWorld ??= LapCsvFormat.HasWorld(frames);
    private bool? hasWorld;

    public override int Count => frames.Count;
    public override string Header => HasWorld ? LapCsvFormat.HeaderWithWorld : LapCsvFormat.Header;
    public override double? LastSessionTime => frames[^1].SessionTimeSeconds;
    public override bool HasPosition => frames.All(f => f.Latitude is { } lat && f.Longitude is { } lon && (lat != 0 || lon != 0));
    public override bool PositionsMayFollow => false;

    public override void WriteRows(TextWriter writer, double? fuelKgPerLiter)
    {
        foreach (var frame in frames)
            writer.WriteLine(LapCsvFormat.Row(frame, fuelKgPerLiter, HasWorld));
    }

    public override LapConditions? Conditions(string? trackUsage, IReadOnlyDictionary<int, string>? tireTypes = null)
    {
        var last = frames[^1];
        return LapConditions.Create(last.TrackTempC, last.AirTempC, last.RelativeHumidity, last.WindSpeedMps, last.WindDirectionRadians, trackUsage);
    }
}
