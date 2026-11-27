using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

public class PitLimiterTests
{
    [Fact]
    public void ThePitSpeedLimiterBitIsIRacings()
    {
        // irsdk_defines.h's irsdk_pitSpeedLimiter, the SDK's EngineWarnings.PitSpeedLimiter
        Assert.Equal(0x10, PitLimiter.IRacingPitSpeedLimiterBit);
    }

    [Theory]
    [InlineData(0x10, true)]
    [InlineData(0x10 | 0x20 | 0x01, true)] // with the rev limiter and a water temperature warning
    [InlineData(0x00, false)]
    [InlineData(0x20, false)] // the rev limiter alone
    [InlineData(0x08 | 0x40, false)] // engine stalled, oil temperature
    public void ReadsOnlyTheLimiterBit(int bits, bool active)
    {
        Assert.Equal(active, PitLimiter.FromIRacingEngineWarnings(bits, replayPlaying: false));
    }

    [Fact]
    public void UnknownWhenTheVariableIsMissingOrAReplayIsPlaying()
    {
        Assert.Null(PitLimiter.FromIRacingEngineWarnings(null, replayPlaying: false));
        Assert.Null(PitLimiter.FromIRacingEngineWarnings(0x10, replayPlaying: true));
        Assert.True(PitLimiter.FromIRacingEngineWarnings(0x10, replayPlaying: null));
    }
}
