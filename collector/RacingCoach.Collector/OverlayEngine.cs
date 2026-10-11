using System.Globalization;
using System.Reflection;
using Jint;
using Jint.Native;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>What the overlay window shows, copied out of OverlayEngine for the UI thread.</summary>
internal sealed record OverlaySnapshot(string? Track, IReadOnlyList<string?> AreaNames, IReadOnlyList<int?> BrakePoints, string? Error);

/// <summary>
/// Runs TelemetryEngine.js (scripts/ in the repo, a SimHub script) for the overlay. The script expects SimHub,
/// so this provides what it uses: $prop(name) answers from live iRacing telemetry in SimHub's units, root is
/// a plain object the script keeps its state in, and TrackConfig holds the user's Track Data track for the
/// current track (the same shape as the Track Data text file). Every telemetry sample is fed through
/// LapBrakePoint(1..8), since the script works out area crossings from consecutive samples.
/// All script calls happen on the telemetry thread (OnSample); the UI reads Snapshot.
/// </summary>
internal sealed class OverlayEngine
{
    public const int AreaCount = 8;
    private const string ScriptName = "TelemetryEngine.js";
    private const double FeetPerMeter = 3.280839895;

    private readonly Engine _js;
    private readonly Action<string, bool> _log;
    private readonly object _lock = new();

    // The sample $prop reads from while the script runs (telemetry thread only)
    private TelemetryData _sample;
    private string _trackName = "";
    private double _trackLengthMeters;

    // A track waiting to be handed to the script on the telemetry thread (set from the UI thread)
    private (string Name, string? Json)? _pendingTrack;
    private double _trackDataLengthFeet;
    private string? _scriptTrack;

    private readonly string?[] _areaNames = new string?[AreaCount];
    private readonly int?[] _brakePoints = new int?[AreaCount];
    private string? _error;

    /// <summary>Loads the script. Throws if it can't be read or doesn't run.</summary>
    public OverlayEngine(Action<string, bool> log)
    {
        _log = log;
        (var script, ScriptSource) = LoadScript();
        _js = new Engine();
        _js.SetValue("$prop", new Func<string, object?>(Prop));
        _js.Execute("var root = {}; var TrackConfig = {};");
        _js.Execute(script);
        if (_js.GetValue("LapBrakePoint") is not Jint.Native.Function.Function)
            throw new InvalidOperationException($"{ScriptName} has no LapBrakePoint function");
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
            return new OverlaySnapshot(_scriptTrack, [.. _areaNames], [.. _brakePoints], _error);
    }

    /// <summary>Runs the script for one telemetry sample (on the telemetry thread).</summary>
    public void OnSample(TelemetryData data, SessionDetails? session)
    {
        try
        {
            ApplyPendingTrack(session);
            if (_scriptTrack is null)
                return;

            _sample = data;
            var results = new int?[AreaCount];
            for (var area = 1; area <= AreaCount; area++)
            {
                if (_areaNames[area - 1] is null)
                    continue;
                var value = _js.Invoke("LapBrakePoint", area);
                results[area - 1] = value.IsNumber() && double.IsFinite(value.AsNumber()) ? (int)Math.Round(value.AsNumber()) : null;
            }
            lock (_lock)
            {
                results.CopyTo(_brakePoints, 0);
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
                Array.Clear(_brakePoints);
            }
        }

        // Track Data's length (feet) is more precise than iRacing's (km, two decimals); SimHub gives meters
        _trackLengthMeters = _trackDataLengthFeet > 0 ? _trackDataLengthFeet / FeetPerMeter : IRacingLengthMeters(session?.TrackLength);
    }

    // iRacing gives the length as e.g. "4.0900 km"
    private static double IRacingLengthMeters(string? length)
    {
        var parts = length?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts is [var number, "km"] && double.TryParse(number, NumberStyles.Float, CultureInfo.InvariantCulture, out var km)
            ? km * 1000
            : 0;
    }

    /// <summary>SimHub's $prop for the properties TelemetryEngine.js reads, in SimHub's units.</summary>
    private object? Prop(string name) => name switch
    {
        "GameRawData.Telemetry.LapDistPct" => (double?)_sample.LapDistPct,
        "GameRawData.Telemetry.SessionTime" => _sample.SessionTime,
        "GameRawData.Telemetry.Brake" => (double?)_sample.Brake,
        "GameRawData.Telemetry.Throttle" => (double?)_sample.Throttle,
        "GameRawData.Telemetry.SessionUniqueID" => _sample.SessionUniqueID,
        // iRacing's Speed is m/s; SimHub's SpeedLocal is km/h
        "DataCorePlugin.GameData.NewData.SpeedLocal" => _sample.Speed is { } speed ? speed * 3.6 : null,
        "TrackName" => _trackName,
        // meters, as in SimHub
        "TrackLength" => _trackLengthMeters,
        _ => null,
    };
}
