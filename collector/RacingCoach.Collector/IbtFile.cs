using System.Buffers.Binary;
using System.Text;
using System.Text.RegularExpressions;

namespace RacingCoach.Collector;

/// <summary>A track position from an .ibt file: Lat/Lon in degrees, Alt in meters.</summary>
internal readonly record struct IbtPosition(double SessionTime, double Lat, double Lon, double Alt);

/// <summary>
/// Reads the track positions out of an iRacing .ibt telemetry file. iRacing only writes Lat, Lon and Alt
/// to these files, never to live telemetry, so this is how live laps get them. Reads the file directly
/// (header, variable headers, then one fixed-size record per 60 Hz sample) rather than through the SDK's
/// playback, and only keeps the samples asked for: a file left recording for hours can be gigabytes.
/// </summary>
internal sealed class IbtFile
{
    // irsdk_header: 10 ints, 2 padding ints, then varBuf[0] = { tickCount, bufOffset, ... }; then
    // irsdk_diskSubHeader, starting with the recording's start time (time_t)
    private const int HeaderSize = 144;
    private const int VarHeaderSize = 144;
    // irsdk_VarType
    private const int TypeInt = 2, TypeFloat = 4, TypeDouble = 5;

    private readonly string _path;
    private readonly int _bufOffset;
    private readonly int _bufLen;
    private readonly Dictionary<string, (int Type, int Offset)> _vars;

    /// <summary>When iRacing started recording the file, or null if the header doesn't say.</summary>
    public DateTimeOffset? StartedAt { get; }

    /// <summary>The session's SubSessionID from the file's session info (0 for offline sessions).</summary>
    public int SubSessionId { get; }

    /// <summary>False for files without track positions.</summary>
    public bool HasPositions { get; }

    /// <summary>True while iRacing still has the file open for writing.</summary>
    public static bool IsBeingWritten(string path)
    {
        try
        {
            using var _ = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.None);
            return false;
        }
        catch (IOException)
        {
            return true;
        }
    }

    /// <summary>Reads the file's headers. Throws InvalidDataException if it isn't an .ibt file.</summary>
    public IbtFile(string path)
    {
        _path = path;
        using var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.Read);
        var header = ReadExactly(stream, 0, HeaderSize);
        int Int(int offset) => BinaryPrimitives.ReadInt32LittleEndian(header.AsSpan(offset));
        var sessionInfoLen = Int(16);
        var sessionInfoOffset = Int(20);
        var numVars = Int(24);
        var varHeaderOffset = Int(28);
        _bufLen = Int(36);
        _bufOffset = Int(52);
        if (numVars <= 0 || numVars > 10_000 || _bufLen <= 0 || _bufOffset < HeaderSize || _bufOffset > stream.Length)
            throw new InvalidDataException("not an iRacing telemetry file");

        var started = BinaryPrimitives.ReadInt64LittleEndian(header.AsSpan(112));
        StartedAt = started > 0 ? DateTimeOffset.FromUnixTimeSeconds(started) : null;

        _vars = [];
        var varHeaders = ReadExactly(stream, varHeaderOffset, numVars * VarHeaderSize);
        for (var i = 0; i < numVars; i++)
        {
            var h = varHeaders.AsSpan(i * VarHeaderSize, VarHeaderSize);
            var name = Encoding.ASCII.GetString(h.Slice(16, 32)).TrimEnd('\0');
            _vars[name] = (BinaryPrimitives.ReadInt32LittleEndian(h), BinaryPrimitives.ReadInt32LittleEndian(h[4..]));
        }
        HasPositions = new[] { "SessionNum", "SessionTick", "SessionTime", "Lat", "Lon", "Alt" }.All(_vars.ContainsKey);

        var sessionInfo = sessionInfoLen > 0 ? Encoding.UTF8.GetString(ReadExactly(stream, sessionInfoOffset, sessionInfoLen)) : "";
        var subSession = Regex.Match(sessionInfo, @"SubSessionID:\s*(\d+)");
        SubSessionId = subSession.Success && int.TryParse(subSession.Groups[1].Value, out var id) ? id : 0;
    }

    /// <summary>The positions of the wanted samples (by SessionNum and SessionTick, which live telemetry
    /// has too) that the file has. Stops reading once it has found them all.</summary>
    public Dictionary<(int SessionNum, int Tick), IbtPosition> ReadPositions(IReadOnlySet<(int SessionNum, int Tick)> wanted)
    {
        var positions = new Dictionary<(int, int), IbtPosition>();
        if (!HasPositions || wanted.Count == 0)
            return positions;
        var (sessionNum, tick, time, lat, lon, alt) = (_vars["SessionNum"], _vars["SessionTick"], _vars["SessionTime"], _vars["Lat"], _vars["Lon"], _vars["Alt"]);

        using var stream = new FileStream(_path, FileMode.Open, FileAccess.Read, FileShare.Read, bufferSize: 1 << 20, FileOptions.SequentialScan);
        var record = new byte[_bufLen];
        stream.Position = _bufOffset;
        while (positions.Count < wanted.Count && stream.Read(record, 0, _bufLen) == _bufLen)
        {
            var r = record.AsSpan();
            var key = ((int)Value(r, sessionNum), (int)Value(r, tick));
            if (!wanted.Contains(key))
                continue;
            var latValue = Value(r, lat);
            var lonValue = Value(r, lon);
            if (latValue != 0 || lonValue != 0)
                positions[key] = new IbtPosition(Value(r, time), latValue, lonValue, Value(r, alt));
        }
        return positions;
    }

    private static double Value(ReadOnlySpan<byte> record, (int Type, int Offset) v) => v.Type switch
    {
        TypeDouble => BinaryPrimitives.ReadDoubleLittleEndian(record[v.Offset..]),
        TypeFloat => BinaryPrimitives.ReadSingleLittleEndian(record[v.Offset..]),
        TypeInt => BinaryPrimitives.ReadInt32LittleEndian(record[v.Offset..]),
        _ => throw new InvalidDataException($"unexpected variable type {v.Type}"),
    };

    private static byte[] ReadExactly(FileStream stream, long offset, int count)
    {
        if (offset < 0 || count < 0 || offset + count > stream.Length)
            throw new InvalidDataException("not an iRacing telemetry file");
        var bytes = new byte[count];
        stream.Position = offset;
        stream.ReadExactly(bytes);
        return bytes;
    }
}
