using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

/// <summary>AC driving round at a steady pace, as its pages would show it. Pages are laid out from the PDF's own field
/// list (AcDocumentedLayout), so these tests don't share the parser's offsets.</summary>
internal sealed class AcDrive
{
    public const double LapSeconds = 12.5;
    public const int Hz = 60;

    public AccPage Static { get; } = new AccPage(AcDocumentedLayout.Static)
        .Text("smVersion", "1.7").Text("acVersion", "1.16.4").Text("track", "ks_nurburgring").Text("trackConfiguration", "layout_gp_a")
        .Text("carModel", "ks_porsche_911_gt3_r_2016").Text("playerName", "Max").Text("playerSurname", "Driver")
        .Float("trackSPlineLength", 5137.5f);

    /// <summary>The pages at each 60 Hz read, starting 90% round the lap; AC's lap counter goes up one read after the
    /// line, with its lap time. A restart at restartAt seconds counts laps from 0 again.</summary>
    public IEnumerable<(double Seconds, byte[] Physics, byte[] Graphics)> Reads(double seconds, AcSessionType session = AcSessionType.Practice, double? restartAt = null)
    {
        var completed = 0;
        var lapStarted = 0.0;
        var lapMs = (int)(LapSeconds * 1000);
        float? prevPct = null;
        var crossedLastRead = false;
        var restarted = false;
        for (var i = 0; i < seconds * Hz; i++)
        {
            var t = i / (double)Hz;
            var pct = (float)((0.9 + t / LapSeconds) % 1.0);
            var crossedNow = prevPct is > 0.9f && pct < 0.1f;
            prevPct = pct;
            if (restartAt is { } at && t >= at && !restarted)
            {
                restarted = true;
                completed = 0;
            }
            var physics = new AccPage(AcDocumentedLayout.Physics)
                .Int("packetId", i + 1).Float("gas", 0.8f).Float("brake", 0.1f).Int("gear", 4).Int("rpms", 7000)
                .Float("steerAngle", 0.25f).Float("speedKmh", 150).Float("fuel", 40).Float("airTemp", 21).Float("roadTemp", 30)
                .Float("clutch", 1).Float("abs", 0.2f).Float("heading", 0.5f)
                .Float("localAngularVel", -0.2f, 1).Float("accG", -0.8f, 0).Float("accG", 0.1f, 1).Float("accG", -0.3f, 2)
                .Float("localVelocity", 41.5f, 2).Float("localVelocity", 0.3f, 0);
            for (var w = 0; w < 4; w++)
                physics.Float("wheelsPressure", 27, w);
            var graphics = new AccPage(AcDocumentedLayout.Graphics)
                .Int("packetId", i + 1).Int("status", (int)AcStatus.Live).Int("session", (int)session)
                .Float("normalizedCarPosition", pct)
                .Float("carCoordinates", 100 + (float)t, 0).Float("carCoordinates", 5, 1).Float("carCoordinates", -200, 2)
                .Float("windSpeed", 3).Float("windDirection", 90);
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

public sealed class AcFrameBuilderTests
{
    private static (List<TelemetryFrame> Frames, AcFrameBuilder Builder) Frames(IEnumerable<(double Seconds, byte[] Physics, byte[] Graphics)> reads)
    {
        var builder = new AcFrameBuilder();
        var frames = reads.Select(r => builder.Next(AcSharedMemory.ReadPhysics(r.Physics), AcSharedMemory.ReadGraphics(r.Graphics), r.Seconds))
            .OfType<TelemetryFrame>().ToList();
        return (frames, builder);
    }

    [Fact]
    public void Pages_become_frames_in_the_collectors_units_and_signs()
    {
        var frame = Frames(new AcDrive().Reads(0.1)).Frames[0];
        Assert.Equal("ac", frame.SimulatorId);
        Assert.Equal(150 / 3.6f, frame.SpeedMps!.Value, 3);
        Assert.Equal(3, frame.Gear); // AC's 4 is third
        Assert.Equal(7000, frame.Rpm);
        Assert.Equal(0.8f, frame.Throttle);
        Assert.Equal(0.1f, frame.Brake);
        Assert.Equal(1, frame.ClutchEngagement); // engaged: AC's clutch is engagement, not the pedal
        Assert.Equal(-0.25f, frame.SteeringInput); // + right in AC, + left in the frame
        Assert.Null(frame.SteeringWheelAngleRadians); // no wheel rotation given
        Assert.Equal(41.5f, frame.VelocityForwardMps);
        Assert.Equal(0.3f, frame.VelocityLeftMps);
        Assert.Equal(-0.2f, frame.YawRateRadiansPerSecond);
        Assert.Equal(-0.5f, frame.YawRadians);
        Assert.Equal(-0.8f * 9.80665f, frame.LatAccelMps2!.Value, 3);
        Assert.Equal(-0.3f * 9.80665f, frame.LongAccelMps2!.Value, 3);
        Assert.Equal(1.1f * 9.80665f, frame.VertAccelMps2!.Value, 3);
        Assert.Equal(27 * 6.894757f, frame.FrontLeft.PressureKpa!.Value, 3);
        Assert.Equal(40, frame.FuelLiters);
        Assert.Equal(21, frame.AirTempC);
        Assert.Equal(30, frame.TrackTempC);
        Assert.Equal(100 + 1f / AcDrive.Hz, frame.WorldX!.Value, 4); // the second read: the first is never a frame
        Assert.Equal(-200, frame.WorldZ);
        Assert.Equal(true, frame.IsOnTrack);
        // What AC's page doesn't give, or gives only as a setting, stays unknown rather than 0
        Assert.Null(frame.AbsActive);
        Assert.Null(frame.WaterTempC);
        Assert.Equal(false, frame.OffTrack);
        Assert.Null(frame.LapValid);
        Assert.Null(frame.WindSpeedMps);
        Assert.Null(frame.Tick);
    }

    [Fact]
    public void Laps_end_on_acs_own_count_with_its_lap_time_and_count_from_its_timing_line()
    {
        var (frames, _) = Frames(new AcDrive().Reads(3 * AcDrive.LapSeconds));
        var ends = frames.Where(f => f.LapJustEnded is not null).ToList();
        Assert.Equal(3, ends.Count);
        Assert.All(ends, f => Assert.Equal(AcDrive.LapSeconds, f.LapJustEnded!.LapTimeSeconds));
        Assert.All(ends, f => Assert.Null(f.LapJustEnded!.Valid)); // AC doesn't say
        Assert.Equal([2, 3, 4], ends.Select(f => f.LapNumber!.Value));
        // After the first count, the lap position is 0 on the read AC counted it
        Assert.True(ends[1].LapDistancePct is < 0.001f or > 0.999f, $"{ends[1].LapDistancePct}");
    }

    [Fact]
    public void With_the_wheel_rotation_the_input_is_the_wheels_angle()
    {
        var builder = new AcFrameBuilder(900);
        var frames = new AcDrive().Reads(0.1)
            .Select(r => builder.Next(AcSharedMemory.ReadPhysics(r.Physics), AcSharedMemory.ReadGraphics(r.Graphics), r.Seconds))
            .OfType<TelemetryFrame>().ToList();
        // 0.25 of 450° to the right is 112.5° to the right: negative, as iRacing's
        Assert.Equal(-112.5 * Math.PI / 180, frames[0].SteeringWheelAngleRadians!.Value, 4);
        builder.SteeringRangeDegrees = null;
        var read = new AcDrive().Reads(1).Last();
        Assert.Null(builder.Next(AcSharedMemory.ReadPhysics(Bump(read.Physics, 99_999)), AcSharedMemory.ReadGraphics(read.Graphics), 1)!.SteeringWheelAngleRadians);
    }

    [Fact]
    public void All_four_wheels_out_is_off_track()
    {
        var builder = new AcFrameBuilder();
        var reads = new AcDrive().Reads(0.1).ToList();
        var tyresOut = DocumentedPages.Layout(AcDocumentedLayout.Physics).Offsets["numberOfTyresOut"];
        TelemetryFrame? With(int read, int wheels)
        {
            var physics = reads[read].Physics.ToArray();
            BitConverter.GetBytes(wheels).CopyTo(physics, tyresOut);
            return builder.Next(AcSharedMemory.ReadPhysics(physics), AcSharedMemory.ReadGraphics(reads[read].Graphics), reads[read].Seconds);
        }
        Assert.Null(With(0, 0)); // the first read is never a frame
        Assert.Equal(false, With(1, 2)!.OffTrack); // a kerb
        Assert.Equal(false, With(2, 3)!.OffTrack);
        Assert.Equal(true, With(3, 4)!.OffTrack);
    }

    [Fact]
    public void A_repeated_read_is_not_a_sample_and_the_first_isnt_one_either()
    {
        var builder = new AcFrameBuilder();
        var reads = new AcDrive().Reads(0.05).ToList();
        var physics = AcSharedMemory.ReadPhysics(reads[0].Physics);
        var graphics = AcSharedMemory.ReadGraphics(reads[0].Graphics);
        // Another game's pages left in the maps look like this until AC writes: a read that never changes
        Assert.Null(builder.Next(physics, graphics, 0));
        Assert.Null(builder.Next(physics, graphics, 0.016));
        Assert.False(builder.PagesAreLive);
        var moved = (AcSharedMemory.ReadPhysics(reads[1].Physics), AcSharedMemory.ReadGraphics(reads[1].Graphics));
        Assert.NotNull(builder.Next(moved.Item1, moved.Item2, 0.033));
        Assert.True(builder.PagesAreLive);
        Assert.Null(builder.Next(moved.Item1, moved.Item2, 0.05)); // paused: packetId hasn't moved
    }

    [Fact]
    public void Another_games_pages_left_in_the_maps_give_no_session()
    {
        // As on 2026-11-09 at 23:58: AC started while the maps still held ACC's last session, and wrote its own 8 s later
        var drive = new AcDrive();
        var stale = new AccPage(AcDocumentedLayout.Static).Text("smVersion", "1.9").Text("acVersion", "1.7")
            .Text("track", "brands_hatch").Text("carModel", "mclaren_720s_gt3");
        var first = drive.Reads(0.02).First();
        using var file = new MemoryStream();
        using (var writer = AcRawRecording.Writer(new NonClosingStream(file), 2048, 2048, 2048))
        {
            writer.Static(0, Padded(stale.Bytes));
            for (var i = 0; i < 480; i++) // 8 s of the same pages
                writer.Sample(i / 60.0, Padded(first.Physics), Padded(first.Graphics));
            writer.Static(8, Padded(drive.Static.Bytes));
            foreach (var (seconds, physics, graphics) in drive.Reads(2).Skip(1))
                writer.Sample(8 + seconds, Padded(physics), Padded(graphics));
        }
        file.Position = 0;
        var sink = new RecordingSink();
        AcRecordingImporter.Import(file, sink);
        Assert.Equal("ks_nurburgring/layout_gp_a", Assert.Single(sink.Sessions).NativeTrackId);
        Assert.All(sink.Frames, f => Assert.True(f.SessionTimeSeconds >= 8));
    }

    [Fact]
    public void A_restart_or_a_new_session_type_is_a_new_session()
    {
        var drive = new AcDrive();
        var (frames, builder) = Frames(drive.Reads(2.5 * AcDrive.LapSeconds, restartAt: 2 * AcDrive.LapSeconds));
        Assert.Equal([0, 1], frames.Select(f => f.SessionNumber!.Value).Distinct());
        Assert.Equal(1, builder.SessionNumber);

        var practice = drive.Reads(1).ToList();
        var race = drive.Reads(1, AcSessionType.Race).Select((r, i) => (r.Seconds + 1, r.Physics, r.Graphics)).ToList();
        // Physics packetIds repeat between the two drives, so make them differ
        var (both, _) = Frames(practice.Concat(race.Select((r, i) => (r.Item1, Bump(r.Physics, 10_000 + i), r.Graphics))));
        Assert.Equal([0, 1], both.Select(f => f.SessionNumber!.Value).Distinct());
    }

    [Fact]
    public void The_session_names_the_track_with_its_layout_and_keeps_acs_ids()
    {
        var drive = new AcDrive();
        var info = AcSharedMemory.ReadStatic(drive.Static.Bytes);
        var graphics = AcSharedMemory.ReadGraphics(drive.Reads(0.02).First().Graphics);
        var session = AcFrameBuilder.Session(info, graphics, 0);
        Assert.Equal("ac", session.SimulatorId);
        Assert.Equal("ks_nurburgring/layout_gp_a", session.NativeTrackId);
        Assert.Equal("ks_nurburgring (layout_gp_a)", session.Track);
        Assert.Equal("layout_gp_a", session.TrackLayout);
        Assert.Equal(5137.5, session.TrackLengthMeters!.Value, 1);
        Assert.Equal("ks_porsche_911_gt3_r_2016", session.NativeCarId);
        Assert.Equal("Max Driver", session.Driver);
        Assert.Equal("Practice", session.SessionTypes[0]);

        var single = AcSharedMemory.ReadStatic(new AccPage(AcDocumentedLayout.Static).Text("track", "spa").Bytes);
        Assert.Equal("spa", AcFrameBuilder.TrackId(single));
        Assert.Null(AcFrameBuilder.Session(single, graphics, 0).TrackLengthMeters); // none given
    }

    [Fact]
    public void A_recording_plays_back_through_the_same_builder_and_isnt_taken_for_accs()
    {
        var drive = new AcDrive();
        using var file = new MemoryStream();
        using (var writer = AcRawRecording.Writer(new NonClosingStream(file), 2048, 2048, 2048))
        {
            writer.Static(0, Padded(drive.Static.Bytes));
            foreach (var (seconds, physics, graphics) in drive.Reads(2 * AcDrive.LapSeconds))
                writer.Sample(seconds, Padded(physics), Padded(graphics));
        }

        file.Position = 0;
        Assert.True(new AcRecordingImporter().CanRead(file));
        file.Position = 0;
        Assert.False(new AccRecordingImporter().CanRead(file));
        file.Position = 0;
        var sink = new RecordingSink();
        AcRecordingImporter.Import(file, sink);

        Assert.Equal([true, false], sink.Connections);
        Assert.Equal("ks_nurburgring/layout_gp_a", Assert.Single(sink.Sessions).NativeTrackId);
        Assert.Equal((int)(2 * AcDrive.LapSeconds * AcDrive.Hz) - 1, sink.Frames.Count); // the first read is never a frame
        Assert.Equal(2, sink.Frames.Count(f => f.LapJustEnded is not null));
    }

    [Fact]
    public void A_page_shorter_than_documented_isnt_recorded()
    {
        Assert.Throws<ArgumentException>(() => AcRawRecording.Writer(new MemoryStream(), AcSharedMemory.PhysicsSize - 4));
    }

    private static byte[] Padded(byte[] page)
    {
        var bytes = new byte[2048];
        page.CopyTo(bytes, 0);
        return bytes;
    }

    private static byte[] Bump(byte[] physics, int packetId)
    {
        var copy = physics.ToArray();
        BitConverter.GetBytes(packetId).CopyTo(copy, 0);
        return copy;
    }

    private sealed class NonClosingStream(Stream inner) : Stream
    {
        public override bool CanRead => inner.CanRead;
        public override bool CanSeek => inner.CanSeek;
        public override bool CanWrite => inner.CanWrite;
        public override long Length => inner.Length;
        public override long Position { get => inner.Position; set => inner.Position = value; }
        public override void Flush() => inner.Flush();
        public override int Read(byte[] buffer, int offset, int count) => inner.Read(buffer, offset, count);
        public override long Seek(long offset, SeekOrigin origin) => inner.Seek(offset, origin);
        public override void SetLength(long value) => inner.SetLength(value);
        public override void Write(byte[] buffer, int offset, int count) => inner.Write(buffer, offset, count);
    }
}
