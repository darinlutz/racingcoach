using System.Diagnostics;
using Microsoft.Extensions.Logging;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

// The SDK's source generator builds the TelemetryData struct from this list.
// Phase 1, step 1 only needs SessionTime to prove samples are arriving.
[RequiredTelemetryVars([TelemetryVar.SessionTime])]
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

        Console.WriteLine(ibtOptions is null
            ? "Waiting for iRacing... (Ctrl+C to quit)"
            : $"Playing back {args[0]}... (Ctrl+C to quit)");

        var status = new ConnectionStatus();

        var handlers = new TelemetryHandlers<TelemetryData>
        {
            OnConnectStateChanged = state =>
            {
                status.EndLine();
                Console.WriteLine(state == ConnectState.Connected
                    ? "Connected to iRacing."
                    : "Disconnected from iRacing. Waiting for iRacing...");
                return Task.CompletedTask;
            },
            OnSessionInfoUpdate = session =>
            {
                var track = session.WeekendInfo?.TrackDisplayName ?? "unknown track";
                var driverIdx = session.DriverInfo?.DriverCarIdx;
                var car = session.DriverInfo?.Drivers?.FirstOrDefault(d => d.CarIdx == driverIdx)?.CarScreenName ?? "unknown car";
                status.EndLine();
                Console.WriteLine($"Session: {track} / {car}");
                return Task.CompletedTask;
            },
            OnTelemetryUpdate = data =>
            {
                status.OnSample(data.SessionTime);
                return Task.CompletedTask;
            },
            OnError = error =>
            {
                status.EndLine();
                Console.Error.WriteLine($"SDK error: {error.Message}");
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

        status.EndLine();
        Console.WriteLine("Stopped.");
        return 0;
    }
}

/// <summary>
/// Prints a single self-overwriting status line once per second, so 60 Hz samples
/// don't flood the terminal.
/// </summary>
internal sealed class ConnectionStatus
{
    private readonly Stopwatch _window = Stopwatch.StartNew();
    private int _samples;
    private bool _lineOpen;

    public void OnSample(double? sessionTime)
    {
        _samples++;
        if (_window.ElapsedMilliseconds < 1000)
            return;

        var rate = _samples * 1000.0 / _window.ElapsedMilliseconds;
        var time = sessionTime?.ToString("F2") ?? "n/a";
        Console.Write($"\rReceiving telemetry: {rate,5:F1} samples/s | Session time: {time} s   ");
        _lineOpen = true;

        _samples = 0;
        _window.Restart();
    }

    public void EndLine()
    {
        if (!_lineOpen)
            return;
        Console.WriteLine();
        _lineOpen = false;
    }
}
