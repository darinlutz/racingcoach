namespace RacingCoach.Collector;

/// <summary>
/// Sends the activity log (ActivityLog, also in collector.log) to RacingCoach.app (POST /api/collector/log), so
/// problems on a sim PC can be looked into without asking for the file. Lines are kept until they're sent: every
/// 15 seconds while there's an upload key, and once more when the collector closes. Each run has its own ID and
/// numbers its lines, so a batch sent twice (a retry after a timeout) is only stored once. The Windows user folder
/// is replaced with %USERPROFILE% in paths. Nothing it does is logged, which would feed it its own lines.
/// </summary>
internal sealed class LogUploader : IAsyncDisposable
{
    private const int MaxKept = 5000; // the oldest are dropped past this, e.g. a long run without a key
    private const int MaxPerBatch = 500;
    private static readonly TimeSpan SendEvery = TimeSpan.FromSeconds(15);

    private readonly Func<RacingCoachApi?> _api;
    private readonly Guid _runId = Guid.NewGuid();
    private readonly string _userFolder = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
    private readonly object _lock = new();
    private readonly List<CollectorLogLine> _pending = [];
    private readonly SemaphoreSlim _sending = new(1, 1);
    private readonly CancellationTokenSource _stop = new();
    private readonly Task _loop;
    private int _seq;

    public LogUploader(Func<RacingCoachApi?> api)
    {
        _api = api;
        ActivityLog.Shared.Added += OnAdded;
        _loop = Task.Run(RunAsync);
    }

    private void OnAdded(LogEntry entry)
    {
        var message = string.IsNullOrEmpty(_userFolder)
            ? entry.Message
            : entry.Message.Replace(_userFolder, "%USERPROFILE%", StringComparison.OrdinalIgnoreCase);
        lock (_lock)
        {
            _pending.Add(new CollectorLogLine(++_seq, new DateTimeOffset(entry.Time), message, entry.IsError));
            if (_pending.Count > MaxKept)
                _pending.RemoveRange(0, _pending.Count - MaxKept);
        }
    }

    private async Task RunAsync()
    {
        try
        {
            while (true)
            {
                await Task.Delay(SendEvery, _stop.Token);
                await SendAsync(_stop.Token);
            }
        }
        catch (OperationCanceledException)
        {
            // closing; DisposeAsync sends the rest
        }
    }

    // Sends what's waiting, a batch at a time, until it's all sent or a batch fails (kept for next time)
    private async Task SendAsync(CancellationToken ct)
    {
        await _sending.WaitAsync(ct);
        try
        {
            while (_api() is { } site)
            {
                CollectorLogLine[] batch;
                lock (_lock)
                    batch = [.. _pending.Take(MaxPerBatch)];
                if (batch.Length == 0)
                    return;
                try
                {
                    await site.UploadLogAsync(_runId, UpdateCheck.Current.ToString(), batch, ct);
                }
                catch (Exception e) when (e is HttpRequestException or TaskCanceledException or UnauthorizedAccessException)
                {
                    return;
                }
                lock (_lock)
                    _pending.RemoveAll(line => line.Seq <= batch[^1].Seq);
            }
        }
        finally
        {
            _sending.Release();
        }
    }

    /// <summary>Stops sending every 15 seconds and gives what's left a few seconds to go.</summary>
    public async ValueTask DisposeAsync()
    {
        ActivityLog.Shared.Added -= OnAdded;
        _stop.Cancel();
        await _loop;
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
        try
        {
            await SendAsync(timeout.Token);
        }
        catch (OperationCanceledException)
        {
            // the rest are lost; they're still in collector.log
        }
    }
}

/// <summary>One activity log line for POST /api/collector/log: its number in this run, when it was written (with
/// the PC's UTC offset), the message, and whether it was an error.</summary>
internal sealed record CollectorLogLine(int Seq, DateTimeOffset At, string Message, bool IsError);
