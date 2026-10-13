using System.Text.Json;
using System.Text.Json.Nodes;

namespace RacingCoach.Collector.Rotation;

/// <summary>A point of a yaw-gain map: steady-state yaw rate per radian of steering wheel at a speed.</summary>
internal sealed record YawGainPoint(double SpeedMps, double GainPerRad);

/// <summary>
/// One car's calibration (rotation-model/calibrations.json, same fields as RotationCalibration in
/// src/lib/rotationModel.ts). Unknown physical values stay null; the model reports itself uncalibrated rather
/// than guess them.
/// </summary>
internal sealed class RotationModelCalibration
{
    public string CalibrationId { get; init; } = "";
    public string CalibrationVersion { get; init; } = "";
    /// <summary>iRacing's CarPath, e.g. "porsche992rgt3".</summary>
    public string? CarId { get; init; }
    /// <summary>iRacing's CarScreenName(s).</summary>
    public List<string> CarNames { get; init; } = [];
    public double? WheelbaseMeters { get; init; }
    public double? SteeringRatio { get; init; }
    public double? CgToFrontAxleMeters { get; init; }
    public double? CgToRearAxleMeters { get; init; }
    public double? UndersteerGradient { get; init; }
    public double? EffectiveSteerLength { get; init; }
    public double? EffectiveUndersteerTerm { get; init; }
    public string YawReferenceModel { get; init; } = "";
    public List<YawGainPoint>? YawGainMap { get; init; }
    public double[]? ValidSpeedRangeMps { get; init; }
    public JsonObject? Overrides { get; init; }
    public string? Source { get; init; }
}

/// <summary>The calibrations file: every calibrated car.</summary>
internal sealed class RotationModelCalibrationSet
{
    public List<RotationModelCalibration> Calibrations { get; init; } = [];

    public static RotationModelCalibrationSet Parse(string json) =>
        JsonSerializer.Deserialize<RotationModelCalibrationSet>(json, RotationModelConfig.Json) ?? new();

    /// <summary>The calibration for a car, by iRacing's CarPath or one of its screen names (case-insensitive),
    /// like findCalibration in rotationModel.ts.</summary>
    public RotationModelCalibration? Find(string? carId, string? carName)
    {
        var id = carId?.Trim();
        var name = carName?.Trim();
        return Calibrations.FirstOrDefault(c => !string.IsNullOrEmpty(id) && string.Equals(c.CarId, id, StringComparison.OrdinalIgnoreCase))
            ?? Calibrations.FirstOrDefault(c => !string.IsNullOrEmpty(name) && c.CarNames.Any(n => string.Equals(n, name, StringComparison.OrdinalIgnoreCase)));
    }

    /// <summary>This set with another's calibrations added; theirs replace ours for the same calibrationId or car.</summary>
    public RotationModelCalibrationSet With(RotationModelCalibrationSet other) => new()
    {
        Calibrations =
        [
            .. other.Calibrations,
            .. Calibrations.Where(c => !other.Calibrations.Any(o =>
                o.CalibrationId == c.CalibrationId
                || (o.CarId is not null && string.Equals(o.CarId, c.CarId, StringComparison.OrdinalIgnoreCase)))),
        ],
    };
}
