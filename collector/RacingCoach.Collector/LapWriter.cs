using System.Globalization;
using System.Text;
using System.Threading.Channels;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>A session folder's laps (copies), reported whenever its session.json changes.</summary>
internal sealed record SessionLaps(string Folder, string Track, string Car, IReadOnlyList<ManifestLap> Laps, bool NewLap);

/// <summary>
/// Saves completed laps on a background task, so slow disk writes never hold up the
/// 60 Hz telemetry handler. Each iRacing session gets its own folder with one CSV per lap
/// and a session.json manifest describing them. With an uploader, each saved lap is then queued
/// for upload, and laps from earlier runs that never uploaded are queued when it starts.
/// With an IbtEnricher, live laps get their track positions from iRacing's .ibt file after the session
/// and are uploaded again. Every change to a session.json is reported through LapsChanged, which the
/// window's lap list shows.
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
        // The car's velocity, forward and to the left (m/s): the Rotation Model's sideslip on the website
        ("VelocityX", d => F(d.VelocityX)),
        ("VelocityY", d => F(d.VelocityY)),
        ("Lap", d => I(d.Lap)),
        ("LapDist", d => F(d.LapDist)),
        ("SessionTime", d => d.SessionTime?.ToString(Inv) ?? ""),
        ("SessionTick", d => I(d.SessionTick)),
        // Empty in live laps until IbtEnricher fills them in from the session's .ibt file
        ("Lat", d => D(d.Lat)),
        ("Lon", d => D(d.Lon)),
        ("Alt", d => D(d.Alt)),
    ];

    // How often, and how many times, to look again for an .ibt file iRacing hasn't finished writing
    private static readonly TimeSpan IbtRetryDelay = TimeSpan.FromSeconds(10);
    private const int IbtMaxAttempts = 12;

    // Everything the worker task does, in order: save a lap, or record how an upload went
    private abstract record Job;
    private sealed record SaveLap(CompletedLap Lap) : Job;
    private sealed record RecordUpload(string Folder, Guid ClientLapId, bool HadPosition, string? Error) : Job;
    // AfterStint: a stint just ended, so its laps should find their .ibt file (logged if they don't)
    private sealed record AddPositions(int Attempt, bool AfterStint) : Job;
    private sealed record UseUploader(LapUploader? Uploader) : Job;
    private sealed record Flush(TaskCompletionSource Done) : Job;

    private readonly Channel<Job> _queue = Channel.CreateUnbounded<Job>(new UnboundedChannelOptions { SingleReader = true });
    private readonly string _root;
    private readonly Action<string> _log;
    private readonly IbtEnricher? _enricher;
    private Task? _worker;

    // Only touched by the worker task.
    private SessionContext? _folderSession;
    private string? _folder;
    private LapUploader? _uploader;

    /// <summary>enricher is null when laps shouldn't get track positions from .ibt files (e.g. playback).</summary>
    public LapWriter(string root, IbtEnricher? enricher, Action<string> log)
    {
        _root = root;
        _enricher = enricher;
        _log = log;
    }

    /// <summary>Called on the writer's task with a copy of a session folder's laps whenever its session.json
    /// changes. NewLap is true when a lap was just saved there. Set before Start.</summary>
    public Action<SessionLaps>? LapsChanged { get; init; }

    public void Start() => _worker = Task.Run(RunAsync);

    /// <summary>Uploads laps from now on (null: stop uploading), starting with earlier laps that haven't
    /// uploaded. Laps are only saved on this PC until an uploader is set.</summary>
    public void SetUploader(LapUploader? uploader) => _queue.Writer.TryWrite(new UseUploader(uploader));

    public void Enqueue(CompletedLap lap) => _queue.Writer.TryWrite(new SaveLap(lap));

    /// <summary>Records an upload result in the lap's session.json (error null = uploaded). A result that
    /// arrives after DisposeAsync is lost, which is harmless: the lap is uploaded again next run and
    /// RacingCoach.app recognises it as a duplicate.</summary>
    public void RecordUploadResult(UploadItem item, string? error) =>
        _queue.Writer.TryWrite(new RecordUpload(item.Folder, item.Lap.ClientLapId!.Value, item.Lap.HasPosition, error));

    /// <summary>Adds track positions to laps whose .ibt file iRacing has finished, e.g. after leaving the car.</summary>
    public void AddPositionsFromIbt()
    {
        if (_enricher is not null)
            _queue.Writer.TryWrite(new AddPositions(1, AfterStint: true));
    }

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
        // The window shows the most recent session's laps until a new lap is saved
        try
        {
            var latest = Directory.Exists(_root)
                ? Directory.GetDirectories(_root).OrderDescending(StringComparer.Ordinal).FirstOrDefault(f => File.Exists(Path.Combine(f, "session.json")))
                : null;
            if (latest is not null && SessionManifest.Load(latest) is { } manifest)
                Report(latest, manifest, newLap: false);
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or System.Text.Json.JsonException)
        {
            _log($"Could not read the last session's laps: {e.Message}");
        }

        // Sessions driven since the last run
        if (_enricher is not null)
            _queue.Writer.TryWrite(new AddPositions(1, AfterStint: false));

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
                    case AddPositions add:
                        AddPositionsFromIbt(add);
                        break;
                    case UseUploader use:
                        _uploader = use.Uploader;
                        if (_uploader is not null)
                            QueueEarlierLaps();
                        break;
                    case Flush flush:
                        flush.Done.SetResult();
                        break;
                }
            }
            catch (Exception e)
            {
                _log(job switch
                {
                    SaveLap s => $"Could not save lap {s.Lap.LapNumber}: {e.Message}",
                    AddPositions => $"Could not add track positions from .ibt files: {e.Message}",
                    UseUploader => $"Could not check earlier laps for uploading: {e.Message}",
                    _ => $"Could not record an upload in session.json: {e.Message}",
                });
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
            // Only played-back .ibt files have them already
            HasPosition = lap.Samples.All(s => s.Lat is { } lat && s.Lon is { } lon && (lat != 0 || lon != 0)),
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
        Report(folder, manifest, newLap: true);

        var notes = new List<string>();
        if (lap.OnPitRoad) notes.Add("pit road");
        if (lap.OffTrack) notes.Add("off track");
        if (lap.Incidents > 0) notes.Add($"{lap.Incidents}x incidents");
        if (lap.MissingSamples > 0) notes.Add($"{lap.MissingSamples} missing samples");
        var suffix = notes.Count > 0 ? $" [{string.Join(", ", notes)}]" : "";
        var t = TimeSpan.FromMilliseconds(Math.Round(lap.LapTimeSeconds * 1000));
        _log($"Lap {lap.LapNumber} saved: {(int)t.TotalMinutes}:{t.Seconds:00}.{t.Milliseconds:000} ({lap.Samples.Count:N0} samples){suffix}");

        if (entry.UploadError is null)
            _uploader?.Enqueue(new UploadItem(folder, InfoOf(manifest), entry, Earlier: false));
    }

    private void Report(string folder, SessionManifest manifest, bool newLap) =>
        LapsChanged?.Invoke(new SessionLaps(folder, manifest.Track, manifest.Car, manifest.Laps.Select(l => l.Copy()).ToList(), newLap));

    private void RecordUploadResult(RecordUpload result)
    {
        var manifest = SessionManifest.Load(result.Folder);
        var lap = manifest?.Laps.FirstOrDefault(l => l.ClientLapId == result.ClientLapId);
        if (manifest is null || lap is null)
            return;
        // Sent before the lap got track positions; the copy with them is queued and records its own result
        if (lap.HasPosition && !result.HadPosition)
            return;
        lap.Uploaded = result.Error is null;
        lap.UploadError = result.Error;
        manifest.Save(result.Folder);
        Report(result.Folder, manifest, newLap: false);
    }

    private void AddPositionsFromIbt(AddPositions add)
    {
        var (enriched, changed, stillWriting, waiting) = _enricher!.Run(_root);
        // Upload them again (replacing the copies without positions), unless they never could be
        var toUpload = enriched.Where(e => e.Lap.UploadError != UnknownTrackError).ToList();
        foreach (var (_, _, lap) in toUpload)
            lap.Uploaded = false;
        foreach (var (folder, manifest) in toUpload.Select(e => (e.Folder, e.Manifest)).Distinct())
            manifest.Save(folder);
        foreach (var (folder, manifest, lap) in toUpload)
            _uploader?.Enqueue(new UploadItem(folder, InfoOf(manifest), lap, Earlier: false, WithPositions: true));
        // Including laps the .ibt didn't fully cover, so the window stops showing them as waiting
        foreach (var (folder, manifest) in changed)
            Report(folder, manifest, newLap: false);

        // iRacing can take a moment to close the file after the car leaves the track
        if (stillWriting && add.Attempt < IbtMaxAttempts)
            _ = Task.Delay(IbtRetryDelay).ContinueWith(_ => _queue.Writer.TryWrite(add with { Attempt = add.Attempt + 1 }), TaskScheduler.Default);
        else if (stillWriting && add.AfterStint)
            _log($"{waiting} lap(s) still waiting for track positions: iRacing's .ibt file is still open. Trying again after your next stint, or when the collector restarts.");
        else if (waiting > 0 && add.AfterStint)
            _log($"{waiting} lap(s) still waiting for track positions: no finished .ibt file in {_enricher.IbtFolder} covers them.");
    }

    // Laps from earlier runs that haven't been uploaded, oldest first. Laps RacingCoach.app refused are
    // tried again too, in case the refusal was a problem since fixed on either side; laps without a
    // known track never are. Laps saved before uploads existed get their upload ID here.
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
            var pending = manifest.Laps.Where(l => !l.Uploaded && l.UploadError != UnknownTrackError).ToList();
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
                _uploader!.Enqueue(new UploadItem(folder, info, lap, Earlier: true));
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
    private static string D(double? v) => v?.ToString(Inv) ?? "";
    private static string I(int? v) => v?.ToString(Inv) ?? "";
    private static string B(bool? v) => v is { } b ? (b ? "true" : "false") : "";
}
