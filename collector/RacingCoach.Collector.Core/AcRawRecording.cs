namespace RacingCoach.Collector.Simulators;

/// <summary>
/// Assetto Corsa's shared memory pages exactly as they were read, with when (the reader's seconds), so what
/// AcFrameBuilder makes of them can be checked and replayed without the game. The same file format as ACC's
/// (AccRawRecording) under its own magic. The pages are kept at the sizes the header gives, which AcAdapter makes
/// larger than the documented ones (AcAdapter.RecordedBytes), so fields after them can still be looked at later.
/// </summary>
public static class AcRawRecording
{
    public const string FileExtension = ".acraw.gz";

    public static bool StartsLikeOne(Stream start) => AccRawRecording.StartsLikeOne(start, AccRawRecording.AcMagic);

    /// <summary>The records in order. Stops quietly at a cut-off end, as a recording ends when the collector closes.</summary>
    public static IEnumerable<AccRawRecording.Record> Read(Stream file) => AccRawRecording.Read(file, AccRawRecording.AcMagic, "AC");

    /// <summary>A writer for AC's pages, at these sizes (each at least the documented page's).</summary>
    public static AccRawRecording.Writer Writer(Stream file, int physicsSize = AcSharedMemory.PhysicsSize, int graphicsSize = AcSharedMemory.GraphicsSize, int staticSize = AcSharedMemory.StaticSize)
    {
        if (physicsSize < AcSharedMemory.PhysicsSize || graphicsSize < AcSharedMemory.GraphicsSize || staticSize < AcSharedMemory.StaticSize)
            throw new ArgumentException("AC's pages are recorded at least at their documented sizes");
        return new AccRawRecording.Writer(file, AccRawRecording.AcMagic, physicsSize, graphicsSize, staticSize);
    }
}

/// <summary>Plays an AC raw recording through the same frame builder as live AC.</summary>
public sealed class AcRecordingImporter : ITelemetryFileImporter
{
    public string SimulatorId => AcFrameBuilder.SimulatorId;
    public string FormatName => "Assetto Corsa raw shared memory recording";

    public bool CanRead(Stream start) => AcRawRecording.StartsLikeOne(start);

    public Task ImportAsync(string path, ITelemetrySink sink, CancellationToken cancel)
    {
        using var file = File.OpenRead(path);
        Import(file, sink, cancel);
        return Task.CompletedTask;
    }

    /// <param name="steeringRangeDegrees">The wheel rotation set in AC's controls when it was recorded, for the
    /// steering angle (AC doesn't share it); null for none.</param>
    public static void Import(Stream file, ITelemetrySink sink, CancellationToken cancel = default, float? steeringRangeDegrees = null)
    {
        var builder = new AcFrameBuilder(steeringRangeDegrees);
        AcStatic? info = null;
        var sessionSent = false;
        SimulatorSession? lastSession = null;
        sink.OnConnectionChanged(true);
        foreach (var record in AcRawRecording.Read(file))
        {
            cancel.ThrowIfCancellationRequested();
            if (record.Static is { } page)
            {
                info = AcSharedMemory.ReadStatic(page);
                sessionSent = false;
                continue;
            }
            var physics = AcSharedMemory.ReadPhysics(record.Physics!);
            var graphics = AcSharedMemory.ReadGraphics(record.Graphics!);
            var frame = builder.Next(physics, graphics, record.Seconds);
            if (info is not null && builder.PagesAreLive)
            {
                var session = AcFrameBuilder.Session(info, graphics, builder.SessionNumber);
                if (!sessionSent || !AcFrameBuilder.SameSession(session, lastSession))
                {
                    sink.OnSession(session);
                    (sessionSent, lastSession) = (true, session);
                }
            }
            if (frame is not null)
                sink.OnFrame(frame);
        }
        sink.OnConnectionChanged(false);
    }
}
