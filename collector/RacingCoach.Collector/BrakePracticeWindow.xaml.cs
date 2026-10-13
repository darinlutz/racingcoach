using System.Diagnostics;
using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Brake Practice button opens: a see-through, always-on-top window, like the overlay, that graphs
/// the brake pedal (0-100%) over the last few seconds as the driver presses it, with lines at 20, 40, 60, 80 and
/// 100%, and a readout of the exact percentage being applied.
/// </summary>
public partial class BrakePracticeWindow : Window
{
    private static readonly double[] GuideLines = [20, 40, 60, 80, 100];
    private static readonly TimeSpan History = TimeSpan.FromSeconds(8);
    private const double LabelWidth = 40; // left margin for the 20%..100% labels
    private const double TopPad = 10;     // so the 100% line isn't on the edge
    private static readonly Brush TraceBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush FillBrush = Frozen(Color.FromArgb(0x40, 0xEF, 0x44, 0x44));
    private static readonly Brush GuideBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush LabelBrush = Frozen(Color.FromRgb(0x9A, 0x9C, 0xA3));

    private readonly CollectorEngine _engine;
    private readonly Stopwatch _clock = Stopwatch.StartNew();
    // (seconds since opening, brake %), oldest first
    private readonly Queue<(double Time, double Brake)> _samples = new();
    private readonly Polyline _trace = new() { Stroke = TraceBrush, StrokeThickness = 2, StrokeLineJoin = PenLineJoin.Round };
    private readonly Polygon _fill = new() { Fill = FillBrush };

    internal BrakePracticeWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        // Every frame (about 60 times a second, as fast as the telemetry), so quick stabs on the pedal show up
        CompositionTarget.Rendering += OnRendering;
    }

    private void OnRendering(object? sender, EventArgs e)
    {
        var now = _clock.Elapsed.TotalSeconds;
        if (_engine.TryGetLatest(out var d) && d.Brake is { } brake)
        {
            var percent = Math.Clamp(brake, 0, 1) * 100;
            _samples.Enqueue((now, percent));
            BrakeReadout.Text = $"{percent.ToString("0.0", CultureInfo.InvariantCulture)}%";
            var session = _engine.Session;
            StatusText.Text = session is null ? "Live" : session.TrackConfig is null ? session.Track : $"{session.Track} ({session.TrackConfig})";
        }
        else
        {
            BrakeReadout.Text = "—";
            StatusText.Text = "Waiting for iRacing…";
        }
        while (_samples.Count > 0 && _samples.Peek().Time < now - History.TotalSeconds)
            _samples.Dequeue();
        DrawTrace(now);
    }

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
        base.OnClosed(e);
    }
}
