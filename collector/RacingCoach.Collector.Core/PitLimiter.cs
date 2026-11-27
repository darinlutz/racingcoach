namespace RacingCoach.Collector.Simulators;

/// <summary>
/// Whether the car's pit speed limiter is on, as the simulator reports it: never worked out from pit road, the speed
/// or the in-car control. Null means the simulator doesn't give it (or isn't live), never "off".
///
/// iRacing: the EngineWarnings telemetry variable, a bitfield of the dash's warning lights, whose irsdk_pitSpeedLimiter
/// bit is 0x10 (irsdk_defines.h; the SDK's EngineWarnings.PitSpeedLimiter). It's set while the limiter is engaged,
/// in or out of the pit lane, and it isn't OnPitRoad (where the car is) or dcPitSpeedLimiterToggle (the in-car
/// control, which not every car has). ACC's and AC's physics pages have pitLimiterOn, which isn't used until a real
/// recording proves it (docs/multi-simulator.md).
/// </summary>
public static class PitLimiter
{
    public const int IRacingPitSpeedLimiterBit = 0x10;

    /// <summary>iRacing's EngineWarnings bits, or null when the variable isn't there or a replay is playing (the
    /// replayed car's dash isn't the driver's own).</summary>
    public static bool? FromIRacingEngineWarnings(int? engineWarnings, bool? replayPlaying) =>
        replayPlaying == true || engineWarnings is not { } bits ? null : (bits & IRacingPitSpeedLimiterBit) != 0;
}
