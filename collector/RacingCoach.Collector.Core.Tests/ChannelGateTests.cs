using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector.Core.Tests;

public sealed class ChannelGateTests
{
    private static readonly TelemetryFrame Full = new()
    {
        SimulatorId = "acc",
        SessionTimeSeconds = 12.5,
        Tick = 750,
        SessionNumber = 1,
        LapNumber = 3,
        LapDistancePct = 0.42f,
        SpeedMps = 41.7f,
        Throttle = 0.8f,
        Brake = 0.1f,
        SteeringInput = -0.2f,
        Gear = 4,
        Rpm = 7200,
        WaterTempC = 88,
        FuelLiters = 50,
        FrontLeft = new WheelTelemetry { PressureKpa = 186, RideHeightMeters = 0.05f },
        OnPitRoad = false,
        LapValid = true,
        AirTempC = 22,
    };

    private static SimulatorDescription With(params (string Channel, ChannelSupport Support)[] channels) =>
        new("acc", "Test", "p1", SimulatorStatus.Documented, channels.ToDictionary(c => c.Channel, c => c.Support));

    [Fact]
    public void Only_collected_channels_reach_the_lap_file()
    {
        var gated = ChannelGate.ForLapFile(Full, With(
            ("speed", ChannelSupport.Collected),
            ("throttle", ChannelSupport.CollectedAfterStint),
            ("brake", ChannelSupport.Documented),
            ("rpm", ChannelSupport.Unavailable),
            ("gear", ChannelSupport.Unknown)));

        Assert.Equal(41.7f, gated.SpeedMps);
        Assert.Equal(0.8f, gated.Throttle);
        Assert.Null(gated.Brake);
        Assert.Null(gated.Rpm);
        Assert.Null(gated.Gear);
        // Not listed is Unknown
        Assert.Null(gated.SteeringInput);
        Assert.Null(gated.WaterTempC);
        Assert.Null(gated.FuelLiters);
        Assert.Null(gated.FrontLeft.PressureKpa);
        Assert.Null(gated.FrontLeft.RideHeightMeters);
        Assert.Null(gated.AirTempC);
    }

    [Fact]
    public void The_laps_structure_and_state_are_kept()
    {
        var gated = ChannelGate.ForLapFile(Full, With());
        Assert.Equal(Full.SessionTimeSeconds, gated.SessionTimeSeconds);
        Assert.Equal(Full.Tick, gated.Tick);
        Assert.Equal(Full.SessionNumber, gated.SessionNumber);
        Assert.Equal(Full.LapNumber, gated.LapNumber);
        Assert.Equal(Full.LapDistancePct, gated.LapDistancePct);
        Assert.Equal(Full.OnPitRoad, gated.OnPitRoad);
        Assert.Equal(Full.LapValid, gated.LapValid);
    }

    [Fact]
    public void IRacing_and_unknown_simulators_pass_through()
    {
        var iracing = Full with { SimulatorId = "iracing" };
        Assert.Same(iracing, ChannelGate.ForLapFile(iracing, SimulatorCatalog.Shared.Find("iracing")));
        Assert.Same(Full, ChannelGate.ForLapFile(Full, null));
    }

    [Fact]
    public void ACC_in_the_matrix_today_writes_only_the_channels_checked_in_the_game()
    {
        var acc = SimulatorCatalog.Shared.Find("acc");
        Assert.NotNull(acc);
        var gated = ChannelGate.ForLapFile(Full with { YawRadians = 1.2f, AbsActive = true, OilTempC = 100, FuelUseKgPerHour = 80 }, acc);
        Assert.Null(gated.FrontLeft.RideHeightMeters); // unavailable
        Assert.Null(gated.OilTempC); // unavailable
        Assert.Null(gated.FuelUseKgPerHour); // unavailable: fuelXLap isn't a rate
        // Checked against the two Spa recordings (docs/multi-simulator.md)
        Assert.Equal(41.7f, gated.SpeedMps);
        Assert.Equal(0.1f, gated.Brake);
        Assert.Equal(186, gated.FrontLeft.PressureKpa);
        Assert.Equal(1.2f, gated.YawRadians);
        Assert.Equal(50, gated.FuelLiters);
        Assert.True(gated.AbsActive);
        Assert.Equal(22, gated.AirTempC);
        // Every value written is one the matrix says ACC's adapter collects
        var row = LapCsvFormat.Row(gated, null).Split(',');
        var header = LapCsvFormat.Header.Split(',');
        var allowed = new[]
        {
            "LapDistPct", "Lap", "SessionTime", "SessionTick", // the lap's structure
            "Speed", "Brake", "Throttle", "RPM", "Gear", "Clutch", "ABSActive", "LatAccel", "LongAccel", "VertAccel", "Yaw",
            "YawRate", "VelocityX", "VelocityY", "FuelLevel", "WaterTemp", "LFpressure", "RFpressure", "LRpressure", "RRpressure",
        };
        Assert.All(header.Select((name, i) => (name, value: row[i])).Where(c => c.value != "" && c.name != "FuelKgPerLtr"),
            c => Assert.Contains(c.name, allowed));
    }

    [Fact]
    public void World_coordinates_reach_an_ACC_lap_file_in_columns_of_their_own()
    {
        var acc = SimulatorCatalog.Shared.Find("acc");
        Assert.NotNull(acc);
        var gated = ChannelGate.ForLapFile(Full with { WorldX = -996.07f, WorldY = 16.7f, WorldZ = -1773.08f }, acc);
        Assert.Equal(-996.07f, gated.WorldX);
        // After FuelKgPerLtr, so the header iRacing's files have always had stays as it is
        Assert.StartsWith(LapCsvFormat.Header + ",", LapCsvFormat.HeaderWithWorld);
        Assert.EndsWith(",WorldX,WorldY,WorldZ", LapCsvFormat.HeaderWithWorld);
        Assert.True(LapCsvFormat.HasWorld([gated]));
        Assert.False(LapCsvFormat.HasWorld([Full]));
        var row = LapCsvFormat.Row(gated, 0.75, withWorld: true).Split(',');
        Assert.Equal(LapCsvFormat.HeaderWithWorld.Split(',').Length, row.Length);
        Assert.Equal(["-996.07", "16.7", "-1773.08"], row[^3..]);
        // Without the flag, the row is iRacing's shape
        Assert.Equal(LapCsvFormat.Header.Split(',').Length, LapCsvFormat.Row(gated, 0.75).Split(',').Length);
        // Not latitude and longitude: those stay empty
        var header = LapCsvFormat.HeaderWithWorld.Split(',');
        Assert.Equal("", row[Array.IndexOf(header, "Lat")]);
    }

    [Fact]
    public void A_simulator_whose_world_position_isnt_collected_keeps_it_out()
    {
        var gated = ChannelGate.ForLapFile(Full with { WorldX = 1, WorldY = 2, WorldZ = 3 }, With(("worldPosition", ChannelSupport.Documented)));
        Assert.Null(gated.WorldX);
        Assert.False(LapCsvFormat.HasWorld([gated]));
    }
}
