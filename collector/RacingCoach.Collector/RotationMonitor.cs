using System.Reflection;
using RacingCoach.Collector.Rotation;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// Runs the Rotation Model (RotationModel/) on every telemetry sample, for the UNDERSTEER / OVERSTEER label in
/// the overlay and the Rotation window. The settings and car calibrations are rotation-model/config.json and
/// calibrations.json, built into the exe; Documents\RacingCoach\rotation-model\config.json replaces the
/// settings and calibrations.json there adds (or replaces) cars, so both can be tuned without a new collector.
/// Update runs on the telemetry handler's thread; the windows read Latest from the UI thread.
/// </summary>
internal sealed class RotationMonitor
{
    private const string ConfigName = "rotation-model.config.json";
    private const string CalibrationsName = "rotation-model.calibrations.json";

    private readonly Action<string> _log;
    private readonly RotationModel _model;
    private readonly RotationModelCalibrationSet _calibrations;
    private readonly object _lock = new();
    private RotationModelResult _latest;
    private bool _hasLatest;
    // Set from the session info handler, swapped in on the telemetry thread (the model isn't thread-safe)
    private volatile CalibrationChange? _pending;
    private string? _car;

    private sealed record CalibrationChange(RotationModelCalibration? Calibration);

    public RotationMonitor(Action<string> log)
    {
        _log = log;
        var folder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RacingCoach", "rotation-model");
        var localConfig = Path.Combine(folder, "config.json");
        Config = RotationModelConfig.Parse(BuiltIn(ConfigName));
        if (File.Exists(localConfig))
        {
            try
            {
                Config = RotationModelConfig.Parse(File.ReadAllText(localConfig));
                _log($"Rotation Model: using settings from {localConfig}.");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
            {
                _log($"Rotation Model: couldn't read {localConfig} ({e.Message}); using the built-in settings.");
            }
        }

        _calibrations = RotationModelCalibrationSet.Parse(BuiltIn(CalibrationsName));
        var localCalibrations = Path.Combine(folder, "calibrations.json");
        if (File.Exists(localCalibrations))
        {
            try
            {
                _calibrations = _calibrations.With(RotationModelCalibrationSet.Parse(File.ReadAllText(localCalibrations)));
                _log($"Rotation Model: added car calibrations from {localCalibrations}.");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
            {
                _log($"Rotation Model: couldn't read {localCalibrations} ({e.Message}); using the built-in calibrations.");
            }
        }
        _model = new RotationModel(Config);
    }

    public RotationModelConfig Config { get; }
    /// <summary>The current car's calibration, or null when it has none (the model then reports Unknown).</summary>
    public RotationModelCalibration? Calibration { get; private set; }
    public int UndersteerEvents { get; private set; }
    public int OversteerEvents { get; private set; }

    /// <summary>The latest result, if there's been a sample since connecting.</summary>
    public bool TryGetLatest(out RotationModelResult result)
    {
        lock (_lock)
        {
            result = _latest;
            return _hasLatest;
        }
    }

    /// <summary>The car changed (from iRacing's session info): use its calibration, if there is one.</summary>
    public void SetCar(string? carPath, string carName)
    {
        var key = $"{carPath}|{carName}";
        if (key == _car)
            return;
        _car = key;
        var calibration = _calibrations.Find(carPath, carName);
        Calibration = calibration;
        _pending = new CalibrationChange(calibration);
        _log(calibration is null
            ? $"Rotation Model: no calibration for {carName} yet, so no understeer/oversteer labels (see rotation-model/README.md, Calibration)."
            : $"Rotation Model: using calibration {calibration.CalibrationId} for {carName}.");
    }

    public void OnSample(in TelemetryData d)
    {
        if (_pending is { } change)
        {
            _pending = null;
            _model.SetCalibration(change.Calibration);
            UndersteerEvents = OversteerEvents = 0;
        }

        var result = _model.Update(new RotationSample(
            d.SessionTime,
            d.Speed,
            d.SteeringWheelAngle,
            d.YawRate,
            d.Yaw,
            d.VelocityX,
            d.VelocityY,
            d.LatAccel,
            d.LongAccel,
            d.VertAccel,
            d.Throttle,
            d.Brake,
            d.LapDistPct,
            d.SessionNum,
            d.IsOnTrack != true || d.IsReplayPlaying == true ? false : true));
        lock (_lock)
        {
            _latest = result;
            _hasLatest = true;
        }

        if (_model.HasEvents)
        {
            foreach (var e in _model.TakeEvents())
            {
                if (e.EventType == RotationState.Understeer)
                    UndersteerEvents++;
                else
                    OversteerEvents++;
            }
        }
    }

    /// <summary>Not connected any more: nothing to show.</summary>
    public void Clear()
    {
        lock (_lock)
            _hasLatest = false;
    }

    // The copy built into the exe from rotation-model/
    private static string BuiltIn(string resource)
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(resource)
            ?? throw new InvalidOperationException($"{resource} isn't built into the collector");
        using var reader = new StreamReader(stream);
        return reader.ReadToEnd();
    }
}
