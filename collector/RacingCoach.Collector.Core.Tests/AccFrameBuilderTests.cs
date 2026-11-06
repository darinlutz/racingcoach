using System.Buffers.Binary;
using System.IO.Compression;
using System.Text;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

/// <summary>A page laid out from the PDF's own field list (AccDocumentedLayout), written by field name, so these
/// tests don't share the parser's offsets.</summary>
internal sealed class AccPage
{
    private readonly Dictionary<string, (DocumentedField Field, int Offset)> _fields = new();
    public byte[] Bytes { get; }

    public AccPage(DocumentedField[] fields)
    {
        var offset = 0;
        foreach (var field in fields)
        {
            var (size, align) = field.Type == FieldType.WChar ? (2, 2) : (4, 4);
            offset = (offset + align - 1) / align * align;
            _fields.Add(field.Name, (field, offset));
            offset += size * field.Count;
        }
        Bytes = new byte[(offset + 3) / 4 * 4];
    }

    public AccPage Int(string name, int value, int index = 0)
    {
        BinaryPrimitives.WriteInt32LittleEndian(Bytes.AsSpan(At(name, FieldType.Int) + 4 * index), value);
        return this;
    }

    public AccPage Float(string name, float value, int index = 0)
    {
        BinaryPrimitives.WriteSingleLittleEndian(Bytes.AsSpan(At(name, FieldType.Float) + 4 * index), value);
        return this;
    }

    public AccPage Text(string name, string value)
    {
        var at = At(name, FieldType.WChar);
        Bytes.AsSpan(at, 2 * _fields[name].Field.Count).Clear();
        Encoding.Unicode.GetBytes(value).CopyTo(Bytes, at);
        return this;
    }

    private int At(string name, FieldType type)
    {
        var (field, offset) = _fields[name];
        Assert.Equal(type, field.Type);
        return offset;
    }
}

internal sealed class RecordingSink : ITelemetrySink
{
    public List<TelemetryFrame> Frames { get; } = [];
    public List<SimulatorSession> Sessions { get; } = [];
    public List<bool> Connections { get; } = [];
    public List<string> Errors { get; } = [];
    public void OnConnectionChanged(bool connected) => Connections.Add(connected);
    public void OnSession(SimulatorSession session) => Sessions.Add(session);
    public void OnFrame(TelemetryFrame frame) => Frames.Add(frame);
    public void OnError(string message) => Errors.Add(message);
}

/// <summary>ACC driving round Spa at a steady pace, as its pages would show it.</summary>
internal sealed class AccDrive
{
    public const double LapSeconds = 12.5;
    public const int Hz = 60;

    public AccPage Static { get; } = new AccPage(AccDocumentedLayout.Static)
        .Text("smVersion", "1.8").Text("acVersion", "1.10").Text("track", "spa").Text("carModel", "porsche_991ii_gt3_r")
        .Text("playerName", "Max").Text("playerSurname", "Driver");

    /// <summary>The pages at each 60 Hz read, starting 90% round the lap; ACC's lap counter goes up one read after
    /// the line, with its lap time. invalidLap marks that lap (1-based, counting the one started at the line) invalid.</summary>
    public IEnumerable<(double Seconds, byte[] Physics, byte[] Graphics)> Reads(double seconds, int? invalidLap = null, int sessionIndex = 0)
    {
        var completed = 0;
        var lines = 0;
        var lineAt = -0.9 * LapSeconds;
        var lapStarted = 0.0;
        var lapMs = (int)(LapSeconds * 1000);
        float? prevPct = null;
        var crossedLastRead = false;
        for (var i = 0; i < seconds * Hz; i++)
        {
            var t = i / (double)Hz;
            var pct = (float)((0.9 + t / LapSeconds) % 1.0);
            var crossedNow = prevPct is > 0.9f && pct < 0.1f;
            prevPct = pct;
            // At the line ACC restarts iCurrentTime and isValidLap at once, a read before it counts the lap
            if (crossedNow)
            {
                lines++;
                lineAt = t;
            }
            var physics = new AccPage(AccDocumentedLayout.Physics)
                .Int("packetId", i + 1).Float("gas", 0.8f).Float("brake", 0.1f).Int("gear", 4).Int("rpm", 7000)
                .Float("steerAngle", 0.25f).Float("speedKmh", 150).Float("waterTemp", 85).Float("fuel", 62).Float("airTemp", 21).Float("roadTemp", 30)
                // Engaged (ACC's clutch is engagement, like iRacing's); turning gently right: heading growing, yaw
                // rate negative, pulled right; vertical without gravity, as ACC gives it
                .Float("clutch", 1).Float("abs", 0).Float("heading", 0.5f)
                .Float("localAngularVel", -0.2f, 1).Float("accG", -0.8f, 0).Float("accG", 0.1f, 1).Float("accG", -0.3f, 2);
            for (var w = 0; w < 4; w++)
                physics.Float("wheelPressure", 27, w);
            var graphics = new AccPage(AccDocumentedLayout.Graphics)
                .Int("packetId", i + 1).Int("status", (int)AccStatus.Live).Int("session", (int)AccSessionType.Practice)
                .Int("sessionIndex", sessionIndex).Float("normalizedCarPosition", pct)
                .Int("iCurrentTime", (int)((t - lineAt) * 1000))
                .Int("isValidLap", lines == invalidLap ? 0 : 1)
                .Float("windSpeed", 3).Float("windDirection", 1);
            // Counted one read after the line
            if (crossedLastRead && t - lapStarted > 1)
            {
                completed++;
                lapStarted = t;
            }
            crossedLastRead = crossedNow;
            graphics.Int("completedLaps", completed).Int("iLastTime", completed > 0 ? lapMs : 0);
            yield return (t, physics.Bytes, graphics.Bytes);
        }
    }
}

public sealed class AccFrameBuilderTests
{
    private static List<TelemetryFrame> Frames(IEnumerable<(double Seconds, byte[] Physics, byte[] Graphics)> reads)
    {
        var builder = new AccFrameBuilder();
        return reads.Select(r => builder.Next(AccSharedMemory.ReadPhysics(r.Physics), AccSharedMemory.ReadGraphics(r.Graphics), r.Seconds))
            .OfType<TelemetryFrame>().ToList();
    }

    [Fact]
    public void Pages_become_frames_in_the_collectors_units_and_signs()
    {
        var frame = Frames(new AccDrive().Reads(0.1))[0];
        Assert.Equal("acc", frame.SimulatorId);
        Assert.Equal(150 / 3.6f, frame.SpeedMps!.Value, 4);
        Assert.Equal(3, frame.Gear); // ACC's 4 is third: 0 reverse, 1 neutral
        Assert.Equal(-0.25f, frame.SteeringInput); // positive left
        Assert.Null(frame.SteeringWheelAngleRadians); // no angle without the driver's wheel rotation
        Assert.Equal(27 * 6.894757f, frame.FrontLeft.PressureKpa!.Value, 3);
        Assert.Null(frame.FrontLeft.CarcassTempMiddleC); // only a core temperature, which isn't a carcass one
        Assert.Null(frame.FrontLeft.RideHeightMeters);
        Assert.Equal(62, frame.FuelLiters); // liters, whatever the document says
        Assert.Null(frame.OffTrack);
        Assert.Null(frame.IncidentCount);
        Assert.Null(frame.Tick);
        Assert.Equal(1f, frame.ClutchEngagement); // engaged, as ACC gives it
        Assert.Equal(-0.5f, frame.YawRadians); // ACC's heading grows turning right; iRacing's Yaw turning left
        Assert.Equal(-0.2f, frame.YawRateRadiansPerSecond); // turning right
        Assert.Equal(-0.8f * 9.80665f, frame.LatAccelMps2!.Value, 3); // pulled right
        Assert.Equal(-0.3f * 9.80665f, frame.LongAccelMps2!.Value, 3);
        Assert.Equal(1.1f * 9.80665f, frame.VertAccelMps2!.Value, 3); // gravity added, as iRacing's includes it
        Assert.False(frame.AbsActive);
        Assert.True(frame.IsOnTrack);
        Assert.False(frame.IsReplay);
        Assert.Equal(1, frame.LapNumber);
        Assert.Equal(0, frame.SessionNumber);
        Assert.Equal(0.9f, frame.LapDistancePct!.Value, 4);
        Assert.Equal(85, frame.WaterTempC);
        Assert.Null(frame.WindSpeedMps); // read 0 in both Spa sessions: not confirmed
        Assert.Equal(21, frame.AirTempC);
    }

    [Fact]
    public void A_page_physics_hasnt_moved_on_from_isnt_a_new_sample()
    {
        var builder = new AccFrameBuilder();
        var (_, physics, graphics) = new AccDrive().Reads(0.1).First();
        Assert.NotNull(builder.Next(AccSharedMemory.ReadPhysics(physics), AccSharedMemory.ReadGraphics(graphics), 0));
        Assert.Null(builder.Next(AccSharedMemory.ReadPhysics(physics), AccSharedMemory.ReadGraphics(graphics), 1 / 60.0));
    }

    [Fact]
    public void A_lap_ends_when_ACC_counts_it_with_its_own_time_and_validity()
    {
        var frames = Frames(new AccDrive().Reads(AccDrive.LapSeconds * 2 + 3, invalidLap: 2));
        var ended = frames.Where(f => f.LapJustEnded is not null).Select(f => f.LapJustEnded!).ToList();
        Assert.Equal(3, ended.Count); // the part lap to the line, then two whole ones
        Assert.All(ended, e => Assert.Equal(AccDrive.LapSeconds, e.LapTimeSeconds));
        Assert.Equal([1, 2, 3], ended.Select(e => e.LapNumber));
        Assert.Equal([true, true, false], ended.Select(e => e.Valid));
    }

    [Fact]
    public void A_new_session_starts_counting_laps_again_without_ending_one()
    {
        var builder = new AccFrameBuilder();
        var drive = new AccDrive();
        var first = drive.Reads(AccDrive.LapSeconds + 2).ToList();
        foreach (var (s, p, g) in first)
            builder.Next(AccSharedMemory.ReadPhysics(p), AccSharedMemory.ReadGraphics(g), s);
        // Session 1 starts with its counter at 0 and new packet ids
        var (_, physics, graphics) = drive.Reads(0.1, sessionIndex: 1).First();
        var page = AccSharedMemory.ReadPhysics(physics) with { PacketId = 1_000_000 };
        var frame = builder.Next(page, AccSharedMemory.ReadGraphics(graphics), 100);
        Assert.Null(frame!.LapJustEnded);
        Assert.Equal(1, frame.SessionNumber);
    }

    [Fact]
    public void The_session_names_ACCs_track_and_car()
    {
        var drive = new AccDrive();
        var graphics = AccSharedMemory.ReadGraphics(drive.Reads(0.1).First().Graphics);
        var session = AccFrameBuilder.Session(AccSharedMemory.ReadStatic(drive.Static.Bytes), graphics);
        Assert.Equal("spa", session.NativeTrackId);
        Assert.Equal("porsche_991ii_gt3_r", session.NativeCarId);
        Assert.Equal("Porsche 911 II GT3 R 2019", session.Car); // the PDF's name (Appendix 2)
        Assert.Equal("Max Driver", session.Driver);
        Assert.Null(session.TrackLengthMeters);
        Assert.Equal("Practice", session.SessionTypes[0]);
    }

    [Fact]
    public void Laps_are_split_on_ACCs_own_lap_events()
    {
        var laps = new List<TrackedLap>();
        var tracker = new FrameLapTracker(laps.Add, _ => { }, AccFrameBuilder.LapTrackerOptions);
        foreach (var frame in Frames(new AccDrive().Reads(AccDrive.LapSeconds * 2 + 3, invalidLap: 2)))
            tracker.OnFrame(frame);

        Assert.Equal(2, laps.Count); // the part lap before the first line crossing isn't one
        Assert.All(laps, lap => Assert.Equal(AccDrive.LapSeconds, lap.LapTimeSeconds));
        Assert.All(laps, lap => Assert.False(lap.LapTimeEstimated));
        Assert.Equal([2, 3], laps.Select(l => l.LapNumber));
        Assert.Equal([true, false], laps.Select(l => l.Valid));
        Assert.All(laps, lap => Assert.InRange(lap.Frames.Count, AccDrive.LapSeconds * AccDrive.Hz - 2, AccDrive.LapSeconds * AccDrive.Hz + 2));
    }
}

public sealed class AccRawRecordingTests
{
    private static MemoryStream Record(AccDrive drive, double seconds)
    {
        var file = new MemoryStream();
        using (var writer = new AccRawRecording.Writer(new NonClosing(file)))
        {
            foreach (var (s, physics, graphics) in drive.Reads(seconds))
            {
                writer.Static(s, drive.Static.Bytes); // written only when it changes
                writer.Sample(s, physics, graphics);
            }
        }
        file.Position = 0;
        return file;
    }

    [Fact]
    public void A_recording_plays_back_as_the_same_frames_as_live()
    {
        var drive = new AccDrive();
        var file = Record(drive, AccDrive.LapSeconds + 3);
        var sink = new RecordingSink();
        AccRecordingImporter.Import(file, sink);

        var builder = new AccFrameBuilder();
        var live = drive.Reads(AccDrive.LapSeconds + 3)
            .Select(r => builder.Next(AccSharedMemory.ReadPhysics(r.Physics), AccSharedMemory.ReadGraphics(r.Graphics), r.Seconds))
            .OfType<TelemetryFrame>().ToList();
        Assert.Equal(live, sink.Frames);
        Assert.Single(sink.Sessions);
        Assert.Equal([true, false], sink.Connections);
        Assert.Empty(sink.Errors);
    }

    [Fact]
    public void The_static_page_is_written_once_while_it_doesnt_change()
    {
        var records = AccRawRecording.Read(Record(new AccDrive(), 1)).ToList();
        Assert.Single(records, r => r.Static is not null);
        Assert.Equal(AccDrive.Hz, records.Count(r => r.Physics is not null));
    }

    [Fact]
    public void A_recording_cut_off_when_the_collector_closed_reads_up_to_the_cut()
    {
        var whole = Record(new AccDrive(), 1).ToArray();
        // Decompress, cut mid-record, compress again: what a file closed mid-write holds
        using var raw = new MemoryStream();
        using (var gzip = new GZipStream(new MemoryStream(whole), CompressionMode.Decompress))
            gzip.CopyTo(raw);
        var cut = raw.ToArray()[..^1000];
        using var file = new MemoryStream();
        using (var gzip = new GZipStream(file, CompressionLevel.Fastest, leaveOpen: true))
            gzip.Write(cut);
        file.Position = 0;
        Assert.Equal(AccDrive.Hz - 1, AccRawRecording.Read(file).Count(r => r.Physics is not null));
    }

    [Fact]
    public void Only_a_recording_is_recognized()
    {
        var importer = new AccRecordingImporter();
        Assert.True(importer.CanRead(Record(new AccDrive(), 0.1)));
        Assert.False(importer.CanRead(new MemoryStream(Encoding.ASCII.GetBytes("Speed,LapDistPct\n1,0.1\n"))));
        var otherGzip = new MemoryStream();
        using (var gzip = new GZipStream(otherGzip, CompressionLevel.Fastest, leaveOpen: true))
            gzip.Write(Encoding.ASCII.GetBytes("not an ACC recording at all"));
        otherGzip.Position = 0;
        Assert.False(importer.CanRead(otherGzip));
    }

    // The writer closes its stream when done; the test still needs to read it
    private sealed class NonClosing(Stream inner) : Stream
    {
        public override bool CanRead => false;
        public override bool CanSeek => false;
        public override bool CanWrite => true;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override void Flush() => inner.Flush();
        public override int Read(byte[] buffer, int offset, int count) => throw new NotSupportedException();
        public override long Seek(long offset, SeekOrigin origin) => throw new NotSupportedException();
        public override void SetLength(long value) => throw new NotSupportedException();
        public override void Write(byte[] buffer, int offset, int count) => inner.Write(buffer, offset, count);
    }
}
