using System.Threading.Channels;

namespace RacingCoach.Collector;

/// <summary>A saved lap waiting to be uploaded. Earlier is true for laps from previous runs.</summary>
internal sealed record UploadItem(string Folder, SessionInfo Session, ManifestLap Lap, bool Earlier);

/// <summary>
/// Uploads saved laps to RacingCoach.app on its own background task, one at a time and in order.
/// When the site can't be reached it waits and tries again (5 s, doubling up to 5 minutes), so laps
/// driven offline upload once the connection is back. Each result is reported to onFinished
/// (error null = uploaded) so it can be recorded in session.json; laps still waiting at shutdown
/// stay marked as not uploaded and go up the next time the collector runs.
/// </summary>
internal sealed class LapUploader : IAsyncDisposable
{
    private static readonly TimeSpan FirstRetryDelay = TimeSpan.FromSeconds(5);
    private static readonly TimeSpan MaxRetryDelay = TimeSpan.FromMinutes(5);
    // How long shutdown waits for queued uploads before leaving them for next time
    private static readonly TimeSpan ShutdownGrace = TimeSpan.FromSeconds(10);

    private readonly Channel<UploadItem> _queue = Channel.CreateUnbounded<UploadItem>(new UnboundedChannelOptions { SingleReader = true });
    private readonly CancellationTokenSource _stop = new();
    private readonly RacingCoachApi _api;
    private readonly Action<UploadItem, string?> _onFinished;
    private readonly Action<string> _log;
    private readonly Task _worker;
    private int _waiting;
    private bool _keyRejected;

    public LapUploader(RacingCoachApi api, Action<UploadItem, string?> onFinished, Action<string> log)
    {
        _api = api;
        _onFinished = onFinished;
        _log = log;
        _worker = Task.Run(RunAsync);
    }

    public void Enqueue(UploadItem item)
    {
        Interlocked.Increment(ref _waiting);
        _queue.Writer.TryWrite(item);
    }

    public async ValueTask DisposeAsync()
    {
        _queue.Writer.TryComplete();
        if (await Task.WhenAny(_worker, Task.Delay(ShutdownGrace)) != _worker)
            _stop.Cancel();
        await _worker;
        _stop.Dispose();

        var left = Volatile.Read(ref _waiting);
        if (left > 0)
            _log(_keyRejected
                ? $"{left} lap(s) not uploaded yet; they will upload once you enter a new key with --set-key."
                : $"{left} lap(s) not uploaded yet; they will upload the next time the collector runs.");
    }

    private async Task RunAsync()
    {
        var offline = false;
        try
        {
            await foreach (var item in _queue.Reader.ReadAllAsync(_stop.Token))
            {
                if (_keyRejected)
                    continue; // stays not uploaded in session.json until the key is fixed

                var delay = FirstRetryDelay;
                while (true)
                {
                    var csvPath = Path.Combine(item.Folder, item.Lap.File);
                    var (outcome, message) = await _api.UploadLapAsync(csvPath, item.Session, item.Lap, _stop.Token);

                    if (outcome == UploadOutcome.RetryLater)
                    {
                        if (!offline)
                            _log($"Could not reach {_api.SiteUrl} ({message}). Laps are saved and will upload when it's reachable again.");
                        offline = true;
                        await Task.Delay(delay, _stop.Token);
                        delay = TimeSpan.FromTicks(Math.Min(delay.Ticks * 2, MaxRetryDelay.Ticks));
                        continue;
                    }

                    if (offline)
                        _log($"{_api.SiteUrl} is reachable again.");
                    offline = false;

                    switch (outcome)
                    {
                        case UploadOutcome.Uploaded:
                            Interlocked.Decrement(ref _waiting);
                            _onFinished(item, null);
                            _log(item.Earlier
                                ? $"Uploaded earlier lap {item.Lap.LapNumber} ({item.Session.Track}, {item.Lap.RecordedAt:yyyy-MM-dd})."
                                : $"Lap {item.Lap.LapNumber} uploaded.");
                            break;
                        case UploadOutcome.Rejected:
                            Interlocked.Decrement(ref _waiting);
                            _onFinished(item, message);
                            _log($"RacingCoach.app did not accept lap {item.Lap.LapNumber}: {message}");
                            break;
                        case UploadOutcome.Unauthorized:
                            _keyRejected = true;
                            _log("RacingCoach.app no longer accepts your upload key. Laps are still saved; "
                                + "run RacingCoach.Collector.exe --set-key with a new key from your Account page to upload them.");
                            break;
                    }
                    break;
                }
            }
        }
        catch (OperationCanceledException) when (_stop.IsCancellationRequested)
        {
            // shutting down; whatever is left uploads next time
        }
    }
}
