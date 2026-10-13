using System.Globalization;
using System.Text.Json;
using System.Text.Json.Serialization;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// The driver's result in one race session, from iRacing's session info, as POST /api/collector/race-result
/// takes it (collectorRaceResultSchema in the website's src/lib/raceHistory.ts). Positions are 1-based and
/// in the driver's class; OldIRating and SafetyRating are the driver's going into the race (session info has
/// nothing from after it). ResultsFinal is iRacing's ResultsOfficial: the result can't change any more.
/// </summary>
internal sealed record RaceResult(
    int SubSessionId,
    int SessionNum,
    int? SeriesId,
    int? CustomerId,
    DateTimeOffset StartedAt,
    string Track,
    string Car,
    string? Category,
    bool OfficialRace,
    bool LeagueRace,
    bool TeamRace,
    bool ResultsFinal,
    int? OldIRating,
    double? SafetyRating,
    int? StartPosition,
    int? FinishPosition,
    int? LapsComplete,
    int? LapsLed,
    int? Incidents,
    double? BestLapSeconds,
    string? ReasonOut);

/// <summary>A race result saved in Documents\RacingCoach\Races, and whether RacingCoach.app has it.</summary>
internal sealed class SavedRaceResult
{
    public RaceResult? Result { get; set; }
    public bool Uploaded { get; set; }
    /// <summary>Why RacingCoach.app refused it; tried again the next time the collector starts.</summary>
    public string? UploadError { get; set; }
}

/// <summary>
/// Collects the driver's race results for Race Trends, with no third party: iRacing's session info lists
/// every car's position, laps, incidents and fastest lap in each race session (ResultsPositions), updated as
/// the race goes on, and marks them final once iRacing has made the result official. A race is saved (one
/// JSON file per race session in Documents\RacingCoach\Races) and uploaded when its result is final, or when
/// the driver leaves before that (another subsession, disconnecting or closing the collector), as it stood
/// then; a final result uploaded later replaces that one. Offline sessions (no subsession ID) are skipped.
/// Saved results that haven't uploaded go up at the next start or once a new upload key is entered.
/// </summary>
internal sealed class RaceResultTracker(string folder, Action<string> log)
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMinutes(1);

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    private readonly object _lock = new();
    // Saving a race and recording its upload can happen at once on different threads
    private readonly object _fileLock = new();
    // The latest result of each race session of the current subsession that isn't final yet
    private readonly Dictionary<int, RaceResult> _pending = [];
    // Race sessions of the current subsession already saved with a final result
    private readonly HashSet<int> _final = [];
    // When each race session of the current subsession started (from the SessionTime of its samples)
    private readonly Dictionary<int, DateTimeOffset> _started = [];
    private HashSet<int> _raceSessions = [];
    private int _subSessionId;

    private readonly SemaphoreSlim _uploading = new(1, 1);
    private RacingCoachApi? _api;
    private bool _retryScheduled;

    public string Folder { get; } = folder;

    /// <summary>Uploads with this site connection from now on (null: keep results locally only), starting
    /// with the saved ones that haven't uploaded yet, including earlier runs'.</summary>
    public void UseApi(RacingCoachApi? api)
    {
        _api = api;
        if (api is not null)
            _ = Task.Run(() => UploadSavedAsync(CancellationToken.None));
    }

    /// <summary>Called with each session info update: the track and car as the laps name them.</summary>
    public void OnSessionInfo(TelemetrySessionInfo session, string track, string car)
    {
        var weekend = session.WeekendInfo;
        var subSessionId = weekend?.SubSessionID ?? 0;
        var toSave = new List<RaceResult>();
        lock (_lock)
        {
            if (subSessionId != _subSessionId)
            {
                toSave.AddRange(TakePending()); // left the last subsession before its results were final
                _final.Clear();
                _started.Clear();
                _subSessionId = subSessionId;
            }

            var sessions = session.SessionInfo?.Sessions ?? [];
            _raceSessions = [.. sessions.Where(IsRace).Select(s => s.SessionNum)];
            var driverInfo = session.DriverInfo;
            var carIdx = driverInfo?.DriverCarIdx ?? -1;
            var driver = driverInfo?.Drivers?.FirstOrDefault(d => d.CarIdx == carIdx);
            if (weekend is null || subSessionId <= 0 || driver is null || driver.IsSpectator != 0)
                return;

            foreach (var race in sessions.Where(IsRace))
            {
                if (_final.Contains(race.SessionNum))
                    continue;
                var position = race.ResultsPositions?.FirstOrDefault(p => p.CarIdx == carIdx);
                if (position is null)
                    continue; // not racing in it (yet)

                // In a team race the car's driver can be a teammate; their iRating and license aren't ours
                var ownEntry = driver.UserID == driverInfo!.DriverUserID;
                var grid = session.QualifyResultsInfo?.Results?.FirstOrDefault(r => r.CarIdx == carIdx);
                var result = new RaceResult(
                    subSessionId,
                    race.SessionNum,
                    weekend.SeriesID > 0 ? weekend.SeriesID : null,
                    driverInfo.DriverUserID > 0 ? driverInfo.DriverUserID : null,
                    _started.TryGetValue(race.SessionNum, out var started) ? started : DateTimeOffset.UtcNow,
                    track,
                    car,
                    string.IsNullOrWhiteSpace(weekend.Category) ? null : weekend.Category,
                    weekend.Official == 1,
                    weekend.LeagueID > 0,
                    weekend.TeamRacing == 1,
                    race.ResultsOfficial == 1,
                    ownEntry && driver.IRating > 0 ? driver.IRating : null,
                    ownEntry ? SafetyRating(driver.LicString) : null,
                    // Grid and class positions in session info count from 0; overall race positions from 1
                    grid is not null && grid.ClassPosition >= 0 ? grid.ClassPosition + 1 : null,
                    position.ClassPosition >= 0 ? position.ClassPosition + 1 : null,
                    Math.Max(0, position.LapsComplete),
                    Math.Max(0, position.LapsLed),
                    Math.Max(0, position.Incidents),
                    position.FastestTime > 0 ? Math.Round(position.FastestTime, 3) : null,
                    string.IsNullOrWhiteSpace(position.ReasonOutStr) ? null : position.ReasonOutStr);

                if (result.ResultsFinal)
                {
                    _pending.Remove(race.SessionNum);
                    _final.Add(race.SessionNum);
                    toSave.Add(result);
                }
                else
                {
                    _pending[race.SessionNum] = result;
                }
            }
        }
        foreach (var result in toSave)
            Save(result);
    }

    /// <summary>Called with every telemetry sample, to note when each race session started.</summary>
    public void OnSample(int? sessionNum, double? sessionTime)
    {
        if (sessionNum is not { } num || sessionTime is not { } time)
            return;
        lock (_lock)
        {
            if (_raceSessions.Contains(num) && !_started.ContainsKey(num))
                _started[num] = DateTimeOffset.UtcNow - TimeSpan.FromSeconds(Math.Max(0, time));
        }
    }

    /// <summary>Saves races that aren't final yet as they stand, e.g. on disconnecting from iRacing or
    /// closing the collector.</summary>
    public void SaveUnfinished()
    {
        List<RaceResult> toSave;
        lock (_lock)
            toSave = TakePending();
        foreach (var result in toSave)
            Save(result);
    }

    /// <summary>Waits up to `grace` for the uploads under way and any still waiting; the rest go next run.</summary>
    public async Task FinishUploadsAsync(TimeSpan grace)
    {
        if (_api is null)
            return;
        using var cancel = new CancellationTokenSource(grace);
        try
        {
            await UploadSavedAsync(cancel.Token);
        }
        catch (OperationCanceledException)
        {
            // next run
        }
    }

    private static bool IsRace(Session s) => string.Equals(s.SessionType, "Race", StringComparison.OrdinalIgnoreCase);

    // "A 3.45" -> 3.45
    private static double? SafetyRating(string? license)
    {
        var parts = license?.Split(' ', StringSplitOptions.RemoveEmptyEntries);
        return parts is { Length: 2 } && double.TryParse(parts[1], NumberStyles.Float, CultureInfo.InvariantCulture, out var sr)
            ? sr
            : null;
    }

    private List<RaceResult> TakePending()
    {
        var results = _pending.Values.ToList();
        _pending.Clear();
        return results;
    }

    private string PathOf(RaceResult result) => Path.Combine(Folder, $"{result.SubSessionId}-S{result.SessionNum}.json");

    private void Save(RaceResult result)
    {
        try
        {
            Directory.CreateDirectory(Folder);
            var path = PathOf(result);
            lock (_fileLock)
            {
                // A final result already saved (or uploaded) is never replaced by one that isn't
                if (!result.ResultsFinal && Load(path)?.Result is { ResultsFinal: true })
                    return;
                Write(path, new SavedRaceResult { Result = result });
            }
            log($"Race result saved: {Describe(result)}{(result.ResultsFinal ? "" : " (left before it was official)")}.");
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            log($"Could not save the race result: {e.Message}");
            return;
        }
        if (_api is not null)
            _ = Task.Run(() => UploadSavedAsync(CancellationToken.None));
    }

    private static string Describe(RaceResult r) =>
        $"{r.Track}, {(r.FinishPosition is { } p ? $"P{p} in class" : "no position")}, {r.Incidents ?? 0}x";

    /// <summary>Uploads every saved result that RacingCoach.app doesn't have yet, one at a time.</summary>
    private async Task UploadSavedAsync(CancellationToken ct)
    {
        if (_api is not { } api)
            return;
        await _uploading.WaitAsync(ct);
        try
        {
            if (!Directory.Exists(Folder))
                return;
            foreach (var path in Directory.GetFiles(Folder, "*.json"))
            {
                ct.ThrowIfCancellationRequested();
                SavedRaceResult? saved;
                try
                {
                    lock (_fileLock)
                        saved = Load(path);
                }
                catch (Exception e) when (e is IOException or JsonException)
                {
                    continue;
                }
                if (saved?.Result is not { } result || saved.Uploaded)
                    continue;

                var (outcome, message) = await api.UploadRaceResultAsync(result, ct);
                switch (outcome)
                {
                    case UploadOutcome.Uploaded:
                        Record(path, result, uploaded: true, error: null);
                        log($"Race result uploaded: {Describe(result)}.");
                        break;
                    case UploadOutcome.Rejected:
                        Record(path, result, uploaded: false, error: message);
                        log($"RacingCoach.app did not accept the race result ({Describe(result)}): {message}.");
                        break;
                    case UploadOutcome.Unauthorized:
                        return; // the lap uploader tells the user; these go once a new key is entered
                    case UploadOutcome.RetryLater:
                        ScheduleRetry();
                        return;
                }
            }
        }
        finally
        {
            _uploading.Release();
        }
    }

    // Records an upload's outcome, unless the file has been saved with a newer result meanwhile (which then
    // uploads next)
    private void Record(string path, RaceResult result, bool uploaded, string? error)
    {
        try
        {
            lock (_fileLock)
            {
                if (Load(path) is not { } saved || saved.Result != result)
                    return;
                saved.Uploaded = uploaded;
                saved.UploadError = error;
                Write(path, saved);
            }
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            log($"Could not record the race result's upload: {e.Message}");
        }
    }

    // The site couldn't be reached; the saved results are tried again a minute later (or at the next start)
    private void ScheduleRetry()
    {
        lock (_lock)
        {
            if (_retryScheduled)
                return;
            _retryScheduled = true;
        }
        _ = Task.Run(async () =>
        {
            await Task.Delay(RetryDelay);
            lock (_lock)
                _retryScheduled = false;
            await UploadSavedAsync(CancellationToken.None);
        });
    }

    private static SavedRaceResult? Load(string path) =>
        File.Exists(path) ? JsonSerializer.Deserialize<SavedRaceResult>(File.ReadAllText(path), JsonOptions) : null;

    // Writes to a temp file first so a crash never leaves a half-written file
    private static void Write(string path, SavedRaceResult saved)
    {
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(saved, JsonOptions));
        File.Move(path + ".tmp", path, overwrite: true);
    }
}
