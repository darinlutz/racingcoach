using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

public class StandstillTests
{
    [Fact]
    public void StillForTenMinutesIsNotYetTooLong()
    {
        var watch = new StandstillWatch();
        Assert.False(watch.Update(0, 100));
        Assert.False(watch.Update(0.2f, 100 + StandstillWatch.MaxStillSeconds));
        Assert.True(watch.Update(0, 100 + StandstillWatch.MaxStillSeconds + 0.1));
    }

    [Fact]
    public void MovingOrAnUnknownSpeedStartsTheCountAgain()
    {
        var watch = new StandstillWatch();
        Assert.False(watch.Update(0, 0));
        Assert.False(watch.Update(10, 500));
        Assert.False(watch.Update(0, 501));
        Assert.False(watch.Update(0, 1000));
        Assert.False(watch.Update(null, 1050));
        Assert.False(watch.Update(0, 1100));
        Assert.True(watch.Update(0, 1701));
    }

    [Fact]
    public void FindsALongStopInALapsSamples()
    {
        Assert.True(StandstillWatch.HasLongStop([(0, 30f), (1, 0f), (700, 0f), (800, 30f)]));
        Assert.False(StandstillWatch.HasLongStop([(0, 30f), (1, 0f), (500, 0f), (501, 30f), (502, 0f), (1000, 0f)]));
    }

    // A lap at 60 Hz, then sitting still for 11 minutes partway round the next one, then driving on: the first lap is
    // saved, the lap with the stop isn't, and the lap after it is recorded as usual
    [Fact]
    public void TheTrackerThrowsAwayALapWithALongStop()
    {
        var laps = new List<TrackedLap>();
        var discarded = new List<string>();
        var tracker = new FrameLapTracker(laps.Add, discarded.Add);
        var tick = 0;
        void Drive(float from, float to, float speed, double seconds)
        {
            var frames = (int)(seconds * 60);
            for (var i = 0; i < frames; i++)
            {
                var pct = from + (to - from) * i / frames;
                tracker.OnFrame(new TelemetryFrame
                {
                    SimulatorId = "test",
                    SessionTimeSeconds = tick / 60.0,
                    Tick = tick++,
                    SessionNumber = 0,
                    LapDistancePct = pct % 1,
                    SpeedMps = speed,
                    IsOnTrack = true,
                    IsReplay = false,
                });
            }
        }

        Drive(0.95f, 1f, 40, 3);      // to the line
        Drive(0f, 1f, 40, 60);        // lap 1
        Drive(0f, 0.5f, 40, 30);      // half of lap 2
        Drive(0.5f, 0.5f, 0, 11 * 60); // sat still
        Drive(0.5f, 1f, 40, 30);      // rest of lap 2
        Drive(0f, 1f, 40, 60);        // lap 3
        Drive(0f, 0.05f, 40, 3);

        Assert.Equal(2, laps.Count);
        Assert.Contains(discarded, message => message.Contains("sat still"));
    }
}
