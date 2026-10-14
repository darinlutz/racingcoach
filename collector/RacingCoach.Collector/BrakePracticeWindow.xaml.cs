using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Brake Practice button opens: a see-through, always-on-top window, like the overlay, that reads
/// the brake straight from the Simucube pedals over USB (iRacing doesn't need to be running). First it calibrates
/// the pedal from two full presses, then it graphs the brake (0-100%) over the last few seconds as the driver
/// presses it, with lines at 20, 40, 60, 80 and 100%, and a readout of the exact percentage being applied. In the
/// user's Preferred Language.
/// </summary>
public partial class BrakePracticeWindow : Window
{
    private static readonly double[] GuideLines = [20, 40, 60, 80, 100];
    private static readonly TimeSpan History = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan RescanEvery = TimeSpan.FromSeconds(2);
    // How long "Calibration complete" shows before the graph
    private static readonly TimeSpan CompleteFor = TimeSpan.FromSeconds(1.5);
    private const double LabelWidth = 40; // left margin for the 20%..100% labels
    private const double TopPad = 10;     // so the 100% line isn't on the edge
    private static readonly Brush TraceBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush FillBrush = Frozen(Color.FromArgb(0x40, 0xEF, 0x44, 0x44));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));
    private static readonly Brush PillBrush = Frozen(Color.FromRgb(0x23, 0x24, 0x28));
    private static readonly Brush DoneBrush = Frozen(Color.FromRgb(0x22, 0xC5, 0x5E));
    private static readonly Brush DoneTextBrush = Frozen(Color.FromRgb(0x0B, 0x1F, 0x12));

    private readonly Stopwatch _clock = Stopwatch.StartNew();
    // (seconds since opening, brake %), oldest first
    private readonly Queue<(double Time, double Brake)> _samples = new();
    private readonly Polyline _trace = new() { Stroke = TraceBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _fill = new() { Fill = FillBrush };
    private List<PedalDevice> _devices = [];
    private PedalCalibration _calibration = new();
    private double _rescanAt;
    private double? _completedAt;
    private bool _graphing;
    private readonly CollectorEngine _engine;
    // The user's Preferred Language, and the status line: a Loc key, or the pedals' names when it's null
    private string _language = "";
    private string? _statusKey = "brake.looking";
    private string _deviceNames = "";

    internal BrakePracticeWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        // Every frame (about 60 times a second), so quick stabs on the pedal show up
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        var now = _clock.Elapsed.TotalSeconds;
        if (_engine.Language != _language)
        {
            _language = _engine.Language;
            Loc.Apply(this, _language);
            ShowStatus();
        }
        if (!_devices.Any(d => d.Connected) && now >= _rescanAt)
        {
            _rescanAt = now + RescanEvery.TotalSeconds;
            Connect();
        }

        if (_graphing)
            UpdateGraph(now);
        else
            UpdateCalibration(now);
    }

    // Opens the Simucube's game controller(s), or every pedal set and wheel plugged in when there's no Simucube
    private void Connect()
    {
        var hadDevices = _devices.Count > 0;
        foreach (var device in _devices)
            device.Dispose();
        var found = PedalDevice.FindAll();
        var simucube = found.Where(d => d.IsSimucube).ToList();
        _devices = simucube.Count > 0 ? simucube : found;
        foreach (var device in found.Except(_devices))
            device.Dispose();
        foreach (var device in _devices)
            device.Start();

        // Devices that came back are new axes: calibrate again
        if (hadDevices)
            Recalibrate();
        if (_devices.Count == 0)
        {
            _statusKey = hadDevices ? "brake.disconnected" : "brake.noPedals";
            ShowStatus();
            return;
        }
        var names = string.Join(", ", _devices.Select(d => d.Name).Distinct());
        _statusKey = null;
        _deviceNames = names;
        ShowStatus();
        if (!hadDevices)
            ActivityLog.Shared.Write($"Brake Practice: reading {names}");
    }

    private void ShowStatus() => StatusText.Text = _statusKey is { } key ? Loc.T(_language, key) : _deviceNames;

    private void UpdateCalibration(double now)
    {
        _calibration.Update(_devices.SelectMany(d => d.Axes));
        var percent = _calibration.RawPercent;
        PositionText.Text = percent is { } p ? Percent(p) : "—";
        PositionBar.Width = PositionTrack.ActualWidth * Math.Clamp(percent ?? 0, 0, 100) / 100;
        MarkPress(Press1, Loc.T(_language, "brake.press1"), _calibration.Presses >= 1);
        MarkPress(Press2, Loc.T(_language, "brake.press2"), _calibration.Presses >= 2);

        if (!_calibration.Complete)
        {
            CalibrationText.Foreground = LabelBrush;
            CalibrationText.Text = _calibration.Axis is { } axis
                ? Loc.T(_language, "brake.pressTwiceReading", axis.Device.Name, axis.Name)
                : Loc.T(_language, "brake.pressTwice");
            return;
        }
        if (_completedAt is null)
        {
            _completedAt = now;
            CalibrationText.Foreground = DoneBrush;
            CalibrationText.Text = Loc.T(_language, "brake.complete");
            ActivityLog.Shared.Write($"Brake Practice: calibrated the {_calibration.Axis!.Name} axis of {_calibration.Axis.Device.Name}");
        }
        else if (now - _completedAt >= CompleteFor.TotalSeconds)
        {
            ShowGraph(true);
        }
    }

    private void UpdateGraph(double now)
    {
        if (_calibration.Percent is { } percent)
        {
            _samples.Enqueue((now, percent));
            BrakeReadout.Text = Percent(percent);
        }
        else
        {
            BrakeReadout.Text = "—";
        }
        while (_samples.Count > 0 && _samples.Peek().Time < now - History.TotalSeconds)
            _samples.Dequeue();
        DrawTrace(now);
    }

    private void ShowGraph(bool show)
    {
        _graphing = show;
        _samples.Clear();
        CalibrationPanel.Visibility = show ? Visibility.Collapsed : Visibility.Visible;
        GraphPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        BrakeReadout.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        RecalibrateButton.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
    }

    private void Recalibrate()
    {
        _calibration = new PedalCalibration();
        _completedAt = null;
        ShowGraph(false);
    }

    private void Recalibrate_Click(object sender, RoutedEventArgs e) => Recalibrate();

    private static void MarkPress(TextBlock pill, string text, bool done)
    {
        pill.Text = done ? $"✓ {text}" : text;
        pill.Background = done ? DoneBrush : PillBrush;
        pill.Foreground = done ? DoneTextBrush : LabelBrush;
    }

    private string Percent(double value) => $"{value.ToString("0.0", Loc.Culture(_language))}%";

    // The guide lines and their labels; redrawn when the window is resized
    private void Graph_SizeChanged(object sender, SizeChangedEventArgs e)
    {
        Graph.Children.Clear();
        foreach (var level in GuideLines)
        {
            var y = Y(level);
            Graph.Children.Add(new Line
            {
                X1 = LabelWidth, X2 = Graph.ActualWidth, Y1 = y, Y2 = y,
                Stroke = GuideBrush, StrokeThickness = 1,
                StrokeDashArray = level == 100 ? null : [4, 4],
            });
            var label = new TextBlock { Text = $"{level:0}%", Foreground = LabelBrush, FontSize = 11, Width = LabelWidth - 6, TextAlignment = TextAlignment.Right };
            Canvas.SetLeft(label, 0);
            Canvas.SetTop(label, y - 8);
            Graph.Children.Add(label);
        }
        Graph.Children.Add(_fill);
        Graph.Children.Add(_trace);
    }

    private void DrawTrace(double now)
    {
        var width = Graph.ActualWidth - LabelWidth;
        if (width <= 0)
            return;
        var points = new PointCollection(_samples.Count);
        foreach (var (time, brake) in _samples)
            points.Add(new Point(LabelWidth + width * (1 - (now - time) / History.TotalSeconds), Y(brake)));
        _trace.Points = points;

        // The area under the trace, down to 0%
        var fill = new PointCollection(points.Count + 2);
        if (points.Count > 0)
        {
            fill.Add(new Point(points[0].X, Y(0)));
            foreach (var p in points)
                fill.Add(p);
            fill.Add(new Point(points[^1].X, Y(0)));
        }
        _fill.Points = fill;
    }

    // 0% at the bottom of the graph, 100% just under the top
    private double Y(double percent) => TopPad + (Graph.ActualHeight - TopPad) * (1 - percent / 100);

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState == MouseButtonState.Pressed)
            DragMove();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        CompositionTarget.Rendering -= OnRendering;
        foreach (var device in _devices)
            device.Dispose();
        base.OnClosed(e);
    }
}
