using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Target Telemetry button opens: a see-through, always-on-top window, like the overlay, with the
/// brake trace (red) of the user's Target Lap (Debrief Coach, from /api/collector/target-lap) over the 500 ft of
/// track around the car, and across the top the gear it shifted into at each gear change. The car is the vertical
/// line, 200 ft from the left, so the trace and gear changes scroll left as the car drives: a gear reaches the car's
/// line where the Target Lap shifted into it. A short bar on the car's line is the
/// driver's own brake, live (hidden off the brake), and a brighter, thicker red line over the Target Lap's trace is
/// the driver's brake over the track behind the car, so the two can be compared. Positions come from live LapDistPct and the track's length (Track
/// Data's, or iRacing's when Track Data has none). The Target Lap loads when the window opens, when the track or
/// the upload key changes, and with Reload. Above the chart are copies of the overlay's Max Brake, Min Speed and
/// handling boxes (OverlayStats), and under it its Upcoming Focus Area row (OverlayAreaRow), from the same
/// TelemetryEngine.js as the overlay (OverlayFeed); without them if the script didn't load.
/// </summary>
public partial class TargetTelemetryWindow : Window
{
    private const double SpanFeet = 500;   // track shown, left to right
    private const double BehindFeet = 200; // of it behind the car, so the recent past stays in view
    private const double MarginFeet = 30;  // samples just off each edge, so the trace runs to the edge
    private const double GearBand = 22;    // the gear changes across the top
    private const double TopPad = GearBand + 8; // so the 100% line is under them
    private const double FeetPerMeter = 3.280839895;
    private static readonly double[] GuideLines = [20, 40, 60, 80, 100];
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;
    private static readonly Brush TraceBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush DriverTraceBrush = Frozen(Color.FromRgb(0xFF, 0x2D, 0x2D));
    private static readonly Brush FillBrush = Frozen(Color.FromArgb(0x40, 0xEF, 0x44, 0x44));
    private static readonly Brush UpshiftBrush = Frozen(Color.FromRgb(0x3B, 0x8B, 0xFF));
    private static readonly Brush DownshiftBrush = Frozen(Color.FromRgb(0xF5, 0x9E, 0x0B));
    private static readonly Brush BrakeBarBrush = Frozen(Color.FromRgb(0xFA, 0xCC, 0x15));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));
    private static readonly Brush CarBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush PlotBackground = Frozen(Color.FromRgb(0x1A, 0x1B, 0x1E));
    private static readonly Brush WarningBrush = Frozen(Color.FromRgb(0xF5, 0x9E, 0x0B));

    private readonly CollectorEngine _engine;
    // The overlay boxes and the In-Car Coach's message, 10 times a second
    private readonly DispatcherTimer _overlayTimer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    private readonly Polyline _trace = new() { Stroke = TraceBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _fill = new() { Fill = FillBrush };
    // The driver's brake behind the car, over the Target Lap's trace
    private readonly Polyline _driverTrace = new() { Stroke = DriverTraceBrush, StrokeThickness = 3, StrokeLineJoin = PenLineJoin.Round };
    private readonly Canvas _gears = new();
    private readonly Line _car = new() { Stroke = CarBrush, StrokeThickness = 2 };
    // The driver's brake: a short bar across the car's line, at the brake's height
    private readonly Line _brakeBar = new() { Stroke = BrakeBarBrush, StrokeThickness = 4, StrokeStartLineCap = PenLineCap.Round,
        StrokeEndLineCap = PenLineCap.Round, Visibility = Visibility.Collapsed };
    private const double BrakeBarHalfWidth = 14;

    // The Target Lap as fractions of a lap (0-1, around the start/finish line), sorted, with Brake 0-100 for each
    private double[] _pcts = [];
    private double[] _brakes = [];
    // Its gear changes: where (0-1), the new gear, and whether that was an upshift
    private (double Pct, int Gear, bool Up)[] _gearChanges = [];
    // The driver's brake (0-100) at each new position (0-1) the car reached, oldest first, back to just beyond the
    // left edge; started over when the car goes backwards or jumps (a reset, a tow, another session)
    private readonly List<(float Pct, double Brake)> _driverBrakes = [];
    // A step further than this (a share of the lap) between frames is a jump, not driving
    private const double JumpPct = 0.05;
    private TargetLapTrace? _lap;
    private readonly TargetLapSource _target;
    private readonly OverlayFeed? _feed;

    // The user's Preferred Language the window is in
    private string _language = "";

    // What's drawn, so a frame without a new position or anything else new draws nothing
    private float? _position;
    private (float Position, double LengthFeet, double Width, double Height)? _drawn;

    internal TargetTelemetryWindow(CollectorEngine engine, OverlayFeed? feed)
    {
        InitializeComponent();
        _engine = engine;
        _feed = feed;
        if (feed is null)
        {
            Stats.Visibility = Visibility.Collapsed;
            AreaRow.Visibility = Visibility.Collapsed;
            InAreaText.Visibility = Visibility.Collapsed;
        }
        _overlayTimer.Tick += (_, _) => RefreshOverlay(feed);
        _overlayTimer.Start();
        RefreshOverlay(feed);
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
        if (_target.Language != _language)
        {
            _language = _target.Language;
            Loc.Apply(this, _language);
            DrawAxes(); // "car" on the distance axis
        }
        var live = _engine.TryGetLatest(out var data) && data.LapDistPct is { } pct && pct >= 0;
        var lengthFeet = _target.LengthFeet;
        if (live)
        {
            _position = data.LapDistPct;
            RecordDriverBrake(data.LapDistPct!.Value, data.Brake, lengthFeet);
        }
        DrawBrakeBar(live ? data.Brake : null);

        ShowStatus(live);
        if (_lap is null || lengthFeet <= 0 || _position is not { } position)
        {
            _trace.Points = [];
            _fill.Points = [];
            _driverTrace.Points = [];
            _gears.Children.Clear();
            BrakeReadout.Text = "—";
            _drawn = null;
            return;
        }
        if (_drawn != (position, lengthFeet, Plot.ActualWidth, Plot.ActualHeight))
            Draw(position, lengthFeet);
    }

    private void RefreshOverlay(OverlayFeed? feed)
    {
        var coach = _engine.Coach.LatestMessage;
        var showCoach = coach is not null && DateTime.UtcNow - coach.At < InCarCoach.MessageShownFor;
        CoachText.Text = showCoach ? coach!.Text : "";
        CoachText.Visibility = showCoach ? Visibility.Visible : Visibility.Hidden;

        if (feed is null)
            return;
        var snapshot = feed.Refresh();
        var language = _engine.Language;
        Stats.Show(snapshot, language, _engine.Rotation);
        AreaRow.Show(snapshot, language);
        InAreaText.Visibility = snapshot.InArea ? Visibility.Visible : Visibility.Hidden;
        var status = feed.Status(language, snapshot);
        OverlayStatusText.Text = status ?? "";
        OverlayStatusText.Visibility = status is null ? Visibility.Collapsed : Visibility.Visible;
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
                    Brake: Math.Clamp(lap.Brakes[i], 0, 1) * 100))
                .OrderBy(s => s.Pct)
                .ToArray();
        _pcts = samples.Select(s => s.Pct).ToArray();
        _brakes = samples.Select(s => s.Brake).ToArray();
        _gearChanges = (lap?.GearChanges ?? [])
            .Select(change => ((change.Pct % 1 + 1) % 1, change.Gear, change.Gear > change.From))
            .ToArray();
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
        var points = new List<(double Feet, double Brake)>();
        for (var i = 0; i < _pcts.Length; i++)
        {
            var feet = FeetFromCar(_pcts[i], position, lengthFeet);
            if (feet >= -BehindFeet - MarginFeet && feet <= SpanFeet - BehindFeet + MarginFeet)
                points.Add((feet, _brakes[i]));
        }
        points.Sort((a, b) => a.Feet.CompareTo(b.Feet));

        var trace = new PointCollection(points.Count);
        double? atCar = null;
        for (var i = 0; i < points.Count; i++)
        {
            trace.Add(new Point(X(points[i].Feet), Y(points[i].Brake)));
            if (i > 0 && points[i - 1].Feet <= 0 && points[i].Feet >= 0)
            {
                var (f0, b0) = points[i - 1];
                var (f1, b1) = points[i];
                atCar = f1 > f0 ? b0 + (b1 - b0) * (0 - f0) / (f1 - f0) : b1;
            }
        }
        _trace.Points = trace;
        DrawGears(position, lengthFeet);
        BrakeReadout.Text = atCar is { } brake ? $"{brake.ToString("0", Loc.Culture(_language))}%" : "—";

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

        // The driver's brake behind the car, up to the car's line
        var driver = new PointCollection(_driverBrakes.Count);
        foreach (var (pct, driverBrake) in _driverBrakes)
            driver.Add(new Point(X(FeetFromCar(pct, position, lengthFeet)), Y(driverBrake)));
        _driverTrace.Points = driver;
    }

    // Adds the driver's brake at a new position, and drops what's gone off the left edge
    private void RecordDriverBrake(float pct, float? brake, double lengthFeet)
    {
        if (lengthFeet <= 0)
        {
            _driverBrakes.Clear();
            return;
        }
        if (_driverBrakes.Count > 0)
        {
            var step = (double)pct - _driverBrakes[^1].Pct;
            step -= Math.Floor(step + 0.5); // across the start/finish line
            if (step == 0)
                return;
            if (step < 0 || step > JumpPct)
                _driverBrakes.Clear();
        }
        _driverBrakes.Add((pct, Math.Clamp(brake ?? 0, 0, 1) * 100.0));
        var keep = (BehindFeet + MarginFeet) / lengthFeet;
        var drop = 0;
        while (drop < _driverBrakes.Count - 1 && Behind(_driverBrakes[drop].Pct, pct) > keep)
            drop++;
        _driverBrakes.RemoveRange(0, drop);
    }

    // How far (a share of the lap, 0-1) a position is behind the car, across the start/finish line
    private static double Behind(float pct, float car) => ((car - pct) % 1 + 1) % 1;

    // Each gear change of the Target Lap within the window: the gear it shifted into, across the top, centered on
    // where it shifted (blue up, amber down)
    private void DrawGears(float position, double lengthFeet)
    {
        _gears.Children.Clear();
        foreach (var (pct, gear, up) in _gearChanges)
        {
            var feet = FeetFromCar(pct, position, lengthFeet);
            if (feet < -BehindFeet - MarginFeet || feet > SpanFeet - BehindFeet + MarginFeet)
                continue;
            var brush = up ? UpshiftBrush : DownshiftBrush;
            var label = new Border
            {
                Width = 22, Height = GearBand - 4, CornerRadius = new CornerRadius(4),
                BorderBrush = brush, BorderThickness = new Thickness(1.5), Background = PlotBackground,
                Child = new TextBlock
                {
                    Text = gear.ToString(Culture), Foreground = brush, FontWeight = FontWeights.Bold, FontSize = 13,
                    HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
                },
            };
            Canvas.SetLeft(label, X(feet) - 11);
            Canvas.SetTop(label, 2);
            _gears.Children.Add(label);
        }
    }

    // How far a point of the lap (0-1) is from the car, in feet: -0.5 to 0.5 of a lap, across the start/finish line
    // (negative is behind the car)
    private static double FeetFromCar(double pct, float position, double lengthFeet)
    {
        var ahead = pct - position;
        ahead -= Math.Floor(ahead + 0.5);
        return ahead * lengthFeet;
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
        Plot.Children.Add(_trace);
        Plot.Children.Add(_driverTrace);

        _car.X1 = _car.X2 = X(0);
        _car.Y1 = 0;
        _car.Y2 = Plot.ActualHeight;
        Plot.Children.Add(_car);
        Plot.Children.Add(_brakeBar);
        Plot.Children.Add(_gears); // over the car's line, so the gear at the car is readable

        // Distance from the car: every 100 ft, or 25 m for Metric Preferred Units
        var step = _target.Metric ? 25 * FeetPerMeter : 100;
        var unit = Loc.DistanceUnit(_target.Metric);
        for (var feet = -Math.Floor(BehindFeet / step) * step; feet <= SpanFeet - BehindFeet; feet += step)
        {
            var value = Math.Round(_target.Metric ? feet / FeetPerMeter : feet);
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

    // Loads the Target Lap again on the next frame, e.g. after changing it in Debrief Coach, and with it the focus
    // areas' targets and the brake beeps' brakepoints, which come from it
    private void Reload_Click(object sender, RoutedEventArgs e)
    {
        _target.Reload();
        _feed?.Reload();
        _engine.ReloadBrakeBeeps();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        CompositionTarget.Rendering -= OnRendering;
        _overlayTimer.Stop();
        base.OnClosed(e);
    }
}
