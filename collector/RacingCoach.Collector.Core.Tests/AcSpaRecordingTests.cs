using System.Runtime.CompilerServices;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

/// <summary>
/// Real Assetto Corsa recordings, made with --simulator ac --record-raw on 2026-11-10 (AC 1.16.4, shared memory 1.7,
/// Ferrari 488 GT3 at Spa, a 900° wheel, 26 °C air and 34 °C track) and cut to the documented bytes of each page:
/// Fixtures/ac-spa-ferrari-488-gt3-lap.acraw.gz is the 2:32.163 lap and 3 s either side;
/// Fixtures/ac-spa-ferrari-488-gt3-off-track-pit-stop.acraw.gz is the off at Les Combes (all four wheels out) and the
/// stop in the pit box (steering held left then right, then reverse). They hold AcConventions to what the game did,
/// so a convention changed by mistake fails here. See docs/multi-simulator.md.
/// </summary>
public sealed class AcSpaRecordingTests
{
    private static readonly Lazy<RecordingSink> Lap = new(() => Replay("ac-spa-ferrari-488-gt3-lap.acraw.gz"));
    private static readonly Lazy<RecordingSink> OffAndPits = new(() => Replay("ac-spa-ferrari-488-gt3-off-track-pit-stop.acraw.gz"));

    private static RecordingSink Replay(string fixture, float? steeringRange = null, [CallerFilePath] string caller = "")
    {
        var sink = new RecordingSink();
        using var file = File.OpenRead(Path.Combine(Path.GetDirectoryName(caller)!, "Fixtures", fixture));
        AcRecordingImporter.Import(file, sink, steeringRangeDegrees: steeringRange);
        return sink;
    }

    private static List<TelemetryFrame> Frames => Lap.Value.Frames;
    private static IEnumerable<TelemetryFrame> Moving => Frames.Where(f => f.SpeedMps > 60 / 3.6f);

    // La Source, the right hairpin after the line: around the slowest point between 1% and 8% of the lap
    private static List<TelemetryFrame> LaSource(List<TelemetryFrame> frames)
    {
        var zone = frames.Where(f => f.LapNumber == 2 && f.LapDistancePct is > 0.01f and < 0.08f).ToList();
        var apex = zone.MinBy(f => f.SpeedMps)!;
        return zone.Where(f => Math.Abs(f.SessionTimeSeconds!.Value - apex.SessionTimeSeconds!.Value) < 0.7).ToList();
    }

    [Fact]
    public void It_names_Spa_and_the_Ferrari()
    {
        var session = Assert.Single(Lap.Value.Sessions);
        Assert.Equal("spa", session.NativeTrackId);
        Assert.Equal("spa", session.Track);
        Assert.Null(session.TrackLayout);
        Assert.Equal("ks_ferrari_488_gt3", session.NativeCarId);
        Assert.Equal(6946, session.TrackLengthMeters!.Value, 0); // iRacing's Spa is 7004 m
        Assert.Empty(Lap.Value.Errors);
    }

    [Fact]
    public void AC_counts_the_lap_with_its_own_time()
    {
        var ended = Frames.Select(f => f.LapJustEnded).OfType<NativeLapEvent>().ToList();
        Assert.Equal(2, ended.Count);
        Assert.Equal(227.778, ended[0].LapTimeSeconds!.Value, 3); // the out lap
        Assert.Equal(152.163, ended[1].LapTimeSeconds!.Value, 3); // as AC showed it
        Assert.All(ended, e => Assert.Null(e.Valid)); // AC doesn't say
        var lapFrames = Frames.Where(f => f.LapNumber == 2).ToList();
        Assert.InRange(lapFrames[^1].SessionTimeSeconds!.Value - lapFrames[0].SessionTimeSeconds!.Value, 151.9, 152.4);
    }

    [Fact]
    public void La_Source_is_a_right_turn_in_first_gear()
    {
        var corner = LaSource(Frames);
        Assert.All(corner, f => Assert.Equal(1, f.Gear)); // AC's 2 is first
        Assert.True(corner.Average(f => f.SteeringInput!.Value) < -0.3); // right is negative, as iRacing's
        Assert.True(corner.Average(f => f.YawRateRadiansPerSecond!.Value) < -0.5); // turning right
        var lat = corner.Average(f => f.LatAccelMps2!.Value);
        var kinematic = corner.Average(f => f.SpeedMps!.Value * f.YawRateRadiansPerSecond!.Value);
        Assert.True(lat < -10);
        Assert.InRange(lat / kinematic, 0.85, 1.25);
    }

    [Fact]
    public void With_a_900_degree_wheel_La_Source_is_a_GT3s_steering_angle_to_the_right()
    {
        var sink = Replay("ac-spa-ferrari-488-gt3-lap.acraw.gz", 900);
        var degrees = LaSource(sink.Frames).Average(f => f.SteeringWheelAngleRadians!.Value) * 180 / MathF.PI;
        Assert.InRange(degrees, -260, -150); // ACC's Spa recordings: -170 to -260
        Assert.All(sink.Frames, f => Assert.InRange(f.SteeringWheelAngleRadians!.Value * 180 / MathF.PI - f.SteeringInput!.Value * 450, -0.01, 0.01));
        Assert.All(Frames, f => Assert.Null(f.SteeringWheelAngleRadians));
    }

    [Fact]
    public void Yaw_turns_the_same_way_as_the_yaw_rate_and_points_where_the_car_goes()
    {
        var pairs = new List<(double Rate, double FromYaw)>();
        var headings = new List<double>();
        for (var i = 1; i < Frames.Count; i++)
        {
            var (a, b) = (Frames[i - 1], Frames[i]);
            var dt = b.SessionTimeSeconds!.Value - a.SessionTimeSeconds!.Value;
            if (dt is <= 0 or > 0.05 || b.SpeedMps < 60 / 3.6f)
                continue;
            // The direction of travel in the world, (x, z) as AC's own: Yaw is atan2(dx, dz)
            var travel = Math.Atan2(b.WorldX!.Value - a.WorldX!.Value, b.WorldZ!.Value - a.WorldZ!.Value);
            headings.Add(Math.IEEERemainder(travel - b.YawRadians!.Value, 2 * Math.PI));
            if (Math.Abs(b.YawRateRadiansPerSecond!.Value) < 0.2)
                continue;
            var change = Math.IEEERemainder((double)b.YawRadians!.Value - a.YawRadians!.Value, 2 * Math.PI);
            pairs.Add((b.YawRateRadiansPerSecond!.Value, change / dt));
        }
        Assert.True(pairs.Count > 1000);
        Assert.InRange(pairs.Average(p => p.FromYaw / p.Rate), 0.9, 1.1);
        Assert.InRange(headings.Average(), -0.05, 0.05);
    }

    [Fact]
    public void Velocity_is_the_cars_own_and_accelerations_have_gravity_added()
    {
        Assert.InRange(Moving.Average(f => f.VelocityForwardMps!.Value / f.SpeedMps!.Value), 0.98, 1.02);
        Assert.InRange(Moving.Average(f => Math.Abs(f.VelocityLeftMps!.Value)), 0, 1.5);
        Assert.InRange(Moving.Average(f => f.VertAccelMps2!.Value), 9.0, 10.6);
        var braking = Moving.Where(f => f.Brake > 0.8f).ToList();
        Assert.NotEmpty(braking);
        Assert.True(braking.Average(f => f.LongAccelMps2!.Value) < -5);
    }

    [Fact]
    public void The_clutch_is_engaged_while_driving()
    {
        Assert.True(Moving.Average(f => f.ClutchEngagement!.Value) > 0.95);
    }

    [Fact]
    public void Speeds_pressures_gears_and_weather_are_in_range()
    {
        Assert.InRange(Frames.Max(f => f.SpeedMps!.Value) * 3.6, 245, 260);
        Assert.InRange(Moving.Average(f => f.FrontLeft.PressureKpa!.Value) / 6.894757, 20, 27); // psi, set to 16 cold
        Assert.Equal(6, Frames.Max(f => f.Gear));
        Assert.DoesNotContain(Frames, f => f.Gear < 0 && f.SpeedMps > 1);
        Assert.All(Frames, f => Assert.Equal(26, f.AirTempC!.Value, 1));
        Assert.All(Frames, f => Assert.Equal(34, f.TrackTempC!.Value, 1));
        Assert.DoesNotContain(Frames, f => f.OffTrack == true); // kerbs, but never all four wheels out
    }

    private static TrackedLap FlyingLap()
    {
        var laps = new List<TrackedLap>();
        var tracker = new FrameLapTracker(laps.Add, _ => { }, AcFrameBuilder.LapTrackerOptions);
        foreach (var frame in Frames) tracker.OnFrame(frame);
        return Assert.Single(laps, lap => Math.Abs(lap.LapTimeSeconds - 152.163) < 0.001);
    }

    [Fact]
    public void The_lap_file_counts_from_ACs_timing_line_and_shifts_straight_to_the_next_gear()
    {
        var lap = FlyingLap();
        Assert.Contains(lap.Frames, f => f.Gear == 0 && f.SpeedMps > 20); // AC's neutral in the middle of a shift
        // The tracker started the lap at the spline's 0, 4 reads before AC counted it at 0.0005: those are left out
        Assert.Equal(4, lap.Frames.TakeWhile(f => f.LapNumber == 1).Count());
        var frames = AcFrameBuilder.ForLapFile(lap.Frames);
        Assert.Equal(lap.Frames.Count - 4, frames.Count);
        Assert.Equal(0, frames[0].LapDistancePct!.Value, 4);
        Assert.Equal(0, frames[^1].LapDistancePct!.Value, 4);
        for (var i = 1; i < frames.Count - 1; i++)
            Assert.True(frames[i].LapDistancePct > frames[i - 1].LapDistancePct, $"position goes on increasing at {i}");
        var span = frames[^1].SessionTimeSeconds!.Value - frames[0].SessionTimeSeconds!.Value;
        Assert.InRange(span, lap.LapTimeSeconds - 0.05, lap.LapTimeSeconds + 0.05);
        Assert.DoesNotContain(frames, f => f.Gear == 0);
        for (var i = 1; i < frames.Count; i++)
            Assert.InRange(Math.Abs(frames[i].Gear!.Value - frames[i - 1].Gear!.Value), 0, 1);
    }

    [Fact]
    public void World_coordinates_are_meters_round_the_lap_and_turn_as_ACCs()
    {
        var frames = AcFrameBuilder.ForLapFile(FlyingLap().Frames);
        double length = 0, area = 0;
        for (var i = 1; i < frames.Count; i++)
        {
            var (a, b) = (frames[i - 1], frames[i]);
            length += Math.Sqrt(Math.Pow(b.WorldX!.Value - a.WorldX!.Value, 2) + Math.Pow(b.WorldY!.Value - a.WorldY!.Value, 2) + Math.Pow(b.WorldZ!.Value - a.WorldZ!.Value, 2));
            area += a.WorldX!.Value * b.WorldZ!.Value - b.WorldX!.Value * a.WorldZ!.Value;
        }
        Assert.InRange(length, 6850, 7050);
        Assert.InRange(frames.Max(f => f.WorldY!.Value) - frames.Min(f => f.WorldY!.Value), 90, 115); // y is up
        // Anticlockwise with x as east and z as north, like ACC's, so the website's fit (mirrored, then turned) holds
        Assert.True(area > 0);
    }

    [Fact]
    public void All_four_wheels_out_at_Les_Combes_is_off_track()
    {
        var off = OffAndPits.Value.Frames.Where(f => f.OffTrack == true).ToList();
        Assert.InRange(off.Count, 50, 90); // 1.2 s
        Assert.All(off, f => Assert.InRange(f.LapDistancePct!.Value, 0.55f, 0.57f));
    }

    [Fact]
    public void In_the_pit_box_the_wheel_went_left_then_right_then_the_car_reversed()
    {
        var box = OffAndPits.Value.Frames.Where(f => f.SessionTimeSeconds is > 793 and < 802 && f.SpeedMps < 0.1f).ToList();
        Assert.NotEmpty(box);
        Assert.All(box, f => Assert.Equal(true, f.OnPitRoad));
        // Left is positive in the frame, as iRacing's
        var left = box.Where(f => f.SessionTimeSeconds < 797).Max(f => f.SteeringInput!.Value);
        var right = box.Where(f => f.SessionTimeSeconds > 798).Min(f => f.SteeringInput!.Value);
        Assert.InRange(left, 0.35, 0.42);
        Assert.InRange(right, -0.42, -0.35);
        var reversing = OffAndPits.Value.Frames.Where(f => f.SessionTimeSeconds is > 808 and < 811).ToList();
        Assert.All(reversing, f => Assert.Equal(-1, f.Gear));
        Assert.All(reversing, f => Assert.True(f.VelocityForwardMps < 0));
    }
}
