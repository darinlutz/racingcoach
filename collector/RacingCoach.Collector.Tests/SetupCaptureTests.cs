namespace RacingCoach.Collector.Tests;

/// <summary>SetupCaptureTracker.ExtractCarSetup takes session info's CarSetup section exactly as iRacing wrote it, the
/// same way the website's extractCarSetupSection (src/lib/setupYaml.ts) does, against the BMW M4 GT3 EVO capture in
/// scripts/fixtures/setups/.</summary>
public sealed class SetupCaptureTests
{
    private static string Fixture()
    {
        var dir = new DirectoryInfo(AppContext.BaseDirectory);
        while (dir is not null && !File.Exists(Path.Combine(dir.FullName, "scripts", "fixtures", "setups", "bmwm4gt3-fixed-carsetup.yaml")))
            dir = dir.Parent;
        Assert.NotNull(dir);
        return File.ReadAllText(Path.Combine(dir!.FullName, "scripts", "fixtures", "setups", "bmwm4gt3-fixed-carsetup.yaml"));
    }

    [Fact]
    public void Takes_the_CarSetup_section_out_of_the_session_info()
    {
        var carSetup = Fixture();
        var session = "---\nWeekendInfo:\n TrackName: twinring fullrc\n WeekendOptions:\n  IsFixedSetup: 0\nDriverInfo:\n DriverSetupName: fixed.sto\n" + carSetup;
        var section = SetupCaptureTracker.ExtractCarSetup(session.Replace("\n", "\r\n"));
        Assert.NotNull(section);
        Assert.StartsWith("CarSetup:\n UpdateCount: 5\n TiresAero:\n", section);
        Assert.Contains("   SpringRate: 223 N/mm\n", section);
        Assert.EndsWith("   HighSpeedReboundDamping: 11 clicks\n", section);
        Assert.DoesNotContain("...", section);
        Assert.DoesNotContain("DriverSetupName", section);
    }

    [Fact]
    public void Stops_at_the_next_top_level_key_and_needs_values()
    {
        Assert.Equal("CarSetup:\n UpdateCount: 1\n", SetupCaptureTracker.ExtractCarSetup("CarSetup:\n UpdateCount: 1\nSplitTimeInfo:\n Sectors:\n"));
        Assert.Null(SetupCaptureTracker.ExtractCarSetup("CarSetup:\nDriverInfo:\n x: 1\n"));
        Assert.Null(SetupCaptureTracker.ExtractCarSetup("WeekendInfo:\n TrackName: x\n"));
    }
}
