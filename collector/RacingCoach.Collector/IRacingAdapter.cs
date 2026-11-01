using System.Diagnostics;
using System.Globalization;
using System.IO.MemoryMappedFiles;
using Microsoft.Extensions.Logging.Abstractions;
using RacingCoach.Collector.Simulators;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// iRacing behind the simulator adapter contract. CollectorEngine still gets iRacing's own telemetry (RunNativeAsync),
/// exactly as it did, because the In-Car AI Coach, overlays, Live Racing and the rest read TelemetryData; everything
/// else about the connection is here. RunAsync gives the same telemetry as canonical frames (ToFrame), for the shared
/// pipeline and the tests that hold it to iRacing's behavior.
/// </summary>
internal sealed class IRacingAdapter(string? ibtFile = null, int speed = 1) : ISimulatorAdapter, ISupportsReplay, IProvidesRaceResults
{
    public const string Id = "iracing";

    private const string MemoryMapName = @"Local\IRSDKMemMapFileName";
    private static readonly string[] ProcessNames = ["iRacingSim64DX11", "iRacingSim64"];
    // irsdk_header.status, and its irsdk_stConnected bit: the sim is in a session and writing telemetry
    private const int StatusOffset = 4;
    private const int StatusConnected = 1;

    private ITelemetryClient<TelemetryData>? _client;

    public string SimulatorId => Id;
    public string DisplayName => "iRacing";
    public string AdapterVersion => "1";

    public SimulatorProbe Probe()
    {
        var running = ProcessNames.Any(IsRunning);
        var open = false;
        var producing = false;
        try
        {
            using var map = MemoryMappedFile.OpenExisting(MemoryMapName, MemoryMappedFileRights.Read);
            using var view = map.CreateViewAccessor(StatusOffset, sizeof(int), MemoryMappedFileAccess.Read);
            open = true;
            producing = (view.ReadInt32(0) & StatusConnected) != 0;
        }
        catch (Exception e) when (e is FileNotFoundException or IOException or UnauthorizedAccessException)
        {
            // no shared memory: iRacing isn't in a session
        }
        return new SimulatorProbe(null, running, open, producing);
    }

    private static bool IsRunning(string name)
    {
        var processes = Process.GetProcessesByName(name);
        foreach (var process in processes)
            process.Dispose();
        return processes.Length > 0;
    }

    /// <summary>Connects and calls the handlers with iRacing's own telemetry until cancelled or a played-back file ends.
    /// The SDK's Monitor waits for iRacing and reconnects when it restarts, so this doesn't return until then.</summary>
    public async Task RunNativeAsync(TelemetryHandlers<TelemetryData> handlers, CancellationToken cancel)
    {
        var ibtOptions = ibtFile is null ? null : new IBTOptions(ibtFile, speed);
        // Playback waits for each handler call instead of dropping samples when it runs faster than we keep up.
        var clientOptions = ibtOptions is null ? new ClientOptions() : new ClientOptions { DeliveryMode = TelemetryDeliveryMode.Synchronous };
        await using var client = TelemetryClient<TelemetryData>.Create(NullLogger.Instance, ibtOptions, clientOptions);
        _client = client;
        try
        {
            await client.Monitor(handlers, cancel);
        }
        finally
        {
            _client = null;
        }
    }

    /// <summary>Asks iRacing to record an .ibt file (what Alt+L does).</summary>
    public void StartDiskRecording() => _client?.SimControl.TelemetryRecording.Start();

    public Task RunAsync(ITelemetrySink sink, CancellationToken cancel) => RunNativeAsync(new TelemetryHandlers<TelemetryData>
    {
        OnConnectStateChanged = state =>
        {
            sink.OnConnectionChanged(state == ConnectState.Connected);
            return Task.CompletedTask;
        },
        OnSessionInfoUpdate = session =>
        {
            sink.OnSession(ToSession(session));
            return Task.CompletedTask;
        },
        OnTelemetryUpdate = data =>
        {
            sink.OnFrame(ToFrame(data));
            return Task.CompletedTask;
        },
        OnError = error =>
        {
            sink.OnError(error.Message);
            return Task.CompletedTask;
        },
    }, cancel);

    /// <summary>iRacing's sample as a canonical frame. Nothing is converted, because the canonical units and signs are
    /// iRacing's; only live telemetry's own values go in, so what iRacing doesn't send stays null.</summary>
    public static TelemetryFrame ToFrame(in TelemetryData d) => new()
    {
        SimulatorId = Id,
        SessionTimeSeconds = d.SessionTime,
        Tick = d.SessionTick,
        SessionNumber = d.SessionNum,
        LapNumber = d.Lap,
        LapDistancePct = d.LapDistPct,
        LapDistanceMeters = d.LapDist,
        Latitude = d.Lat,
        Longitude = d.Lon,
        AltitudeMeters = d.Alt,
        SpeedMps = d.Speed,
        VelocityForwardMps = d.VelocityX,
        VelocityLeftMps = d.VelocityY,
        LatAccelMps2 = d.LatAccel,
        LongAccelMps2 = d.LongAccel,
        VertAccelMps2 = d.VertAccel,
        YawRadians = d.Yaw,
        YawRateRadiansPerSecond = d.YawRate,
        Throttle = d.Throttle,
        Brake = d.Brake,
        ClutchEngagement = d.Clutch,
        SteeringWheelAngleRadians = d.SteeringWheelAngle,
        Gear = d.Gear,
        Rpm = d.RPM,
        AbsActive = d.BrakeABSactive,
        FrontLeft = new WheelTelemetry { PressureKpa = d.LFpressure, RideHeightMeters = d.LFrideHeight, CarcassTempLeftC = d.LFtempCL, CarcassTempMiddleC = d.LFtempCM, CarcassTempRightC = d.LFtempCR },
        FrontRight = new WheelTelemetry { PressureKpa = d.RFpressure, RideHeightMeters = d.RFrideHeight, CarcassTempLeftC = d.RFtempCL, CarcassTempMiddleC = d.RFtempCM, CarcassTempRightC = d.RFtempCR },
        RearLeft = new WheelTelemetry { PressureKpa = d.LRpressure, RideHeightMeters = d.LRrideHeight, CarcassTempLeftC = d.LRtempCL, CarcassTempMiddleC = d.LRtempCM, CarcassTempRightC = d.LRtempCR },
        RearRight = new WheelTelemetry { PressureKpa = d.RRpressure, RideHeightMeters = d.RRrideHeight, CarcassTempLeftC = d.RRtempCL, CarcassTempMiddleC = d.RRtempCM, CarcassTempRightC = d.RRtempCR },
        WaterTempC = d.WaterTemp,
        OilTempC = d.OilTemp,
        FuelLiters = d.FuelLevel,
        FuelUseKgPerHour = d.FuelUsePerHour,
        IsOnTrack = d.IsOnTrack,
        IsReplay = d.IsReplayPlaying,
        OnPitRoad = d.OnPitRoad,
        OffTrack = d.PlayerTrackSurface is { } surface ? surface == TrackLocation.OffTrack : null,
        IncidentCount = d.PlayerCarMyIncidentCount,
        TrackTempC = d.TrackTempCrew,
        AirTempC = d.AirTemp,
        RelativeHumidity = d.RelativeHumidity,
        WindSpeedMps = d.WindVel,
        WindDirectionRadians = d.WindDir,
    };

    /// <summary>iRacing's session info as a canonical session, named as the collector's laps are.</summary>
    public static SimulatorSession ToSession(TelemetrySessionInfo session)
    {
        var weekend = session.WeekendInfo;
        var track = weekend?.TrackDisplayName ?? "Unknown Track";
        var config = string.IsNullOrWhiteSpace(weekend?.TrackConfigName) ? null : weekend.TrackConfigName;
        var driverIdx = session.DriverInfo?.DriverCarIdx;
        var driver = session.DriverInfo?.Drivers?.FirstOrDefault(d => d.CarIdx == driverIdx);
        return new SimulatorSession
        {
            SimulatorId = Id,
            NativeTrackId = string.IsNullOrWhiteSpace(weekend?.TrackName) ? null : weekend.TrackName.Trim(),
            Track = config is null ? track : $"{track} ({config})",
            TrackLayout = config,
            TrackLengthMeters = BrakeBeeps.IRacingLengthFeet(weekend?.TrackLength) is > 0 and var feet ? feet * 0.3048 : null,
            TrackLatitude = Degrees(weekend?.TrackLatitude),
            TrackLongitude = Degrees(weekend?.TrackLongitude),
            NativeCarId = string.IsNullOrWhiteSpace(driver?.CarPath) ? null : driver.CarPath,
            Car = driver?.CarScreenName ?? "Unknown Car",
            NativeDriverId = driver?.UserID is > 0 and var user ? user.ToString(CultureInfo.InvariantCulture) : null,
            Driver = driver?.UserName ?? "Unknown Driver",
            SessionId = weekend?.SessionID ?? 0,
            SubSessionId = weekend?.SubSessionID ?? 0,
            SessionTypes = session.SessionInfo?.Sessions?.ToDictionary(s => s.SessionNum, s => s.SessionType) ?? [],
            FuelKgPerLiter = session.DriverInfo?.DriverCarFuelKgPerLtr,
            TrackUsage = session.SessionInfo?.Sessions?
                .Where(s => !string.IsNullOrWhiteSpace(s.SessionTrackRubberState))
                .ToDictionary(s => s.SessionNum, s => s.SessionTrackRubberState!.Trim()),
        };
    }

    // Session info writes them with a unit that isn't one, e.g. "43.797310 m"
    private static double? Degrees(string? value) =>
        double.TryParse(value?.Split(' ', StringSplitOptions.RemoveEmptyEntries).FirstOrDefault(), NumberStyles.Float, CultureInfo.InvariantCulture, out var degrees)
            ? degrees
            : null;
}
