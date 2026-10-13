using System.Text.Json;
using System.Text.Json.Nodes;

namespace RacingCoach.Collector.Rotation;

/// <summary>
/// The Rotation Model's settings, read from rotation-model/config.json (shared with the website's
/// src/lib/rotationModel.ts; see rotation-model/README.md for what each one does). Property names match the
/// JSON's camelCase names.
/// </summary>
internal sealed class RotationModelConfig
{
    public static readonly JsonSerializerOptions Json = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
    };

    public string ModelVersion { get; init; } = "";
    public string ConfigVersion { get; init; } = "";
    public ConventionSettings Conventions { get; init; } = new();
    public FilterSettings Filters { get; init; } = new();
    public ValiditySettings Validity { get; init; } = new();
    public UndersteerSettings Understeer { get; init; } = new();
    public OversteerSettings Oversteer { get; init; } = new();
    public StateSettings State { get; init; } = new();
    public PhaseSettings Phase { get; init; } = new();
    public DisplaySettings Display { get; init; } = new();

    /// <summary>The JSON this config was read from, so a calibration's overrides can be merged into it.</summary>
    internal JsonObject Source { get; private set; } = [];

    public static RotationModelConfig Parse(string json) => FromNode(JsonNode.Parse(json)?.AsObject() ?? throw new JsonException("config must be a JSON object"));

    private static RotationModelConfig FromNode(JsonObject node)
    {
        var config = node.Deserialize<RotationModelConfig>(Json) ?? throw new JsonException("config must be a JSON object");
        config.Source = node;
        return config;
    }

    /// <summary>This config with a calibration's overrides applied (objects merged key by key, anything else
    /// replaced), like mergeConfig in rotationModel.ts.</summary>
    public RotationModelConfig WithOverrides(JsonObject? overrides)
    {
        if (overrides is null || overrides.Count == 0)
            return this;
        var merged = (JsonObject)Source.DeepClone();
        Merge(merged, overrides);
        return FromNode(merged);
    }

    private static void Merge(JsonObject target, JsonObject overrides)
    {
        foreach (var (key, value) in overrides)
        {
            if (value is JsonObject child && target[key] is JsonObject existing)
                Merge(existing, child);
            else
                target[key] = value?.DeepClone();
        }
    }
}

internal sealed class ConventionSettings
{
    /// <summary>"body": VelocityX/VelocityY are forward/left in the car's frame; "world": rotate them by Yaw.</summary>
    public string VelocityFrame { get; init; } = "body";
    public double SteeringSign { get; init; } = 1;
    /// <summary>"auto" or a number (its sign is used): LatAccel's sign relative to a left turn's v·r.</summary>
    public JsonElement LatAccelSign { get; init; }

    public bool LatAccelSignAuto => LatAccelSign.ValueKind != JsonValueKind.Number;
    public double LatAccelSignValue => LatAccelSign.ValueKind == JsonValueKind.Number ? LatAccelSign.GetDouble() : 0;
}

internal sealed class FilterSettings
{
    public double SpeedTau { get; init; }
    public double SteeringTau { get; init; }
    public double YawRateTau { get; init; }
    public double VelocityTau { get; init; }
    public double LatAccelTau { get; init; }
    public double DerivativeTau { get; init; }
    public double YawResponseTau { get; init; }
    public double VertBaselineTau { get; init; }
}

internal sealed class ValiditySettings
{
    public double MinSpeedMps { get; init; }
    public double MaxSampleGapSeconds { get; init; }
    public double WarmupSeconds { get; init; }
    public double MinTurnYawRate { get; init; }
    public double ReverseForwardVelocityMps { get; init; }
    public double VelocityMagnitudeTolerance { get; init; }
    public double FrameCheckMaxSideslipDeg { get; init; }
    public double FrameCheckTau { get; init; }
    public double FrameCheckMinScore { get; init; }
    public double BumpVertAccelMps2 { get; init; }
    public double BumpHoldSeconds { get; init; }
    public double MaxLatAccelResidualMps2 { get; init; }
    public double LatAccelSignMinEvidence { get; init; }
    public double LatAccelSignMinLateralMps2 { get; init; }
}

internal sealed class UndersteerSettings
{
    public double YawDeficitStart { get; init; }
    public double YawDeficitFull { get; init; }
    public double CoreWeight { get; init; }
    public double GrowthStartPerSecond { get; init; }
    public double GrowthFullPerSecond { get; init; }
    public double LatAccelPlateauStart { get; init; }
    public double LatAccelPlateauFull { get; init; }
    public double LatAccelPeakMinMps2 { get; init; }
    public double LatAccelPeakDecayTau { get; init; }
    public double FrontSlipExcessStartDeg { get; init; }
    public double FrontSlipExcessFullDeg { get; init; }
    public UndersteerWeights Weights { get; init; } = new();
    public double SteeringRateOkRadPerSec { get; init; }
    public double SteeringRateMaxRadPerSec { get; init; }
    public double SeverityFull { get; init; }
}

internal sealed class UndersteerWeights
{
    public double Growth { get; init; }
    public double Plateau { get; init; }
    public double FrontAxle { get; init; }
}

internal sealed class OversteerSettings
{
    public double YawExcessStart { get; init; }
    public double YawExcessFull { get; init; }
    public double EntryAllowance { get; init; }
    public double CoreWeight { get; init; }
    public double SideslipStartDeg { get; init; }
    public double SideslipFullDeg { get; init; }
    public double SideslipRateStartDegPerSec { get; init; }
    public double SideslipRateFullDegPerSec { get; init; }
    public double CountersteerMinRad { get; init; }
    public double RearSlipStartDeg { get; init; }
    public double RearSlipFullDeg { get; init; }
    public OversteerWeights Weights { get; init; } = new();
    public double SeverityYawFull { get; init; }
    public double SeveritySideslipFullDeg { get; init; }
}

internal sealed class OversteerWeights
{
    public double Sideslip { get; init; }
    public double SideslipRate { get; init; }
    public double Countersteer { get; init; }
    public double RearAxle { get; init; }
}

internal sealed class StateSettings
{
    public double EnterConfidence { get; init; }
    public double ExitConfidence { get; init; }
    public double EnterSeconds { get; init; }
    public double ExitSeconds { get; init; }
    public double MinHoldSeconds { get; init; }
}

internal sealed class PhaseSettings
{
    public double BrakeOn { get; init; }
    public double ThrottleExit { get; init; }
}

internal sealed class DisplaySettings
{
    public string UndersteerColor { get; init; } = "#F59E0B";
    public string OversteerColor { get; init; } = "#EF4444";
}
