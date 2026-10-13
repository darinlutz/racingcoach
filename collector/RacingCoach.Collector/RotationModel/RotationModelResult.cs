namespace RacingCoach.Collector.Rotation;

/// <summary>One telemetry sample in iRacing's names and units (see RotationSample in rotationModel.ts). Time is
/// SessionTime in seconds. Missing values are null.</summary>
internal readonly record struct RotationSample(
    double? Time,
    double? Speed,
    double? SteeringWheelAngle,
    double? YawRate,
    double? Yaw = null,
    double? VelocityX = null,
    double? VelocityY = null,
    double? LatAccel = null,
    double? LongAccel = null,
    double? VertAccel = null,
    double? Throttle = null,
    double? Brake = null,
    double? LapDistPct = null,
    int? SessionNum = null,
    bool? IsOnTrack = null);

internal enum RotationState { Unknown, Neutral, Understeer, Oversteer }

internal enum CornerPhase { Straight, Entry, MidCorner, Exit }

internal enum OversteerType { Entry, MidCorner, PowerOn }

/// <summary>
/// The model's verdict on one sample (RotationModelResult in rotationModel.ts; the JSON names are the camelCase
/// of these). A struct, so the 60 Hz telemetry handler doesn't allocate.
/// </summary>
internal readonly record struct RotationModelResult
{
    public double? Timestamp { get; init; }
    public RotationState State { get; init; }
    /// <summary>"UNDERSTEER", "OVERSTEER", or "" when the overlay should show nothing.</summary>
    public string DisplayLabel { get; init; }
    public double Confidence { get; init; }
    public double UndersteerConfidence { get; init; }
    public double OversteerConfidence { get; init; }
    public double UndersteerSeverity { get; init; }
    public double OversteerSeverity { get; init; }
    public double? YawRateActual { get; init; }
    public double? YawRateExpected { get; init; }
    public double? YawRateKinematic { get; init; }
    public double? YawRateError { get; init; }
    public double? YawResponseRatio { get; init; }
    public double? ForwardVelocityMps { get; init; }
    public double? LateralVelocityMps { get; init; }
    public double? SideslipAngleRadians { get; init; }
    public double? SideslipAngleDegrees { get; init; }
    public double? SideslipRateDegreesPerSecond { get; init; }
    public double? FrontWheelAngleRadians { get; init; }
    public double? FrontAxleSlipDegrees { get; init; }
    public double? RearAxleSlipDegrees { get; init; }
    public double? LatAccelResidual { get; init; }
    public CornerPhase CornerPhase { get; init; }
    public OversteerType? OversteerType { get; init; }
    /// <summary>True with usable VelocityX/VelocityY (sideslip); false is yaw only.</summary>
    public bool FullCapability { get; init; }
    public string? InvalidReason { get; init; }
    public string ModelVersion { get; init; }
    public string? CalibrationId { get; init; }
    public bool IsCalibrated { get; init; }
    public bool IsValid { get; init; }
}

/// <summary>A completed understeer or oversteer event (RotationModelEvent in rotationModel.ts).</summary>
internal sealed record RotationModelEvent(
    RotationState EventType,
    double StartTime,
    double ConfirmedTime,
    double EndTime,
    double DurationMs,
    double PeakSeverity,
    double AverageSeverity,
    double PeakConfidence,
    double SpeedAtStartMps,
    CornerPhase CornerPhase,
    OversteerType? OversteerType,
    IReadOnlyDictionary<string, int> PhaseSamples,
    double AverageThrottle,
    double AverageBrake,
    double? LapDistPctStart,
    double? LapDistPctEnd,
    string EndReason,
    string ModelVersion,
    string? CalibrationId);

/// <summary>The JSON names of the enums, the same strings as rotationModel.ts.</summary>
internal static class RotationNames
{
    public static string Of(RotationState state) => state switch
    {
        RotationState.Neutral => "NEUTRAL",
        RotationState.Understeer => "UNDERSTEER",
        RotationState.Oversteer => "OVERSTEER",
        _ => "UNKNOWN",
    };

    public static string Of(CornerPhase phase) => phase switch
    {
        CornerPhase.Entry => "ENTRY",
        CornerPhase.MidCorner => "MID_CORNER",
        CornerPhase.Exit => "EXIT",
        _ => "STRAIGHT",
    };

    public static string Of(OversteerType type) => type switch
    {
        OversteerType.Entry => "ENTRY",
        OversteerType.PowerOn => "POWER_ON",
        _ => "MID_CORNER",
    };
}
