using Microsoft.Extensions.Logging;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

// The SDK's source generator builds the TelemetryData struct from this list.
[RequiredTelemetryVars([
    // shown live and saved to the lap CSVs
    TelemetryVar.Speed,
    TelemetryVar.Throttle,
    TelemetryVar.Brake,
    TelemetryVar.Gear,
    TelemetryVar.RPM,
    TelemetryVar.LapDistPct,
    TelemetryVar.Lap,
    TelemetryVar.SessionTime,
    // saved to the lap CSVs
    TelemetryVar.Clutch,
    TelemetryVar.SteeringWheelAngle,
    TelemetryVar.BrakeABSactive,
    TelemetryVar.LatAccel,
    TelemetryVar.LongAccel,
    TelemetryVar.VertAccel,
    TelemetryVar.Yaw,
    TelemetryVar.YawRate,
    TelemetryVar.LapDist,
    TelemetryVar.SessionTick,
    // Track position: only in .ibt files, so live laps get these afterwards from the session's .ibt (IbtEnricher)
    TelemetryVar.Lat,
    TelemetryVar.Lon,
    TelemetryVar.Alt,
    // used to turn on iRacing's .ibt recording and notice when a file is finished
    TelemetryVar.IsDiskLoggingEnabled,
    TelemetryVar.IsDiskLoggingActive,
    // used to decide whether a lap is complete and clean
    TelemetryVar.SessionNum,
    TelemetryVar.IsOnTrack,
    TelemetryVar.IsReplayPlaying,
    TelemetryVar.OnPitRoad,
    TelemetryVar.PlayerTrackSurface,
    TelemetryVar.PlayerCarMyIncidentCount,
])]
public class Program
{
    private const string Usage = """
        Usage: RacingCoach.Collector.exe [options]
               RacingCoach.Collector.exe <file.ibt> [speed] [options]

          <file.ibt> [speed]  Play back a recorded iRacing telemetry file instead of reading live
                              iRacing (speed: 1 = real time, the default)
          --set-key           Enter a new upload key from your RacingCoach.app Account page
          --no-upload         Only save laps on this PC this time
          --upload            Also upload laps when playing back a file (off by default)
          --site <url>        Upload to another RacingCoach.app address this time (for testing)
          --no-positions      Don't turn on iRacing's .ibt recording or add track positions (Lat/Lon)
                              from .ibt files to live laps this time
        """;

    public static async Task<int> Main(string[] args)
    {
        if (!TryParseArgs(args, out var options))
        {
            Console.Error.WriteLine(Usage);
            return 1;
        }

        // Optional: a recorded .ibt file to play back instead of reading live iRacing, and a speed multiplier.
        IBTOptions? ibtOptions = options.IbtFile is null ? null : new IBTOptions(options.IbtFile, options.Speed);
        // Playback waits for each handler call instead of dropping samples when it runs faster than we keep up.
        var clientOptions = ibtOptions is null ? new ClientOptions() : new ClientOptions { DeliveryMode = TelemetryDeliveryMode.Synchronous };

        var documents = Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments);
        var lapsFolder = Path.Combine(documents, "RacingCoach", "Laps");

        // Played-back files are usually someone else's laps, so they only upload when asked to
        var wantUploads = !options.NoUpload && (ibtOptions is null || options.Upload);
        using var api = wantUploads ? await UploadSetup.ConnectAsync(options.SiteUrl, options.SetKey) : null;

        using var loggerFactory = LoggerFactory.Create(b => b.AddConsole().SetMinimumLevel(LogLevel.Warning));
        var logger = loggerFactory.CreateLogger("RacingCoach.Collector");

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true; // let Monitor() finish instead of killing the process
            cts.Cancel();
        };

        var display = new TelemetryDisplay();
        // Live telemetry has no track positions; iRacing only writes them to its .ibt files, so live laps get them
        // from there after each stint. Played-back laps have them already.
        var enricher = ibtOptions is null && !options.NoPositions
            ? new IbtEnricher(Path.Combine(documents, "iRacing", "telemetry"), message => display.WriteMessage(message))
            : null;
        var writer = new LapWriter(lapsFolder, enricher, message => display.WriteMessage(message));
        var uploader = api is null ? null : new LapUploader(api, writer.RecordUploadResult, message => display.WriteMessage(message));
        writer.Uploader = uploader;
        writer.Start();
        var recorder = new LapRecorder(writer.Enqueue, message => display.WriteMessage(message));

        await using var client = TelemetryClient<TelemetryData>.Create(logger, ibtOptions, clientOptions);

        display.WriteMessage(ibtOptions is null
            ? "Waiting for iRacing... (Ctrl+C to quit)"
            : $"Playing back {options.IbtFile}... (Ctrl+C to quit)");
        display.WriteMessage($"Completed laps are saved under {lapsFolder}");
        if (!wantUploads)
            display.WriteMessage("Uploading is off for this run.");
        if (enricher is not null)
            display.WriteMessage($"Track positions are added after each stint from iRacing's .ibt files in {enricher.IbtFolder}");

        // iRacing re-sends session info every few seconds (flags, driver list, ...);
        // only print it when the track or car changes.
        string? lastSession = null;
        // .ibt recording: asked for once per connection (so turning it off with Alt+L sticks), and
        // a finished recording is the cue to add track positions to the stint's laps
        var askedForIbt = false;
        var wasRecordingIbt = false;

        var handlers = new TelemetryHandlers<TelemetryData>
        {
            OnConnectStateChanged = state =>
            {
                display.ResetRate();
                askedForIbt = false;
                if (state == ConnectState.Connected)
                {
                    display.WriteMessage("Connected to iRacing.");
                }
                else
                {
                    lastSession = null;
                    wasRecordingIbt = false;
                    display.WriteMessage("Disconnected from iRacing. Waiting for iRacing...");
                    writer.AddPositionsFromIbt(); // iRacing closed its .ibt file
                }
                return Task.CompletedTask;
            },
            OnSessionInfoUpdate = session =>
            {
                var weekend = session.WeekendInfo;
                var track = weekend?.TrackDisplayName ?? "Unknown Track";
                if (!string.IsNullOrWhiteSpace(weekend?.TrackConfigName))
                    track += $" ({weekend.TrackConfigName})";
                var driverIdx = session.DriverInfo?.DriverCarIdx;
                var driver = session.DriverInfo?.Drivers?.FirstOrDefault(d => d.CarIdx == driverIdx);
                var car = driver?.CarScreenName ?? "Unknown Car";

                recorder.Session = new SessionContext(
                    track,
                    car,
                    driver?.UserName ?? "Unknown Driver",
                    weekend?.SessionID ?? 0,
                    weekend?.SubSessionID ?? 0,
                    session.SessionInfo?.Sessions?.ToDictionary(s => s.SessionNum, s => s.SessionType) ?? []);

                var current = $"{track} / {car}";
                if (current != lastSession)
                {
                    lastSession = current;
                    display.WriteMessage($"Session: {current}");
                }
                return Task.CompletedTask;
            },
            OnTelemetryUpdate = data =>
            {
                recorder.OnSample(data);
                display.OnSample(data, recorder.Status);

                if (enricher is not null)
                {
                    // iRacing only records while the driver is in the car
                    if (!askedForIbt && data.IsOnTrack == true && data.IsDiskLoggingEnabled == false)
                    {
                        askedForIbt = true;
                        client.SimControl.TelemetryRecording.Start();
                        display.WriteMessage("Turned on iRacing's telemetry recording (.ibt) for track positions.");
                    }
                    var recordingIbt = data.IsDiskLoggingActive == true;
                    if (wasRecordingIbt && !recordingIbt)
                        writer.AddPositionsFromIbt(); // left the car: the stint's .ibt file is done
                    wasRecordingIbt = recordingIbt;
                }
                return Task.CompletedTask;
            },
            OnError = error =>
            {
                display.WriteMessage($"SDK error: {error.Message}", isError: true);
                return Task.CompletedTask;
            },
        };

        try
        {
            await client.Monitor(handlers, cts.Token);
        }
        catch (OperationCanceledException) when (cts.IsCancellationRequested)
        {
            // Ctrl+C
        }
        finally
        {
            await writer.FlushAsync(); // finish saving laps already completed (which queues their uploads)
            if (uploader is not null)
                await uploader.DisposeAsync(); // give queued uploads a few seconds; the rest go next run
            await writer.DisposeAsync(); // record the last upload results in session.json
            display.Close();
        }

        Console.WriteLine("Stopped.");
        return 0;
    }

    private sealed record Options(string? IbtFile, int Speed, bool SetKey, bool NoUpload, bool Upload, string? SiteUrl, bool NoPositions);

    private static bool TryParseArgs(string[] args, out Options options)
    {
        options = new Options(null, 1, false, false, false, null, false);
        var positional = new List<string>();
        for (var i = 0; i < args.Length; i++)
        {
            switch (args[i])
            {
                case "--set-key": options = options with { SetKey = true }; break;
                case "--no-upload": options = options with { NoUpload = true }; break;
                case "--upload": options = options with { Upload = true }; break;
                case "--no-positions": options = options with { NoPositions = true }; break;
                case "--site" when i + 1 < args.Length && Uri.TryCreate(args[i + 1], UriKind.Absolute, out _):
                    options = options with { SiteUrl = args[++i] };
                    break;
                case var arg when arg.StartsWith("--", StringComparison.Ordinal): return false;
                default: positional.Add(args[i]); break;
            }
        }

        if (positional.Count > 2)
            return false;
        var speed = 1;
        if (positional.Count == 2 && (!int.TryParse(positional[1], out speed) || speed < 1))
            return false;
        options = options with { IbtFile = positional.ElementAtOrDefault(0), Speed = speed };
        return true;
    }
}
