using System.Globalization;
using System.Text;
using System.Threading.Channels;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// Saves completed laps on a background task, so slow disk writes never hold up the
/// 60 Hz telemetry handler. Each iRacing session gets its own folder with one CSV per lap
/// and a session.json manifest describing them. With an uploader, each saved lap is then queued
/// for upload, and laps from earlier runs that never uploaded are queued when it starts.
/// </summary>
internal sealed class LapWriter : IAsyncDisposable
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private const string UnknownTrack = "Unknown Track";
    private const string UnknownTrackError = "track and car unknown (iRacing hadn't sent session info yet)";

    // Same names and units as iRacing: Speed in m/s, pedals 0..1, LapDistPct 0..1.
    private static readonly (string Name, Func<TelemetryData, string> Value)[] Columns =
    [
        ("Speed", d => F(d.Speed)),
        ("LapDistPct", d => F(d.LapDistPct)),
        ("Brake", d => F(d.Brake)),
        ("Throttle", d => F(d.Throttle)),
        ("RPM", d => F(d.RPM)),
        ("SteeringWheelAngle", d => F(d.SteeringWheelAngle)),
        ("Gear", d => I(d.Gear)),
        ("Clutch", d => F(d.Clutch)),
        ("ABSActive", d => B(d.BrakeABSactive)),
        ("LatAccel", d => F(d.LatAccel)),
        ("LongAccel", d => F(d.LongAccel)),
        ("VertAccel", d => F(d.VertAccel)),
        ("Yaw", d => F(d.Yaw)),
        ("YawRate", d => F(d.YawRate)),
        ("Lap", d => I(d.Lap)),
        ("LapDist", d => F(d.LapDist)),
        ("SessionTime", d => d.SessionTime?.ToString(Inv) ?? ""),
        ("SessionTick", d => I(d.SessionTick)),
    ];

    // Everything the worker task does, in order: save a lap, or record how an upload went
    private abstract record Job;
    private sealed record SaveLap(CompletedLap Lap) : Job;
    private sealed record RecordUpload(string Folder, Guid ClientLapId, string? Error) : Job;
    private sealed record Flush(TaskCompletionSource Done) : Job;

    private readonly Channel<Job> _queue = Channel.CreateUnbounded<Job>(new UnboundedChannelOptions { SingleReader = true });
    private readonly string _root;
    private readonly Action<string> _log;
    private Task? _worker;

    // Only touched by the worker task.
    private SessionContext? _folderSession;
    private string? _folder;

    public LapWriter(string root, Action<string> log)
    {
        _root = root;
        _log = log;
    }

    /// <summary>Set before Start; laps are only saved locally without it.</summary>
    public LapUploader? Uploader { get; set; }

    public void Start() => _worker = Task.Run(RunAsync);

    public void Enqueue(CompletedLap lap) => _queue.Writer.TryWrite(new SaveLap(lap));

    /// <summary>Records an upload result in the lap's session.json (error null = uploaded). A result that
    /// arrives after DisposeAsync is lost, which is harmless: the lap is uploaded again next run and
    /// RacingCoach.app recognises it as a duplicate.</summary>
    public void RecordUploadResult(UploadItem item, string? error) =>
        _queue.Writer.TryWrite(new RecordUpload(item.Folder, item.Lap.ClientLapId!.Value, error));

    /// <summary>Waits until everything queued so far is done, e.g. the last laps are saved (and handed
    /// to the uploader) before the uploader is shut down. The writer keeps running.</summary>
    public Task FlushAsync()
    {
        var flush = new Flush(new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously));
        return _worker is not null && _queue.Writer.TryWrite(flush) ? flush.Done.Task : Task.CompletedTask;
    }

    /// <summary>Finishes writing any queued laps and upload results.</summary>
    public async ValueTask DisposeAsync()
    {
        _queue.Writer.TryComplete();
        if (_worker is not null)
            await _worker;
    }

    private async Task RunAsync()
    {
        if (Uploader is not null)
        {
            try
            {
                QueueEarlierLaps();
            }
            catch (Exception e)
            {
                _log($"Could not check earlier laps for uploading: {e.Message}");
            }
        }

        await foreach (var job in _queue.Reader.ReadAllAsync())
        {
            try
            {
                switch (job)
                {
                    case SaveLap save:
                        Save(save.Lap);
                        break;
                    case RecordUpload result:
                        RecordUploadResult(result);
                        break;
                    case Flush flush:
                        flush.Done.SetResult();
                        break;
                }
            }
            catch (Exception e)
            {
                _log(job is SaveLap s ? $"Could not save lap {s.Lap.LapNumber}: {e.Message}" : $"Could not record an upload in session.json: {e.Message}");
            }
        }
    }

    private void Save(CompletedLap lap)
    {
        var session = lap.Session ?? new SessionContext(UnknownTrack, "Unknown Car", "Unknown Driver", 0, 0, new Dictionary<int, string>());
        var folder = FolderFor(session);

        var lapTime = FormatLapTime(lap.LapTimeSeconds);
        var id = $"S{lap.SessionNum}L{lap.LapNumber:000}";
        var path = UniquePath(folder, SafeFileName($"RacingCoach - {session.Driver} - {session.Car} - {session.Track} - {lapTime} - {id}"));

        // Write to a temp file first so a crash never leaves a half-written CSV behind.
        var temp = path + ".tmp";
        using (var writer = new StreamWriter(temp, append: false, new UTF8Encoding(encoderShouldEmitUTF8Identifier: false), bufferSize: 1 << 16))
        {
            writer.NewLine = "\n";
            writer.WriteLine(string.Join(',', Columns.Select(c => c.Name)));
            foreach (var sample in lap.Samples)
                writer.WriteLine(string.Join(',', Columns.Select(c => c.Value(sample))));
        }
        File.Move(temp, path);

        var entry = new ManifestLap
        {
            File = Path.GetFileName(path),
            ClientLapId = Guid.NewGuid(),
            LapNumber = lap.LapNumber,
            SessionNum = lap.SessionNum,
            SessionType = session.SessionTypes.GetValueOrDefault(lap.SessionNum, "Unknown"),
            LapTimeSeconds = Math.Round(lap.LapTimeSeconds, 3),
            Samples = lap.Samples.Count,
            MissingSamples = lap.MissingSamples,
            Incidents = lap.Incidents,
            PitRoad = lap.OnPitRoad,
            OffTrack = lap.OffTrack,
            RecordedAt = DateTimeOffset.Now,
            // Without session info the lap can't be matched to a track on RacingCoach.app; it's kept here only
            UploadError = lap.Session is null ? UnknownTrackError : null,
        };
        var manifest = SessionManifest.Load(folder) ?? new SessionManifest();
        // Keep the newest session details (session types fill in over time)
        manifest.Track = session.Track;
        manifest.Car = session.Car;
        manifest.Driver = session.Driver;
        manifest.SessionId = session.SessionId;
        manifest.SubSessionId = session.SubSessionId;
        manifest.Laps.Add(entry);
        manifest.Save(folder);

        var notes = new List<string>();
        if (lap.OnPitRoad) notes.Add("pit road");
        if (lap.OffTrack) notes.Add("off track");
        if (lap.Incidents > 0) notes.Add($"{lap.Incidents}x incidents");
        if (lap.MissingSamples > 0) notes.Add($"{lap.MissingSamples} missing samples");
        var suffix = notes.Count > 0 ? $" [{string.Join(", ", notes)}]" : "";
        var t = TimeSpan.FromMilliseconds(Math.Round(lap.LapTimeSeconds * 1000));
        _log($"Lap {lap.LapNumber} saved: {(int)t.TotalMinutes}:{t.Seconds:00}.{t.Milliseconds:000} ({lap.Samples.Count:N0} samples){suffix}");

        if (entry.UploadError is null)
            Uploader?.Enqueue(new UploadItem(folder, InfoOf(manifest), entry, Earlier: false));
    }

    private void RecordUploadResult(RecordUpload result)
    {
        var manifest = SessionManifest.Load(result.Folder);
        var lap = manifest?.Laps.FirstOrDefault(l => l.ClientLapId == result.ClientLapId);
        if (manifest is null || lap is null)
            return;
        lap.Uploaded = result.Error is null;
        lap.UploadError = result.Error;
        manifest.Save(result.Folder);
    }

    // Laps from earlier runs that haven't been uploaded (and weren't refused), oldest first. Laps saved
    // before uploads existed get their upload ID here.
    private void QueueEarlierLaps()
    {
        if (!Directory.Exists(_root))
            return;

        var count = 0;
        foreach (var folder in Directory.GetDirectories(_root).Order(StringComparer.Ordinal))
        {
            var manifest = SessionManifest.Load(folder);
            if (manifest is null)
                continue;
            var pending = manifest.Laps.Where(l => !l.Uploaded && l.UploadError is null).ToList();
            if (pending.Count == 0)
                continue;

            // Saved by a version that didn't mark these; they can't be matched to a track on RacingCoach.app
            if (manifest.Track == UnknownTrack)
            {
                pending.ForEach(l => l.UploadError = UnknownTrackError);
                manifest.Save(folder);
                continue;
            }

            var changed = false;
            foreach (var lap in pending.Where(l => l.ClientLapId is null))
            {
                lap.ClientLapId = Guid.NewGuid();
                changed = true;
            }
            if (changed)
                manifest.Save(folder);

            var info = InfoOf(manifest);
            foreach (var lap in pending)
                Uploader!.Enqueue(new UploadItem(folder, info, lap, Earlier: true));
            count += pending.Count;
        }
        if (count > 0)
            _log($"Uploading {count} earlier lap(s) that haven't been uploaded yet.");
    }

    // One folder per iRacing session (track, car and session IDs); a new one when any of them changes.
    private string FolderFor(SessionContext session)
    {
        if (_folder is not null && _folderSession is { } s
            && s.Track == session.Track && s.Car == session.Car
            && s.SessionId == session.SessionId && s.SubSessionId == session.SubSessionId)
        {
            _folderSession = session;
            return _folder;
        }

        _folderSession = session;
        _folder = Path.Combine(_root, SafeFileName($"{DateTime.Now:yyyy-MM-dd HH-mm-ss} {session.Track} - {session.Car}"));
        Directory.CreateDirectory(_folder);
        _log($"Saving laps to {_folder}");
        return _folder;
    }

    private static SessionInfo InfoOf(SessionManifest m) => new(m.Track, m.Car, m.Driver, m.SessionId, m.SubSessionId);

    private static string UniquePath(string folder, string name)
    {
        var path = Path.Combine(folder, name + ".csv");
        for (var n = 2; File.Exists(path); n++)
            path = Path.Combine(folder, $"{name}{n}.csv");
        return path;
    }

    // "01.50.486", the lap time format in RacingCoach lap file names.
    private static string FormatLapTime(double seconds)
    {
        var t = TimeSpan.FromMilliseconds(Math.Round(seconds * 1000));
        return $"{(int)t.TotalMinutes:00}.{t.Seconds:00}.{t.Milliseconds:000}";
    }

    private static string SafeFileName(string name) =>
        string.Concat(name.Select(c => Path.GetInvalidFileNameChars().Contains(c) ? '_' : c));

    private static string F(float? v) => v?.ToString(Inv) ?? "";
    private static string I(int? v) => v?.ToString(Inv) ?? "";
    private static string B(bool? v) => v is { } b ? (b ? "true" : "false") : "";
}
