using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Runtime.InteropServices;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector;

/// <summary>
/// Assetto Corsa (the original), through its shared memory (Local\acpmf_physics, _graphics, _static; layout in
/// AcSharedMemory, conversions in AcFrameBuilder). Laps only, through CanonicalLapPipeline: the live features don't
/// get its samples yet. The channels the Spa and Red Bull Ring recordings of 2026-11-10 proved reach lap files
/// (ChannelGate), and the website takes them (simulators/capabilities.json: supported, from adapter 2). Only read when
/// picked (the window's Simulator picker, or --simulator ac).
///
/// AC, ACC and AC Rally all use these map names, so the maps only count as AC's while AC's own process (acs.exe) is
/// running, and only once their pages change (AcFrameBuilder.PagesAreLive): until AC writes them they may still hold
/// another game's. The steering angle needs the wheel rotation set in AC's controls (SteeringRange). With a raw
/// recording folder (--record-raw), every page read is also written there (AcRawRecording), including what follows
/// the documented fields, for checking the conversions.
/// </summary>
internal sealed class AcAdapter(string? rawRecordingFolder = null, Action<string>? log = null, int? steeringRangeDegrees = null) : ISimulatorAdapter, IHasLapTrackerOptions, IShapesLapFiles
{
    // The window's Wheel rotation, which may change while AC is being read; the reading loop picks it up
    private volatile int _steeringRange = steeringRangeDegrees ?? 0;

    /// <summary>The wheel rotation set in AC's controls, lock to lock in degrees, or null for no steering angle (AC's
    /// steerAngle is a share of it). Takes effect from the next sample, also while reading.</summary>
    public int? SteeringRange
    {
        get => _steeringRange > 0 ? _steeringRange : null;
        set => _steeringRange = value ?? 0;
    }

    // acs.exe, however it's started (Steam or Content Manager); acs_x86.exe is the old 32-bit build
    private static readonly string[] ProcessNames = ["acs", "acs_x86"];
    private static readonly TimeSpan Period = TimeSpan.FromSeconds(1 / 60.0);
    private static readonly TimeSpan SlowCheck = TimeSpan.FromSeconds(1);
    // graphics' status offset (AC_STATUS), for Probe
    private const int StatusOffset = 4;

    /// <summary>How much of each page a raw recording keeps: the documented fields and what follows them, as later AC
    /// versions are reported to add fields that aren't in the document.</summary>
    public const int RecordedBytes = 2048;

    public string SimulatorId => AcFrameBuilder.SimulatorId;
    public string DisplayName => "Assetto Corsa";
    // 2: the conventions the Spa recording of 2026-11-10 proved (simulators/capabilities.json minAdapterVersion)
    public string AdapterVersion => "2";
    public LapTrackerOptions LapTrackerOptions => AcFrameBuilder.LapTrackerOptions;
    public IReadOnlyList<TelemetryFrame> ForLapFile(IReadOnlyList<TelemetryFrame> frames) => AcFrameBuilder.ForLapFile(frames);

    public SimulatorProbe Probe()
    {
        var running = IsRunning();
        var open = false;
        var producing = false;
        if (running)
        {
            try
            {
                using var map = MemoryMappedFile.OpenExisting(AcSharedMemory.GraphicsMapName, MemoryMappedFileRights.Read);
                using var view = map.CreateViewAccessor(StatusOffset, sizeof(int), MemoryMappedFileAccess.Read);
                open = true;
                producing = view.ReadInt32(0) != (int)AcStatus.Off;
            }
            catch (Exception e) when (e is FileNotFoundException or IOException or UnauthorizedAccessException)
            {
                // AC creates the maps once it has loaded
            }
        }
        return new SimulatorProbe(null, running, open, producing);
    }

    private static bool IsRunning()
    {
        var found = false;
        foreach (var name in ProcessNames)
        {
            var processes = Process.GetProcessesByName(name);
            found |= processes.Length > 0;
            foreach (var process in processes)
                process.Dispose();
        }
        return found;
    }

    public async Task RunAsync(ITelemetrySink sink, CancellationToken cancel)
    {
        using var physicsMap = MemoryMappedFile.OpenExisting(AcSharedMemory.PhysicsMapName, MemoryMappedFileRights.Read);
        using var graphicsMap = MemoryMappedFile.OpenExisting(AcSharedMemory.GraphicsMapName, MemoryMappedFileRights.Read);
        using var staticMap = MemoryMappedFile.OpenExisting(AcSharedMemory.StaticMapName, MemoryMappedFileRights.Read);
        // The whole of each map (its size isn't documented), of which the documented page and, for a raw recording,
        // what follows it up to RecordedBytes are read
        using var physicsView = physicsMap.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
        using var graphicsView = graphicsMap.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);
        using var staticView = staticMap.CreateViewAccessor(0, 0, MemoryMappedFileAccess.Read);

        var physics = new byte[ReadSize(physicsView, AcSharedMemory.PhysicsSize)];
        var graphics = new byte[ReadSize(graphicsView, AcSharedMemory.GraphicsSize)];
        var info = new byte[ReadSize(staticView, AcSharedMemory.StaticSize)];
        var steeringRange = _steeringRange;
        var builder = new AcFrameBuilder(SteeringRange);
        var clock = Stopwatch.StartNew();
        AccRawRecording.Writer? recording = null;
        SimulatorSession? session = null;
        var nextSlowCheck = TimeSpan.Zero;
        var versionLogged = false;
        var staticPage = new AcStatic();

        // The session from the static page, when it's changed. Not until AC itself writes the pages, as until then
        // they may be another game's (AcFrameBuilder.PagesAreLive)
        void SendSession()
        {
            if (!builder.PagesAreLive)
                return;
            if (!versionLogged && staticPage.SmVersion.Length > 0)
            {
                versionLogged = true;
                log?.Invoke($"Assetto Corsa {staticPage.AcVersion}, shared memory {staticPage.SmVersion}");
            }
            var sessionGraphics = AcSharedMemory.ReadGraphics(ReadConsistent(graphicsView, graphics));
            var current = AcFrameBuilder.Session(staticPage, sessionGraphics, builder.SessionNumber);
            if (current.Track.Length > 0 && !AcFrameBuilder.SameSession(current, session))
            {
                session = current;
                sink.OnSession(current);
            }
        }

        // Windows' timer ticks every 15.6 ms unless asked for finer, which would make 60 Hz uneven
        TimeBeginPeriod(1);
        sink.OnConnectionChanged(true);
        try
        {
            if (rawRecordingFolder is not null)
            {
                Directory.CreateDirectory(rawRecordingFolder);
                var path = Path.Combine(rawRecordingFolder, $"ac-{DateTime.Now:yyyyMMdd-HHmmss}{AcRawRecording.FileExtension}");
                recording = AcRawRecording.Writer(File.Create(path), physics.Length, graphics.Length, info.Length);
                log?.Invoke($"Recording Assetto Corsa's shared memory to {path}");
            }

            using var timer = new PeriodicTimer(Period);
            while (await timer.WaitForNextTickAsync(cancel))
            {
                var now = clock.Elapsed;
                if (now >= nextSlowCheck)
                {
                    nextSlowCheck = now + SlowCheck;
                    if (!IsRunning())
                        return; // AC closed; the caller waits for it again
                    staticView.ReadArray(0, info, 0, info.Length);
                    recording?.Static(now.TotalSeconds, info);
                    staticPage = AcSharedMemory.ReadStatic(info);
                    SendSession();
                }

                ReadConsistent(physicsView, physics);
                ReadConsistent(graphicsView, graphics);
                recording?.Sample(now.TotalSeconds, physics, graphics);
                if (_steeringRange != steeringRange)
                {
                    steeringRange = _steeringRange;
                    builder.SteeringRangeDegrees = steeringRange > 0 ? steeringRange : null;
                }
                var wasLive = builder.PagesAreLive;
                var frame = builder.Next(AcSharedMemory.ReadPhysics(physics), AcSharedMemory.ReadGraphics(graphics), now.TotalSeconds);
                if (!wasLive && builder.PagesAreLive)
                {
                    // AC has started writing: its own static page, then the session, before its first frame
                    staticView.ReadArray(0, info, 0, info.Length);
                    recording?.Static(now.TotalSeconds, info);
                    staticPage = AcSharedMemory.ReadStatic(info);
                    SendSession();
                }
                if (frame is not null)
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

    // The documented page, or more of the map for a raw recording, never past the map's end
    private int ReadSize(MemoryMappedViewAccessor view, int documented)
    {
        var wanted = rawRecordingFolder is null ? documented : Math.Max(documented, RecordedBytes);
        return (int)Math.Min(view.Capacity, wanted);
    }

    // AC writes the pages while they're read. Each starts with a packetId it changes on every write, so a page whose
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
