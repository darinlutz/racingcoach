using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Target Telemetry button opens: a see-through, always-on-top window, like the overlay, with the
/// brake trace of the user's Target Lap (Account page, from /api/collector/target-lap) over the 500 ft of track
/// around the car. The car is the vertical line, 100 ft from the left, so the trace scrolls left as the car drives
/// and the target braking ahead comes into view. Positions come from live LapDistPct and the track's length (Track
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
    private static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;
    private static readonly Brush TraceBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush FillBrush = Frozen(Color.FromArgb(0x40, 0xEF, 0x44, 0x44));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));
    private static readonly Brush CarBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush WarningBrush = Frozen(Color.FromRgb(0xF5, 0x9E, 0x0B));

    private readonly CollectorEngine _engine;
    private readonly Polyline _trace = new() { Stroke = TraceBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _fill = new() { Fill = FillBrush };
    private readonly Line _car = new() { Stroke = CarBrush, StrokeThickness = 2 };

    // The Target Lap as fractions of a lap (0-1, around the start/finish line), sorted, with Brake 0-100 for each
    private double[] _pcts = [];
    private double[] _brakes = [];
    private TargetLapTrace? _lap;
    private double _trackDataFeet;
    private bool _metric;

    // What the Target Lap was loaded for: a different track or upload key loads it again
    private (string? Track, RacingCoachApi? Api)? _loadedFor;
    private bool _loading;
    private string? _loadError;
    private DateTime _retryAt;

    // What's drawn, so a frame without a new position or anything else new draws nothing
    private float? _position;
    private (float Position, double LengthFeet, double Width, double Height)? _drawn;

    internal TargetTelemetryWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        // Every frame (about 60 times a second, as fast as telemetry), so the trace scrolls smoothly
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        var track = TrackName(_engine.Session);
        var site = _engine.Api;
        if (!_loading && (_loadedFor != (track, site) || (_loadError is not null && DateTime.UtcNow >= _retryAt)))
            _ = LoadAsync(track, site);

        var live = _engine.TryGetLatest(out var data) && data.LapDistPct is { } pct && pct >= 0;
        if (live)
            _position = data.LapDistPct;

        var lengthFeet = _trackDataFeet > 0 ? _trackDataFeet : BrakeBeeps.IRacingLengthFeet(_engine.Session?.TrackLength);
        ShowStatus(track, site, live, lengthFeet);
        if (_lap is null || lengthFeet <= 0 || _position is not { } position)
        {
            _trace.Points = [];
            _fill.Points = [];
            BrakeReadout.Text = "—";
            _drawn = null;
            return;
        }
        if (_drawn != (position, lengthFeet, Plot.ActualWidth, Plot.ActualHeight))
            Draw(position, lengthFeet);
    }

    // The name the collector gives laps on this track, e.g. "Road Atlanta (Full Course)", or null before session info
    private static string? TrackName(SessionDetails? session) =>
        session is null || session.Track == "Unknown Track" ? null
        : session.TrackConfig is null ? session.Track
        : $"{session.Track} ({session.TrackConfig})";

    private async Task LoadAsync(string? track, RacingCoachApi? site)
    {
        _loadedFor = (track, site);
        _loadError = null;
        if (site is null)
        {
            SetLap(null);
            return; // loads once a key is entered
        }

        _loading = true;
        try
        {
            var response = await site.GetTargetLapAsync(track, CancellationToken.None);
            if (_loadedFor != (track, site))
                return; // the track or key changed meanwhile; that load is next
            var units = _metric;
            _trackDataFeet = response.TrackLengthFeet;
            _metric = response.Units == "metric";
            if (units != _metric)
                DrawAxes();
            SetLap(response.TargetLap);
            if (response.TargetLap is { } lap)
                ActivityLog.Shared.Write($"Target Telemetry: loaded your Target Lap {lap.FileName}");
        }
        catch (UnauthorizedAccessException)
        {
            // the main window asks for a new key; it loads again with it
            SetLap(null);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            _loadError = e.Message;
            _retryAt = DateTime.UtcNow + RetryAfter;
        }
        finally
        {
            _loading = false;
        }
    }

    // Wraps the unwrapped LapDistPct back into 0-1 and sorts the samples by it, so a stretch of track is one run
    private void SetLap(TargetLapTrace? lap)
    {
        _lap = lap;
        _drawn = null;
        var samples = lap is null
            ? []
            : lap.Pcts.Zip(lap.Brakes, (pct, brake) => (Pct: (pct % 1 + 1) % 1, Brake: Math.Clamp(brake, 0, 1) * 100))
                .OrderBy(s => s.Pct)
                .ToArray();
        _pcts = samples.Select(s => s.Pct).ToArray();
        _brakes = samples.Select(s => s.Brake).ToArray();
    }

    private void ShowStatus(string? track, RacingCoachApi? site, bool live, double lengthFeet)
    {
        string status;
        string? message = null;
        var brush = LabelBrush;
        if (site is null)
            message = status = "Enter an upload key (Upload Key in the main window) to load your Target Lap.";
        else if (_lap is null && _loadError is not null)
        {
            status = $"Couldn't load your Target Lap ({_loadError}). Trying again shortly.";
            message = "Couldn't load your Target Lap.";
        }
        else if (_lap is null)
            message = status = _loading ? "Loading your Target Lap…" : "No Target Lap. Set one on the Account page at RacingCoach.app.";
        else if (_lap.SameTrack == false)
        {
            status = $"Your Target Lap is from {_lap.Track}, not {track}.";
            brush = WarningBrush;
        }
        else if (lengthFeet <= 0)
            message = status = "Waiting for iRacing's track…";
        else
            status = live ? _lap.FileName : $"Waiting for iRacing… · {_lap.FileName}";
        if (_lap is not null && _position is null && message is null)
            message = "Waiting for the car to be on track…";

        if (StatusText.Text != status)
            StatusText.Text = status;
        StatusText.Foreground = brush;
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
            var ahead = _pcts[i] - position;
            ahead -= Math.Floor(ahead + 0.5); // -0.5 to 0.5 of a lap, across the start/finish line
            var feet = ahead * lengthFeet;
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

        _car.X1 = _car.X2 = X(0);
        _car.Y1 = 0;
        _car.Y2 = Plot.ActualHeight;
        Plot.Children.Add(_car);

        // Distance from the car: every 100 ft, or 25 m for Metric Preferred Units
        var step = _metric ? 25 * FeetPerMeter : 100;
        var unit = _metric ? "m" : "ft";
        for (var feet = -Math.Floor(BehindFeet / step) * step; feet <= SpanFeet - BehindFeet; feet += step)
        {
            var value = Math.Round(_metric ? feet / FeetPerMeter : feet);
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
    private void Reload_Click(object sender, RoutedEventArgs e)
    {
        if (!_loading)
            _loadedFor = null;
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        CompositionTarget.Rendering -= OnRendering;
        base.OnClosed(e);
    }
}
