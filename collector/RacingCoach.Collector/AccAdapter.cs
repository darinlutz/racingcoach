using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using RacingCoach.Collector.Simulators;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// Assetto Corsa Competizione, through its shared memory (Local\acpmf_physics, _graphics, _static; layout in
/// AccSharedMemory, conversions in AccFrameBuilder). Laps go through CanonicalLapPipeline; with a live callback, each
/// sample also goes to the live features as iRacing's TelemetryData (AccLiveTelemetry), on the reading thread like the
/// SDK's samples. The pages are read 60 times a second; ACC has no session clock or matching sample counter in them, so
/// the reader's own clock times the frames.
///
/// AC, ACC and AC Rally all use these map names, and AC's static page starts the same way, so the maps only count as
/// ACC's while ACC's process is running. With a raw recording folder, every page read is also written there
/// (AccRawRecording), for checking the conversions at Spa.
/// </summary>
internal sealed class AccAdapter(string? rawRecordingFolder = null, Action<string>? log = null, int? steeringRangeDegrees = null) : ISimulatorAdapter, IHasLapTrackerOptions, IShapesLapFiles
{
    /// <summary>Called with each sample as TelemetryData, for the live features; null for laps only.</summary>
    public Action<TelemetryData>? Live { get; set; }

    // The window's Wheel rotation, which may change while ACC is being read; the reading loop picks it up
    private volatile int _steeringRange = steeringRangeDegrees ?? 0;

    /// <summary>The driver's wheel rotation, lock to lock in degrees, or null for no steering angle. Takes effect from
    /// the next sample, also while reading.</summary>
    public int? SteeringRange
    {
        get => _steeringRange > 0 ? _steeringRange : null;
        set => _steeringRange = value ?? 0;
    }

    private const string ProcessName = "AC2-Win64-Shipping";
    // The static page's smVersions this layout is known to read: 1.8, which it was written from (ACC Shared Memory
    // v1.8.12), and 1.9, which the Spa recordings of 2026-11-05 checked field by field (AccSpaRecordingTests; 1.9
    // moved nothing this reads). Any other version is warned about once, as its fields may have moved
    private static readonly string[] VerifiedVersions = ["1.8", "1.9"];
    private static readonly TimeSpan Period = TimeSpan.FromSeconds(1 / 60.0);
    // How often the static page and the process are looked at again
    private static readonly TimeSpan SlowCheck = TimeSpan.FromSeconds(1);
    // graphics' status offset (ACC_STATUS), for Probe
    private const int StatusOffset = 4;

    public string SimulatorId => AccFrameBuilder.SimulatorId;
    public string DisplayName => "Assetto Corsa Competizione";
    // 2: lap files count from ACC's timing line and have no neutral mid-shift (AccFrameBuilder.ForLapFile). The
    // website refuses ACC laps from older adapters (minAdapterVersion in simulators/capabilities.json).
    // 3: the steering wheel angle, from the driver's wheel rotation (--steering-range)
    // 4: the car's world coordinates (WorldX, WorldY, WorldZ), from which the website draws the driving line
    public string AdapterVersion => "4";
    public LapTrackerOptions LapTrackerOptions => AccFrameBuilder.LapTrackerOptions;
    public IReadOnlyList<TelemetryFrame> ForLapFile(IReadOnlyList<TelemetryFrame> frames) => AccFrameBuilder.ForLapFile(frames);

    public SimulatorProbe Probe()
    {
        var running = IsRunning();
        var open = false;
        var producing = false;
        if (running)
        {
            try
            {
                using var map = MemoryMappedFile.OpenExisting(AccSharedMemory.GraphicsMapName, MemoryMappedFileRights.Read);
                using var view = map.CreateViewAccessor(StatusOffset, sizeof(int), MemoryMappedFileAccess.Read);
                open = true;
                producing = view.ReadInt32(0) != (int)AccStatus.Off;
            }
            catch (Exception e) when (e is FileNotFoundException or IOException or UnauthorizedAccessException)
            {
                // ACC creates the maps once it has loaded
            }
        }
        return new SimulatorProbe(null, running, open, producing);
    }

    private static bool IsRunning()
    {
        var processes = Process.GetProcessesByName(ProcessName);
        foreach (var process in processes)
            process.Dispose();
        return processes.Length > 0;
    }

    public async Task RunAsync(ITelemetrySink sink, CancellationToken cancel)
    {
        using var physicsMap = MemoryMappedFile.OpenExisting(AccSharedMemory.PhysicsMapName, MemoryMappedFileRights.Read);
        using var graphicsMap = MemoryMappedFile.OpenExisting(AccSharedMemory.GraphicsMapName, MemoryMappedFileRights.Read);
        using var staticMap = MemoryMappedFile.OpenExisting(AccSharedMemory.StaticMapName, MemoryMappedFileRights.Read);
        using var physicsView = physicsMap.CreateViewAccessor(0, AccSharedMemory.PhysicsSize, MemoryMappedFileAccess.Read);
        using var graphicsView = graphicsMap.CreateViewAccessor(0, AccSharedMemory.GraphicsSize, MemoryMappedFileAccess.Read);
        using var staticView = staticMap.CreateViewAccessor(0, AccSharedMemory.StaticSize, MemoryMappedFileAccess.Read);

        var physics = new byte[AccSharedMemory.PhysicsSize];
        var graphics = new byte[AccSharedMemory.GraphicsSize];
        var info = new byte[AccSharedMemory.StaticSize];
        var steeringRange = _steeringRange;
        var builder = new AccFrameBuilder(SteeringRange);
        var clock = Stopwatch.StartNew();
        AccRawRecording.Writer? recording = null;
        SimulatorSession? session = null;
        var nextSlowCheck = TimeSpan.Zero;
        var versionChecked = false;
        var staticPage = new AccStatic();

        // Windows' timer ticks every 15.6 ms unless asked for finer, which would make 60 Hz uneven
        TimeBeginPeriod(1);
        sink.OnConnectionChanged(true);
        try
        {
            if (rawRecordingFolder is not null)
            {
                Directory.CreateDirectory(rawRecordingFolder);
                var path = Path.Combine(rawRecordingFolder, $"acc-{DateTime.Now:yyyyMMdd-HHmmss}{AccRawRecording.FileExtension}");
                recording = new AccRawRecording.Writer(File.Create(path));
                log?.Invoke($"Recording ACC's shared memory to {path}");
            }

            using var timer = new PeriodicTimer(Period);
            while (await timer.WaitForNextTickAsync(cancel))
            {
                var now = clock.Elapsed;
                if (now >= nextSlowCheck)
                {
                    nextSlowCheck = now + SlowCheck;
                    if (!IsRunning())
                        return; // ACC closed; the caller waits for it again
                    staticView.ReadArray(0, info, 0, info.Length);
                    recording?.Static(now.TotalSeconds, info);
                    staticPage = AccSharedMemory.ReadStatic(info);
                    if (!versionChecked && staticPage.SmVersion.Length > 0)
                    {
                        versionChecked = true;
                        if (!VerifiedVersions.Any(v => staticPage.SmVersion.StartsWith(v, StringComparison.Ordinal)))
                            sink.OnError($"shared memory version {staticPage.SmVersion}, not one this layout was checked against ({string.Join(", ", VerifiedVersions)}): laps may be wrong");
                    }
                    var sessionGraphics = AccSharedMemory.ReadGraphics(ReadConsistent(graphicsView, graphics));
                    var current = AccFrameBuilder.Session(staticPage, sessionGraphics);
                    if (current.Track.Length > 0 && !AccFrameBuilder.SameSession(current, session))
                    {
                        session = current;
                        sink.OnSession(current);
                    }
                }

                ReadConsistent(physicsView, physics);
                ReadConsistent(graphicsView, graphics);
                recording?.Sample(now.TotalSeconds, physics, graphics);
                if (_steeringRange != steeringRange)
                {
                    steeringRange = _steeringRange;
                    builder.SteeringRangeDegrees = steeringRange > 0 ? steeringRange : null;
                }
                var physicsPage = AccSharedMemory.ReadPhysics(physics);
                var graphicsPage = AccSharedMemory.ReadGraphics(graphics);
                if (builder.Next(physicsPage, graphicsPage, now.TotalSeconds) is { } frame)
                {
                    sink.OnFrame(frame);
                    if (Live is { } live)
                    {
                        try
                        {
                            live(AccLiveTelemetry.From(frame, physicsPage, graphicsPage, staticPage));
                        }
                        catch (Exception e) when (e is not OperationCanceledException)
                        {
                            // a live feature's failure never stops the laps
                            log?.Invoke($"ACC live telemetry: {e.Message}");
                        }
                    }
                }
            }
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
        }
        finally
        {
            recording?.Dispose();
            TimeEndPeriod(1);
            sink.OnConnectionChanged(false);
        }
    }

    // ACC writes the pages while they're read. Each starts with a packetId it changes on every write, so a page whose
    // packetId changed while it was being copied is copied again (a few tries; a torn page at worst gives one odd frame).
    private static byte[] ReadConsistent(MemoryMappedViewAccessor view, byte[] buffer)
    {
        for (var attempt = 0; attempt < 3; attempt++)
        {
            var before = view.ReadInt32(0);
            view.ReadArray(0, buffer, 0, buffer.Length);
            if (view.ReadInt32(0) == before)
                break;
        }
        return buffer;
    }

    [DllImport("winmm.dll", EntryPoint = "timeBeginPeriod")]
    private static extern uint TimeBeginPeriod(uint milliseconds);

    [DllImport("winmm.dll", EntryPoint = "timeEndPeriod")]
    private static extern uint TimeEndPeriod(uint milliseconds);
}
