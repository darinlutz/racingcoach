namespace RacingCoach.Collector;

/// <summary>One activity message: lap saved, uploaded, connected, a problem...</summary>
internal sealed record LogEntry(DateTime Time, string Message, bool IsError);

/// <summary>
/// The collector's activity messages, shown in the window and appended to Documents\RacingCoach\collector.log
/// (there's no console to scroll back through). Safe to write from any thread; Added is raised on the
/// writing thread.
/// </summary>
internal sealed class ActivityLog
{
    // At each start the file keeps only the messages of the last few days, and is cut back to its newest half when
    // it's still past MaxFileBytes
    public static readonly TimeSpan MaxAge = TimeSpan.FromDays(3);
    private const long MaxFileBytes = 2 * 1024 * 1024;

    public static ActivityLog Shared { get; } = new();

    private readonly object _lock = new();

    private ActivityLog()
    {
        FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RacingCoach", "collector.log");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            if (File.Exists(FilePath))
            {
                var text = KeepRecent(File.ReadAllText(FilePath), DateTime.Now - MaxAge);
                if (text.Length > MaxFileBytes)
                {
                    var keep = text[(text.Length / 2)..];
                    text = keep[(keep.IndexOf('\n') + 1)..];
                }
                File.WriteAllText(FilePath, text);
            }
        }
        catch (IOException)
        {
            // the log file is a convenience; the window still shows everything
        }
    }

    /// <summary>The log's text from its first message at or after <paramref name="since"/> (each line starts with
    /// its time, "yyyy-MM-dd HH:mm:ss"); "" when every message is older.</summary>
    internal static string KeepRecent(string text, DateTime since)
    {
        var start = 0;
        while (start < text.Length)
        {
            var end = text.IndexOf('\n', start);
            var line = text.AsSpan(start, (end < 0 ? text.Length : end) - start);
            if (line.Length >= 19 && DateTime.TryParseExact(line[..19], "yyyy-MM-dd HH:mm:ss",
                    System.Globalization.CultureInfo.InvariantCulture, System.Globalization.DateTimeStyles.None, out var time)
                && time >= since)
                return text[start..];
            if (end < 0)
                break;
            start = end + 1;
        }
        return "";
    }

    public string FilePath { get; }

    public event Action<LogEntry>? Added;

    public void Write(string message, bool isError = false)
    {
        // Messages about things that failed read as errors even when the caller didn't say so
        isError |= message.StartsWith("Could not", StringComparison.Ordinal)
            || message.Contains("did not accept", StringComparison.Ordinal)
            || message.Contains("no longer accepts", StringComparison.Ordinal);
        var entry = new LogEntry(DateTime.Now, message, isError);
        lock (_lock)
        {
            try
            {
                File.AppendAllText(FilePath, $"{entry.Time:yyyy-MM-dd HH:mm:ss} {(isError ? "ERROR " : "")}{message}{Environment.NewLine}");
            }
            catch (IOException)
            {
                // e.g. the file is open elsewhere; skip this line
            }
        }
        Added?.Invoke(entry);
    }
}
