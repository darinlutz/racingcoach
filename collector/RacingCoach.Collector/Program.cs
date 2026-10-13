using System.Windows;
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
    TelemetryVar.SteeringWheelAngle,
    // saved to the lap CSVs
    TelemetryVar.Clutch,
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
    // only shown in the window
    TelemetryVar.FuelLevel,
    TelemetryVar.FuelLevelPct,
    TelemetryVar.TrackTempCrew,
    TelemetryVar.AirTemp,
    TelemetryVar.SessionTimeRemain,
    TelemetryVar.SessionLapsRemainEx,
    TelemetryVar.LapCurrentLapTime,
    TelemetryVar.LapLastLapTime,
    TelemetryVar.LapBestLapTime,
    TelemetryVar.LapDeltaToBestLap,
    TelemetryVar.PlayerCarPosition,
    // the Rotation Model (RotationMonitor), the Rotation window, and saved to the lap CSVs
    TelemetryVar.VelocityX,
    TelemetryVar.VelocityY,
    // read by TelemetryEngine.js in the overlay (as SimHub's GameRawData.Telemetry.SessionUniqueID)
    TelemetryVar.SessionUniqueID,
])]
public static class Program
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

    // One collector at a time: two would both record every lap and upload it twice
    private const string SingleInstanceName = @"Local\RacingCoach.Collector";

    [STAThread]
    public static int Main(string[] args)
    {
        // Started by Restart Now after an update: the old collector is still saving its last laps
        var afterUpdate = args.Contains(SelfUpdater.AfterUpdateArg);
        args = [.. args.Where(a => a != SelfUpdater.AfterUpdateArg)];
        if (!TryParseArgs(args, out var options))
        {
            MessageBox.Show(Usage, "RacingCoach Collector", MessageBoxButton.OK, MessageBoxImage.Information);
            return 1;
        }

        using var single = new Mutex(initiallyOwned: true, SingleInstanceName, out var firstInstance);
        if (!firstInstance && afterUpdate)
            firstInstance = WaitForOldCollector(single);
        SelfUpdater.CleanUp();
        if (!firstInstance && !options.Playback)
        {
            MessageBox.Show("The RacingCoach Collector is already running. Look for it on the taskbar.",
                "RacingCoach Collector", MessageBoxButton.OK, MessageBoxImage.Information);
            return 0;
        }

        var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
        app.DispatcherUnhandledException += (_, e) =>
        {
            ActivityLog.Shared.Write($"Unexpected error: {e.Exception}", isError: true);
            MessageBox.Show($"Something went wrong: {e.Exception.Message}\n\nDetails are in {ActivityLog.Shared.FilePath}",
                "RacingCoach Collector", MessageBoxButton.OK, MessageBoxImage.Error);
            e.Handled = true;
        };
        return app.Run(new MainWindow(options));
    }

    // Waits for the collector being replaced to finish closing (it saves laps and gives uploads a few seconds)
    private static bool WaitForOldCollector(Mutex single)
    {
        try
        {
            return single.WaitOne(TimeSpan.FromSeconds(60));
        }
        catch (AbandonedMutexException)
        {
            return true; // it exited without letting go; the mutex is ours now
        }
    }

    private static bool TryParseArgs(string[] args, out CollectorOptions options)
    {
        options = new CollectorOptions(null, 1, false, false, false, null, false);
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
