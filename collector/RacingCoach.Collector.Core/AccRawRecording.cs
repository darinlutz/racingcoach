using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;

namespace RacingCoach.Collector.Simulators;

/// <summary>
/// ACC's shared memory pages exactly as they were read, with when (the reader's seconds), so what an adapter makes of
/// them can be checked and replayed without the game: the proving work at Spa, and test fixtures. A gzip stream of:
/// the header ("RCACCRAW", format, then the physics, graphics and static page sizes, int32 little-endian), then
/// records, each a kind byte and the reader's seconds (float64): kind 1 is a static page (written when it changes),
/// kind 2 a physics page and a graphics page. Pages are written at the sizes in the header, so a recording made against
/// a longer page (a newer ACC) still reads.
/// </summary>
public static class AccRawRecording
{
    public const string FileExtension = ".accraw.gz";
    private static readonly byte[] Magic = Encoding.ASCII.GetBytes("RCACCRAW");
    private const int Format = 1;
    internal const byte StaticRecord = 1;
    internal const byte SampleRecord = 2;

    public static bool StartsLikeOne(Stream start)
    {
        try
        {
            using var gzip = new GZipStream(start, CompressionMode.Decompress, leaveOpen: true);
            var magic = new byte[Magic.Length];
            gzip.ReadExactly(magic);
            return magic.AsSpan().SequenceEqual(Magic);
        }
        catch (Exception e) when (e is InvalidDataException or EndOfStreamException or IOException)
        {
            return false;
        }
    }

    /// <summary>One record of a recording.</summary>
    public readonly record struct Record(double Seconds, byte[]? Static, byte[]? Physics, byte[]? Graphics);

    /// <summary>The records in order. Stops quietly at a cut-off end, as a recording ends when the collector closes.</summary>
    public static IEnumerable<Record> Read(Stream file)
    {
        using var gzip = new GZipStream(file, CompressionMode.Decompress, leaveOpen: true);
        var header = new byte[Magic.Length + 16];
        gzip.ReadExactly(header);
        if (!header.AsSpan(0, Magic.Length).SequenceEqual(Magic))
            throw new InvalidDataException("not an ACC raw recording");
        var format = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(Magic.Length));
        if (format != Format)
            throw new InvalidDataException($"ACC raw recording format {format} isn't one this collector reads");
        var physicsSize = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(Magic.Length + 4));
        var graphicsSize = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(Magic.Length + 8));
        var staticSize = BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(Magic.Length + 12));

        var head = new byte[9];
        while (true)
        {
            if (!TryRead(gzip, head))
                yield break;
            var seconds = BinaryPrimitives.ReadDoubleLittleEndian(head.AsSpan(1));
            switch (head[0])
            {
                case StaticRecord:
                    var page = new byte[staticSize];
                    if (!TryRead(gzip, page)) yield break;
                    yield return new Record(seconds, page, null, null);
                    break;
                case SampleRecord:
                    var physics = new byte[physicsSize];
                    var graphics = new byte[graphicsSize];
                    if (!TryRead(gzip, physics) || !TryRead(gzip, graphics)) yield break;
                    yield return new Record(seconds, null, physics, graphics);
                    break;
                default:
                    throw new InvalidDataException($"unknown record kind {head[0]} in an ACC raw recording");
            }
        }
    }

    private static bool TryRead(Stream stream, byte[] buffer)
    {
        try
        {
            stream.ReadExactly(buffer);
            return true;
        }
        catch (EndOfStreamException)
        {
            return false;
        }
    }

    /// <summary>Writes a recording. Not thread safe; dispose it to finish the file.</summary>
    public sealed class Writer : IDisposable
    {
        private readonly GZipStream _gzip;
        private readonly int _physicsSize;
        private readonly int _graphicsSize;
        private readonly int _staticSize;
        private byte[]? _lastStatic;
        private readonly byte[] _head = new byte[9];

        public Writer(Stream file, int physicsSize = AccSharedMemory.PhysicsSize, int graphicsSize = AccSharedMemory.GraphicsSize, int staticSize = AccSharedMemory.StaticSize)
        {
            _gzip = new GZipStream(file, CompressionLevel.Fastest, leaveOpen: false);
            (_physicsSize, _graphicsSize, _staticSize) = (physicsSize, graphicsSize, staticSize);
            var header = new byte[Magic.Length + 16];
            Magic.CopyTo(header, 0);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(Magic.Length), Format);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(Magic.Length + 4), physicsSize);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(Magic.Length + 8), graphicsSize);
            BinaryPrimitives.WriteInt32LittleEndian(header.AsSpan(Magic.Length + 12), staticSize);
            _gzip.Write(header);
        }

        /// <summary>Writes the static page if it differs from the last one written.</summary>
        public void Static(double seconds, ReadOnlySpan<byte> page)
        {
            page = page[.._staticSize];
            if (_lastStatic is not null && page.SequenceEqual(_lastStatic))
                return;
            _lastStatic = page.ToArray();
            Head(StaticRecord, seconds);
            _gzip.Write(page);
        }

        public void Sample(double seconds, ReadOnlySpan<byte> physics, ReadOnlySpan<byte> graphics)
        {
            Head(SampleRecord, seconds);
            _gzip.Write(physics[.._physicsSize]);
            _gzip.Write(graphics[.._graphicsSize]);
        }

        private void Head(byte kind, double seconds)
        {
            _head[0] = kind;
            BinaryPrimitives.WriteDoubleLittleEndian(_head.AsSpan(1), seconds);
            _gzip.Write(_head);
        }

        public void Dispose() => _gzip.Dispose();
    }
}

/// <summary>Plays an ACC raw recording through the same frame builder as live ACC.</summary>
public sealed class AccRecordingImporter : ITelemetryFileImporter
{
    public string SimulatorId => AccFrameBuilder.SimulatorId;
    public string FormatName => "ACC raw shared memory recording";

    public bool CanRead(Stream start) => AccRawRecording.StartsLikeOne(start);

    public Task ImportAsync(string path, ITelemetrySink sink, CancellationToken cancel)
    {
        using var file = File.OpenRead(path);
        Import(file, sink, cancel);
        return Task.CompletedTask;
    }

    /// <param name="steeringRangeDegrees">The driver's wheel rotation, as the collector's --steering-range.</param>
    public static void Import(Stream file, ITelemetrySink sink, CancellationToken cancel = default, float? steeringRangeDegrees = null)
    {
        var builder = new AccFrameBuilder(steeringRangeDegrees);
        AccStatic? info = null;
        var sessionSent = false;
        SimulatorSession? lastSession = null;
        sink.OnConnectionChanged(true);
        foreach (var record in AccRawRecording.Read(file))
        {
            cancel.ThrowIfCancellationRequested();
            if (record.Static is { } page)
            {
                info = AccSharedMemory.ReadStatic(page);
                sessionSent = false;
                continue;
            }
            var physics = AccSharedMemory.ReadPhysics(record.Physics!);
            var graphics = AccSharedMemory.ReadGraphics(record.Graphics!);
            if (info is not null)
            {
                var session = AccFrameBuilder.Session(info, graphics);
                if (!sessionSent || !AccFrameBuilder.SameSession(session, lastSession))
                {
                    sink.OnSession(session);
                    (sessionSent, lastSession) = (true, session);
                }
            }
            if (builder.Next(physics, graphics, record.Seconds) is { } frame)
                sink.OnFrame(frame);
        }
        sink.OnConnectionChanged(false);
    }
}
