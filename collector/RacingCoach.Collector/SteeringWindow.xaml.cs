using System.Globalization;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Steering Overlay button opens: a see-through, always-on-top window like the Target Telemetry
/// window, with the same 250 ft of track scrolling past at the same pace (the car is the vertical line, 100 ft from
/// the left). On it, the steering wheel angle of the user's Target Lap (blue, from /api/collector/target-lap's
/// steerings) and the driver's own over the track behind the car (orange), with the gap between the two shaded, and
/// a short bar on the car's line riding up and down with the driver's steering now. Right is up and left down, like
/// the website's steering chart. The header shows the Target Lap's angle at the car, the driver's, and the
/// difference: how much more (+) or less (−) lock the driver has than the Target Lap, in the Target Lap's turn.
/// The scale fits the Target Lap's largest angle, so it doesn't change while driving. Positions and the Target Lap's
/// loading are the Target Telemetry window's (TargetLapSource).
/// </summary>
public partial class SteeringWindow : Window
{
    // The same track and pace as the Target Telemetry window
    private const double SpanFeet = 250;
    private const double BehindFeet = 100;
    private const double MarginFeet = 30;
    private const double Pad = 8;
    private const double JumpPct = 0.05;
    private const double DegreesPerRadian = 180 / Math.PI;
    // Under this the Target Lap is going straight, so the difference is judged by the driver's own turn
    private const double StraightDegrees = 2;
    // The difference is green within this many degrees, amber within the second, red beyond
    private const double CloseDegrees = 5;
    private const double OffDegrees = 15;
    private const double BarHalfWidth = 14;

    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;
    private static readonly Brush TargetBrush = Frozen(Color.FromRgb(0x3B, 0x8B, 0xFF));
    private static readonly Brush DriverBrush = Frozen(Color.FromRgb(0xF9, 0x8F, 0x3A));
    private static readonly Brush GapBrush = Frozen(Color.FromArgb(0x48, 0xF9, 0x8F, 0x3A));
    private static readonly Brush BarBrush = Frozen(Color.FromRgb(0xFA, 0xCC, 0x15));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush CenterBrush = Frozen(Color.FromRgb(0x6B, 0x6E, 0x78));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));
    private static readonly Brush CarBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush WarningBrush = Frozen(Color.FromRgb(0xF5, 0x9E, 0x0B));
    private static readonly Brush CloseBrush = Frozen(Color.FromRgb(0x4A, 0xDE, 0x80));
    private static readonly Brush OffBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush PlainBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));

    private readonly CollectorEngine _engine;
    private readonly TargetLapSource _target;
    private readonly Polyline _targetTrace = new() { Stroke = TargetBrush, StrokeThickness = 2.5, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polyline _driverTrace = new() { Stroke = DriverBrush, StrokeThickness = 3, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _gap = new() { Fill = GapBrush };
    private readonly Line _car = new() { Stroke = CarBrush, StrokeThickness = 2 };
    private readonly Line _bar = new() { Stroke = BarBrush, StrokeThickness = 4, StrokeStartLineCap = PenLineCap.Round,
        StrokeEndLineCap = PenLineCap.Round, Visibility = Visibility.Collapsed };

    // The Target Lap as fractions of a lap (0-1), sorted, with its steering in degrees, right positive
    private double[] _pcts = [];
    private double[] _degrees = [];
    private bool _hasLap;
    // The scale's top (right) and bottom (left), in degrees
    private double _range = 90;
    // The driver's steering (degrees, right positive) at each new position the car reached, oldest first
    private readonly List<(float Pct, double Degrees)> _driverSteering = [];

    private string _language = "";
    private float? _position;
    private (float Position, double LengthFeet, double Width, double Height)? _drawn;

    internal SteeringWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        _target = new TargetLapSource(engine);
        _target.Loaded += () =>
        {
            SetLap(_target.Lap);
            DrawAxes();
        };
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        _target.Update();
        if (_target.Language != _language)
        {
            _language = _target.Language;
            Loc.Apply(this, _language);
            DrawAxes();
        }
        var live = _engine.TryGetLatest(out var data) && data.LapDistPct is { } pct && pct >= 0;
        var lengthFeet = _target.LengthFeet;
        double? liveDegrees = live && data.SteeringWheelAngle is { } angle ? -angle * DegreesPerRadian : null;
        if (live)
        {
            _position = data.LapDistPct;
            RecordDriverSteering(data.LapDistPct!.Value, liveDegrees ?? 0, lengthFeet);
        }
        DrawBar(liveDegrees);

        ShowStatus(live);
        double? targetDegrees = _hasLap && _position is { } p ? TargetAt(p) : null;
        ShowReadouts(targetDegrees, liveDegrees);

        if (!_hasLap || lengthFeet <= 0 || _position is not { } position)
        {
            _targetTrace.Points = [];
            _driverTrace.Points = [];
            _gap.Points = [];
            _drawn = null;
            return;
        }
        if (_drawn != (position, lengthFeet, Plot.ActualWidth, Plot.ActualHeight))
            Draw(position, lengthFeet);
    }

    private void SetLap(TargetLapTrace? lap)
    {
        _drawn = null;
        var steerings = lap?.Steerings;
        _hasLap = lap is not null && steerings is not null && steerings.Length == lap.Pcts.Length && lap.Pcts.Length > 1;
        if (!_hasLap)
        {
            _pcts = [];
            _degrees = [];
            return;
        }
        var samples = lap!.Pcts
            .Select((pct, i) => (Pct: (pct % 1 + 1) % 1, Degrees: -steerings![i] * DegreesPerRadian))
            .OrderBy(s => s.Pct)
            .ToArray();
        _pcts = samples.Select(s => s.Pct).ToArray();
        _degrees = samples.Select(s => s.Degrees).ToArray();
        // Room for the Target Lap's largest angle and a bit more, in steps of 30°, so the scale stays put
        var largest = _degrees.Length == 0 ? 0 : _degrees.Max(Math.Abs);
        _range = Math.Max(60, Math.Ceiling(largest * 1.15 / 30) * 30);
    }

    // The Target Lap's steering at a point of the lap (0-1), between its samples, across the start/finish line too
    private double TargetAt(double pct)
    {
        var n = _pcts.Length;
        var i = Array.BinarySearch(_pcts, pct);
        if (i >= 0)
            return _degrees[i];
        i = ~i; // the first sample after pct
        var (before, after) = i == 0 || i == n ? (n - 1, 0) : (i - 1, i);
        var span = _pcts[after] - _pcts[before];
        if (span <= 0)
            span += 1;
        var into = pct - _pcts[before];
        if (into < 0)
            into += 1;
        var t = span > 0 ? Math.Clamp(into / span, 0, 1) : 0;
        return _degrees[before] + (_degrees[after] - _degrees[before]) * t;
    }

    private void ShowStatus(bool live)
    {
        var (status, message, warning) = _target.Status(live, _position is not null);
        if (_target.Lap is not null && !_hasLap)
            message = Loc.T(_language, "steering.noSteering");
        if (StatusText.Text != status)
            StatusText.Text = status;
        StatusText.Foreground = warning ? WarningBrush : LabelBrush;
        MessageText.Text = message ?? "";
        MessageText.Visibility = message is null ? Visibility.Collapsed : Visibility.Visible;
    }

    // Target and live angles ("85° R"), and the difference in lock: + more than the Target Lap, − less, in the
    // Target Lap's turn (the driver's own when the Target Lap is going straight)
    private void ShowReadouts(double? target, double? live)
    {
        TargetReadout.Text = target is { } t ? Angle(t) : "—";
        LiveReadout.Text = live is { } l ? Angle(l) : "—";
        if (target is not { } tv || live is not { } lv)
        {
            DiffReadout.Text = "—";
            DiffReadout.Foreground = PlainBrush;
            DiffLabel.Text = Loc.T(_language, "steering.difference");
            return;
        }
        var side = Math.Abs(tv) >= StraightDegrees ? Math.Sign(tv) : Math.Abs(lv) >= StraightDegrees ? Math.Sign(lv) : 1;
        var lockDiff = (lv - tv) * side;
        var rounded = Math.Round(lockDiff);
        DiffReadout.Text = $"{rounded.ToString("+0;−0;0", Loc.Culture(_language))}°";
        var size = Math.Abs(lockDiff);
        DiffReadout.Foreground = size <= CloseDegrees ? CloseBrush : size <= OffDegrees ? WarningBrush : OffBrush;
        DiffLabel.Text = Loc.T(_language, rounded > 0 ? "steering.moreLock" : rounded < 0 ? "steering.lessLock" : "steering.difference");
    }

    private string Angle(double degrees)
    {
        var value = Math.Round(Math.Abs(degrees));
        var text = value.ToString("0", Loc.Culture(_language));
        return value == 0 ? $"{text}°" : $"{text}° {Loc.T(_language, degrees > 0 ? "right" : "left")}";
    }

    private void Draw(float position, double lengthFeet)
    {
        _drawn = (position, lengthFeet, Plot.ActualWidth, Plot.ActualHeight);
        if (Plot.ActualWidth <= 0 || _pcts.Length == 0)
            return;

        // The Target Lap's samples within the window, by distance from the car
        var points = new List<(double Feet, double Degrees)>();
        for (var i = 0; i < _pcts.Length; i++)
        {
            var feet = FeetFromCar(_pcts[i], position, lengthFeet);
            if (feet >= -BehindFeet - MarginFeet && feet <= SpanFeet - BehindFeet + MarginFeet)
                points.Add((feet, _degrees[i]));
        }
        points.Sort((a, b) => a.Feet.CompareTo(b.Feet));
        var target = new PointCollection(points.Count);
        foreach (var (feet, degrees) in points)
            target.Add(new Point(X(feet), Y(degrees)));
        _targetTrace.Points = target;

        // The driver's steering behind the car, and the gap between it and the Target Lap's at the same places
        var driver = new PointCollection(_driverSteering.Count);
        var gap = new PointCollection(_driverSteering.Count * 2);
        foreach (var (pct, degrees) in _driverSteering)
        {
            var point = new Point(X(FeetFromCar(pct, position, lengthFeet)), Y(degrees));
            driver.Add(point);
            gap.Add(point);
        }
        for (var i = _driverSteering.Count - 1; i >= 0; i--)
        {
            var pct = _driverSteering[i].Pct;
            gap.Add(new Point(X(FeetFromCar(pct, position, lengthFeet)), Y(TargetAt(pct))));
        }
        _driverTrace.Points = driver;
        _gap.Points = gap;
    }

    // Adds the driver's steering at a new position, and drops what's gone off the left edge (as the Target
    // Telemetry window does with the brake)
    private void RecordDriverSteering(float pct, double degrees, double lengthFeet)
    {
        if (lengthFeet <= 0)
        {
            _driverSteering.Clear();
            return;
        }
        if (_driverSteering.Count > 0)
        {
            var step = (double)pct - _driverSteering[^1].Pct;
            step -= Math.Floor(step + 0.5);
            if (step == 0)
                return;
            if (step < 0 || step > JumpPct)
                _driverSteering.Clear();
        }
        _driverSteering.Add((pct, degrees));
        var keep = (BehindFeet + MarginFeet) / lengthFeet;
        var drop = 0;
        while (drop < _driverSteering.Count - 1 && Behind(_driverSteering[drop].Pct, pct) > keep)
            drop++;
        _driverSteering.RemoveRange(0, drop);
    }

    private static double Behind(float pct, float car) => ((car - pct) % 1 + 1) % 1;

    private static double FeetFromCar(double pct, float position, double lengthFeet)
    {
        var ahead = pct - position;
        ahead -= Math.Floor(ahead + 0.5);
        return ahead * lengthFeet;
    }

    // The driver's steering now as a bar on the car's line; hidden without live telemetry
    private void DrawBar(double? degrees)
    {
        if (degrees is not { } value)
        {
            _bar.Visibility = Visibility.Collapsed;
            return;
        }
        var x = X(0);
        var y = Y(value);
        _bar.X1 = x - BarHalfWidth;
        _bar.X2 = x + BarHalfWidth;
        _bar.Y1 = _bar.Y2 = y;
        _bar.Visibility = Visibility.Visible;
    }

    private void Plot_SizeChanged(object sender, SizeChangedEventArgs e) => DrawAxes();

    // Straight ahead in the middle (solid), half and full scale each way (dashed), the car's line and the labels
    private void DrawAxes()
    {
        Plot.Children.Clear();
        YAxis.Children.Clear();
        XAxis.Children.Clear();
        foreach (var level in new[] { _range, _range / 2, 0, -_range / 2, -_range })
        {
            var y = Y(level);
            Plot.Children.Add(new Line
            {
                X1 = 0, X2 = Plot.ActualWidth, Y1 = y, Y2 = y,
                Stroke = level == 0 ? CenterBrush : GuideBrush, StrokeThickness = 1,
                StrokeDashArray = level == 0 ? null : [4, 4],
            });
            var value = Math.Abs(level).ToString("0", Culture);
            var text = level == 0 ? "0°" : $"{value}° {Loc.T(_language, level > 0 ? "right" : "left")}";
            AddLabel(YAxis, text, 0, y - 8, YAxis.ActualWidth - 6, TextAlignment.Right);
        }
        Plot.Children.Add(_gap);
        Plot.Children.Add(_targetTrace);
        Plot.Children.Add(_driverTrace);

        _car.X1 = _car.X2 = X(0);
        _car.Y1 = 0;
        _car.Y2 = Plot.ActualHeight;
        Plot.Children.Add(_car);
        Plot.Children.Add(_bar);

        // Distance from the car: every 50 ft, or 25 m for Metric Preferred Units (as in the Target Telemetry window)
        const double feetPerMeter = 3.280839895;
        var step = _target.Metric ? 25 * feetPerMeter : 50;
        var unit = Loc.DistanceUnit(_target.Metric);
        for (var feet = -Math.Floor(BehindFeet / step) * step; feet <= SpanFeet - BehindFeet; feet += step)
        {
            var value = Math.Round(_target.Metric ? feet / feetPerMeter : feet);
            var text = value == 0 ? Loc.T(_language, "car") : $"{value.ToString("+0;−0", Culture)} {unit}";
            AddLabel(XAxis, text, X(feet) - 30, 2, 60, TextAlignment.Center);
        }
        _drawn = null;
    }

    private static void AddLabel(System.Windows.Controls.Canvas canvas, string text, double left, double top, double width, TextAlignment alignment)
    {
        var label = new System.Windows.Controls.TextBlock
        {
            Text = text, Foreground = LabelBrush, FontSize = 11, Width = Math.Max(0, width), TextAlignment = alignment,
        };
        System.Windows.Controls.Canvas.SetLeft(label, left);
        System.Windows.Controls.Canvas.SetTop(label, top);
        canvas.Children.Add(label);
    }

    private double X(double feet) => Plot.ActualWidth * (feet + BehindFeet) / SpanFeet;

    // Right (positive) up, left down, clamped to the plot so an angle beyond the scale rides its edge
    private double Y(double degrees)
    {
        var share = Math.Clamp(degrees / _range, -1, 1);
        return Pad + (Plot.ActualHeight - 2 * Pad) * (1 - share) / 2;
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

    private void Reload_Click(object sender, RoutedEventArgs e) => _target.Reload();

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        CompositionTarget.Rendering -= OnRendering;
        base.OnClosed(e);
    }
}
