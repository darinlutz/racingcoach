using System.Text.Json;
using System.Text.Json.Nodes;
using RacingCoach.Collector.Rotation;

// Usage: RotationModel.Replay <config.json> <output folder> <fixture.json>...
// Each fixture is { calibration, samples: [RotationSample as JSON] } (rotation-model/fixtures). Writes
// <output folder>/<fixture name>.results.json: { results: [RotationModelResult], events: [RotationModelEvent] },
// with the same names and values rotationModel.ts gives.

if (args.Length < 3)
{
    Console.Error.WriteLine("Usage: RotationModel.Replay <config.json> <output folder> <fixture.json>...");
    return 1;
}

var config = RotationModelConfig.Parse(File.ReadAllText(args[0]));
Directory.CreateDirectory(args[1]);
foreach (var path in args.Skip(2))
{
    var fixture = JsonNode.Parse(File.ReadAllText(path))!.AsObject();
    var calibration = fixture["calibration"] is JsonObject c ? c.Deserialize<RotationModelCalibration>(RotationModelConfig.Json) : null;
    var model = new RotationModel(config, calibration);
    var output = Path.Combine(args[1], Path.GetFileNameWithoutExtension(path) + ".results.json");

    using var stream = File.Create(output);
    using var json = new Utf8JsonWriter(stream);
    json.WriteStartObject();
    json.WriteStartArray("results");
    var events = new List<RotationModelEvent>();
    foreach (var node in fixture["samples"]!.AsArray())
    {
        var s = node!.AsObject();
        var sample = new RotationSample(
            Number(s, "time"), Number(s, "speed"), Number(s, "steeringWheelAngle"), Number(s, "yawRate"), Number(s, "yaw"),
            Number(s, "velocityX"), Number(s, "velocityY"), Number(s, "latAccel"), Number(s, "longAccel"), Number(s, "vertAccel"),
            Number(s, "throttle"), Number(s, "brake"), Number(s, "lapDistPct"),
            Number(s, "sessionNum") is { } n ? (int)n : null,
            s["isOnTrack"] is JsonValue b && b.TryGetValue<bool>(out var onTrack) ? onTrack : null);
        WriteResult(json, model.Update(sample));
        events.AddRange(model.TakeEvents());
    }
    model.Finish();
    events.AddRange(model.TakeEvents());
    json.WriteEndArray();
    json.WriteStartArray("events");
    foreach (var e in events)
        WriteEvent(json, e);
    json.WriteEndArray();
    json.WriteEndObject();
}
return 0;

static double? Number(JsonObject o, string name) =>
    o[name] is JsonValue v && v.TryGetValue<double>(out var d) ? d : null;

static void WriteNumber(Utf8JsonWriter json, string name, double? value)
{
    if (value is { } v && double.IsFinite(v))
        json.WriteNumber(name, v);
    else
        json.WriteNull(name);
}

static void WriteResult(Utf8JsonWriter json, RotationModelResult r)
{
    json.WriteStartObject();
    WriteNumber(json, "timestamp", r.Timestamp);
    json.WriteString("state", RotationNames.Of(r.State));
    json.WriteString("displayLabel", r.DisplayLabel);
    json.WriteNumber("confidence", r.Confidence);
    json.WriteNumber("understeerConfidence", r.UndersteerConfidence);
    json.WriteNumber("oversteerConfidence", r.OversteerConfidence);
    json.WriteNumber("understeerSeverity", r.UndersteerSeverity);
    json.WriteNumber("oversteerSeverity", r.OversteerSeverity);
    WriteNumber(json, "yawRateActual", r.YawRateActual);
    WriteNumber(json, "yawRateExpected", r.YawRateExpected);
    WriteNumber(json, "yawRateKinematic", r.YawRateKinematic);
    WriteNumber(json, "yawRateError", r.YawRateError);
    WriteNumber(json, "yawResponseRatio", r.YawResponseRatio);
    WriteNumber(json, "forwardVelocityMps", r.ForwardVelocityMps);
    WriteNumber(json, "lateralVelocityMps", r.LateralVelocityMps);
    WriteNumber(json, "sideslipAngleRadians", r.SideslipAngleRadians);
    WriteNumber(json, "sideslipAngleDegrees", r.SideslipAngleDegrees);
    WriteNumber(json, "sideslipRateDegreesPerSecond", r.SideslipRateDegreesPerSecond);
    WriteNumber(json, "frontWheelAngleRadians", r.FrontWheelAngleRadians);
    WriteNumber(json, "frontAxleSlipDegrees", r.FrontAxleSlipDegrees);
    WriteNumber(json, "rearAxleSlipDegrees", r.RearAxleSlipDegrees);
    WriteNumber(json, "latAccelResidual", r.LatAccelResidual);
    json.WriteString("cornerPhase", RotationNames.Of(r.CornerPhase));
    if (r.OversteerType is { } type)
        json.WriteString("oversteerType", RotationNames.Of(type));
    else
        json.WriteNull("oversteerType");
    json.WriteString("capability", r.FullCapability ? "FULL" : "YAW_ONLY");
    if (r.InvalidReason is null)
        json.WriteNull("invalidReason");
    else
        json.WriteString("invalidReason", r.InvalidReason);
    json.WriteString("modelVersion", r.ModelVersion);
    if (r.CalibrationId is null)
        json.WriteNull("calibrationId");
    else
        json.WriteString("calibrationId", r.CalibrationId);
    json.WriteBoolean("isCalibrated", r.IsCalibrated);
    json.WriteBoolean("isValid", r.IsValid);
    json.WriteEndObject();
}

static void WriteEvent(Utf8JsonWriter json, RotationModelEvent e)
{
    json.WriteStartObject();
    json.WriteString("eventType", RotationNames.Of(e.EventType));
    json.WriteNumber("startTime", e.StartTime);
    json.WriteNumber("confirmedTime", e.ConfirmedTime);
    json.WriteNumber("endTime", e.EndTime);
    json.WriteNumber("durationMs", e.DurationMs);
    json.WriteNumber("peakSeverity", e.PeakSeverity);
    json.WriteNumber("averageSeverity", e.AverageSeverity);
    json.WriteNumber("peakConfidence", e.PeakConfidence);
    json.WriteNumber("speedAtStartMps", e.SpeedAtStartMps);
    json.WriteString("cornerPhase", RotationNames.Of(e.CornerPhase));
    if (e.OversteerType is { } type)
        json.WriteString("oversteerType", RotationNames.Of(type));
    else
        json.WriteNull("oversteerType");
    json.WriteStartObject("phaseSamples");
    foreach (var (phase, count) in e.PhaseSamples)
        json.WriteNumber(phase, count);
    json.WriteEndObject();
    json.WriteNumber("averageThrottle", e.AverageThrottle);
    json.WriteNumber("averageBrake", e.AverageBrake);
    WriteNumber(json, "lapDistPctStart", e.LapDistPctStart);
    WriteNumber(json, "lapDistPctEnd", e.LapDistPctEnd);
    json.WriteString("endReason", e.EndReason);
    json.WriteString("modelVersion", e.ModelVersion);
    if (e.CalibrationId is null)
        json.WriteNull("calibrationId");
    else
        json.WriteString("calibrationId", e.CalibrationId);
    json.WriteEndObject();
}
