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
    // The file is cut back to its newest half when it grows past this
    private const long MaxFileBytes = 2 * 1024 * 1024;

    public static ActivityLog Shared { get; } = new();

    private readonly object _lock = new();

    private ActivityLog()
    {
        FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments), "RacingCoach", "collector.log");
        try
        {
            Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
            if (File.Exists(FilePath) && new FileInfo(FilePath).Length > MaxFileBytes)
            {
                var text = File.ReadAllText(FilePath);
                var keep = text[(text.Length / 2)..];
                File.WriteAllText(FilePath, keep[(keep.IndexOf('\n') + 1)..]);
            }
        }
        catch (IOException)
        {
            // the log file is a convenience; the window still shows everything
        }
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
