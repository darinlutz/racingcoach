using System.Globalization;
using System.Reflection;
using Jint;
using Jint.Native;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>One focus area's values on this lap, as TelemetryEngine.js's functions return them (colors are
/// SimHub color names such as "Firebrick", or "Transparent").</summary>
internal sealed record OverlayAreaValues(
    string AlertColor,
    string Brake, string BrakeColor,
    string Force, string ForceColor,
    string Gas, string GasColor,
    string Time, string Exit, string Coast, string Overlap);

/// <summary>What the overlay window shows, copied out of OverlayEngine for the UI thread.</summary>
internal sealed record OverlaySnapshot(
    string? Track,
    IReadOnlyList<string?> AreaNames,
    IReadOnlyList<OverlayAreaValues?> Areas,
    string? MaxBrake,
    string? MinSpeed,
    string? Error);

/// <summary>
/// Runs TelemetryEngine.js (scripts/ in the repo, a SimHub script) for the overlay. The script expects SimHub,
/// so this provides what it uses: $prop(name) answers from live iRacing telemetry in SimHub's units, format()
/// formats a number like SimHub's, root is a plain object the script keeps its state in, and TrackConfig holds
/// the user's Track Data track for the current track (the same shape as the Track Data text file). Every
/// telemetry sample is fed through all the functions the overlay shows, since the script works out area
/// crossings from consecutive samples. root starts empty again with each new session, so nothing carries over.
/// All script calls happen on the telemetry thread (OnSample); the UI reads Snapshot.
/// </summary>
internal sealed class OverlayEngine
{
    public const int AreaCount = 8;
    private const string ScriptName = "TelemetryEngine.js";
    private const double MphPerMetersPerSecond = 2.2369362921;

    // The script functions the overlay calls; checked when the script loads
    private static readonly string[] Functions =
    [
        "LapBrakePoint", "GetAreaMaxBrake", "GetThrottlePickupPoint", "GetBrakepointAlertColor",
        "GetBrakepointDiffTarget", "GetBrakepointColorTarget",
        "GetBrakePressureDiffTarget", "GetBrakePressureDiffTargetColor",
        "GetThrottlePickupDiffTarget", "GetThrottlePickupColorTarget",
        "GetTimeArea", "GetSpeedArea", "GetCoastingDistance", "GetControlOverlapDistance",
        "GetMaximumBrakePressure", "GetMinimumSpeed",
    ];
    // The functions that only compare and format what the measuring ones recorded run every this many samples
    // (60 Hz / 6 = 10 times a second, as often as the window refreshes), since the script is slow enough that
    // running all of them for 8 areas would take most of the time between samples
    private const int TextEvery = 6;

    private readonly Engine _js;
    private readonly Dictionary<string, JsValue> _functions = [];
    private readonly Action<string, bool> _log;
    private readonly object _lock = new();

    // The sample $prop reads from while the script runs (telemetry thread only)
    private TelemetryData _sample;
    private string _trackName = "";
    private double _trackLengthMeters;
    private (int? UniqueId, int? Num)? _session;
    private float? _lastLapDistPct;
    private int _sampleCount;

    // A track waiting to be handed to the script on the telemetry thread (set from the UI thread)
    private (string Name, string? Json)? _pendingTrack;
    private double _trackDataLengthFeet;
    private string? _scriptTrack;

    private readonly string?[] _areaNames = new string?[AreaCount];
    private readonly OverlayAreaValues?[] _areas = new OverlayAreaValues?[AreaCount];
    private string? _maxBrake;
    private string? _minSpeed;
    private string? _error;

    /// <summary>Loads the script. Throws if it can't be read, doesn't run or lacks a function the overlay uses.</summary>
    public OverlayEngine(Action<string, bool> log)
    {
        _log = log;
        (var script, ScriptSource) = LoadScript();
        _js = new Engine();
        _js.SetValue("$prop", new Func<string, object?>(Prop));
        _js.SetValue("format", new Func<object?, string?, string>(Format));
        _js.Execute("var root = {}; var TrackConfig = {};");
        _js.Execute(script);
        foreach (var name in Functions)
            _functions[name] = _js.GetValue(name);
        var missing = Functions.Where(name => _functions[name] is not Jint.Native.Function.Function).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"{ScriptName} has no {string.Join(", ", missing)} function{(missing.Count > 1 ? "s" : "")}");
    }

    /// <summary>Where the script came from: the copy in Documents\RacingCoach, or the one built into the exe.</summary>
    public string ScriptSource { get; }

    /// <summary>Documents\RacingCoach\TelemetryEngine.js when it exists (so the engine can be changed without a
    /// new collector), otherwise the copy built in from scripts/TelemetryEngine.js.</summary>
    private static (string Script, string Source) LoadScript()
    {
        var local = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RacingCoach", ScriptName);
        if (File.Exists(local))
            return (File.ReadAllText(local), local);
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream(ScriptName)
            ?? throw new FileNotFoundException($"{ScriptName} is not built into this collector");
        using var reader = new StreamReader(stream);
        return (reader.ReadToEnd(), "built in");
    }

    /// <summary>Hands the script the user's Track Data track for an iRacing track (json: as from
    /// /api/collector/track, or null if they have none). Takes effect on the next telemetry sample.</summary>
    public void SetTrack(string trackName, string? trackJson)
    {
        lock (_lock)
            _pendingTrack = (trackName, trackJson);
    }

    public OverlaySnapshot Snapshot()
    {
        lock (_lock)
            return new OverlaySnapshot(_scriptTrack, [.. _areaNames], [.. _areas], _maxBrake, _minSpeed, _error);
    }

    /// <summary>Runs the script for one telemetry sample (on the telemetry thread).</summary>
    public void OnSample(TelemetryData data, SessionDetails? session)
    {
        try
        {
            // A new session (another event, or practice to qualifying to race) starts every value over
            var sessionKey = (data.SessionUniqueID, data.SessionNum);
            if (_session != sessionKey)
            {
                _session = sessionKey;
                _lastLapDistPct = null;
                ResetValues();
            }
            AnnounceNewLap(data.LapDistPct);
            ApplyPendingTrack(session);

            _sample = data;
            var maxBrake = Text(Call("GetMaximumBrakePressure"));
            var minSpeed = Text(Call("GetMinimumSpeed"));

            var withText = _sampleCount++ % TextEvery == 0;
            OverlayAreaValues?[] previous;
            lock (_lock)
                previous = [.. _areas];
            var results = new OverlayAreaValues?[AreaCount];
            if (_scriptTrack is not null)
            {
                for (var area = 1; area <= AreaCount; area++)
                {
                    if (_areaNames[area - 1] is not null)
                        results[area - 1] = AreaValues(area, withText ? null : previous[area - 1]);
                }
            }
            lock (_lock)
            {
                results.CopyTo(_areas, 0);
                _maxBrake = maxBrake;
                _minSpeed = minSpeed;
                _error = null;
            }
        }
        catch (Exception e)
        {
            // Reported once per different message, not 60 times a second
            string? previous;
            lock (_lock)
            {
                previous = _error;
                _error = e.Message;
            }
            if (previous != e.Message)
                _log($"Overlay: {ScriptName} failed: {e.Message}", true);
        }
    }

    /// <summary>One area's values for this sample. The measuring functions (which compare this sample's position
    /// with the last one's) run every sample; the rest, which call them again and only compare and format, reuse
    /// <paramref name="keepText"/> unless it's null. Calling a measuring function twice in a sample changes nothing.</summary>
    private OverlayAreaValues AreaValues(int area, OverlayAreaValues? keepText)
    {
        Call("LapBrakePoint", area);
        Call("GetAreaMaxBrake", area);
        Call("GetThrottlePickupPoint", area);
        var measured = new OverlayAreaValues(
            AlertColor: Text(Call("GetBrakepointAlertColor", area)),
            Brake: "", BrakeColor: "", Force: "", ForceColor: "", Gas: "", GasColor: "", Time: "",
            // GetSpeedArea takes the track name too
            Exit: Text(Call("GetSpeedArea", _trackName, area)),
            Coast: Text(Call("GetCoastingDistance", area)),
            Overlap: Text(Call("GetControlOverlapDistance", area)));

        if (keepText is not null)
        {
            return measured with
            {
                Brake = keepText.Brake, BrakeColor = keepText.BrakeColor,
                Force = keepText.Force, ForceColor = keepText.ForceColor,
                Gas = keepText.Gas, GasColor = keepText.GasColor,
                Time = keepText.Time,
            };
        }
        return measured with
        {
            Brake = Text(Call("GetBrakepointDiffTarget", area)),
            BrakeColor = Text(Call("GetBrakepointColorTarget", area)),
            Force = Text(Call("GetBrakePressureDiffTarget", area)),
            ForceColor = Text(Call("GetBrakePressureDiffTargetColor", area)),
            Gas = Text(Call("GetThrottlePickupDiffTarget", area)),
            GasColor = Text(Call("GetThrottlePickupColorTarget", area)),
            Time = Text(Call("GetTimeArea", _trackName, area)),
        };
    }

    private JsValue Call(string function, params object[] arguments) => _js.Invoke(_functions[function], arguments);

    private static string Text(JsValue value) => value.IsNull() || value.IsUndefined() ? "" : value.ToString();

    /// <summary>Forgets everything the script has measured, and what the overlay shows from it.</summary>
    private void ResetValues()
    {
        _js.Execute("root = {};");
        lock (_lock)
        {
            Array.Clear(_areas);
            _maxBrake = null;
            _minSpeed = null;
        }
    }

    /// <summary>Says "Starting new lap" when the car crosses the start/finish line (the script's own test:
    /// from past 90% of the lap to under 10%). iRacing's LapDistPct is -1 when the car isn't on track.</summary>
    private void AnnounceNewLap(float? lapDistPct)
    {
        var crossed = _lastLapDistPct > 0.9f && lapDistPct is >= 0 and < 0.1f;
        _lastLapDistPct = lapDistPct;
        if (crossed)
            Voice.Say("Starting new lap", interrupt: true);
    }

    private void ApplyPendingTrack(SessionDetails? session)
    {
        (string Name, string? Json)? pending;
        lock (_lock)
        {
            pending = _pendingTrack;
            _pendingTrack = null;
        }

        if (pending is { } track)
        {
            _trackName = track.Name;
            var names = new string?[AreaCount];
            _trackDataLengthFeet = 0;
            ResetValues();
            if (track.Json is null)
            {
                _js.Execute("TrackConfig = {};");
            }
            else
            {
                // TrackConfig is keyed by lowercase track name; the script looks up $prop('TrackName') that way
                _js.SetValue("__trackKey", track.Name.ToLowerInvariant());
                _js.SetValue("__trackJson", track.Json);
                _js.Execute("TrackConfig = {}; TrackConfig[__trackKey] = JSON.parse(__trackJson);");
                var config = _js.Evaluate("TrackConfig[__trackKey]").AsObject();
                _trackDataLengthFeet = config.Get("TrackLengthInFeet").IsNumber() ? config.Get("TrackLengthInFeet").AsNumber() : 0;
                var areas = config.Get("areas");
                if (areas.IsArray())
                {
                    var array = areas.AsArray();
                    for (var i = 0; i < Math.Min(AreaCount, (int)array.Length); i++)
                        names[i] = array[i].AsObject().Get("name").ToString();
                }
            }
            lock (_lock)
            {
                _scriptTrack = track.Json is null ? null : track.Name;
                names.CopyTo(_areaNames, 0);
            }
        }

        // Track Data's length (feet) is more precise than iRacing's (km, two decimals); SimHub gives meters
        _trackLengthMeters = _trackDataLengthFeet > 0 ? _trackDataLengthFeet / 3.280839895 : IRacingLengthMeters(session?.TrackLength);
    }

    // iRacing gives the length as e.g. "4.0900 km"
    private static double IRacingLengthMeters(string? length)
    {
        var parts = length?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts is [var number, "km"] && double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var km)
            ? km * 1000
            : 0;
    }

    /// <summary>SimHub's format(value, "0.00"): a .NET number format.</summary>
    private static string Format(object? value, string? format)
    {
        var number = value switch
        {
            null => 0,
            string s => double.TryParse(s, NumberStyles.Float, CultureInfo.InvariantCulture, out var parsed) ? parsed : 0,
            _ => Convert.ToDouble(value, CultureInfo.InvariantCulture),
        };
        return number.ToString(format ?? "", CultureInfo.InvariantCulture);
    }

    /// <summary>SimHub's $prop for the properties TelemetryEngine.js reads, in SimHub's units.</summary>
    private object? Prop(string name) => name switch
    {
        "GameRawData.Telemetry.LapDistPct" => (double?)_sample.LapDistPct,
        "GameRawData.Telemetry.SessionTime" => _sample.SessionTime,
        "GameRawData.Telemetry.Brake" => (double?)_sample.Brake,
        "GameRawData.Telemetry.Throttle" => (double?)_sample.Throttle,
        "GameRawData.Telemetry.SessionUniqueID" => _sample.SessionUniqueID,
        // SimHub's Brake is 0-100 (iRacing's is 0-1)
        "Brake" or "DataCorePlugin.GameData.NewData.Brake" => _sample.Brake is { } brake ? brake * 100.0 : null,
        // SimHub's SpeedLocal is in the user's units; the script labels speeds mph. iRacing's Speed is m/s
        "SpeedLocal" or "DataCorePlugin.GameData.NewData.SpeedLocal" => _sample.Speed is { } speed ? speed * MphPerMetersPerSecond : null,
        "TrackName" => _trackName,
        // meters, as in SimHub
        "TrackLength" => _trackLengthMeters,
        _ => null,
    };
}
