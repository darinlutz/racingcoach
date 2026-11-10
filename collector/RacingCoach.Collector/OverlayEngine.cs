using System.Globalization;
using System.Reflection;
using System.Text.RegularExpressions;
using Jint;
using Jint.Native;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>One focus area's values on this lap, as TelemetryEngine.js's functions return them, in the user's
/// units and language (colors are SimHub color names such as "Firebrick", "#AARRGGBB", or "Transparent").
/// ForceTarget is the area's target max brake ("Target 65"), or "" when the Target Lap doesn't brake there.
/// WheelDiff is the Target Lap's largest steering angle in the area ("Target 85°"), while the car is in the area
/// ("" otherwise or without one).</summary>
internal sealed record OverlayAreaValues(
    string AlertColor,
    string Brake, string BrakeColor,
    string Force, string ForceColor, string ForceTarget,
    string Gas, string GasColor,
    string Time, string TimeColor,
    string Exit, string ExitColor,
    string Coast, string Overlap,
    string WheelDiff = "");

/// <summary>What the overlay window shows, copied out of OverlayEngine for the UI thread. UpcomingArea is the
/// index (0-based) of the focus area the car is in, or the next one ahead of it when it's between areas; InArea is
/// true while the car is inside it (the Target Telemetry window's "In Area"). LastArea is the values of the area the
/// car last left, for LastAreaHoldMs after it left (null after that), even when it went straight into the next
/// area. LastAreaIndex is that area's index (0-based), for its name ("T3 Time", "T3 Exit"), null with LastArea.
/// MaxSteering is the largest steering wheel angle (degrees, either way) of the last few seconds, like MinSpeed:
/// the angle now while it grows, then held 5 s from when it was reached before following the angle again.</summary>
/// <summary>The area just left's steering against the Target Lap's, for the same LastAreaHoldMs: Diff is the driver's
/// largest steering wheel angle there less the Target Lap's ("+6°"), Point where it was against where the Target
/// Lap's was ("5 ft early", in the user's units and language); colors as the Brake Point's (SteelBlue below,
/// Firebrick above, ForestGreen close). "" for one there's no target for.</summary>
internal sealed record OverlayWheelValues(string Diff, string DiffColor, string Point, string PointColor);

internal sealed record OverlaySnapshot(
    string? Track,
    IReadOnlyList<string?> AreaNames,
    IReadOnlyList<OverlayAreaValues?> Areas,
    string? MaxBrake,
    string? MinSpeed,
    string? MaxSteering,
    string? Error,
    int? UpcomingArea,
    bool InArea,
    OverlayAreaValues? LastArea,
    bool Metric,
    int? LastAreaIndex = null,
    OverlayWheelValues? LastWheel = null);

/// <summary>
/// Runs TelemetryEngine.js (scripts/ in the repo, a SimHub script) for the overlay. The script expects SimHub,
/// so this provides what it uses: $prop(name) answers from live iRacing telemetry in SimHub's units, format()
/// formats a number like SimHub's, root is a plain object the script keeps its state in, and TrackConfig holds
/// the Track Data track for the current track (the same shape as the Track Data text file). Every
/// telemetry sample is fed through all the functions the overlay shows, since the script works out area
/// crossings from consecutive samples. root starts empty again with each new session, so nothing carries over.
/// All script calls happen on the telemetry thread (OnSample); the UI reads Snapshot.
/// Units follow the user's Preferred Units on RacingCoach.app: as in SimHub, SpeedLocal is mph or kph, and the
/// script's distances (which it measures in feet, its alert colors included) are shown in meters for Metric.
/// The script writes English ("12 ft late", "BEST"); <see cref="Localize"/> puts its text in the user's Preferred
/// Language (<see cref="Language"/>), numbers included.
/// </summary>
internal sealed partial class OverlayEngine
{
    private const string ScriptName = "TelemetryEngine.js";
    private const double MphPerMetersPerSecond = 2.2369362921;
    private const double KphPerMetersPerSecond = 3.6;
    private const double MetersPerFoot = 0.3048;

    // The script functions the overlay calls; checked when the script loads
    private static readonly string[] Functions =
    [
        "LapBrakePoint", "GetAreaMaxBrake", "GetThrottlePickupPoint", "GetBrakepointAlertColor",
        "GetBrakepointDiffTarget", "GetBrakepointColorTarget",
        "GetBrakePressureTarget", "GetBrakePressureDiffTarget", "GetBrakePressureDiffTargetColor",
        "GetThrottlePickupDiffTarget", "GetThrottlePickupColorTarget",
        "GetTimeArea", "GetSpeedArea", "GetCoastingDistance", "GetControlOverlapDistance",
        "GetMaximumBrakePressure", "GetMinimumSpeed",
    ];
    // Functions the overlay calls when the script has them (a Documents\RacingCoach copy from before them may not)
    private static readonly string[] OptionalFunctions = ["GetTimeAreaColor", "GetSpeedAreaColor"];
    // The functions that only compare and format what the measuring ones recorded run every this many samples
    // (60 Hz / 6 = 10 times a second, as often as the window refreshes), since the script is slow enough that
    // running all of them for every area would take most of the time between samples
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

    // One per Track Data focus area, however many the track has; replaced when the track changes
    private string?[] _areaNames = [];
    // Each area's start and end as fractions of a lap (LapDistPct), or null without both (telemetry thread only)
    private (double Start, double End)?[] _areaRanges = [];
    private int? _upcomingArea;
    private bool _inArea;
    // The area the car last left, while it's held on show (telemetry thread and under _lock), when it left
    // (Environment.TickCount64) and where (LapDistPct), and its values (under _lock): followed while the car is
    // still on the same lap, then kept as they were, since the script starts some of them over at the line
    private int? _lastArea;
    private long _lastAreaLeftAt;
    private double _lastAreaExitPos;
    private OverlayAreaValues? _lastAreaValues;
    // How long the area just left's values stay on show
    private const long LastAreaHoldMs = 3000;
    private OverlayAreaValues?[] _areas = [];
    private string? _maxBrake;
    private string? _minSpeed;
    // The Max Steering box, like Min Speed: the largest steering angle (radians, either way) of the last few seconds
    // and when it was reached (Environment.TickCount64; telemetry thread only), and its text (under _lock)
    private double? _peakSteering;
    private long _peakSteeringAt;
    private string? _maxSteering;
    // How long the largest steering angle stays on show, as GetMinimumSpeed holds the lowest speed
    private const long SteeringHoldMs = 5000;
    // Each area's Target Lap max steering angle (degrees; null without one), from the track's MaxSteeringTarget
    // (telemetry thread only)
    private double?[] _steeringTargets = [];
    // And where it was (feet from the start/finish line; null without one), from MaxSteeringPointTarget
    private double?[] _steeringPointTargets = [];
    // The driver's largest steering wheel angle (radians, either way) in the area the car is in on this pass, and
    // where (LapDistPct), for the area just left's Wheel° Diff and Wheel Point Diff (telemetry thread only)
    private int? _wheelArea;
    private double? _wheelPeak;
    private double _wheelPeakPos;
    // The area just left's Wheel° Diff and Wheel Point Diff (under _lock), shown with LastArea
    private OverlayWheelValues? _lastWheel;
    // Within this many degrees of the Target Lap's max steering, or feet of where it was, is green (as the
    // script's brake point's 10 ft)
    private const double WheelDiffCloseDegrees = 5;
    private const double WheelPointCloseFeet = 10;
    // The units the values are in, for the window's headings (under _lock)
    private bool _shownMetric;
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
        foreach (var name in Functions.Concat(OptionalFunctions))
            _functions[name] = _js.GetValue(name);
        var missing = Functions.Where(name => _functions[name] is not Jint.Native.Function.Function).ToList();
        if (missing.Count > 0)
            throw new InvalidOperationException($"{ScriptName} has no {string.Join(", ", missing)} function{(missing.Count > 1 ? "s" : "")}");
    }

    /// <summary>Where the script came from: the copy in Documents\RacingCoach, or the one built into the exe.</summary>
    public string ScriptSource { get; }

    /// <summary>The user's Preferred Language ("en", "pt", "es" or "de") for the script's text; set from the UI thread,
    /// takes effect with the next text.</summary>
    public string Language { get => _language; set => _language = Loc.Normalize(value); }
    private volatile string _language = Loc.English;

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

    /// <summary>Hands the script the Track Data track for an iRacing track (json: as from
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
            return new OverlaySnapshot(_scriptTrack, [.. _areaNames], [.. _areas], _maxBrake, _minSpeed, _maxSteering, _error, _upcomingArea, _inArea, _lastArea is null ? null : _lastAreaValues, _shownMetric,
                _lastAreaValues is null ? null : _lastArea, _lastAreaValues is null ? null : _lastWheel);
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
            // A bare number in SpeedLocal's units (mph or kph), shown whole
            var minSpeed = Localize(WholeNumbers(Text(Call("GetMinimumSpeed"))));

            // iRacing's LapDistPct is outside 0-1 while the car isn't on track; the last area shown stays then
            // (but the car isn't in it)
            int? upcoming, lastArea;
            bool wasInArea;
            lock (_lock)
                (upcoming, wasInArea, lastArea) = (_upcomingArea, _inArea, _lastArea);
            var previousUpcoming = upcoming;
            var inArea = false;
            double? onTrackPos = data.LapDistPct is { } p and >= 0 and <= 1 ? p : null;
            if (_scriptTrack is null)
                upcoming = null;
            else if (onTrackPos is { } pos)
                (upcoming, inArea) = UpcomingArea(pos);
            // Leaving an area keeps its values on show for LastAreaHoldMs, whether the car goes into a gap or
            // straight into the next area (focus areas often join end to end), across the start/finish line too
            var now = Environment.TickCount64;
            var justLeft = false;
            OverlayWheelValues? lastWheel;
            lock (_lock)
                lastWheel = _lastWheel;
            if (upcoming is null)
                lastArea = null;
            else if (wasInArea && (!inArea || upcoming != previousUpcoming))
            {
                lastArea = previousUpcoming;
                (_lastAreaLeftAt, _lastAreaExitPos, justLeft) = (now, onTrackPos ?? 0, true);
                lastWheel = WheelValues(lastArea);
            }
            else if (lastArea is not null && now - _lastAreaLeftAt >= LastAreaHoldMs)
                lastArea = null;
            // This pass's largest steering angle in the area the car is in, from entering it
            TrackAreaSteering(inArea ? upcoming : null, data.SteeringWheelAngle, onTrackPos);

            // Max Steering box: the live angle while it grows, then the largest held for SteeringHoldMs from when it
            // was reached, then the live angle again (GetMinimumSpeed's way, turned around)
            var maxSteering = PeakSteering(data.SteeringWheelAngle);

            // The texts are worked out again at once when the car enters or leaves an area, so the area just left
            // shows this lap's time straight away rather than up to TextEvery samples later
            var withText = _sampleCount++ % TextEvery == 0 || inArea != wasInArea || upcoming != previousUpcoming;
            // _areaNames and _areas only change on this thread (ApplyPendingTrack), so they're the same length here
            OverlayAreaValues?[] previous;
            lock (_lock)
                previous = [.. _areas];
            var results = new OverlayAreaValues?[_areaNames.Length];
            if (_scriptTrack is not null)
            {
                for (var area = 1; area <= results.Length; area++)
                {
                    if (_areaNames[area - 1] is not null)
                    {
                        // The Target Lap's max steering, from entering the area until leaving it
                        var wheelTarget = inArea && upcoming == area - 1 && _steeringTargets[area - 1] is { } target
                            ? SteeringTargetText(target)
                            : "";
                        results[area - 1] = AreaValues(area, withText ? null : previous[area - 1]) with
                        {
                            WheelDiff = wheelTarget,
                        };
                    }
                }
            }
            // The area just left's values follow the script's until the car crosses the start/finish line, where
            // the script starts this lap's brake point and pressure over; then they stay as they were
            var lastAreaValues = _lastAreaValues;
            if (lastArea is { } held && held < results.Length
                && (justLeft || onTrackPos is { } heldPos && heldPos >= _lastAreaExitPos))
                lastAreaValues = results[held];
            lock (_lock)
            {
                _areas = results;
                _upcomingArea = upcoming;
                _inArea = inArea;
                _lastArea = lastArea;
                _lastAreaValues = lastArea is null ? null : lastAreaValues;
                _lastWheel = lastArea is null ? null : lastWheel;
                _maxBrake = maxBrake;
                _minSpeed = minSpeed;
                _maxSteering = maxSteering;
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
            Brake: "", BrakeColor: "", Force: "", ForceColor: "", ForceTarget: "", Gas: "", GasColor: "", Time: "", TimeColor: "",
            // GetSpeedArea takes the track name too
            // "-1.2 mph" shown whole, "-1 mph"
            Exit: Localize(WholeNumbers(Text(Call("GetSpeedArea", _trackName, area)))),
            ExitColor: CallOptional("GetSpeedAreaColor", _trackName, area),
            Coast: Localize(BlankIfZero(Text(Call("GetCoastingDistance", area)))),
            Overlap: Localize(BlankIfZero(Text(Call("GetControlOverlapDistance", area)))));

        if (keepText is not null)
        {
            return measured with
            {
                Brake = keepText.Brake, BrakeColor = keepText.BrakeColor,
                Force = keepText.Force, ForceColor = keepText.ForceColor, ForceTarget = keepText.ForceTarget,
                Gas = keepText.Gas, GasColor = keepText.GasColor,
                Time = keepText.Time, TimeColor = keepText.TimeColor,
            };
        }
        return measured with
        {
            // "3 ft late", or "2.3 m early" for Metric
            Brake = Localize(Text(Call("GetBrakepointDiffTarget", area)), metersFormat: "0.0"),
            BrakeColor = Text(Call("GetBrakepointColorTarget", area)),
            Force = Localize(Text(Call("GetBrakePressureDiffTarget", area))),
            ForceColor = Text(Call("GetBrakePressureDiffTargetColor", area)),
            ForceTarget = Call("GetBrakePressureTarget", area) is var target && target.IsNumber() && target.AsNumber() > 0
                ? Localize($"Target {Math.Round(target.AsNumber()).ToString("0", CultureInfo.InvariantCulture)}")
                : "",
            Gas = Localize(Text(Call("GetThrottlePickupDiffTarget", area))),
            GasColor = Text(Call("GetThrottlePickupColorTarget", area)),
            Time = Localize(Text(Call("GetTimeArea", _trackName, area))),
            TimeColor = CallOptional("GetTimeAreaColor", _trackName, area),
        };
    }

    /// <summary>The area the car is in at <paramref name="pos"/> (LapDistPct), or else the one whose start is
    /// next ahead of it, so an area's row follows right after the car leaves the one before. An area can run
    /// across the start/finish line (start after end). Inside is true when the car is in it.</summary>
    private (int? Index, bool Inside) UpcomingArea(double pos)
    {
        int? next = null;
        var nextAhead = double.MaxValue;
        for (var i = 0; i < _areaNames.Length; i++)
        {
            if (_areaNames[i] is null || _areaRanges[i] is not var (start, end))
                continue;
            var inside = start <= end ? pos >= start && pos <= end : pos >= start || pos <= end;
            if (inside)
                return (i, true);
            var ahead = start - pos;
            if (ahead < 0)
                ahead += 1;
            if (ahead < nextAhead)
            {
                nextAhead = ahead;
                next = i;
            }
        }
        return (next, false);
    }

    private JsValue Call(string function, params object[] arguments) => _js.Invoke(_functions[function], arguments);

    // An OptionalFunctions function's text, or "" when the script has no such function
    private string CallOptional(string function, params object[] arguments) =>
        _functions[function] is Jint.Native.Function.Function ? Text(Call(function, arguments)) : "";

    private static string Text(JsValue value) => value.IsNull() || value.IsUndefined() ? "" : value.ToString();

    // Coast and Overlap show nothing rather than "0 ft" (the script answers 0, or e.g. "0 ft")
    [GeneratedRegex(@"^\s*-?0+(?:\.0+)?\s*(?:ft)?\s*$")]
    private static partial Regex ZeroDistance();
    private static string BlankIfZero(string text) => ZeroDistance().IsMatch(text) ? "" : text;

    // A number with a fractional part, e.g. "56.2" or "-1.25"
    [GeneratedRegex(@"-?\d+\.\d+")]
    private static partial Regex DecimalNumber();

    /// <summary>The script's numbers rounded to whole ones, e.g. "-1.2 mph" to "-1 mph" (never "-0").</summary>
    private static string WholeNumbers(string text) => DecimalNumber().Replace(text, m =>
    {
        var whole = Math.Round(double.Parse(m.Value, CultureInfo.InvariantCulture), MidpointRounding.AwayFromZero);
        return (whole == 0 ? 0 : whole).ToString("0", CultureInfo.InvariantCulture);
    });

    // "12 ft late" or "35 ft"; and "-1.2 mph" (the script labels SpeedLocal's speeds mph whatever their units)
    [GeneratedRegex(@"(-?\d+(?:\.\d+)?)\s*ft\b")]
    private static partial Regex FeetText();
    [GeneratedRegex(@"\bmph\b")]
    private static partial Regex MphText();
    // A decimal point between digits, e.g. "1.25"
    [GeneratedRegex(@"(?<=\d)\.(?=\d)")]
    private static partial Regex DecimalPoint();
    // The script's words (Loc's script.* texts)
    [GeneratedRegex(@"\b(late|early|NAILED|Target|HEAVY|light|SAME|BEST|TGT)\b")]
    private static partial Regex ScriptWords();

    /// <summary>The script's text in the user's units and language: for Metric, "12 ft late" becomes "4 m late"
    /// and its speeds (already kph, from SpeedLocal) are labeled km/h; then its words and decimal points are the
    /// language's, e.g. "4 m depois" and "+0,12 s" in Portuguese. Feet are shown as whole numbers, and meters
    /// in <paramref name="metersFormat"/>.</summary>
    private string Localize(string text, string metersFormat = "0")
    {
        if (text.Length == 0)
            return text;
        text = FeetText().Replace(text, m =>
        {
            var feet = double.Parse(m.Groups[1].Value, CultureInfo.InvariantCulture);
            return _metric
                ? (feet * MetersPerFoot).ToString(metersFormat, CultureInfo.InvariantCulture) + " m"
                : Math.Round(feet).ToString("0", CultureInfo.InvariantCulture) + " ft";
        });
        if (_metric)
            text = MphText().Replace(text, Loc.SpeedUnit(metric: true));
        var language = _language;
        if (language == Loc.English)
            return text;
        text = DecimalPoint().Replace(text, Loc.Culture(language).NumberFormat.NumberDecimalSeparator);
        return ScriptWords().Replace(text, m => Loc.T(language, "script." + m.Value));
    }

    /// <summary>Forgets everything the script has measured, and what the overlay shows from it.</summary>
    private void ResetValues()
    {
        _js.Execute("root = {};");
        lock (_lock)
        {
            Array.Clear(_areas);
            _upcomingArea = null;
            _inArea = false;
            _lastArea = null;
            _lastAreaValues = null;
            _lastWheel = null;
            _maxBrake = null;
            _minSpeed = null;
            _maxSteering = null;
        }
        _peakSteering = null;
        (_wheelArea, _wheelPeak) = (null, null);
    }

    /// <summary>Follows the driver's largest steering angle (either way) in <paramref name="area"/>, the area the car
    /// is in (null between areas), from when it entered it, and where it was.</summary>
    private void TrackAreaSteering(int? area, double? radians, double? pos)
    {
        if (area != _wheelArea)
            (_wheelArea, _wheelPeak) = (area, null);
        if (area is null || radians is not { } angle || pos is not { } at)
            return;
        angle = Math.Abs(angle);
        if (_wheelPeak is not { } peak || angle > peak)
            (_wheelPeak, _wheelPeakPos) = (angle, at);
    }

    /// <summary>The area just left's Wheel° Diff and Wheel Point Diff against the Target Lap's, from the steering
    /// followed while the car was in it; null when it wasn't followed there.</summary>
    private OverlayWheelValues? WheelValues(int? area)
    {
        if (area is not { } index || _wheelArea != index || _wheelPeak is not { } peak || index >= _steeringTargets.Length)
            return null;
        string diff = "", diffColor = "", point = "", pointColor = "";
        if (_steeringTargets[index] is { } targetDegrees)
        {
            var degrees = Math.Round(peak * 180 / Math.PI - targetDegrees);
            diff = (degrees > 0 ? "+" : "") + degrees.ToString("0", Loc.Culture(_language)) + "°";
            diffColor = DiffColor(degrees, WheelDiffCloseDegrees);
        }
        var lengthFeet = _trackLengthMeters / MetersPerFoot;
        if (_steeringPointTargets[index] is { } targetFeet && lengthFeet > 0)
        {
            // Feet from the start/finish line, like the Target Lap's; the shorter way round for an area across it
            var feet = Math.Round(_wheelPeakPos * lengthFeet - targetFeet);
            if (feet > lengthFeet / 2)
                feet -= Math.Round(lengthFeet);
            else if (feet < -lengthFeet / 2)
                feet += Math.Round(lengthFeet);
            // The script's brake point words, then in the user's units and language like its text
            var distance = Math.Abs(feet).ToString("0", CultureInfo.InvariantCulture);
            point = Localize(feet > 0 ? $"{distance} ft late" : feet < 0 ? $"{distance} ft early" : "NAILED", metersFormat: "0.0");
            pointColor = DiffColor(feet, WheelPointCloseFeet);
        }
        return new OverlayWheelValues(diff, diffColor, point, pointColor);
    }

    // GetBrakepointColorTarget's colors: blue below the target, red above it, green close to it
    private static string DiffColor(double diff, double close) =>
        diff < -close ? "SteelBlue" : diff > close ? "Firebrick" : "ForestGreen";

    /// <summary>The Max Steering box's text for one sample: a larger angle (either way) than the one on show
    /// replaces it, and one held SteeringHoldMs gives way to the angle now. Null without steering telemetry.</summary>
    private string? PeakSteering(double? radians)
    {
        if (radians is not { } angle)
            return _peakSteering is { } held ? SteeringText(held) : null;
        angle = Math.Abs(angle);
        var now = Environment.TickCount64;
        if (_peakSteering is not { } peak || angle > peak || now - _peakSteeringAt >= SteeringHoldMs)
            (_peakSteering, _peakSteeringAt) = (angle, now);
        return SteeringText(_peakSteering.Value);
    }

    /// <summary>Wheel Diff inside an area: the Target Lap's max steering there (degrees), e.g. "Target 85°" in the
    /// user's language.</summary>
    private string SteeringTargetText(double targetDegrees) =>
        Loc.T(_language, "script.Target") + " " + Math.Round(targetDegrees).ToString("0", CultureInfo.InvariantCulture) + "°";

    // "56°": degrees of steering wheel angle, either way, to the nearest whole degree
    private static string SteeringText(double radians) =>
        Math.Round(radians * 180 / Math.PI, MidpointRounding.AwayFromZero).ToString("0", CultureInfo.InvariantCulture) + "°";

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
            string?[] names = [];
            (double Start, double End)?[] ranges = [];
            double?[] steeringTargets = [];
            double?[] steeringPointTargets = [];
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
                    names = new string?[(int)array.Length];
                    ranges = new (double, double)?[names.Length];
                    steeringTargets = new double?[names.Length];
                    steeringPointTargets = new double?[names.Length];
                    for (var i = 0; i < names.Length; i++)
                    {
                        var area = array[i].AsObject();
                        names[i] = area.Get("name").ToString();
                        // 0 (or missing, from a site before it) when the Target Lap has none
                        var steering = area.Get("MaxSteeringTarget");
                        steeringTargets[i] = steering.IsNumber() && steering.AsNumber() > 0 ? steering.AsNumber() : null;
                        // Where it was (feet), 0 or missing (a site before it) without one
                        var steeringPoint = area.Get("MaxSteeringPointTarget");
                        steeringPointTargets[i] = steeringPoint.IsNumber() && steeringPoint.AsNumber() > 0 ? steeringPoint.AsNumber() : null;
                        var (start, end) = (area.Get("start"), area.Get("end"));
                        if (start.IsNumber() && end.IsNumber())
                            ranges[i] = (start.AsNumber(), end.AsNumber());
                    }
                }
            }
            lock (_lock)
            {
                _scriptTrack = track.Json is null ? null : track.Name;
                _areaNames = names;
                _areaRanges = ranges;
                _steeringTargets = steeringTargets;
                _steeringPointTargets = steeringPointTargets;
                _areas = new OverlayAreaValues?[names.Length];
                _shownMetric = track.Metric;
            }
        }

        // iRacing's length from session info, or the site's (also iRacing's, from uploaded laps) when it has none;
        // SimHub gives meters
        _trackLengthMeters = IRacingLengthMeters(session?.TrackLength) is > 0 and var meters ? meters : _trackDataLengthFeet / 3.280839895;
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
