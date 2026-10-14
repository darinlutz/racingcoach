using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Target Telemetry button opens: a see-through, always-on-top window, like the overlay, with the
/// brake (red) and throttle (green) traces of the user's Target Lap (Account page, from /api/collector/target-lap)
/// over the 500 ft of track around the car. The car is the vertical line, 100 ft from the left, so the traces
/// scroll left as the car drives and the target braking ahead comes into view. A short bar on the car's line is the
/// driver's own brake, live (hidden off the brake). Positions come from live LapDistPct and the track's length (Track
/// Data's, or iRacing's when Track Data has none). The Target Lap loads when the window opens, when the track or
/// the upload key changes, and with Reload.
/// </summary>
public partial class TargetTelemetryWindow : Window
{
    private const double SpanFeet = 500;   // track shown, left to right
    private const double BehindFeet = 100; // of it behind the car
    private const double MarginFeet = 30;  // samples just off each edge, so the trace runs to the edge
    private const double TopPad = 10;      // so the 100% line isn't on the edge
    private const double FeetPerMeter = 3.280839895;
    private static readonly double[] GuideLines = [20, 40, 60, 80, 100];
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;
    private static readonly Brush TraceBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush FillBrush = Frozen(Color.FromArgb(0x40, 0xEF, 0x44, 0x44));
    private static readonly Brush ThrottleBrush = Frozen(Color.FromRgb(0x22, 0xC5, 0x5E));
    private static readonly Brush BrakeBarBrush = Frozen(Color.FromRgb(0xFA, 0xCC, 0x15));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));
    private static readonly Brush CarBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush WarningBrush = Frozen(Color.FromRgb(0xF5, 0x9E, 0x0B));

    private readonly CollectorEngine _engine;
    private readonly Polyline _trace = new() { Stroke = TraceBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _fill = new() { Fill = FillBrush };
    private readonly Polyline _throttle = new() { Stroke = ThrottleBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Line _car = new() { Stroke = CarBrush, StrokeThickness = 2 };
    // The driver's brake: a short bar across the car's line, at the brake's height
    private readonly Line _brakeBar = new() { Stroke = BrakeBarBrush, StrokeThickness = 4, StrokeStartLineCap = PenLineCap.Round,
        StrokeEndLineCap = PenLineCap.Round, Visibility = Visibility.Collapsed };
    private const double BrakeBarHalfWidth = 14;

    // The Target Lap as fractions of a lap (0-1, around the start/finish line), sorted, with Brake and Throttle
    // 0-100 for each
    private double[] _pcts = [];
    private double[] _brakes = [];
    private double[] _throttles = [];
    private TargetLapTrace? _lap;
    private readonly TargetLapSource _target;

    // What's drawn, so a frame without a new position or anything else new draws nothing
    private float? _position;
    private (float Position, double LengthFeet, double Width, double Height)? _drawn;

    internal TargetTelemetryWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        _target = new TargetLapSource(engine);
        _target.Loaded += () =>
        {
            SetLap(_target.Lap);
            DrawAxes(); // the units may have changed
        };
        // Every frame (about 60 times a second, as fast as telemetry), so the trace scrolls smoothly
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        _target.Update();
        var live = _engine.TryGetLatest(out var data) && data.LapDistPct is { } pct && pct >= 0;
        if (live)
            _position = data.LapDistPct;
        DrawBrakeBar(live ? data.Brake : null);

        var lengthFeet = _target.LengthFeet;
        ShowStatus(live);
        if (_lap is null || lengthFeet <= 0 || _position is not { } position)
        {
            _trace.Points = [];
            _fill.Points = [];
            _throttle.Points = [];
            BrakeReadout.Text = "—";
            _drawn = null;
            return;
        }
        if (_drawn != (position, lengthFeet, Plot.ActualWidth, Plot.ActualHeight))
            Draw(position, lengthFeet);
    }

    // Wraps the unwrapped LapDistPct back into 0-1 and sorts the samples by it, so a stretch of track is one run
    private void SetLap(TargetLapTrace? lap)
    {
        _lap = lap;
        _drawn = null;
        var samples = lap is null
            ? []
            : lap.Pcts.Select((pct, i) => (
                    Pct: (pct % 1 + 1) % 1,
                    Brake: Math.Clamp(lap.Brakes[i], 0, 1) * 100,
                    Throttle: lap.Throttles is { } throttles && i < throttles.Length ? Math.Clamp(throttles[i], 0, 1) * 100 : double.NaN))
                .OrderBy(s => s.Pct)
                .ToArray();
        _pcts = samples.Select(s => s.Pct).ToArray();
        _brakes = samples.Select(s => s.Brake).ToArray();
        _throttles = samples.Select(s => s.Throttle).ToArray();
    }

    private void ShowStatus(bool live)
    {
        var (status, message, warning) = _target.Status(live, _position is not null);
        if (StatusText.Text != status)
            StatusText.Text = status;
        StatusText.Foreground = warning ? WarningBrush : LabelBrush;
        MessageText.Text = message ?? "";
        MessageText.Visibility = message is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Draw(float position, double lengthFeet)
    {
        _drawn = (position, lengthFeet, Plot.ActualWidth, Plot.ActualHeight);
        var width = Plot.ActualWidth;
        if (width <= 0 || _pcts.Length == 0)
            return;

        // The Target Lap's samples within the window, by distance from the car (negative is behind it)
        var points = new List<(double Feet, double Brake, double Throttle)>();
        for (var i = 0; i < _pcts.Length; i++)
        {
            var ahead = _pcts[i] - position;
            ahead -= Math.Floor(ahead + 0.5); // -0.5 to 0.5 of a lap, across the start/finish line
            var feet = ahead * lengthFeet;
            if (feet >= -BehindFeet - MarginFeet && feet <= SpanFeet - BehindFeet + MarginFeet)
                points.Add((feet, _brakes[i], _throttles[i]));
        }
        points.Sort((a, b) => a.Feet.CompareTo(b.Feet));

        var trace = new PointCollection(points.Count);
        double? atCar = null;
        for (var i = 0; i < points.Count; i++)
        {
            trace.Add(new Point(X(points[i].Feet), Y(points[i].Brake)));
            if (i > 0 && points[i - 1].Feet <= 0 && points[i].Feet >= 0)
            {
                var (f0, b0, _) = points[i - 1];
                var (f1, b1, _) = points[i];
                atCar = f1 > f0 ? b0 + (b1 - b0) * (0 - f0) / (f1 - f0) : b1;
            }
        }
        _trace.Points = trace;
        // NaN when the site didn't send the throttle
        _throttle.Points = new PointCollection(
            points.Where(p => !double.IsNaN(p.Throttle)).Select(p => new Point(X(p.Feet), Y(p.Throttle))));
        BrakeReadout.Text = atCar is { } brake ? $"{brake.ToString("0", Culture)}%" : "—";

        // The area under the trace, down to 0%
        var fill = new PointCollection(trace.Count + 2);
        if (trace.Count > 0)
        {
            fill.Add(new Point(trace[0].X, Y(0)));
            foreach (var p in trace)
                fill.Add(p);
            fill.Add(new Point(trace[^1].X, Y(0)));
        }
        _fill.Points = fill;
    }

    // The driver's brake (0-1) as a bar on the car's line; hidden at 0 or without live telemetry
    private void DrawBrakeBar(float? brake)
    {
        if (brake is not { } value || value <= 0)
        {
            _brakeBar.Visibility = Visibility.Collapsed;
            return;
        }
        var x = X(0);
        var y = Y(Math.Clamp(value, 0, 1) * 100);
        _brakeBar.X1 = x - BrakeBarHalfWidth;
        _brakeBar.X2 = x + BrakeBarHalfWidth;
        _brakeBar.Y1 = _brakeBar.Y2 = y;
        _brakeBar.Visibility = Visibility.Visible;
    }

    // The guide lines, the car's line and the axis labels; redrawn when the window is resized
    private void Plot_SizeChanged(object sender, SizeChangedEventArgs e) => DrawAxes();

    private void DrawAxes()
    {
        Plot.Children.Clear();
        YAxis.Children.Clear();
        XAxis.Children.Clear();
        foreach (var level in GuideLines)
        {
            var y = Y(level);
            Plot.Children.Add(new Line
            {
                X1 = 0, X2 = Plot.ActualWidth, Y1 = y, Y2 = y,
                Stroke = GuideBrush, StrokeThickness = 1,
                StrokeDashArray = level == 100 ? null : [4, 4],
            });
            AddLabel(YAxis, $"{level:0}%", 0, y - 8, YAxis.ActualWidth - 6, TextAlignment.Right);
        }
        Plot.Children.Add(_fill);
        Plot.Children.Add(_throttle);
        Plot.Children.Add(_trace);

        _car.X1 = _car.X2 = X(0);
        _car.Y1 = 0;
        _car.Y2 = Plot.ActualHeight;
        Plot.Children.Add(_car);
        Plot.Children.Add(_brakeBar);

        // Distance from the car: every 100 ft, or 25 m for Metric Preferred Units
        var step = _target.Metric ? 25 * FeetPerMeter : 100;
        var unit = _target.Metric ? "m" : "ft";
        for (var feet = -Math.Floor(BehindFeet / step) * step; feet <= SpanFeet - BehindFeet; feet += step)
        {
            var value = Math.Round(_target.Metric ? feet / FeetPerMeter : feet);
            var text = value == 0 ? "car" : $"{value.ToString("+0;−0", Culture)} {unit}";
            AddLabel(XAxis, text, X(feet) - 30, 2, 60, TextAlignment.Center);
        }
        _drawn = null;
    }

    private static void AddLabel(Canvas canvas, string text, double left, double top, double width, TextAlignment alignment)
    {
        var label = new TextBlock { Text = text, Foreground = LabelBrush, FontSize = 11, Width = Math.Max(0, width), TextAlignment = alignment };
        Canvas.SetLeft(label, left);
        Canvas.SetTop(label, top);
        canvas.Children.Add(label);
    }

    // Feet from the car (negative is behind it) to the plot's x
    private double X(double feet) => Plot.ActualWidth * (feet + BehindFeet) / SpanFeet;

    // 0% at the bottom of the plot, 100% just under the top
    private double Y(double percent) => TopPad + (Plot.ActualHeight - TopPad) * (1 - percent / 100);

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

    // Loads the Target Lap again on the next frame, e.g. after changing it on the Account page
    private void Reload_Click(object sender, RoutedEventArgs e) => _target.Reload();

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        CompositionTarget.Rendering -= OnRendering;
        base.OnClosed(e);
    }
}
