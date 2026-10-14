using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Target Steering button opens: like the Target Telemetry window, but with the steering wheel angle
/// of the user's Target Lap (blue) over the 500 ft of track around the car, and the driver's own, live (orange),
/// over the stretch behind the car up to it. The car is the vertical line, 100 ft from the left, so the Target Lap's
/// steering ahead scrolls into view and the driver's trails behind it on the same scale. Left is up. The scale fits
/// the Target Lap's largest angle (at least 90° each way); the driver's is cut off past it.
/// </summary>
public partial class TargetSteeringWindow : Window
{
    private const double SpanFeet = 500;   // track shown, left to right
    private const double BehindFeet = 100; // of it behind the car
    private const double MarginFeet = 30;  // samples just off each edge, so the trace runs to the edge
    private const double Pad = 10;         // so the top and bottom lines aren't on the edge
    private const double MinRangeDegrees = 90;
    private const double RangeStepDegrees = 45;
    private const double FeetPerMeter = 3.280839895;
    private const double RadiansToDegrees = 180 / Math.PI;
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;
    private static readonly Brush TargetBrush = Frozen(Color.FromRgb(0x3B, 0x8B, 0xFF));
    private static readonly Brush LiveBrush = Frozen(Color.FromRgb(0xF9, 0x73, 0x16));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));
    private static readonly Brush CarBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush WarningBrush = Frozen(Color.FromRgb(0xF5, 0x9E, 0x0B));

    private readonly CollectorEngine _engine;
    private readonly TargetLapSource _target;
    private readonly Polyline _targetTrace = new() { Stroke = TargetBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polyline _liveTrace = new() { Stroke = LiveBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Line _car = new() { Stroke = CarBrush, StrokeThickness = 2 };

    // The Target Lap as fractions of a lap (0-1, around the start/finish line), sorted, with the steering in degrees
    // (positive to the left) for each
    private double[] _pcts = [];
    private double[] _steerings = [];
    private TargetLapTrace? _lap;
    private double _rangeDegrees = MinRangeDegrees; // the plot's top is this far left, its bottom this far right

    // The driver's steering (degrees) over the stretch behind the car, oldest first
    private readonly List<(float Pct, double Steering)> _live = [];

    // The user's Preferred Language the window is in
    private string _language = "";

    // What's drawn, so a frame without a new position or anything else new draws nothing
    private float? _position;
    private (float Position, int Live, double? Steering, double LengthFeet, double Width, double Height)? _drawn;

    internal TargetSteeringWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        _target = new TargetLapSource(engine);
        _target.Loaded += () =>
        {
            SetLap(_target.Lap);
            DrawAxes(); // the units and the scale may have changed
        };
        // Every frame (about 60 times a second, as fast as telemetry), so the traces scroll smoothly
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        _target.Update();
        if (_target.Language != _language)
        {
            _language = _target.Language;
            Loc.Apply(this, _language);
            DrawAxes(); // "car" and left/right on the axes
        }
        var lengthFeet = _target.LengthFeet;
        var live = _engine.TryGetLatest(out var data) && data.LapDistPct is { } pct && pct >= 0;
        if (live && data.LapDistPct is { } position && data.SteeringWheelAngle is { } angle)
        {
            _position = position;
            if (lengthFeet > 0)
                AddLiveSample(position, angle * RadiansToDegrees, lengthFeet);
        }
        LiveReadout.Text = live && data.SteeringWheelAngle is { } now ? Degrees(now * RadiansToDegrees) : "—";

        ShowStatus(live);
        if (_lap is null || lengthFeet <= 0 || _position is not { } at)
        {
            _targetTrace.Points = [];
            _liveTrace.Points = [];
            TargetReadout.Text = "—";
            _drawn = null;
            return;
        }
        if (_drawn != (at, _live.Count, LastLiveSteering, lengthFeet, Plot.ActualWidth, Plot.ActualHeight))
            Draw(at, lengthFeet);
    }

    // Keeps the driver's steering over the stretch behind the car: drops what scrolled off the left, and starts
    // over when the car jumps back (a reset or tow) so the trace never runs ahead of the car
    private void AddLiveSample(float position, double steering, double lengthFeet)
    {
        if (_live.Count > 0 && _live[^1].Pct == position)
        {
            _live[^1] = (position, steering);
            return;
        }
        if (_live.Count > 0 && FeetFromCar(_live[^1].Pct, position, lengthFeet) > 0)
            _live.Clear();
        _live.Add((position, steering));
        var keep = _live.FindIndex(s => FeetFromCar(s.Pct, position, lengthFeet) >= -BehindFeet - MarginFeet);
        _live.RemoveRange(0, keep < 0 ? _live.Count : keep);
    }

    private double? LastLiveSteering => _live.Count == 0 ? null : _live[^1].Steering;

    // Feet from the car at position to a point at pct (negative is behind it), across the start/finish line
    private static double FeetFromCar(double pct, double position, double lengthFeet)
    {
        var ahead = pct - position;
        ahead -= Math.Floor(ahead + 0.5); // -0.5 to 0.5 of a lap
        return ahead * lengthFeet;
    }

    // Wraps the unwrapped LapDistPct back into 0-1 and sorts the samples by it, so a stretch of track is one run,
    // and fits the scale to the lap's largest angle
    private void SetLap(TargetLapTrace? lap)
    {
        _lap = lap;
        _drawn = null;
        var samples = lap?.Steerings is { } steerings
            ? lap.Pcts.Zip(steerings, (pct, steering) => (Pct: (pct % 1 + 1) % 1, Steering: steering * RadiansToDegrees))
                .OrderBy(s => s.Pct)
                .ToArray()
            : [];
        _pcts = samples.Select(s => s.Pct).ToArray();
        _steerings = samples.Select(s => s.Steering).ToArray();
        var largest = _steerings.Length == 0 ? 0 : _steerings.Max(Math.Abs);
        _rangeDegrees = Math.Max(MinRangeDegrees, Math.Ceiling(largest / RangeStepDegrees) * RangeStepDegrees);
    }

    private void ShowStatus(bool live)
    {
        var (status, message, warning) = _target.Status(live, _position is not null);
        if (message is null && _lap is not null && _lap.Steerings is null)
            message = Loc.T(_language, "target.noSteering");
        if (StatusText.Text != status)
            StatusText.Text = status;
        StatusText.Foreground = warning ? WarningBrush : LabelBrush;
        MessageText.Text = message ?? "";
        MessageText.Visibility = message is null ? Visibility.Collapsed : Visibility.Visible;
    }

    private void Draw(float position, double lengthFeet)
    {
        _drawn = (position, _live.Count, LastLiveSteering, lengthFeet, Plot.ActualWidth, Plot.ActualHeight);
        if (Plot.ActualWidth <= 0)
            return;

        // The Target Lap's samples within the window, by distance from the car
        var points = new List<(double Feet, double Steering)>();
        for (var i = 0; i < _pcts.Length; i++)
        {
            var feet = FeetFromCar(_pcts[i], position, lengthFeet);
            if (feet >= -BehindFeet - MarginFeet && feet <= SpanFeet - BehindFeet + MarginFeet)
                points.Add((feet, _steerings[i]));
        }
        points.Sort((a, b) => a.Feet.CompareTo(b.Feet));

        var trace = new PointCollection(points.Count);
        double? atCar = null;
        for (var i = 0; i < points.Count; i++)
        {
            trace.Add(new Point(X(points[i].Feet), Y(points[i].Steering)));
            if (i > 0 && points[i - 1].Feet <= 0 && points[i].Feet >= 0)
            {
                var (f0, s0) = points[i - 1];
                var (f1, s1) = points[i];
                atCar = f1 > f0 ? s0 + (s1 - s0) * (0 - f0) / (f1 - f0) : s1;
            }
        }
        _targetTrace.Points = trace;
        TargetReadout.Text = atCar is { } steering ? Degrees(steering) : "—";

        _liveTrace.Points = new PointCollection(
            _live.Select(s => new Point(X(FeetFromCar(s.Pct, position, lengthFeet)), Y(s.Steering))));
    }

    // "L 45°", "R 12°" or "0°" (E/D in Portuguese, I/D in Spanish)
    private string Degrees(double degrees) =>
        Math.Round(degrees) switch
        {
            > 0 and var left => $"{Loc.T(_language, "left")} {left.ToString("0", Culture)}°",
            < 0 and var right => $"{Loc.T(_language, "right")} {(-right).ToString("0", Culture)}°",
            _ => "0°",
        };

    // The guide lines, the car's line and the axis labels; redrawn when the window is resized
    private void Plot_SizeChanged(object sender, SizeChangedEventArgs e) => DrawAxes();

    private void DrawAxes()
    {
        Plot.Children.Clear();
        YAxis.Children.Clear();
        XAxis.Children.Clear();
        foreach (var share in new[] { 1, 0.5, 0, -0.5, -1 })
        {
            var degrees = share * _rangeDegrees;
            var y = Y(degrees);
            Plot.Children.Add(new Line
            {
                X1 = 0, X2 = Plot.ActualWidth, Y1 = y, Y2 = y,
                Stroke = GuideBrush, StrokeThickness = 1,
                StrokeDashArray = share == 0 ? null : [4, 4],
            });
            AddLabel(YAxis, Degrees(degrees), 0, y - 8, YAxis.ActualWidth - 6, TextAlignment.Right);
        }
        Plot.Children.Add(_targetTrace);
        Plot.Children.Add(_liveTrace);

        _car.X1 = _car.X2 = X(0);
        _car.Y1 = 0;
        _car.Y2 = Plot.ActualHeight;
        Plot.Children.Add(_car);

        // Distance from the car: every 100 ft, or 25 m for Metric Preferred Units
        var metric = _target.Metric;
        var step = metric ? 25 * FeetPerMeter : 100;
        var unit = Loc.DistanceUnit(metric);
        for (var feet = -Math.Floor(BehindFeet / step) * step; feet <= SpanFeet - BehindFeet; feet += step)
        {
            var value = Math.Round(metric ? feet / FeetPerMeter : feet);
            var text = value == 0 ? Loc.T(_language, "car") : $"{value.ToString("+0;−0", Culture)} {unit}";
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

    // Left (positive) up, right down, straight in the middle
    private double Y(double degrees)
    {
        var height = Plot.ActualHeight - 2 * Pad;
        return Pad + height * (1 - (Math.Clamp(degrees / _rangeDegrees, -1, 1) + 1) / 2);
    }

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
