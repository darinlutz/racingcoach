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
/// Then a game, with the Start button: three of the Target Lap's braking zones (BrakeDrill), smoothed, scroll past
/// a line at the Target Lap's pace, three times through, with the brake beeps before each brakepoint, while the
/// driver's own brake is drawn up to the line; then Play Again counts down from 3 and plays three other zones.
/// </summary>
public partial class BrakePracticeWindow : Window
{
    private static readonly double[] GuideLines = [20, 40, 60, 80, 100];
    private static readonly TimeSpan History = TimeSpan.FromSeconds(8);
    private static readonly TimeSpan RescanEvery = TimeSpan.FromSeconds(2);
    // How long "Calibration complete" shows before the graph
    private static readonly TimeSpan CompleteFor = TimeSpan.FromSeconds(1.5);
    // The game's graph: this much behind the line where the driver's brake is now, and ahead of it
    private const double GameBehind = 2;
    private const double GameAhead = 4;
    private const double CountdownSeconds = 3; // before Play Again's drill
    private const double BrakeBarHalfWidth = 14;
    private const double LabelWidth = 40; // left margin for the 20%..100% labels
    private const double TopPad = 10;     // so the 100% line isn't on the edge
    private static readonly Brush TraceBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush FillBrush = Frozen(Color.FromArgb(0x40, 0xEF, 0x44, 0x44));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));
    private static readonly Brush PillBrush = Frozen(Color.FromRgb(0x23, 0x24, 0x28));
    private static readonly Brush DoneBrush = Frozen(Color.FromRgb(0x22, 0xC5, 0x5E));
    private static readonly Brush DoneTextBrush = Frozen(Color.FromRgb(0x0B, 0x1F, 0x12));
    // The game's colors, like Target Telemetry's: the drill's brake, the driver's over it, the line and the bar on it
    private static readonly Brush DriverTraceBrush = Frozen(Color.FromRgb(0xFF, 0x2D, 0x2D));
    private static readonly Brush NowBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush BrakeBarBrush = Frozen(Color.FromRgb(0xFA, 0xCC, 0x15));

    private readonly Stopwatch _clock = Stopwatch.StartNew();
    // (seconds since opening, brake %), oldest first
    private readonly Queue<(double Time, double Brake)> _samples = new();
    private readonly Polyline _trace = new() { Stroke = TraceBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _fill = new() { Fill = FillBrush };
    private readonly Polyline _drillTrace = new() { Stroke = TraceBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _drillFill = new() { Fill = FillBrush };
    private readonly Line _now = new() { Stroke = NowBrush, StrokeThickness = 2, Visibility = Visibility.Collapsed };
    private readonly Line _brakeBar = new() { Stroke = BrakeBarBrush, StrokeThickness = 4, StrokeStartLineCap = PenLineCap.Round,
        StrokeEndLineCap = PenLineCap.Round, Visibility = Visibility.Collapsed };
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

    // The game: the Target Lap the drills come from, and the drill being played (null when none is)
    private readonly TargetLapSource _target;
    private readonly BeepQueue _beeps = new();
    private (TargetLapTrace Lap, List<BrakeDrill.Zone> Zones)? _zones;
    private List<BrakeDrill.Zone>? _lastPicked;
    private BrakeDrill? _drill;
    private double _drillStart;  // when it starts, in seconds since opening (later than now while counting down)
    private double _drillTime;   // how far into it the last frame was, so each beep plays once
    private bool _played;        // a drill was played through, so the button says Play Again
    // Shown over the graph (e.g. no Target Lap, or Play Again?); null shows nothing
    private Func<string?>? _message;

    internal BrakePracticeWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        _target = new TargetLapSource(engine);
        // Every frame (about 60 times a second), so quick stabs on the pedal show up
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        var now = _clock.Elapsed.TotalSeconds;
        _target.Update();
        if (_engine.Language != _language)
        {
            _language = _engine.Language;
            Loc.Apply(this, _language);
            ShowStatus();
            StartButton.Content = Loc.T(_language, _played ? "brake.playAgain" : "brake.start");
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
        while (_samples.Count > 0 && _samples.Peek().Time < now - Behind)
            _samples.Dequeue();
        UpdateGame(now);
        DrawTrace(now);
    }

    // The graph's span: the last few seconds up to now, or in the game, a little behind now and more ahead
    private double Behind => _drill is null ? History.TotalSeconds : GameBehind;
    private double Ahead => _drill is null ? 0 : GameAhead;

    // Starts a drill of three braking zones of the Target Lap, after a countdown when it's Play Again
    private void Start_Click(object sender, RoutedEventArgs e)
    {
        _message = null;
        if (_target.Lap is not { } lap)
        {
            // No upload key, still loading, no Target Lap...; gone once it has loaded
            _message = () => _target.Lap is null ? _target.Status(true, true).Status : null;
            return;
        }
        if (_zones?.Lap != lap)
            _zones = (lap, BrakeDrill.FindZones(lap));
        var zones = _zones.Value.Zones;
        if (zones.Count == 0)
        {
            _message = () => Loc.T(_language, "brake.noZones");
            return;
        }

        var picked = BrakeDrill.Pick(zones, _lastPicked, Random.Shared);
        _lastPicked = picked;
        _drill = BrakeDrill.Build(lap, picked, _target.LengthFeet);
        var now = _clock.Elapsed.TotalSeconds;
        _drillStart = now + (_played ? CountdownSeconds : 0);
        _drillTime = now - _drillStart;
        ShowGame(true);
        ActivityLog.Shared.Write($"Brake Practice: playing {string.Join(", ", picked.Select(z => $"{(z.Heavy ? "heavy" : "medium")} {z.Peak:P0}"))} braking from {lap.FileName}");
    }

    // The countdown, the beeps as their times go by, which run it is and the zone coming up, and the end
    private void UpdateGame(double now)
    {
        var message = _message?.Invoke();
        GameMessage.Text = message ?? "";
        GameMessagePanel.Visibility = message is null ? Visibility.Collapsed : Visibility.Visible;
        if (_drill is not { } drill)
            return;

        var time = now - _drillStart;
        CountdownText.Visibility = time < 0 ? Visibility.Visible : Visibility.Collapsed;
        if (time < 0)
            CountdownText.Text = Math.Ceiling(-time).ToString(Loc.Culture(_language));
        var volume = BrakeBeeps.Gain(_engine.BrakeBeepsVolume);
        foreach (var (at, brakepoint) in drill.Beeps)
        {
            if (at <= _drillTime || at > time)
                continue;
            if (brakepoint)
                _beeps.Brakepoint(volume);
            else
                _beeps.Warning(volume);
        }
        _drillTime = time;

        if (time >= drill.Seconds)
        {
            _played = true;
            ShowGame(false);
            _message = () => Loc.T(_language, "brake.playAgainPrompt");
            return;
        }
        var run = Math.Clamp((int)Math.Floor(Math.Max(time, 0) / drill.RunSeconds), 0, BrakeDrill.Runs - 1);
        var inRun = Math.Max(time, 0) - run * drill.RunSeconds;
        var zone = (drill.Segments.FirstOrDefault(s => s.End >= inRun) ?? drill.Segments[^1]).Zone;
        RunText.Text = $"{Loc.T(_language, "brake.run", run + 1, BrakeDrill.Runs)} · " +
            $"{Loc.T(_language, zone.Heavy ? "brake.heavy" : "brake.medium")} {(zone.Peak * 100).ToString("0", Loc.Culture(_language))}%";
    }

    // Switches the graph between the game and the driver's brake alone, and the buttons with it
    private void ShowGame(bool show)
    {
        if (!show)
            _drill = null;
        StartButton.Content = Loc.T(_language, _played ? "brake.playAgain" : "brake.start");
        StartButton.Visibility = !show && _graphing ? Visibility.Visible : Visibility.Collapsed;
        RecalibrateButton.Visibility = !show && _graphing ? Visibility.Visible : Visibility.Collapsed;
        RunPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        CountdownText.Visibility = Visibility.Collapsed;
        _fill.Visibility = show ? Visibility.Collapsed : Visibility.Visible;
        _drillTrace.Visibility = _drillFill.Visibility = _now.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        if (!show)
            _brakeBar.Visibility = Visibility.Collapsed;
        // The driver's brake brighter and thicker over the drill's, like Target Telemetry
        _trace.Stroke = show ? DriverTraceBrush : TraceBrush;
        _trace.StrokeThickness = show ? 3 : 2;
    }

    private void ShowGraph(bool show)
    {
        _graphing = show;
        _samples.Clear();
        CalibrationPanel.Visibility = show ? Visibility.Collapsed : Visibility.Visible;
        GraphPanel.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        BrakeReadout.Visibility = show ? Visibility.Visible : Visibility.Collapsed;
        _message = null;
        ShowGame(false);
    }

    private void Recalibrate()
    {
        _calibration = new PedalCalibration();
        _completedAt = null;
        _played = false;
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
        Graph.Children.Add(_drillFill);
        Graph.Children.Add(_drillTrace);
        Graph.Children.Add(_fill);
        Graph.Children.Add(_trace);
        Graph.Children.Add(_now);
        Graph.Children.Add(_brakeBar);
    }

    private void DrawTrace(double now)
    {
        if (Graph.ActualWidth - LabelWidth <= 0)
            return;
        var points = new PointCollection(_samples.Count);
        foreach (var (time, brake) in _samples)
            points.Add(new Point(X(time - now), Y(brake)));
        _trace.Points = points;
        _fill.Points = UnderTrace(points);
        if (_drill is not { } drill)
            return;

        // The drill's brake from just behind the line to well ahead of it
        var at = now - _drillStart;
        var first = Math.Max(0, (int)Math.Ceiling((at - GameBehind) * BrakeDrill.SampleRate));
        var last = Math.Min(drill.Brakes.Length - 1, (int)Math.Floor((at + GameAhead) * BrakeDrill.SampleRate));
        var drillPoints = new PointCollection(Math.Max(0, last - first + 1));
        for (var i = first; i <= last; i++)
            drillPoints.Add(new Point(X(i / (double)BrakeDrill.SampleRate - at), Y(drill.Brakes[i] * 100)));
        _drillTrace.Points = drillPoints;
        _drillFill.Points = UnderTrace(drillPoints);

        _now.X1 = _now.X2 = X(0);
        _now.Y1 = 0;
        _now.Y2 = Graph.ActualHeight;
        // The driver's brake now, as a bar across the line (hidden off the brake)
        var brakeNow = _calibration.Percent ?? 0;
        _brakeBar.Visibility = brakeNow > 0 ? Visibility.Visible : Visibility.Collapsed;
        _brakeBar.X1 = X(0) - BrakeBarHalfWidth;
        _brakeBar.X2 = X(0) + BrakeBarHalfWidth;
        _brakeBar.Y1 = _brakeBar.Y2 = Y(Math.Clamp(brakeNow, 0, 100));
    }

    // The area under a trace, down to 0%
    private PointCollection UnderTrace(PointCollection points)
    {
        var fill = new PointCollection(points.Count + 2);
        if (points.Count > 0)
        {
            fill.Add(new Point(points[0].X, Y(0)));
            foreach (var p in points)
                fill.Add(p);
            fill.Add(new Point(points[^1].X, Y(0)));
        }
        return fill;
    }

    // Seconds from now (negative is the past) to the graph's x
    private double X(double seconds) => LabelWidth + (Graph.ActualWidth - LabelWidth) * (seconds + Behind) / (Behind + Ahead);

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
        _beeps.Dispose();
        foreach (var device in _devices)
            device.Dispose();
        base.OnClosed(e);
    }
}
