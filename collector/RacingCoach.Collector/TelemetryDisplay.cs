using System.Diagnostics;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Text;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// Shows live telemetry as a fixed block at the bottom of the console, redrawn in place
/// about 10 times per second. Messages (connect, session, laps) scroll above the block.
/// All console output goes through this class, so the SDK's handlers can call it from
/// different threads.
/// </summary>
/// <remarks>
/// The block is redrawn with VT escape codes that move the cursor relative to where it is
/// (up N lines), so it keeps working when the console scrolls or is resized.
/// </remarks>
internal sealed class TelemetryDisplay
{
    private const float MetersPerSecondToMph = 2.23694f;
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private readonly object _lock = new();
    // Without a VT-capable console (e.g. output redirected to a file), print one line per second instead.
    private readonly bool _interactive = !Console.IsOutputRedirected && EnableVirtualTerminal();
    private readonly int _renderIntervalMs;
    private readonly Stopwatch _sinceRender = new();
    private readonly Stopwatch _rateWindow = new();
    private int _samplesInWindow;
    private double _samplesPerSecond;
    private int _blockHeight; // lines of the block currently on screen; the cursor sits just below them

    public TelemetryDisplay()
    {
        _renderIntervalMs = _interactive ? 100 : 1000;
    }

    /// <summary>Called for every telemetry sample (60 Hz); only redraws every render interval.</summary>
    public void OnSample(in TelemetryData data, string recording)
    {
        lock (_lock)
        {
            if (!_rateWindow.IsRunning)
                _rateWindow.Start();
            _samplesInWindow++;
            if (_rateWindow.ElapsedMilliseconds >= 1000)
            {
                _samplesPerSecond = _samplesInWindow * 1000.0 / _rateWindow.ElapsedMilliseconds;
                _samplesInWindow = 0;
                _rateWindow.Restart();
            }

            if (_sinceRender.IsRunning && _sinceRender.ElapsedMilliseconds < _renderIntervalMs)
                return;
            _sinceRender.Restart();

            var lines = Format(data, recording);
            if (_interactive)
                DrawBlock(lines);
            else
                Console.WriteLine(string.Join(" | ", lines.Select(l => string.Join(' ', l.Split(' ', StringSplitOptions.RemoveEmptyEntries)))));
        }
    }

    /// <summary>Starts the samples-per-second measurement over, e.g. after a reconnect.</summary>
    public void ResetRate()
    {
        lock (_lock)
        {
            _rateWindow.Reset();
            _samplesInWindow = 0;
            _samplesPerSecond = 0;
        }
    }

    /// <summary>Prints a message above the live block; the block is redrawn below it on the next sample.</summary>
    public void WriteMessage(string message, bool isError = false)
    {
        lock (_lock)
        {
            ClearBlock();
            (isError ? Console.Error : Console.Out).WriteLine(message);
        }
    }

    /// <summary>Leaves the last block on screen (the cursor is already below it) and shows the cursor again.</summary>
    public void Close()
    {
        lock (_lock)
        {
            if (_interactive)
                Console.Out.Write("\e[?25h");
            _blockHeight = 0;
        }
    }

    private string[] Format(in TelemetryData d, string recording) =>
    [
        Line("Speed:", d.Speed is { } mps ? $"{(mps * MetersPerSecondToMph).ToString("F1", Inv)} MPH" : null),
        Line("Throttle:", Percent(d.Throttle)),
        Line("Brake:", Percent(d.Brake)),
        Line("Gear:", d.Gear switch { null => null, -1 => "R", 0 => "N", var g => g.Value.ToString(Inv) }),
        Line("RPM:", d.RPM?.ToString("N0", Inv)),
        Line("Lap Distance:", d.LapDistPct is { } pct ? $"{(pct * 100).ToString("F2", Inv)}%" : null),
        Line("Lap:", d.Lap?.ToString(Inv)),
        Line("Session Time:", d.SessionTime is { } t ? $"{t.ToString("F2", Inv)} seconds" : null),
        Line("Telemetry:", $"{_samplesPerSecond.ToString("F1", Inv)} samples/s"),
        Line("Recording:", recording),
    ];

    private static string Line(string label, string? value) => $"{label,-14}{value ?? "--"}";

    // Throttle and Brake are 0..1 in the SDK.
    private static string? Percent(float? value) =>
        value is { } v ? $"{Math.Clamp(Math.Round(v * 100), 0, 100).ToString("F0", Inv)}%" : null;

    private void DrawBlock(string[] lines)
    {
        var width = WindowWidth();
        var sb = new StringBuilder();
        if (_blockHeight > 0)
            sb.Append($"\e[{_blockHeight}F"); // up to the start of the block
        else
            sb.Append("\e[?25l");             // hide the cursor while the block is shown
        foreach (var line in lines)
            sb.Append("\e[2K").Append(line.Length > width ? line[..width] : line).Append('\n');
        if (_blockHeight > lines.Length)
            sb.Append("\e[0J");               // erase leftovers of a taller block
        Console.Out.Write(sb.ToString());     // one write per frame keeps it flicker-free
        Console.Out.Flush();
        _blockHeight = lines.Length;
    }

    private void ClearBlock()
    {
        if (!_interactive || _blockHeight == 0)
            return;
        Console.Out.Write($"\e[{_blockHeight}F\e[0J"); // up to the start of the block, erase to the end of the screen
        _blockHeight = 0;
    }

    // Cut lines to the window width so they never wrap (a wrapped line breaks the "up N lines" redraw).
    private static int WindowWidth()
    {
        try
        {
            return Math.Max(Console.WindowWidth - 1, 1);
        }
        catch (IOException)
        {
            return 80;
        }
    }

    // Windows 10's classic console only understands VT escape codes once this mode is switched on.
    private static bool EnableVirtualTerminal()
    {
        const int StdOutputHandle = -11;
        const uint EnableVirtualTerminalProcessing = 0x0004;
        if (!OperatingSystem.IsWindows())
            return true;
        var handle = GetStdHandle(StdOutputHandle);
        return GetConsoleMode(handle, out var mode)
            && ((mode & EnableVirtualTerminalProcessing) != 0 || SetConsoleMode(handle, mode | EnableVirtualTerminalProcessing));
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr GetStdHandle(int nStdHandle);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool GetConsoleMode(IntPtr hConsoleHandle, out uint lpMode);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool SetConsoleMode(IntPtr hConsoleHandle, uint dwMode);
}
