using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Threading.Channels;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// Saves completed laps on a background task, so slow disk writes never hold up the
/// 60 Hz telemetry handler. Each iRacing session gets its own folder with one CSV per lap
/// and a session.json manifest describing them.
/// </summary>
internal sealed class LapWriter : IAsyncDisposable
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    // Same names and units as iRacing (and Garage 61's exports): Speed in m/s, pedals 0..1, LapDistPct 0..1.
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

    private readonly Channel<CompletedLap> _queue = Channel.CreateUnbounded<CompletedLap>(new UnboundedChannelOptions { SingleReader = true });
    private readonly string _root;
    private readonly Action<string> _log;
    private readonly Task _worker;

    // Only touched by the worker task.
    private SessionContext? _folderSession;
    private string? _folder;
    private readonly List<ManifestLap> _manifestLaps = [];

    public LapWriter(string root, Action<string> log)
    {
        _root = root;
        _log = log;
        _worker = Task.Run(RunAsync);
    }

    public void Enqueue(CompletedLap lap) => _queue.Writer.TryWrite(lap);

    /// <summary>Finishes writing any queued laps.</summary>
    public async ValueTask DisposeAsync()
    {
        _queue.Writer.TryComplete();
        await _worker;
    }

    private async Task RunAsync()
    {
        await foreach (var lap in _queue.Reader.ReadAllAsync())
        {
            try
            {
                Save(lap);
            }
            catch (Exception e)
            {
                _log($"Could not save lap {lap.LapNumber}: {e.Message}");
            }
        }
    }

    private void Save(CompletedLap lap)
    {
        var session = lap.Session ?? new SessionContext("Unknown Track", "Unknown Car", "Unknown Driver", 0, 0, new Dictionary<int, string>());
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

        _manifestLaps.Add(new ManifestLap(
            Path.GetFileName(path),
            lap.LapNumber,
            lap.SessionNum,
            session.SessionTypes.GetValueOrDefault(lap.SessionNum, "Unknown"),
            Math.Round(lap.LapTimeSeconds, 3),
            lap.Samples.Count,
            lap.MissingSamples,
            lap.Incidents,
            lap.OnPitRoad,
            lap.OffTrack,
            DateTimeOffset.Now));
        WriteManifest(folder, session);

        var notes = new List<string>();
        if (lap.OnPitRoad) notes.Add("pit road");
        if (lap.OffTrack) notes.Add("off track");
        if (lap.Incidents > 0) notes.Add($"{lap.Incidents}x incidents");
        if (lap.MissingSamples > 0) notes.Add($"{lap.MissingSamples} missing samples");
        var suffix = notes.Count > 0 ? $" [{string.Join(", ", notes)}]" : "";
        var t = TimeSpan.FromMilliseconds(Math.Round(lap.LapTimeSeconds * 1000));
        _log($"Lap {lap.LapNumber} saved: {(int)t.TotalMinutes}:{t.Seconds:00}.{t.Milliseconds:000} ({lap.Samples.Count:N0} samples){suffix}");
    }

    // One folder per iRacing session (track, car and session IDs); a new one when any of them changes.
    private string FolderFor(SessionContext session)
    {
        if (_folder is not null && _folderSession is { } s
            && s.Track == session.Track && s.Car == session.Car
            && s.SessionId == session.SessionId && s.SubSessionId == session.SubSessionId)
        {
            _folderSession = session; // keep the newest details (session types fill in over time)
            return _folder;
        }

        _folderSession = session;
        _folder = Path.Combine(_root, SafeFileName($"{DateTime.Now:yyyy-MM-dd HH-mm-ss} {session.Track} - {session.Car}"));
        Directory.CreateDirectory(_folder);
        _manifestLaps.Clear();
        _log($"Saving laps to {_folder}");
        return _folder;
    }

    private void WriteManifest(string folder, SessionContext session)
    {
        var manifest = new Manifest(1, session.Track, session.Car, session.Driver, session.SessionId, session.SubSessionId, _manifestLaps);
        var path = Path.Combine(folder, "session.json");
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(manifest, JsonOptions));
        File.Move(path + ".tmp", path, overwrite: true);
    }

    private static string UniquePath(string folder, string name)
    {
        var path = Path.Combine(folder, name + ".csv");
        for (var n = 2; File.Exists(path); n++)
            path = Path.Combine(folder, $"{name}{n}.csv");
        return path;
    }

    // "01.50.486", the lap time format in Garage 61 file names.
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

    private sealed record Manifest(int Version, string Track, string Car, string Driver, int SessionId, int SubSessionId, List<ManifestLap> Laps);

    private sealed record ManifestLap(
        string File,
        int LapNumber,
        int SessionNum,
        string SessionType,
        double LapTimeSeconds,
        int Samples,
        int MissingSamples,
        int Incidents,
        bool PitRoad,
        bool OffTrack,
        DateTimeOffset RecordedAt);
}
