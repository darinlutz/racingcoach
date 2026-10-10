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
    public static async Task<int> Main(string[] args)
    {
        // Optional: pass a recorded .ibt file to play it back instead of reading live iRacing,
        // and a speed multiplier (default 1 = real time, 60 samples/s).
        IBTOptions? ibtOptions = args.Length > 0
            ? new IBTOptions(args[0], args.Length > 1 ? int.Parse(args[1]) : 1)
            : null;
        // Playback waits for each handler call instead of dropping samples when it runs faster than we keep up.
        var clientOptions = ibtOptions is null ? new ClientOptions() : new ClientOptions { DeliveryMode = TelemetryDeliveryMode.Synchronous };

        var lapsFolder = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RacingCoach", "Laps");

        using var loggerFactory = LoggerFactory.Create(b => b.AddConsole().SetMinimumLevel(LogLevel.Warning));
        var logger = loggerFactory.CreateLogger("RacingCoach.Collector");

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true; // let Monitor() finish instead of killing the process
            cts.Cancel();
        };

        var display = new TelemetryDisplay();
        await using var writer = new LapWriter(lapsFolder, message => display.WriteMessage(message));
        var recorder = new LapRecorder(writer.Enqueue, message => display.WriteMessage(message));

        await using var client = TelemetryClient<TelemetryData>.Create(logger, ibtOptions, clientOptions);

        display.WriteMessage(ibtOptions is null
            ? "Waiting for iRacing... (Ctrl+C to quit)"
            : $"Playing back {args[0]}... (Ctrl+C to quit)");
        display.WriteMessage($"Completed laps are saved under {lapsFolder}");

        // iRacing re-sends session info every few seconds (flags, driver list, ...);
        // only print it when the track or car changes.
        string? lastSession = null;

        var handlers = new TelemetryHandlers<TelemetryData>
        {
            OnConnectStateChanged = state =>
            {
                display.ResetRate();
                if (state == ConnectState.Connected)
                {
                    display.WriteMessage("Connected to iRacing.");
                }
                else
                {
                    lastSession = null;
                    display.WriteMessage("Disconnected from iRacing. Waiting for iRacing...");
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
            await writer.DisposeAsync(); // finish saving laps already completed
            display.Close();
        }

        Console.WriteLine("Stopped.");
        return 0;
    }
}
