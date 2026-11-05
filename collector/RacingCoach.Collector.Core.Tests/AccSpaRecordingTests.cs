using System.Runtime.CompilerServices;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

/// <summary>
/// A real ACC recording (Fixtures/acc-spa-huracan-gt3-evo-lap.accraw.gz): the one valid lap of a practice session at
/// Spa in the Lamborghini Huracán GT3 Evo, recorded with --record-raw on 2026-11-05 (shared memory 1.9), cut to that
/// lap and 3 s either side. It holds AccConventions to what the game actually did, so a convention changed by mistake
/// fails here. See docs/multi-simulator.md.
/// </summary>
public sealed class AccSpaRecordingTests
{
    private static readonly Lazy<RecordingSink> Replay = new(() =>
    {
        var sink = new RecordingSink();
        using var file = File.OpenRead(FixturePath());
        AccRecordingImporter.Import(file, sink);
        return sink;
    });

    private static string FixturePath([CallerFilePath] string caller = "") =>
        Path.Combine(Path.GetDirectoryName(caller)!, "Fixtures", "acc-spa-huracan-gt3-evo-lap.accraw.gz");

    private static List<TelemetryFrame> Frames => Replay.Value.Frames;
    private static IEnumerable<TelemetryFrame> Moving => Frames.Where(f => f.SpeedMps > 60 / 3.6f);

    // La Source, the right hairpin after the line: around the slowest point between 1% and 8% of the lap
    private static List<TelemetryFrame> LaSource()
    {
        var zone = Frames.Where(f => f.LapNumber == 2 && f.LapDistancePct is > 0.01f and < 0.08f).ToList();
        var apex = zone.MinBy(f => f.SpeedMps)!;
        return zone.Where(f => Math.Abs(f.SessionTimeSeconds!.Value - apex.SessionTimeSeconds!.Value) < 0.7).ToList();
    }

    [Fact]
    public void It_names_Spa_and_the_Huracan()
    {
        var session = Assert.Single(Replay.Value.Sessions);
        Assert.Equal("Spa", session.NativeTrackId);
        Assert.Equal("lamborghini_huracan_gt3_evo", session.NativeCarId);
        Assert.Empty(Replay.Value.Errors);
    }

    [Fact]
    public void ACC_counts_the_lap_with_its_own_time_and_validity()
    {
        // The cut starts 3 s before the out lap ends (ACC marked it invalid) and ends 3 s after the flying lap
        var ended = Frames.Select(f => f.LapJustEnded).OfType<NativeLapEvent>().ToList();
        Assert.Equal(2, ended.Count);
        Assert.Equal(153.570, ended[0].LapTimeSeconds!.Value, 3);
        Assert.False(ended[0].Valid);
        Assert.Equal(154.135, ended[1].LapTimeSeconds!.Value, 3);
        Assert.True(ended[1].Valid);
        // ACC's own time matches the time between its line crossings
        var lapFrames = Frames.Where(f => f.LapNumber == 2).ToList();
        Assert.InRange(lapFrames[^1].SessionTimeSeconds!.Value - lapFrames[0].SessionTimeSeconds!.Value, 153.9, 154.4);
    }

    [Fact]
    public void La_Source_is_a_right_turn_in_first_gear()
    {
        var corner = LaSource();
        Assert.All(corner, f => Assert.Equal(1, f.Gear)); // ACC's 2 is first
        Assert.True(corner.Average(f => f.SteeringInput!.Value) < -0.3); // right is negative, as iRacing's
        Assert.True(corner.Average(f => f.YawRateRadiansPerSecond!.Value) < -0.5); // turning right
        // Pulled right, as hard as speed × yaw rate says
        var lat = corner.Average(f => f.LatAccelMps2!.Value);
        var kinematic = corner.Average(f => f.SpeedMps!.Value * f.YawRateRadiansPerSecond!.Value);
        Assert.True(lat < -10);
        Assert.InRange(lat / kinematic, 0.85, 1.25);
    }

    [Fact]
    public void Yaw_turns_the_same_way_as_the_yaw_rate()
    {
        var pairs = new List<(double Rate, double FromYaw)>();
        for (var i = 1; i < Frames.Count; i++)
        {
            var (a, b) = (Frames[i - 1], Frames[i]);
            var dt = b.SessionTimeSeconds!.Value - a.SessionTimeSeconds!.Value;
            if (dt is <= 0 or > 0.05 || b.SpeedMps < 60 / 3.6f || Math.Abs(b.YawRateRadiansPerSecond!.Value) < 0.2)
                continue;
            var change = (double)b.YawRadians!.Value - a.YawRadians!.Value;
            change = Math.IEEERemainder(change, 2 * Math.PI);
            pairs.Add((b.YawRateRadiansPerSecond!.Value, change / dt));
        }
        Assert.True(pairs.Count > 1000);
        Assert.InRange(pairs.Average(p => p.FromYaw / p.Rate), 0.9, 1.1);
    }

    [Fact]
    public void Accelerations_are_the_cars_own_with_gravity_in_the_vertical()
    {
        Assert.InRange(Moving.Average(f => f.VertAccelMps2!.Value), 9.0, 10.6);
        var braking = Moving.Where(f => f.Brake > 0.8f).ToList();
        Assert.NotEmpty(braking);
        Assert.True(braking.Average(f => f.LongAccelMps2!.Value) < -5);
    }

    [Fact]
    public void The_clutch_is_engaged_while_driving()
    {
        Assert.True(Moving.Average(f => f.ClutchEngagement!.Value) > 0.99);
    }

    [Fact]
    public void Speeds_pressures_and_gears_are_in_range()
    {
        Assert.InRange(Frames.Max(f => f.SpeedMps!.Value) * 3.6, 240, 255);
        Assert.InRange(Moving.Average(f => f.VelocityForwardMps!.Value / f.SpeedMps!.Value), 0.98, 1.02);
        Assert.InRange(Moving.Average(f => f.FrontLeft.PressureKpa!.Value) / 6.894757, 24, 29); // psi, hot
        Assert.Equal(6, Frames.Max(f => f.Gear));
        // Never reverse on the move
        Assert.DoesNotContain(Frames, f => f.Gear < 0 && f.SpeedMps > 1);
    }
}
