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
    public void ACC_in_the_matrix_today_writes_no_unconfirmed_channel()
    {
        var acc = SimulatorCatalog.Shared.Find("acc");
        Assert.NotNull(acc);
        var gated = ChannelGate.ForLapFile(Full, acc);
        Assert.Null(gated.SteeringWheelAngleRadians); // unavailable: ACC only gives the input
        Assert.Null(gated.FrontLeft.RideHeightMeters); // unavailable
        // Documented, not yet checked in the game
        Assert.Null(gated.SpeedMps);
        Assert.Null(gated.Brake);
        // Every value written is one the matrix says ACC's adapter collects
        var row = LapCsvFormat.Row(gated, null).Split(',');
        var header = LapCsvFormat.Header.Split(',');
        var structure = new[] { "LapDistPct", "Lap", "SessionTime", "SessionTick" };
        Assert.All(header.Select((name, i) => (name, value: row[i])).Where(c => c.value != "" && c.name != "FuelKgPerLtr"),
            c => Assert.Contains(c.name, structure));
    }
}
