namespace RacingCoach.Collector.Simulators;

/// <summary>
/// What a lap file may carry for a simulator: a frame with every channel the matrix (simulators/capabilities.json)
/// doesn't mark collected for it emptied, so the website shows it as Not Available rather than an unconfirmed number.
/// An adapter may read a documented channel (its raw recording, the proving work, needs it); it only reaches a lap
/// once the channel has been checked against the game and marked collected.
///
/// The lap's structure (LapDistancePct, lap number, session number and time, tick) is left alone: a lap can't be
/// made without it, and a simulator can't be marked supported before it's been checked. So are the frame's state
/// flags (pit road, off track, incidents, lap valid), which the lap tracker reads and the CSV doesn't hold.
/// </summary>
public static class ChannelGate
{
    /// <summary>The frame as a lap file may hold it for this simulator. iRacing's (and any frame whose simulator
    /// isn't in the matrix, which never uploads) is returned as it is.</summary>
    public static TelemetryFrame ForLapFile(TelemetryFrame frame, SimulatorDescription? simulator)
    {
        if (simulator is null || simulator.Id == "iracing") return frame;
        bool On(string channel) => simulator.Support(channel) is ChannelSupport.Collected or ChannelSupport.CollectedAfterStint;
        float? F(string channel, float? value) => On(channel) ? value : null;

        var geo = On("geoPosition");
        return frame with
        {
            LapDistanceMeters = F("lapDistance", frame.LapDistanceMeters),
            Latitude = geo ? frame.Latitude : null,
            Longitude = geo ? frame.Longitude : null,
            AltitudeMeters = geo ? frame.AltitudeMeters : null,
            SpeedMps = F("speed", frame.SpeedMps),
            VelocityForwardMps = F("velocityLocal", frame.VelocityForwardMps),
            VelocityLeftMps = F("velocityLocal", frame.VelocityLeftMps),
            LatAccelMps2 = F("latAccel", frame.LatAccelMps2),
            LongAccelMps2 = F("longAccel", frame.LongAccelMps2),
            VertAccelMps2 = F("vertAccel", frame.VertAccelMps2),
            YawRadians = F("yaw", frame.YawRadians),
            YawRateRadiansPerSecond = F("yawRate", frame.YawRateRadiansPerSecond),
            Throttle = F("throttle", frame.Throttle),
            Brake = F("brake", frame.Brake),
            ClutchEngagement = F("clutch", frame.ClutchEngagement),
            SteeringWheelAngleRadians = F("steeringAngle", frame.SteeringWheelAngleRadians),
            SteeringInput = F("steeringInput", frame.SteeringInput),
            Gear = On("gear") ? frame.Gear : null,
            Rpm = F("rpm", frame.Rpm),
            AbsActive = On("absActive") ? frame.AbsActive : null,
            FrontLeft = Wheel(frame.FrontLeft, On),
            FrontRight = Wheel(frame.FrontRight, On),
            RearLeft = Wheel(frame.RearLeft, On),
            RearRight = Wheel(frame.RearRight, On),
            WaterTempC = F("waterTemp", frame.WaterTempC),
            OilTempC = F("oilTemp", frame.OilTempC),
            FuelLiters = F("fuelLevel", frame.FuelLiters),
            FuelUseKgPerHour = F("fuelUse", frame.FuelUseKgPerHour),
            TrackTempC = F("weather", frame.TrackTempC),
            AirTempC = F("weather", frame.AirTempC),
            RelativeHumidity = F("weather", frame.RelativeHumidity),
            WindSpeedMps = F("weather", frame.WindSpeedMps),
            WindDirectionRadians = F("weather", frame.WindDirectionRadians),
        };
    }

    private static WheelTelemetry Wheel(WheelTelemetry wheel, Func<string, bool> on)
    {
        var carcass = on("tireCarcassTemp");
        return wheel with
        {
            PressureKpa = on("tirePressure") ? wheel.PressureKpa : null,
            RideHeightMeters = on("rideHeightCorner") ? wheel.RideHeightMeters : null,
            CarcassTempLeftC = carcass ? wheel.CarcassTempLeftC : null,
            CarcassTempMiddleC = carcass ? wheel.CarcassTempMiddleC : null,
            CarcassTempRightC = carcass ? wheel.CarcassTempRightC : null,
        };
    }
}
