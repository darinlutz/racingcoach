using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// The car's setup as iRacing has it loaded, as POST /api/collector/setup takes it (captureSchema in the website's
/// src/app/api/collector/setup/route.ts; docs/setups.md). Yaml is session info's CarSetup section exactly as iRacing
/// wrote it: the garage's values with their units, whatever the car has. PassedTech is DriverSetupPassedTech (1 passed,
/// 0 failed); FixedSession is the session's WeekendOptions.IsFixedSetup, which says whether the session is a fixed
/// setup session (a setup's name doesn't: iRacing's GT3 setups include one named "fixed.sto" for open sessions too).
/// </summary>
internal sealed record SetupCaptureData(
    string Simulator,
    string Car,
    string? CarKey,
    string? Track,
    string? TrackKey,
    string? SetupName,
    string? LoadType,
    bool? Modified,
    int? PassedTech,
    bool? FixedSession,
    int SessionId,
    int SubSessionId,
    DateTimeOffset ObservedAt,
    string Yaml);

/// <summary>
/// Sends the car's setup to RacingCoach.app's Setups page whenever iRacing's session info shows it changed: another
/// setup loaded, a garage or in-car change (CarSetup.UpdateCount goes up), iRacing's inspection result, or the
/// session. The same setup isn't sent twice. Only the newest capture waits to be sent: one that couldn't be sent is
/// replaced by the next, as only what's loaded now matters. Nothing is kept on disk.
/// </summary>
internal sealed class SetupCaptureTracker(Action<string> log)
{
    private static readonly TimeSpan RetryDelay = TimeSpan.FromMinutes(1);

    private readonly object _lock = new();
    private readonly SemaphoreSlim _sending = new(1, 1);
    private RacingCoachApi? _api;
    private string? _section;
    private SetupCaptureData? _pending;
    private string? _sentHash;
    private string? _lastLoggedName;
    private bool _retryScheduled;

    public void UseApi(RacingCoachApi? api)
    {
        _api = api;
        lock (_lock)
            _sentHash = null; // another account may not have it yet
        Kick();
    }

    // The parsed session info's part of a capture, waiting for its CarSetup section (or the other way round)
    private SetupCaptureData? _meta;

    /// <summary>The whole session info YAML (OnRawSessionInfoUpdate): only its CarSetup section is kept.</summary>
    public void OnRawSessionInfo(string yaml)
    {
        var section = ExtractCarSetup(yaml);
        lock (_lock)
            _section = section;
        Queue();
    }

    /// <summary>The parsed session info (OnSessionInfoUpdate), with the track and car as the laps name them.</summary>
    public void OnSessionInfo(TelemetrySessionInfo session, string track, string car)
    {
        var info = session.DriverInfo;
        var driverIdx = info?.DriverCarIdx;
        var driver = info?.Drivers?.FirstOrDefault(d => d.CarIdx == driverIdx);
        var weekend = session.WeekendInfo;
        lock (_lock)
        {
            _meta = new SetupCaptureData(
                "iracing",
                car,
                string.IsNullOrWhiteSpace(driver?.CarPath) ? null : driver.CarPath.Trim(),
                track,
                string.IsNullOrWhiteSpace(weekend?.TrackName) ? null : weekend.TrackName.Trim(),
                string.IsNullOrWhiteSpace(info?.DriverSetupName) ? null : info.DriverSetupName.Trim(),
                string.IsNullOrWhiteSpace(info?.DriverSetupLoadTypeName) ? null : info.DriverSetupLoadTypeName.Trim(),
                info?.DriverSetupIsModified is { } modified ? modified != 0 : null,
                info?.DriverSetupPassedTech,
                weekend?.WeekendOptions?.IsFixedSetup is { } fixedSetup ? fixedSetup != 0 : null,
                weekend?.SessionID ?? 0,
                weekend?.SubSessionID ?? 0,
                DateTimeOffset.UtcNow,
                "");
        }
        Queue();
    }

    // A capture from the latest of both halves, unless it's what was sent or is waiting already
    private void Queue()
    {
        lock (_lock)
        {
            if (_meta is null || _section is null)
                return; // the other half hasn't come yet, or the car has no garage
            var capture = _meta with { Yaml = _section, ObservedAt = DateTimeOffset.UtcNow };
            var hash = HashOf(capture);
            if (hash == _sentHash || hash == (_pending is null ? null : HashOf(_pending)))
                return;
            _pending = capture;
        }
        Kick();
    }

    public void OnDisconnected()
    {
        lock (_lock)
        {
            _section = null;
            _meta = null;
            _sentHash = null;
        }
    }

    /// <summary>The CarSetup section: from the line "CarSetup:" to the next top-level key or the document's end.</summary>
    public static string? ExtractCarSetup(string yaml)
    {
        var lines = yaml.Replace("\r\n", "\n").Split('\n');
        var start = Array.FindIndex(lines, l => l.TrimEnd() == "CarSetup:");
        if (start < 0)
            return null;
        var out_ = new StringBuilder(lines[start]).Append('\n');
        var any = false;
        for (var i = start + 1; i < lines.Length; i++)
        {
            var line = lines[i];
            if (line == "..." || (line.Length > 0 && !char.IsWhiteSpace(line[0])))
                break;
            if (line.Trim().Length == 0)
                continue;
            out_.Append(line).Append('\n');
            any = true;
        }
        return any ? out_.ToString() : null;
    }

    // What makes a capture new: everything but when it was seen
    private static string HashOf(SetupCaptureData c) =>
        Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(JsonSerializer.Serialize(c with { ObservedAt = default }))));

    private void Kick()
    {
        if (_api is null)
            return;
        _ = Task.Run(() => SendAsync(CancellationToken.None));
    }

    private async Task SendAsync(CancellationToken ct)
    {
        if (!await _sending.WaitAsync(0, ct))
            return; // the running send picks up the newest
        try
        {
            while (true)
            {
                SetupCaptureData? capture;
                lock (_lock)
                    capture = _pending;
                var api = _api;
                if (capture is null || api is null)
                    return;
                var (outcome, message) = await api.UploadSetupAsync(capture, ct);
                lock (_lock)
                {
                    if (outcome is UploadOutcome.Uploaded or UploadOutcome.Rejected or UploadOutcome.Unauthorized)
                    {
                        if (outcome == UploadOutcome.Uploaded)
                            _sentHash = HashOf(capture);
                        if (ReferenceEquals(_pending, capture))
                            _pending = null;
                    }
                }
                if (outcome == UploadOutcome.Uploaded)
                {
                    if (capture.SetupName != _lastLoggedName)
                    {
                        _lastLoggedName = capture.SetupName;
                        log($"Setup sent to RacingCoach.app: {capture.SetupName ?? "unnamed"}.");
                    }
                    continue;
                }
                if (outcome == UploadOutcome.Rejected)
                {
                    log($"RacingCoach.app didn't take the setup: {message}");
                    continue;
                }
                if (outcome == UploadOutcome.RetryLater)
                    ScheduleRetry();
                return;
            }
        }
        finally
        {
            _sending.Release();
        }
    }

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
            await SendAsync(CancellationToken.None);
        });
    }
}
