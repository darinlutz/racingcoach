using System.Globalization;
using System.Media;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>A message the In-Car Coach showed, and when.</summary>
internal sealed record CoachMessage(string Text, DateTime At);

/// <summary>
/// The In-Car AI Coach (src/lib/inCarCoach.ts in the website). For each track it fetches the plan made from the
/// user's In-Car AI Coach Instructions (Account page): rules it runs here on live telemetry (e.g. play a sound when
/// the car crosses the start/finish line) and how to deliver lap feedback. Once a session's laps start uploading it
/// asks the coach, every few laps, what to tell the driver from the laps so far (analysed like Debrief Coach does,
/// without track positions, which live laps only get after the stint), and says it, shows it or plays a sound.
/// Only laps driven in this run count, not earlier runs' laps, re-uploads with track positions or pit road laps.
/// OnSample is called on the telemetry thread for every sample, so it only compares numbers.
/// </summary>
internal sealed class InCarCoach(Func<RacingCoachApi?> api, Action<string> log)
{
    /// <summary>Laps that have to upload before the first lap feedback.</summary>
    public const int LapsBeforeFeedback = 2;
    private const int MaxLapsSent = 30;
    private const int RecentCalloutsKept = 6;
    private static readonly TimeSpan RetryAfter = TimeSpan.FromMinutes(1);
    /// <summary>How long the overlay shows a message.</summary>
    public static readonly TimeSpan MessageShownFor = TimeSpan.FromSeconds(20);

    // Culture: the user's Preferred Language's, for the numbers in rule texts (e.g. 1:23,456 in pt-BR)
    private sealed record LoadedPlan(string Track, CoachPlan Plan, IReadOnlyList<CoachRule> Rules, IReadOnlyList<CoachArea> Areas, CultureInfo Culture);

    private readonly object _lock = new();

    // The plan for the current track; replaced whole, so the telemetry thread reads it without a lock
    private volatile LoadedPlan? _plan;
    private string? _track;
    private string? _loadedTrack;
    private RacingCoachApi? _loadedWith;
    private bool _loading;
    private DateTime _retryAt = DateTime.MaxValue;

    // Live telemetry state, only touched on the telemetry thread
    private volatile bool _resetLive;
    private float? _lastPct;
    private bool? _lastOnPitRoad;
    private int? _lastIncidents;
    private int? _sessionNum;
    private (float? Before, double At)? _awaitingLapTime;
    private double? _bestLap;
    private int _lap;
    private double? _lapTime;
    private double? _delta;
    private int _incidents;
    private volatile bool _inArea;

    // Lap feedback: this run's uploaded laps per session folder, and the one request at a time
    private readonly Dictionary<string, List<Guid>> _uploaded = [];
    private bool _requesting;
    private string? _pendingFolder;
    private readonly Queue<string> _recent = [];
    private readonly List<string> _held = [];

    /// <summary>The last message shown, for the overlay.</summary>
    public CoachMessage? LatestMessage { get; private set; }

    /// <summary>The track being driven (the name the collector gives its laps), from each session info update.
    /// Loads its plan when the track or the upload key changes, or again a minute after a failed load.</summary>
    public void SetTrack(string? track)
    {
        lock (_lock)
            _track = track;
        Refresh();
    }

    /// <summary>Loads the plan again if the track or the upload key changed, or a failed load is due a retry.</summary>
    public void Refresh()
    {
        string track;
        RacingCoachApi? site;
        lock (_lock)
        {
            site = api();
            if (_track is null || _loading)
                return;
            var changed = _track != _loadedTrack || site != _loadedWith;
            if (!changed && DateTime.UtcNow < _retryAt)
                return;
            if (changed)
            {
                _plan = null;
                _resetLive = true;
            }
            track = _track;
            _loadedTrack = track;
            _loadedWith = site;
            _retryAt = DateTime.MaxValue;
            if (site is null)
                return; // loads once a key is entered
            _loading = true;
        }
        _ = Task.Run(() => LoadPlanAsync(track, site));
    }

    private async Task LoadPlanAsync(string track, RacingCoachApi site)
    {
        try
        {
            var response = await site.GetCoachPlanAsync(track, CancellationToken.None);
            var plan = response.Plan ?? new CoachPlan([], true, true, false, true, 1);
            var loaded = new LoadedPlan(track, plan, plan.Rules ?? [], response.Areas ?? [], CultureFor(response.Locale));
            lock (_lock)
            {
                if (_loadedTrack == track && _loadedWith == site)
                    _plan = loaded;
            }
            log(string.IsNullOrWhiteSpace(response.Instructions)
                ? $"In-Car Coach ready for {track}: no instructions yet (write them on the Account page), {Feedback(plan)}."
                : $"In-Car Coach ready for {track}: {Plural(loaded.Rules.Count, "rule")} from your instructions" +
                  (loaded.Rules.Count == 0 ? "" : $" ({string.Join("; ", loaded.Rules.Select(Describe))})") + $", {Feedback(plan)}.");
        }
        catch (UnauthorizedAccessException)
        {
            // the window asks for a new key; the plan loads again with it
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            log($"In-Car Coach couldn't load your instructions for {track} ({e.Message}). Trying again in a minute.");
            lock (_lock)
                _retryAt = DateTime.UtcNow + RetryAfter;
        }
        finally
        {
            lock (_lock)
                _loading = false;
        }
    }

    private static string Feedback(CoachPlan plan) =>
        !plan.LapFeedback ? "no lap feedback"
        : plan.FeedbackEveryLaps <= 1 ? $"lap feedback after every lap from lap {LapsBeforeFeedback}"
        : $"lap feedback every {plan.FeedbackEveryLaps} laps from lap {LapsBeforeFeedback}";

    private static string Describe(CoachRule rule) =>
        $"{rule.Event}{(rule.Area is null ? "" : $" {rule.Area}")}: {rule.Action} {(rule.Action == "sound" ? rule.Sound : $"\"{rule.Text}\"")}";

    private static CultureInfo CultureFor(string? locale)
    {
        try
        {
            return string.IsNullOrWhiteSpace(locale) ? CultureInfo.InvariantCulture : CultureInfo.GetCultureInfo(locale);
        }
        catch (CultureNotFoundException)
        {
            return CultureInfo.InvariantCulture;
        }
    }

    private static string Plural(int n, string word) => $"{n} {word}{(n == 1 ? "" : "s")}";

    /// <summary>Every telemetry sample: fires the rules on the moments they're for.</summary>
    public void OnSample(in TelemetryData data)
    {
        if (_resetLive)
        {
            _resetLive = false;
            _lastPct = null;
            _lastOnPitRoad = null;
            _lastIncidents = null;
            _awaitingLapTime = null;
            _bestLap = null;
            _inArea = false;
        }
        if (_plan is not { } plan)
            return;
        if (data.IsReplayPlaying == true || data.IsOnTrack != true || data.LapDistPct is not { } pct || pct < 0)
        {
            _lastPct = null;
            _inArea = false;
            return;
        }

        if (data.SessionNum != _sessionNum)
        {
            _sessionNum = data.SessionNum;
            _bestLap = null;
        }
        var time = data.SessionTime ?? 0;

        if (data.OnPitRoad is { } onPitRoad)
        {
            if (_lastOnPitRoad is { } was && was != onPitRoad)
                Fire(plan, onPitRoad ? "pitEntry" : "pitExit", null);
            _lastOnPitRoad = onPitRoad;
        }

        if (data.PlayerCarMyIncidentCount is { } incidents)
        {
            _incidents = incidents;
            if (_lastIncidents is { } before && incidents > before)
                Fire(plan, "incident", null);
            _lastIncidents = incidents;
        }

        if (_lastPct is { } previous)
        {
            var wrapped = previous > 0.9f && pct < 0.1f;
            // A tow or reset jumps the car; that's not driving through anything
            if (wrapped || Math.Abs(pct - previous) <= 0.05f)
            {
                if (wrapped)
                {
                    Fire(plan, "lapStart", null);
                    _awaitingLapTime = (data.LapLastLapTime, time);
                }
                foreach (var area in plan.Areas)
                {
                    if (Crossed(previous, pct, area.Start))
                        Fire(plan, "areaEntry", area);
                    if (Crossed(previous, pct, area.End))
                        Fire(plan, "areaExit", area);
                }
            }
        }
        _lastPct = pct;

        // iRacing has the lap time a moment after the line
        if (_awaitingLapTime is { } awaiting)
        {
            if (data.LapLastLapTime is { } lapTime && lapTime > 0 && lapTime != awaiting.Before)
            {
                _awaitingLapTime = null;
                LapCompleted(plan, (data.Lap ?? 1) - 1, lapTime);
            }
            else if (time - awaiting.At > 5)
            {
                _awaitingLapTime = null; // no lap time for this one (e.g. invalidated)
            }
        }

        var inArea = plan.Areas.Any(area => area.Start <= area.End ? pct >= area.Start && pct < area.End : pct >= area.Start || pct < area.End);
        _inArea = inArea;
        if (!inArea)
            SpeakHeld();
    }

    private void LapCompleted(LoadedPlan plan, int lap, double lapTime)
    {
        var best = _bestLap;
        _lap = lap;
        _lapTime = lapTime;
        _delta = best is null ? null : lapTime - best;
        _bestLap = best is null ? lapTime : Math.Min(best.Value, lapTime);
        Fire(plan, "lapComplete", null);
        if (best is not null && lapTime < best)
            Fire(plan, "newBestLap", null);
    }

    // Whether the car went past x (a fraction of the lap) between two samples, including across the line
    private static bool Crossed(float previous, float current, double x) =>
        current >= previous ? previous < x && x <= current : x > previous || x <= current;

    private void Fire(LoadedPlan plan, string @event, CoachArea? area)
    {
        foreach (var rule in plan.Rules)
        {
            if (rule.Event != @event || (rule.Area is not null && !string.Equals(rule.Area, area?.Name, StringComparison.OrdinalIgnoreCase)))
                continue;
            switch (rule.Action)
            {
                case "sound":
                    CoachSounds.Play(rule.Sound);
                    break;
                case "say":
                    Voice.Say(Fill(plan, rule.Text, area, speech: true));
                    break;
                case "message":
                    Show(Fill(plan, rule.Text, area, speech: false));
                    break;
            }
        }
    }

    // A rule's text with its {placeholders} filled in from the latest lap
    private string Fill(LoadedPlan plan, string? text, CoachArea? area, bool speech)
    {
        if (string.IsNullOrEmpty(text))
            return "";
        return text
            .Replace("{lap}", _lap > 0 ? _lap.ToString(CultureInfo.InvariantCulture) : "")
            .Replace("{lapTime}", LapTime(_lapTime, speech, plan.Culture))
            .Replace("{best}", LapTime(_bestLap, speech, plan.Culture))
            .Replace("{delta}", _delta is { } delta ? delta.ToString("+0.00;-0.00;0.00", plan.Culture) : "")
            .Replace("{area}", area?.Name ?? "")
            .Replace("{incidents}", _incidents.ToString(CultureInfo.InvariantCulture));
    }

    // 1:23.456 on screen; "1 23.46" spoken, which the voice reads as "one twenty-three point four six"
    private static string LapTime(double? seconds, bool speech, CultureInfo culture)
    {
        if (seconds is not { } s)
            return "";
        var minutes = (int)(s / 60);
        var rest = s - minutes * 60;
        return speech
            ? minutes > 0 ? $"{minutes} {rest.ToString("00.00", culture)}" : rest.ToString("0.00", culture)
            : $"{minutes}:{rest.ToString("00.000", culture)}";
    }

    private void Show(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
            return;
        LatestMessage = new CoachMessage(text, DateTime.UtcNow);
        log($"In-Car Coach: {text}");
    }

    private void SpeakHeld()
    {
        string[] held;
        lock (_lock)
        {
            if (_held.Count == 0)
                return;
            held = [.. _held];
            _held.Clear();
        }
        foreach (var text in held)
            Voice.Say(text);
    }

    /// <summary>Called with each lap the uploader has finished with (error null = uploaded).</summary>
    public void OnUploaded(UploadItem item, string? error)
    {
        if (error is not null || item.Earlier || item.WithPositions || item.Lap.PitRoad || item.Lap.ClientLapId is not { } id)
            return;
        if (_plan is not { Plan.LapFeedback: true } plan)
            return;

        lock (_lock)
        {
            var laps = _uploaded.TryGetValue(item.Folder, out var list) ? list : _uploaded[item.Folder] = [];
            if (laps.Contains(id))
                return;
            laps.Add(id);
            var every = Math.Max(1, plan.Plan.FeedbackEveryLaps);
            if (laps.Count < LapsBeforeFeedback || (laps.Count - LapsBeforeFeedback) % every != 0)
                return;
            if (_requesting)
            {
                _pendingFolder = item.Folder; // asked again with the newest laps once this one's answered
                return;
            }
            _requesting = true;
        }
        // Not on the uploader's task, so the next lap's upload doesn't wait for it
        _ = Task.Run(() => FeedbackAsync(item.Folder));
    }

    private async Task FeedbackAsync(string folder)
    {
        while (true)
        {
            List<Guid> laps;
            string[] recent;
            lock (_lock)
            {
                laps = [.. _uploaded[folder].TakeLast(MaxLapsSent)];
                recent = [.. _recent];
            }

            if (api() is { } site)
            {
                var (callouts, error) = await site.GetCoachCalloutsAsync(laps, recent, CancellationToken.None);
                if (error is not null)
                    log($"In-Car Coach had no feedback after {Plural(laps.Count, "lap")}: {error}.");
                else if (callouts.Count == 0)
                    log($"In-Car Coach: nothing new to say after {Plural(laps.Count, "lap")}.");
                foreach (var callout in callouts)
                    Deliver(callout);
            }

            lock (_lock)
            {
                if (_pendingFolder is null)
                {
                    _requesting = false;
                    return;
                }
                folder = _pendingFolder;
                _pendingFolder = null;
            }
        }
    }

    private void Deliver(CoachCallout callout)
    {
        if (string.IsNullOrWhiteSpace(callout.Text) || _plan is not { } plan)
            return;
        if (callout.Sound is not null)
            CoachSounds.Play(callout.Sound);
        if (plan.Plan.Show)
            Show(callout.Text);
        else
            log($"In-Car Coach said: {callout.Text}");

        lock (_lock)
        {
            _recent.Enqueue(callout.Text);
            while (_recent.Count > RecentCalloutsKept)
                _recent.Dequeue();
            if (plan.Plan.Speak && plan.Plan.HoldInFocusAreas && _inArea)
            {
                _held.Add(callout.Text); // said once the car is out of the focus area
                return;
            }
        }
        if (plan.Plan.Speak)
            Voice.Say(callout.Text);
    }
}

/// <summary>The sounds the In-Car Coach can play (COACH_SOUNDS in src/lib/inCarCoach.ts).</summary>
internal static class CoachSounds
{
    public static void Play(string? sound) => Task.Run(() =>
    {
        try
        {
            switch (sound)
            {
                case "doubleBeep":
                    Console.Beep(1000, 120);
                    Thread.Sleep(60);
                    Console.Beep(1000, 120);
                    break;
                case "chime":
                    SystemSounds.Asterisk.Play();
                    break;
                case "alert":
                    SystemSounds.Exclamation.Play();
                    break;
                default:
                    Console.Beep(880, 150);
                    break;
            }
        }
        catch (Exception e) when (e is InvalidOperationException or PlatformNotSupportedException)
        {
            // no sound device
        }
    });
}
