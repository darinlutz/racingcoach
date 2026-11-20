namespace RacingCoach.Collector;

/// <summary>
/// Uploads iRacing's setup files to the iRacing Setups library automatically (docs/setups.md's iRacing setup
/// collection), for Admins only, as Get Car Setups does by hand: once the account is known to be an Admin (each upload
/// key once per run), then whenever a .sto or .htm in the setups folder is added or changed (a FileSystemWatcher, run
/// 30 s after the last change, so a batch of saves is one import), and every hour in case the watcher missed something,
/// which imports only when the folder's fingerprint (names, sizes, times) differs from the last good run's. Runs
/// quietly: the activity log gets problems and, when something was imported or failed, the summary.
/// </summary>
internal sealed class CarSetupSync : IDisposable
{
    private static readonly TimeSpan Tick = TimeSpan.FromSeconds(15);
    private static readonly TimeSpan Settle = TimeSpan.FromSeconds(30);
    private static readonly TimeSpan Recheck = TimeSpan.FromHours(1);
    private static readonly TimeSpan RetryAfterFailure = TimeSpan.FromMinutes(10);

    private readonly Func<RacingCoachApi?> _api;
    private readonly Func<bool> _isAdmin;
    private readonly CancellationTokenSource _stop = new();
    private readonly HashSet<string> _errorsSaid = [];
    private FileSystemWatcher? _watcher;
    private string? _root;
    private RacingCoachApi? _syncedFor;
    private string? _lastFingerprint;
    private DateTime _lastCheck = DateTime.MinValue;
    private DateTime _retryAt = DateTime.MinValue;
    private long _changedAtTicks; // when the watcher last saw a change (UTC ticks), 0 for none waiting

    public CarSetupSync(Func<RacingCoachApi?> api, Func<bool> isAdmin)
    {
        _api = api;
        _isAdmin = isAdmin;
        _ = Task.Run(RunAsync);
    }

    private async Task RunAsync()
    {
        try
        {
            while (true)
            {
                await Task.Delay(Tick, _stop.Token);
                try
                {
                    await CheckAsync(_stop.Token);
                }
                catch (OperationCanceledException) when (_stop.IsCancellationRequested)
                {
                    throw;
                }
                catch (Exception e)
                {
                    Log($"Car setups: the automatic upload failed: {e.Message}", true);
                    _retryAt = DateTime.UtcNow + RetryAfterFailure;
                }
            }
        }
        catch (OperationCanceledException)
        {
            // closing
        }
    }

    private async Task CheckAsync(CancellationToken ct)
    {
        if (_api() is not { } api || !_isAdmin())
            return;
        var now = DateTime.UtcNow;
        if (now < _retryAt)
            return;
        Watch();
        var changedAt = Interlocked.Read(ref _changedAtTicks);
        var changeSettled = changedAt != 0 && now - new DateTime(changedAt, DateTimeKind.Utc) >= Settle;
        var newKey = _syncedFor != api;
        if (!newKey && !changeSettled && now - _lastCheck < Recheck)
            return;
        _lastCheck = now;
        if (changeSettled)
            Interlocked.CompareExchange(ref _changedAtTicks, 0, changedAt);
        var fingerprint = await Task.Run(() => CarSetupImporter.Fingerprint(_root), ct);
        if (!newKey && fingerprint is not null && fingerprint == _lastFingerprint)
            return;
        var summary = await new CarSetupImporter(api, Report, quiet: true).RunAsync(null, ct);
        if (summary is null)
        {
            _retryAt = DateTime.UtcNow + RetryAfterFailure;
            return;
        }
        _syncedFor = api;
        // Failed setups are tried again at the next check rather than waiting for a change
        _lastFingerprint = summary.Failed == 0 ? fingerprint : null;
    }

    // Watches the setups folder once it exists (iRacing may make it after the collector starts)
    private void Watch()
    {
        if (_watcher is not null)
            return;
        _root = CarSetupImporter.FindSetupsRoot();
        if (_root is null)
            return;
        try
        {
            var watcher = new FileSystemWatcher(_root)
            {
                IncludeSubdirectories = true,
                NotifyFilter = NotifyFilters.FileName | NotifyFilters.DirectoryName | NotifyFilters.LastWrite | NotifyFilters.Size,
                InternalBufferSize = 64 * 1024,
            };
            watcher.Changed += OnChange;
            watcher.Created += OnChange;
            watcher.Renamed += OnChange;
            watcher.Error += (_, _) => Interlocked.Exchange(ref _changedAtTicks, DateTime.UtcNow.Ticks); // overflow: check it all
            watcher.EnableRaisingEvents = true;
            _watcher = watcher;
        }
        catch (Exception e) when (e is IOException or ArgumentException or UnauthorizedAccessException)
        {
            Log($"Car setups: can't watch the setups folder ({e.Message}); it's checked every hour instead", false);
        }
    }

    private void OnChange(object sender, FileSystemEventArgs e)
    {
        var name = e.FullPath;
        if (e.ChangeType != WatcherChangeTypes.Renamed && !name.EndsWith(".sto", StringComparison.OrdinalIgnoreCase) &&
            !name.EndsWith(".htm", StringComparison.OrdinalIgnoreCase) && !name.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            return;
        Interlocked.Exchange(ref _changedAtTicks, DateTime.UtcNow.Ticks);
    }

    // Each problem once per run, so a car that isn't in Car Data isn't logged at every change
    private void Report(string key, object?[] args, bool isError)
    {
        var message = "Car setups: " + Loc.T(Loc.English, key, args);
        if (isError && !_errorsSaid.Add(message))
            return;
        Log(message, isError);
    }

    private static void Log(string message, bool isError) => ActivityLog.Shared.Write(message, isError);

    public void Dispose()
    {
        _stop.Cancel();
        _watcher?.Dispose();
    }
}
