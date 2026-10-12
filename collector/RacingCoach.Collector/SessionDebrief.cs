namespace RacingCoach.Collector;

/// <summary>
/// The in-session debrief: once a session's first few laps have uploaded, asks RacingCoach.app for the
/// average time through the track's first focus area (/api/collector/debrief, measured like Debrief Coach
/// measures areas), then logs it and says it, e.g. "Area 1 average time was 12.3 seconds". Once per session
/// folder per run. Only laps driven in this run count, not earlier runs' laps or re-uploads with track
/// positions; in-laps (pit road) don't count either, as they're slow through the last areas.
/// </summary>
internal sealed class SessionDebrief(Func<RacingCoachApi?> api, Action<string> log)
{
    /// <summary>Laps that have to upload before the debrief.</summary>
    public const int LapsNeeded = 3;

    private readonly object _lock = new();
    private readonly Dictionary<string, List<Guid>> _uploaded = []; // session folder -> laps uploaded this run
    private readonly HashSet<string> _done = [];

    /// <summary>Called with each lap the uploader has finished with (error null = uploaded).</summary>
    public void OnUploaded(UploadItem item, string? error)
    {
        if (error is not null || item.Earlier || item.WithPositions || item.Lap.PitRoad || item.Lap.ClientLapId is not { } id)
            return;

        List<Guid> laps;
        lock (_lock)
        {
            if (_done.Contains(item.Folder))
                return;
            laps = _uploaded.TryGetValue(item.Folder, out var list) ? list : _uploaded[item.Folder] = [];
            if (laps.Contains(id))
                return;
            laps.Add(id);
            if (laps.Count < LapsNeeded)
                return;
            _done.Add(item.Folder);
            laps = [.. laps];
        }
        // Not on the uploader's task, so the next lap's upload doesn't wait for it
        _ = Task.Run(() => RunAsync(laps));
    }

    private async Task RunAsync(List<Guid> laps)
    {
        if (api() is not { } site)
            return;
        var (message, areaName, error) = await site.GetDebriefAsync(laps, CancellationToken.None);
        if (message is null)
        {
            log($"No debrief after {laps.Count} laps: {error}.");
            return;
        }
        log($"Debrief after {laps.Count} laps: {message}{(areaName is null ? "" : $" ({areaName})")}.");
        Voice.Say(message);
    }
}
