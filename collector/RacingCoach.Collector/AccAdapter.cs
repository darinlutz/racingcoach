using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector;

/// <summary>
/// Assetto Corsa Competizione, through its shared memory (Local\acpmf_physics, _graphics, _static; layout in
/// AccSharedMemory, conversions in AccFrameBuilder). Laps only, through CanonicalLapPipeline: none of iRacing's live
/// features. The pages are read 60 times a second; ACC has no session clock or matching sample counter in them, so the
/// reader's own clock times the frames.
///
/// AC, ACC and AC Rally all use these map names, and AC's static page starts the same way, so the maps only count as
/// ACC's while ACC's process is running. With a raw recording folder, every page read is also written there
/// (AccRawRecording), for checking the conversions at Spa.
/// </summary>
internal sealed class AccAdapter(string? rawRecordingFolder = null, Action<string>? log = null) : ISimulatorAdapter, IHasLapTrackerOptions, IShapesLapFiles
{
    private const string ProcessName = "AC2-Win64-Shipping";
    // The static page's smVersion this layout was written from (ACC Shared Memory v1.8.12)
    private const string DocumentedVersion = "1.8";
    private static readonly TimeSpan Period = TimeSpan.FromSeconds(1 / 60.0);
    // How often the static page and the process are looked at again
    private static readonly TimeSpan SlowCheck = TimeSpan.FromSeconds(1);
    // graphics' status offset (ACC_STATUS), for Probe
    private const int StatusOffset = 4;

    public string SimulatorId => AccFrameBuilder.SimulatorId;
    public string DisplayName => "Assetto Corsa Competizione";
    // 2: lap files count from ACC's timing line and have no neutral mid-shift (AccFrameBuilder.ForLapFile). The
    // website refuses ACC laps from older adapters (minAdapterVersion in simulators/capabilities.json)
    public string AdapterVersion => "2";
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
        var builder = new AccFrameBuilder();
        var clock = Stopwatch.StartNew();
        AccRawRecording.Writer? recording = null;
        SimulatorSession? session = null;
        var nextSlowCheck = TimeSpan.Zero;
        var versionChecked = false;

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
                    var staticPage = AccSharedMemory.ReadStatic(info);
                    if (!versionChecked && staticPage.SmVersion.Length > 0)
                    {
                        versionChecked = true;
                        if (!staticPage.SmVersion.StartsWith(DocumentedVersion, StringComparison.Ordinal))
                            sink.OnError($"shared memory version {staticPage.SmVersion}, not the {DocumentedVersion} its layout was written from: laps may be wrong");
                    }
                    var graphicsPage = AccSharedMemory.ReadGraphics(ReadConsistent(graphicsView, graphics));
                    var current = AccFrameBuilder.Session(staticPage, graphicsPage);
                    if (current.Track.Length > 0 && !AccFrameBuilder.SameSession(current, session))
                    {
                        session = current;
                        sink.OnSession(current);
                    }
                }

                ReadConsistent(physicsView, physics);
                ReadConsistent(graphicsView, graphics);
                recording?.Sample(now.TotalSeconds, physics, graphics);
                if (builder.Next(AccSharedMemory.ReadPhysics(physics), AccSharedMemory.ReadGraphics(graphics), now.TotalSeconds) is { } frame)
                    sink.OnFrame(frame);
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
