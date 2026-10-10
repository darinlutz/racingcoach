using System.Diagnostics;
using System.Globalization;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>
/// Shows live telemetry as a fixed block at the bottom of the console, redrawn in place
/// about 10 times per second. Messages (connect, session) scroll above the block.
/// All console output goes through this class, so the SDK's handlers can call it from
/// different threads.
/// </summary>
internal sealed class TelemetryDisplay
{
    private const float MetersPerSecondToMph = 2.23694f;
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;

    private readonly object _lock = new();
    // When output is redirected to a file there is no cursor to move, so print one line per second instead.
    private readonly bool _interactive = !Console.IsOutputRedirected;
    private readonly int _renderIntervalMs;
    private readonly Stopwatch _sinceRender = new();
    private readonly Stopwatch _rateWindow = new();
    private int _samplesInWindow;
    private double _samplesPerSecond;
    private int _blockTop = -1; // console row where the block starts; -1 when no block is on screen
    private int _blockHeight;

    public TelemetryDisplay()
    {
        _renderIntervalMs = _interactive ? 100 : 1000;
    }

    /// <summary>Called for every telemetry sample (60 Hz); only redraws every render interval.</summary>
    public void OnSample(in TelemetryData data)
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

            var lines = Format(data);
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

    /// <summary>Leaves the last block on screen, moves the cursor below it and shows the cursor again.</summary>
    public void Close()
    {
        lock (_lock)
        {
            if (_interactive && _blockTop >= 0)
            {
                TryMoveCursor(_blockTop + _blockHeight);
                Console.CursorVisible = true;
            }
            _blockTop = -1;
        }
    }

    private string[] Format(in TelemetryData d) =>
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
    ];

    private static string Line(string label, string? value) => $"{label,-14}{value ?? "--"}";

    // Throttle and Brake are 0..1 in the SDK.
    private static string? Percent(float? value) =>
        value is { } v ? $"{Math.Clamp(Math.Round(v * 100), 0, 100).ToString("F0", Inv)}%" : null;

    private void DrawBlock(string[] lines)
    {
        try
        {
            var width = Math.Max(Console.WindowWidth - 1, 1);
            if (_blockTop < 0)
            {
                // First draw: WriteLine lets the console scroll if the cursor is at the bottom.
                Console.CursorVisible = false;
                foreach (var line in lines)
                    Console.WriteLine(Fit(line, width));
                _blockTop = Console.CursorTop - lines.Length;
                _blockHeight = lines.Length;
                return;
            }

            for (var i = 0; i < lines.Length; i++)
            {
                Console.SetCursorPosition(0, _blockTop + i);
                Console.Write(Fit(lines[i], width));
            }
        }
        catch (Exception e) when (e is IOException or ArgumentOutOfRangeException)
        {
            // The window was resized or scrolled; draw a fresh block next time.
            _blockTop = -1;
        }
    }

    private void ClearBlock()
    {
        if (!_interactive || _blockTop < 0)
            return;
        try
        {
            var blank = new string(' ', Math.Max(Console.WindowWidth - 1, 1));
            for (var i = 0; i < _blockHeight; i++)
            {
                Console.SetCursorPosition(0, _blockTop + i);
                Console.Write(blank);
            }
            Console.SetCursorPosition(0, _blockTop);
        }
        catch (Exception e) when (e is IOException or ArgumentOutOfRangeException)
        {
            // Nothing to clean up if the console moved underneath us.
        }
        _blockTop = -1;
    }

    private static void TryMoveCursor(int row)
    {
        try
        {
            Console.SetCursorPosition(0, Math.Min(row, Console.BufferHeight - 1));
        }
        catch (Exception e) when (e is IOException or ArgumentOutOfRangeException)
        {
        }
    }

    // Pad to clear leftovers from a longer previous value; cut to avoid wrapping in a narrow window.
    private static string Fit(string line, int width) =>
        line.Length >= width ? line[..width] : line.PadRight(width);
}
