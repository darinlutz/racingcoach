using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
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

/// <summary>What the overlay window shows, copied out of OverlayEngine for the UI thread. UpcomingArea is the
/// index (0-based) of the focus area the car is in, or the next one ahead of it when it's between areas.</summary>
internal sealed record OverlaySnapshot(
    string? Track,
    IReadOnlyList<string?> AreaNames,
    IReadOnlyList<OverlayAreaValues?> Areas,
    string? MaxBrake,
    string? MinSpeed,
    string? Error,
    int? UpcomingArea);

/// <summary>
/// Runs TelemetryEngine.js (scripts/ in the repo, a SimHub script) for the overlay. The script expects SimHub,
/// so this provides what it uses: $prop(name) answers from live iRacing telemetry in SimHub's units, format()
/// formats a number like SimHub's, root is a plain object the script keeps its state in, and TrackConfig holds
/// the user's Track Data track for the current track (the same shape as the Track Data text file). Every
/// telemetry sample is fed through all the functions the overlay shows, since the script works out area
/// crossings from consecutive samples. root starts empty again with each new session, so nothing carries over.
/// All script calls happen on the telemetry thread (OnSample); the UI reads Snapshot.
/// Units follow the user's Preferred Units on RacingCoach.app: as in SimHub, SpeedLocal is mph or kph, and the
/// script's distances (which it measures in feet, its alert colors included) are shown in meters for Metric.
/// </summary>
internal sealed partial class OverlayEngine
{
    public const int AreaCount = 8;
    private const string ScriptName = "TelemetryEngine.js";
    private const double MphPerMetersPerSecond = 2.2369362921;
    private const double KphPerMetersPerSecond = 3.6;
    private const double MetersPerFoot = 0.3048;

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
    private int _sampleCount;

    // A track waiting to be handed to the script on the telemetry thread (set from the UI thread)
    private (string Name, string? Json, bool Metric)? _pendingTrack;
    // Meters and kph rather than feet and mph (telemetry thread only)
    private bool _metric;
    private double _trackDataLengthFeet;
    private string? _scriptTrack;

    private readonly string?[] _areaNames = new string?[AreaCount];
    // Each area's start and end as fractions of a lap (LapDistPct), or null without both (telemetry thread only)
    private readonly (double Start, double End)?[] _areaRanges = new (double, double)?[AreaCount];
    private int? _upcomingArea;
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
    /// /api/collector/track, or null if they have none), and whether their Preferred Units are Metric. Takes effect
    /// on the next telemetry sample.</summary>
    public void SetTrack(string trackName, string? trackJson, bool metric)
    {
        lock (_lock)
            _pendingTrack = (trackName, trackJson, metric);
    }

    public OverlaySnapshot Snapshot()
    {
        lock (_lock)
            return new OverlaySnapshot(_scriptTrack, [.. _areaNames], [.. _areas], _maxBrake, _minSpeed, _error, _upcomingArea);
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
                ResetValues();
            }
            ApplyPendingTrack(session);

            _sample = data;
            var maxBrake = Text(Call("GetMaximumBrakePressure"));
            // A bare number in SpeedLocal's units (mph or kph)
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
            // iRacing's LapDistPct is outside 0-1 while the car isn't on track; the last area shown stays then
            int? upcoming;
            lock (_lock)
                upcoming = _upcomingArea;
            if (_scriptTrack is null)
                upcoming = null;
            else if (data.LapDistPct is { } pos and >= 0 and <= 1)
                upcoming = UpcomingArea(pos);
            lock (_lock)
            {
                results.CopyTo(_areas, 0);
                _upcomingArea = upcoming;
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
            Exit: InUnits(Text(Call("GetSpeedArea", _trackName, area))),
            Coast: InUnits(Text(Call("GetCoastingDistance", area))),
            Overlap: InUnits(Text(Call("GetControlOverlapDistance", area))));

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
            Brake = InUnits(Text(Call("GetBrakepointDiffTarget", area))),
            BrakeColor = Text(Call("GetBrakepointColorTarget", area)),
            Force = Text(Call("GetBrakePressureDiffTarget", area)),
            ForceColor = Text(Call("GetBrakePressureDiffTargetColor", area)),
            Gas = InUnits(Text(Call("GetThrottlePickupDiffTarget", area))),
            GasColor = Text(Call("GetThrottlePickupColorTarget", area)),
            Time = Text(Call("GetTimeArea", _trackName, area)),
        };
    }

    /// <summary>The area the car is in at <paramref name="pos"/> (LapDistPct), or else the one whose start is
    /// next ahead of it, so an area's row follows right after the car leaves the one before. An area can run
    /// across the start/finish line (start after end).</summary>
    private int? UpcomingArea(double pos)
    {
        int? next = null;
        var nextAhead = double.MaxValue;
        for (var i = 0; i < AreaCount; i++)
        {
            if (_areaNames[i] is null || _areaRanges[i] is not var (start, end))
                continue;
            var inside = start <= end ? pos >= start && pos <= end : pos >= start || pos <= end;
            if (inside)
                return i;
            var ahead = start - pos;
            if (ahead < 0)
                ahead += 1;
            if (ahead < nextAhead)
            {
                nextAhead = ahead;
                next = i;
            }
        }
        return next;
    }

    private JsValue Call(string function, params object[] arguments) => _js.Invoke(_functions[function], arguments);

    private static string Text(JsValue value) => value.IsNull() || value.IsUndefined() ? "" : value.ToString();

    // "12 ft late" or "35 ft"; and "-1.2 mph" (the script labels SpeedLocal's speeds mph whatever their units)
    [GeneratedRegex(@"(-?\d+(?:\.\d+)?)\s*ft\b")]
    private static partial Regex FeetText();
    [GeneratedRegex(@"\bmph\b")]
    private static partial Regex MphText();

    /// <summary>The script's text in the user's units: for Metric, "12 ft late" becomes "4 m late" and its
    /// speeds (already kph, from SpeedLocal) are labeled kph. Unchanged for Standard.</summary>
    private string InUnits(string text)
    {
        if (!_metric || text.Length == 0)
            return text;
        text = FeetText().Replace(text, m =>
        {
            var feet = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            return Math.Round(feet * MetersPerFoot).ToString("0", CultureInfo.InvariantCulture) + " m";
        });
        return MphText().Replace(text, "kph");
    }

    /// <summary>Forgets everything the script has measured, and what the overlay shows from it.</summary>
    private void ResetValues()
    {
        _js.Execute("root = {};");
        lock (_lock)
        {
            Array.Clear(_areas);
            _upcomingArea = null;
            _maxBrake = null;
            _minSpeed = null;
        }
    }

    private void ApplyPendingTrack(SessionDetails? session)
    {
        (string Name, string? Json, bool Metric)? pending;
        lock (_lock)
        {
            pending = _pendingTrack;
            _pendingTrack = null;
        }

        if (pending is { } track)
        {
            _trackName = track.Name;
            // Set before the values start over, so the script never mixes mph and kph
            _metric = track.Metric;
            var names = new string?[AreaCount];
            Array.Clear(_areaRanges);
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
                    {
                        var area = array[i].AsObject();
                        names[i] = area.Get("name").ToString();
                        var (start, end) = (area.Get("start"), area.Get("end"));
                        if (start.IsNumber() && end.IsNumber())
                            _areaRanges[i] = (start.AsNumber(), end.AsNumber());
                    }
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
        // SimHub's SpeedLocal is in the user's units: mph, or kph for Metric (the script labels speeds mph, which
        // InUnits relabels). iRacing's Speed is m/s
        "SpeedLocal" or "DataCorePlugin.GameData.NewData.SpeedLocal" =>
            _sample.Speed is { } speed ? speed * (_metric ? KphPerMetersPerSecond : MphPerMetersPerSecond) : null,
        "TrackName" => _trackName,
        // meters, as in SimHub
        "TrackLength" => _trackLengthMeters,
        _ => null,
    };
}
