using Microsoft.Extensions.Logging;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

// The SDK's source generator builds the TelemetryData struct from this list.
[RequiredTelemetryVars([
    TelemetryVar.Speed,
    TelemetryVar.Throttle,
    TelemetryVar.Brake,
    TelemetryVar.Gear,
    TelemetryVar.RPM,
    TelemetryVar.LapDistPct,
    TelemetryVar.Lap,
    TelemetryVar.SessionTime,
])]
public class Program
{
    public static async Task<int> Main(string[] args)
    {
        // Optional: pass a recorded .ibt file to play it back instead of reading live iRacing.
        IBTOptions? ibtOptions = args.Length > 0 ? new IBTOptions(args[0], 1) : null;

        using var loggerFactory = LoggerFactory.Create(b => b.AddConsole().SetMinimumLevel(LogLevel.Warning));
        var logger = loggerFactory.CreateLogger("RacingCoach.Collector");

        using var cts = new CancellationTokenSource();
        Console.CancelKeyPress += (_, e) =>
        {
            e.Cancel = true; // let Monitor() finish instead of killing the process
            cts.Cancel();
        };

        await using var client = TelemetryClient<TelemetryData>.Create(logger, ibtOptions);

        var display = new TelemetryDisplay();
        display.WriteMessage(ibtOptions is null
            ? "Waiting for iRacing... (Ctrl+C to quit)"
            : $"Playing back {args[0]}... (Ctrl+C to quit)");

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
                var track = session.WeekendInfo?.TrackDisplayName ?? "unknown track";
                var driverIdx = session.DriverInfo?.DriverCarIdx;
                var car = session.DriverInfo?.Drivers?.FirstOrDefault(d => d.CarIdx == driverIdx)?.CarScreenName ?? "unknown car";
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
                display.OnSample(data);
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
            display.Close();
        }

        Console.WriteLine("Stopped.");
        return 0;
    }
}
