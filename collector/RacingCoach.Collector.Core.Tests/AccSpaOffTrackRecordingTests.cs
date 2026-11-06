using System.Runtime.CompilerServices;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

/// <summary>
/// The second real ACC recording (Fixtures/acc-spa-huracan-gt3-evo-off-track-pit-entry.accraw.gz): a practice lap at
/// Spa in the Huracán GT3 Evo, recorded with --record-raw on 2026-11-05 at 18:36, with a deliberate trip off the track
/// early in the lap and the pit lane at its end, cut from 3 s before the lap before it ends to 3 s after it. ACC reset
/// isValidLap at the line a read before it counted the lap, and fuel didn't go down all session. See
/// docs/multi-simulator.md.
/// </summary>
public sealed class AccSpaOffTrackRecordingTests
{
    private static readonly Lazy<RecordingSink> Replay = new(() =>
    {
        var sink = new RecordingSink();
        using var file = File.OpenRead(FixturePath());
        AccRecordingImporter.Import(file, sink);
        return sink;
    });

    private static string FixturePath([CallerFilePath] string caller = "") =>
        Path.Combine(Path.GetDirectoryName(caller)!, "Fixtures", "acc-spa-huracan-gt3-evo-off-track-pit-entry.accraw.gz");

    private static List<TelemetryFrame> Frames => Replay.Value.Frames;
    private static IEnumerable<TelemetryFrame> Moving => Frames.Where(f => f.SpeedMps > 60 / 3.6f);

    [Fact]
    public void The_lap_off_the_track_is_invalid_though_ACC_reset_the_flag_before_counting_it()
    {
        var ended = Frames.Select(f => f.LapJustEnded).OfType<NativeLapEvent>().ToList();
        Assert.Equal(2, ended.Count);
        Assert.Equal(150.325, ended[0].LapTimeSeconds!.Value, 3);
        Assert.True(ended[0].Valid);
        Assert.Equal(165.130, ended[1].LapTimeSeconds!.Value, 3);
        Assert.False(ended[1].Valid);
        // The frame before the event already says valid: the next lap's
        var last = Frames.IndexOf(Frames.Last(f => f.LapJustEnded is not null));
        Assert.True(Frames[last - 1].LapValid);
    }

    [Fact]
    public void The_tracker_saves_one_invalid_in_lap_not_the_late_event_of_the_lap_before()
    {
        var laps = new List<TrackedLap>();
        var tracker = new FrameLapTracker(laps.Add, _ => { }, AccFrameBuilder.LapTrackerOptions);
        foreach (var frame in Frames)
            tracker.OnFrame(frame);
        var lap = Assert.Single(laps);
        Assert.Equal(165.130, lap.LapTimeSeconds, 3);
        Assert.False(lap.Valid);
        Assert.Equal(LapKind.InLap, lap.Kind);
        Assert.True(lap.OnPitRoad);
        // Within a second of ACC's time: this in lap's frames span 0.6 s less than it
        Assert.InRange(lap.Frames[^1].SessionTimeSeconds!.Value - lap.Frames[0].SessionTimeSeconds!.Value, 164.1, 165.4);
    }

    [Fact]
    public void Fuel_is_in_liters_and_ACC_burned_none()
    {
        Assert.All(Moving, f => Assert.Equal(62, f.FuelLiters));
    }

    [Fact]
    public void ABS_is_only_on_under_braking()
    {
        var abs = Frames.Where(f => f.AbsActive == true).ToList();
        Assert.True(abs.Count > 50);
        // Into the trail braking too, at a light pedal
        Assert.True(abs.Count(f => f.Brake > 0.05f) > abs.Count * 0.95);
    }

    [Fact]
    public void Air_and_track_temperatures_are_degrees_C()
    {
        Assert.InRange(Moving.Average(f => f.AirTempC!.Value), 20, 35);
        Assert.InRange(Moving.Average(f => f.TrackTempC!.Value), 20, 40);
    }
}
