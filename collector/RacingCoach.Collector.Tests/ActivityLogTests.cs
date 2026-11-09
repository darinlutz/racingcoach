namespace RacingCoach.Collector.Tests;

/// <summary>collector.log keeps only the last few days' messages (ActivityLog.MaxAge), trimmed at each start.</summary>
public sealed class ActivityLogTests
{
    private static readonly DateTime Since = new(2026, 11, 6, 12, 0, 0);

    [Fact]
    public void Keeps_messages_from_the_cutoff_on()
    {
        var text = "2026-11-01 09:00:00 old\n2026-11-06 11:59:59 just before\n2026-11-06 12:00:00 kept\n2026-11-09 08:30:00 newest\n";
        Assert.Equal("2026-11-06 12:00:00 kept\n2026-11-09 08:30:00 newest\n", ActivityLog.KeepRecent(text, Since));
    }

    [Fact]
    public void Keeps_a_message_s_further_lines_with_it()
    {
        var text = "2026-11-01 09:00:00 old\nsecond line of old\n2026-11-07 10:00:00 ERROR new\r\nsecond line of new\r\n";
        Assert.Equal("2026-11-07 10:00:00 ERROR new\r\nsecond line of new\r\n", ActivityLog.KeepRecent(text, Since));
    }

    [Fact]
    public void Empties_a_log_with_only_older_messages()
    {
        Assert.Equal("", ActivityLog.KeepRecent("2026-11-01 09:00:00 old\nmore\n", Since));
        Assert.Equal("", ActivityLog.KeepRecent("", Since));
    }
}
