using System.IO.Compression;
using System.Net;
using System.Text;
using System.Text.Json.Nodes;
using System.Text.RegularExpressions;
using SVappsLAB.iRacingTelemetrySDK;
using static RacingCoach.Collector.Tests.SyntheticTelemetry;

namespace RacingCoach.Collector.Tests;

/// <summary>
/// What the iRacing collector does, pinned to the behavior at commit 64815d5 (see Golden): how the telemetry stream is
/// split into laps, the lap CSVs byte for byte, session.json, what's uploaded, and the whole engine from an .ibt file
/// through the real SDK. None of this needs iRacing; docs/multi-simulator.md lists what only iRacing itself can show.
/// </summary>
public sealed class IRacingRegressionTests
{
    private const int Lap = (int)(LapSeconds * Hz);

    private static (List<object> Laps, List<string> Discarded) Record(IEnumerable<TelemetryData> samples)
    {
        var laps = new List<object>();
        var discarded = new List<string>();
        var recorder = new LapRecorder(
            lap => laps.Add(new
            {
                lap.LapNumber,
                lap.SessionNum,
                LapTimeSeconds = Math.Round(lap.LapTimeSeconds, 6),
                Samples = lap.Samples.Count,
                lap.MissingSamples,
                lap.Incidents,
                lap.OnPitRoad,
                lap.OffTrack,
            }),
            discarded.Add);
        foreach (var sample in samples)
            recorder.OnSample(sample);
        return (laps, discarded);
    }

    private static IEnumerable<TelemetryData> Ticks(int from, int to) => Enumerable.Range(from, to - from).Select(t => Sample(t));

    // What each scenario does to the stream of samples, all starting 30 ticks before the line
    public static readonly Dictionary<string, Func<IEnumerable<TelemetryData>>> Scenarios = new()
    {
        ["clean"] = () => Ticks(0, 3 * Lap + 100),
        ["missing samples"] = () => Ticks(0, 3 * Lap).Where(s => s.SessionTick is not (500 or 501 or 502)),
        ["telemetry paused"] = () => Ticks(0, 3 * Lap).Where(s => s.SessionTick is not >= 700 or >= 740),
        ["time goes backwards"] = () => Ticks(0, 800).Concat(Ticks(700, 3 * Lap)),
        ["reset or tow"] = () => Ticks(0, 3 * Lap).Select(s => s.SessionTick == 800 ? s with { LapDistPct = s.LapDistPct + 0.3f } : s),
        ["backward over the line"] = () => Ticks(0, Lap + 50).Concat(Ticks(Lap + 50, 3 * Lap).Select(s => s.SessionTick == Lap + 60 ? s with { LapDistPct = 0.95f } : s)),
        ["rocking over the line"] = () => Ticks(0, 40).Select(s => s with { LapDistPct = s.SessionTick % 2 == 0 ? 0.95f : 0.05f }).Concat(Ticks(40, 3 * Lap)),
        ["session changes"] = () => Ticks(0, 900).Concat(Enumerable.Range(900, 3 * Lap).Select(t => Sample(t, sessionNum: 1))),
        ["replay"] = () => Ticks(0, 3 * Lap).Select(s => s.SessionTick is >= 700 and < 800 ? s with { IsReplayPlaying = true } : s),
        ["left the car"] = () => Ticks(0, 3 * Lap).Select(s => s.SessionTick is >= 700 and < 800 ? s with { IsOnTrack = false } : s),
        ["pit road"] = () => Ticks(0, 3 * Lap).Select(s => s.SessionTick is >= 700 and < 800 ? s with { OnPitRoad = true } : s),
        // A one-sample off-track reading with no incident (a curb) isn't an off track lap
        ["off track"] = () => Ticks(0, 3 * Lap).Select(s => s.SessionTick == 750 ? s with { PlayerTrackSurface = TrackLocation.OffTrack } : s),
        ["off track with an incident"] = () => Ticks(0, 3 * Lap).Select(s => s with
        {
            PlayerTrackSurface = s.SessionTick is >= 750 and < 790 ? TrackLocation.OffTrack : TrackLocation.OnTrack,
            PlayerCarMyIncidentCount = s.SessionTick >= 760 ? 1 : 0,
        }),
        ["incidents"] = () => Ticks(0, 3 * Lap).Select(s => s with { PlayerCarMyIncidentCount = s.SessionTick >= 750 ? 4 : 0 }),
        ["no lap position"] = () => Ticks(0, 3 * Lap).Select(s => s.SessionTick is >= 700 and < 710 ? s with { LapDistPct = null } : s),
        ["negative lap position"] = () => Ticks(0, 3 * Lap).Select(s => s.SessionTick is >= 700 and < 710 ? s with { LapDistPct = -1 } : s),
    };

    [Fact]
    public void Lap_detection_matches_the_baseline_in_every_scenario()
    {
        var results = Scenarios.ToDictionary(s => s.Key, s =>
        {
            var (laps, discarded) = Record(s.Value());
            return new { laps, discarded };
        });
        Golden.Check("lap-detection", results);
    }

    private static readonly SessionContext Session = new(
        "Lime Rock Park (Grand Prix)", "Test Car GT3", "Test Driver", 111, 222,
        new Dictionary<int, string> { [0] = "Practice" },
        0.75,
        new Dictionary<int, string> { [0] = "moderate usage" });

    private static async Task<string> SaveLapsAsync(string root, IEnumerable<TelemetryData> samples)
    {
        var log = new List<string>();
        var writer = new LapWriter(root, null, log.Add) { PlaybackStartedAt = DateTimeOffset.FromUnixTimeSeconds(IbtStartUnixSeconds) };
        writer.Start();
        var recorder = new LapRecorder(writer.Enqueue, _ => { }) { Session = Session };
        foreach (var sample in samples)
            recorder.OnSample(sample);
        await writer.FlushAsync();
        await writer.DisposeAsync();
        Assert.True(Directory.GetDirectories(root).Length == 1, string.Join(" | ", log));
        return Directory.GetDirectories(root).Single();
    }

    // session.json without what's different on every run
    private static JsonObject Manifest(string folder)
    {
        var manifest = JsonNode.Parse(File.ReadAllText(Path.Combine(folder, "session.json")))!.AsObject();
        foreach (var lap in manifest["laps"]!.AsArray())
            lap!.AsObject()["clientLapId"] = "(random)";
        return manifest;
    }

    [Fact]
    public async Task Lap_csvs_and_session_json_match_the_baseline()
    {
        using var temp = new TempFolder();
        var folder = await SaveLapsAsync(temp.Path, Ticks(0, 3 * Lap + 100));

        var files = Directory.GetFiles(folder, "*.csv").OrderBy(f => f, StringComparer.Ordinal).ToList();
        Golden.Check("lap-csvs", new
        {
            Folder = Regex.Replace(Path.GetFileName(folder), @"^\d{4}-\d\d-\d\d \d\d-\d\d-\d\d", "(date)"),
            Header = File.ReadLines(files[0]).First(),
            FirstRow = File.ReadLines(files[0]).Skip(1).First(),
            Files = files.Select(f => new { Name = Path.GetFileName(f), Sha256 = Golden.Sha256(f), Rows = File.ReadLines(f).Count() - 1 }),
        });
        Golden.CheckPreserved("session-json", Manifest(folder), ["simulator"]);
    }

    [Fact]
    public async Task A_lap_upload_matches_the_baseline()
    {
        using var temp = new TempFolder();
        var folder = await SaveLapsAsync(temp.Path, Ticks(0, 2 * Lap));
        var manifest = SessionManifest.Load(folder)!;
        var lap = manifest.Laps[0];
        TrackKeys.Set(manifest.Track, "limerock full", "2.42 km", "41.928 m", "-73.381 m");

        await using var site = await FakeSite.StartAsync();
        using var api = new RacingCoachApi(site.Url, "test-key");
        var (outcome, _) = await api.UploadLapAsync(Path.Combine(folder, lap.File), new SessionInfo(manifest.Track, manifest.Car, manifest.Driver, manifest.SessionId, manifest.SubSessionId), lap, CancellationToken.None);

        Assert.Equal(UploadOutcome.Uploaded, outcome);
        var upload = Assert.Single(site.Uploads);
        Assert.Equal("Bearer test-key", upload.Authorization);
        Assert.Equal(Golden.Sha256(Path.Combine(folder, lap.File)), Golden.Sha256(upload.Csv));
        var details = JsonNode.Parse(upload.LapJson)!.AsObject();
        details["clientLapId"] = "(random)";
        Golden.CheckPreserved("upload-details", details, ["simulator", "payloadVersion", "adapterVersion", "carKey"]);
    }

    [Theory]
    [InlineData(201, "Uploaded")]
    [InlineData(200, "Uploaded")]
    [InlineData(400, "Rejected")]
    [InlineData(413, "Rejected")]
    [InlineData(422, "Rejected")]
    [InlineData(401, "Unauthorized")]
    [InlineData(500, "RetryLater")]
    [InlineData(503, "RetryLater")]
    public async Task Upload_answers_mean_what_they_did(int status, string expected)
    {
        using var temp = new TempFolder();
        var folder = await SaveLapsAsync(temp.Path, Ticks(0, 2 * Lap));
        var manifest = SessionManifest.Load(folder)!;
        await using var site = await FakeSite.StartAsync(status);
        using var api = new RacingCoachApi(site.Url, "test-key");
        var (outcome, _) = await api.UploadLapAsync(Path.Combine(folder, manifest.Laps[0].File), new SessionInfo(manifest.Track, manifest.Car, manifest.Driver, 1, 2), manifest.Laps[0], CancellationToken.None);
        Assert.Equal(expected, outcome.ToString());
    }

    [Fact]
    public async Task An_old_session_json_still_loads()
    {
        using var temp = new TempFolder();
        File.WriteAllText(Path.Combine(temp.Path, "session.json"), """
            { "version": 3, "track": "T", "car": "C", "driver": "D", "sessionId": 1, "subSessionId": 2,
              "laps": [ { "file": "a.csv", "lapNumber": 4, "sessionNum": 0, "sessionType": "Race", "lapTimeSeconds": 90.5,
                          "samples": 5400, "recordedAt": "2026-05-28T10:00:00+00:00", "uploaded": true, "hasPosition": true } ] }
            """);
        var manifest = SessionManifest.Load(temp.Path)!;
        Assert.Equal("T", manifest.Track);
        Assert.True(Assert.Single(manifest.Laps).Uploaded);
        await Task.CompletedTask;
    }

    /// <summary>The whole engine, from an .ibt file through the real SDK, with no window, upload or iRacing.</summary>
    [Fact]
    public async Task The_engine_plays_an_ibt_back_through_the_sdk_as_before()
    {
        using var temp = new TempFolder();
        var ibt = Path.Combine(temp.Path, "test.ibt");
        WriteIbt(ibt, 3 * Lap + 100);

        var documents = Path.Combine(temp.Path, "Documents");
        var log = new List<string>();
        var engine = new CollectorEngine(new CollectorOptions(ibt, 100, false, true, false, null, false), (message, _) => { lock (log) log.Add(message); }, _ => { }, documents);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        await engine.RunAsync(timeout.Token);

        Assert.False(timeout.IsCancellationRequested, "playback never finished");
        Assert.Equal(SimState.PlaybackFinished, engine.State);
        Assert.Equal("Lime Rock Park", engine.Session?.Track);
        var folder = Directory.GetDirectories(engine.LapsFolder).Single();
        var files = Directory.GetFiles(folder, "*.csv").OrderBy(f => f, StringComparer.Ordinal).ToList();
        Golden.Check("engine-playback", new
        {
            Files = files.Select(f => new { Name = Path.GetFileName(f), Sha256 = Golden.Sha256(f) }),
            Log = log.Where(m => m.StartsWith("Session:") || m.StartsWith("Lap ") || m.Contains("Playback finished")).Order(StringComparer.Ordinal).ToList(),
        });
        Golden.CheckPreserved("engine-session-json", Manifest(folder), ["simulator"]);
    }
}

/// <summary>A stand-in for RacingCoach.app's POST /api/collector/laps, on a local port, keeping what it's sent.</summary>
internal sealed class FakeSite : IAsyncDisposable
{
    public sealed record Upload(string? Authorization, string LapJson, byte[] Csv);

    private readonly HttpListener _listener = new();
    private readonly Task _loop;
    private readonly int _status;
    public List<Upload> Uploads { get; } = [];
    public string Url { get; }

    private FakeSite(int status, Func<HttpListenerRequest, int>? statusOf)
    {
        _status = status;
        StatusOf = statusOf;
        var port = FreePort();
        Url = $"http://127.0.0.1:{port}/";
        _listener.Prefixes.Add(Url);
        _listener.Start();
        _loop = Task.Run(LoopAsync);
    }

    public Func<HttpListenerRequest, int>? StatusOf { get; }

    public static Task<FakeSite> StartAsync(int status = 201, Func<HttpListenerRequest, int>? statusOf = null) => Task.FromResult(new FakeSite(status, statusOf));

    private async Task LoopAsync()
    {
        try
        {
            while (true)
            {
                var context = await _listener.GetContextAsync();
                using var body = new MemoryStream();
                await context.Request.InputStream.CopyToAsync(body);
                if (context.Request.Url?.AbsolutePath == "/api/collector/laps")
                    lock (Uploads)
                        Uploads.Add(Parse(context.Request, body.ToArray()));
                context.Response.StatusCode = StatusOf?.Invoke(context.Request) ?? _status;
                await context.Response.OutputStream.WriteAsync(Encoding.UTF8.GetBytes("""{"success":true,"error":"refused"}"""));
                context.Response.Close();
            }
        }
        catch (Exception e) when (e is HttpListenerException or ObjectDisposedException)
        {
            // stopped
        }
    }

    private static Upload Parse(HttpListenerRequest request, byte[] body)
    {
        var boundary = Encoding.ASCII.GetBytes("--" + request.ContentType!.Split("boundary=")[1].Trim('"'));
        string? json = null;
        byte[] csv = [];
        var start = IndexOf(body, boundary, 0);
        while (start >= 0)
        {
            var next = IndexOf(body, boundary, start + boundary.Length);
            if (next < 0)
                break;
            var part = body[(start + boundary.Length)..next];
            var split = IndexOf(part, "\r\n\r\n"u8.ToArray(), 0);
            var headers = Encoding.UTF8.GetString(part[..split]);
            var content = part[(split + 4)..^2]; // less the CRLF before the next boundary
            if (headers.Contains("name=\"lap\""))
                json = Encoding.UTF8.GetString(content);
            else if (headers.Contains("name=\"csv\""))
            {
                using var gzip = new GZipStream(new MemoryStream(content), CompressionMode.Decompress);
                using var plain = new MemoryStream();
                gzip.CopyTo(plain);
                csv = plain.ToArray();
            }
            start = next;
        }
        return new Upload(request.Headers["Authorization"], json!, csv);
    }

    private static int IndexOf(byte[] haystack, byte[] needle, int from)
    {
        var index = haystack.AsSpan(from).IndexOf(needle);
        return index < 0 ? -1 : index + from;
    }

    private static int FreePort()
    {
        var socket = new System.Net.Sockets.TcpListener(IPAddress.Loopback, 0);
        socket.Start();
        var port = ((IPEndPoint)socket.LocalEndpoint).Port;
        socket.Stop();
        return port;
    }

    public async ValueTask DisposeAsync()
    {
        _listener.Close();
        await _loop;
    }
}
