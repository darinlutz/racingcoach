using RacingCoach.Collector.Simulators;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// ACC's sample as iRacing's TelemetryData, for the live features that read it (the In-Car AI Coach, brake beeps,
/// overlays, the Rotation Model, Live Racing, Driver Radio and the window), so they run on ACC unchanged. The frame
/// (AccFrameBuilder) has the converted motion and inputs; the graphics and static pages add what lap files don't need
/// (lap times, delta, position, time left, flags, fuel). What ACC doesn't give stays null, as in the frame: incidents,
/// track surface, the field's CarIdx arrays, iRacing's radio and .ibt recording, and brake bias (ACC's has an offset
/// per car the shared memory doesn't give).
/// </summary>
internal static class AccLiveTelemetry
{
    // ACC's "no time yet" (INT_MAX) and anything past an hour aren't lap times
    private const int MaxLapMs = 3_600_000;

    // iRacing's irsdk_Flags bits (SessionFlags) that ACC's flags have a match for
    private const uint Checkered = 0x1, White = 0x2, Green = 0x4, Yellow = 0x8, Red = 0x10, Blue = 0x20, Black = 0x10000;

    public static TelemetryData From(TelemetryFrame f, AccPhysics physics, AccGraphics g, AccStatic info) => new()
    {
        Speed = f.SpeedMps,
        Throttle = f.Throttle,
        Brake = f.Brake,
        Gear = f.Gear,
        RPM = f.Rpm,
        LapDistPct = f.LapDistancePct,
        Lap = f.LapNumber,
        SessionTime = f.SessionTimeSeconds,
        Clutch = f.ClutchEngagement,
        SteeringWheelAngle = f.SteeringWheelAngleRadians,
        BrakeABSactive = f.AbsActive,
        LatAccel = f.LatAccelMps2,
        LongAccel = f.LongAccelMps2,
        VertAccel = f.VertAccelMps2,
        Yaw = f.YawRadians,
        YawRate = f.YawRateRadiansPerSecond,
        VelocityX = f.VelocityForwardMps,
        VelocityY = f.VelocityLeftMps,
        SessionNum = f.SessionNumber,
        // The overlay's script starts over when this or SessionNum changes
        SessionUniqueID = g.SessionIndex,
        IsOnTrack = f.IsOnTrack,
        IsReplayPlaying = f.IsReplay,
        OnPitRoad = f.OnPitRoad,
        FuelLevel = f.FuelLiters,
        FuelLevelPct = info.MaxFuel > 0 ? Math.Clamp(physics.Fuel / info.MaxFuel, 0, 1) : null,
        WaterTemp = f.WaterTempC,
        TrackTempCrew = f.TrackTempC,
        AirTemp = f.AirTempC,
        LapCurrentLapTime = LapSeconds(g.CurrentTimeMs) ?? 0,
        // iRacing's -1 is "none yet", which the coach and Live Racing already read that way
        LapLastLapTime = LapSeconds(g.LastTimeMs) ?? -1,
        LapBestLapTime = LapSeconds(g.BestTimeMs) ?? -1,
        LapDeltaToBestLap = LapSeconds(g.BestTimeMs) is null ? null : g.DeltaLapTimeMs / 1000f,
        PlayerCarPosition = g.Position > 0 ? g.Position : null,
        // ACC's sessionTimeLeft is in milliseconds; a lap race gives none
        SessionTimeRemain = g.SessionTimeLeft > 0 ? g.SessionTimeLeft / 1000.0 : null,
        SessionLapsTotal = g.Session == AccSessionType.Race && g.NumberOfLaps > 0 ? g.NumberOfLaps : null,
        SessionLapsRemainEx = g.Session == AccSessionType.Race && g.NumberOfLaps > 0 ? Math.Max(0, g.NumberOfLaps - g.CompletedLaps) : null,
        SessionFlags = Flags(g),
        Precipitation = Rain(g.RainIntensity),
    };

    private static float? LapSeconds(int ms) => ms is > 0 and < MaxLapMs ? ms / 1000f : null;

    // The session's flag (ACC's global flags) and the driver's own (its flag field), as iRacing's bits
    private static uint Bits(AccGraphics g)
    {
        uint bits = 0;
        if (g.GlobalGreen) bits |= Green;
        if (g.GlobalYellow) bits |= Yellow;
        if (g.GlobalWhite) bits |= White;
        if (g.GlobalChequered) bits |= Checkered;
        if (g.GlobalRed) bits |= Red;
        bits |= g.Flag switch
        {
            AccFlag.Blue => Blue,
            AccFlag.Yellow => Yellow,
            AccFlag.Black or AccFlag.Penalty => Black,
            AccFlag.White => White,
            AccFlag.Checkered => Checkered,
            AccFlag.Green => Green,
            _ => 0u,
        };
        return bits;
    }

    private static SessionFlags Flags(AccGraphics g) => (SessionFlags)Bits(g);

    // ACC's rain intensity as a share, like iRacing's Precipitation
    private static float? Rain(AccRainIntensity rain) => rain switch
    {
        AccRainIntensity.NoRain => 0f,
        AccRainIntensity.Drizzle => 0.1f,
        AccRainIntensity.LightRain => 0.3f,
        AccRainIntensity.MediumRain => 0.5f,
        AccRainIntensity.HeavyRain => 0.75f,
        AccRainIntensity.Thunderstorm => 1f,
        _ => null,
    };
}
