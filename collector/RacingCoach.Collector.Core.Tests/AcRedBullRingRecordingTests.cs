using System.Runtime.CompilerServices;
using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

/// <summary>
/// The second real Assetto Corsa recording, made with --simulator ac --record-raw on 2026-11-10 (AC 1.16.4, shared
/// memory 1.7, Ferrari 488 GT3 at Red Bull Ring National, fuel use on), cut to the documented bytes of each page:
/// Fixtures/ac-red-bull-ring-national-restart.acraw.gz is the first 8 s after the collector connected (AC's static page
/// still held the Spa session before it, until AC loaded this one), then the 0:54.414 lap and the session restart
/// after it. It holds the track id with a layout, the fuel and the session counting to what the game did.
/// See docs/multi-simulator.md.
/// </summary>
public sealed class AcRedBullRingRecordingTests
{
    private static readonly Lazy<RecordingSink> Recording = new(() => Replay("ac-red-bull-ring-national-restart.acraw.gz"));

    private static RecordingSink Replay(string fixture, [CallerFilePath] string caller = "")
    {
        var sink = new RecordingSink();
        using var file = File.OpenRead(Path.Combine(Path.GetDirectoryName(caller)!, "Fixtures", fixture));
        AcRecordingImporter.Import(file, sink);
        return sink;
    }

    private static List<TelemetryFrame> Frames => Recording.Value.Frames;

    private static List<TrackedLap> Laps()
    {
        var laps = new List<TrackedLap>();
        var tracker = new FrameLapTracker(laps.Add, _ => { }, AcFrameBuilder.LapTrackerOptions);
        foreach (var frame in Frames) tracker.OnFrame(frame);
        return laps;
    }

    private static TrackedLap Lap4() => Assert.Single(Laps(), lap => Math.Abs(lap.LapTimeSeconds - 54.414) < 0.001);

    [Fact]
    public void It_names_the_track_with_its_layout_and_never_the_last_sessions_Spa()
    {
        Assert.NotEmpty(Recording.Value.Sessions);
        Assert.All(Recording.Value.Sessions, session =>
        {
            Assert.Equal("ks_red_bull_ring/layout_national", session.NativeTrackId);
            Assert.Equal("ks_red_bull_ring (layout_national)", session.Track);
            Assert.Equal("layout_national", session.TrackLayout);
            Assert.Equal("ks_ferrari_488_gt3", session.NativeCarId);
            Assert.Equal(2317, session.TrackLengthMeters!.Value, 0);
        });
        Assert.Empty(Recording.Value.Errors);
    }

    [Fact]
    public void Fuel_is_liters_and_falls_about_a_GT3s_lap_worth()
    {
        var frames = Lap4().Frames;
        var used = frames[0].FuelLiters!.Value - frames[^1].FuelLiters!.Value;
        Assert.InRange(used, 1.0, 1.4); // 26.891 to 25.682 in the recording
        for (var i = 1; i < frames.Count; i++)
            Assert.True(frames[i].FuelLiters <= frames[i - 1].FuelLiters + 0.001f, $"fuel never rises in the lap, at {i}");
    }

    [Fact]
    public void A_restart_starts_a_new_session_with_the_tank_filled_again()
    {
        var before = Frames.Where(f => f.SessionTimeSeconds < 319).ToList();
        var after = Frames.Where(f => f.SessionTimeSeconds > 324).ToList();
        Assert.NotEmpty(before);
        Assert.NotEmpty(after);
        var session = before[^1].SessionNumber!.Value;
        Assert.All(after, f => Assert.Equal(session + 1, f.SessionNumber));
        Assert.Equal(1, after[0].LapNumber); // the lap being driven: AC's completedLaps went back to 0
        Assert.Equal(30, after[0].FuelLiters!.Value, 2);
        Assert.Equal(session, Lap4().SessionNumber);
    }

    [Fact]
    public void The_lap_file_runs_from_the_line_to_the_line()
    {
        var lap = Lap4();
        var frames = AcFrameBuilder.ForLapFile(lap.Frames);
        Assert.Equal(0, frames[0].LapDistancePct!.Value, 4);
        Assert.Equal(0, frames[^1].LapDistancePct!.Value, 4);
        for (var i = 1; i < frames.Count - 1; i++)
            Assert.True(frames[i].LapDistancePct > frames[i - 1].LapDistancePct, $"position goes on increasing at {i}");
        Assert.InRange(frames[^1].SessionTimeSeconds!.Value - frames[0].SessionTimeSeconds!.Value, lap.LapTimeSeconds - 0.05, lap.LapTimeSeconds + 0.05);
        Assert.DoesNotContain(frames, f => f.Gear == 0);
        Assert.All(frames, f => Assert.Equal(26, f.AirTempC!.Value, 1));
        Assert.All(frames, f => Assert.Equal(34, f.TrackTempC!.Value, 1));
    }
}
