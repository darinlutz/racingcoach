using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Shapes;
using System.Windows.Threading;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Rotation button opens: a see-through, always-on-top window, like the overlay, with the
/// Rotation Model's verdict (UNDERSTEER / OVERSTEER) and the numbers behind it, then the live
/// telemetry that shows how the car rotates (steering, yaw, velocities, accelerations) and the pedals. Each box
/// shows the value in readable units, with iRacing's own value and units under it.
/// </summary>
public partial class RotationWindow : Window
{
    private const double MetersPerSecondToMph = 2.23694;
    private const double MetersPerSecondToKph = 3.6;
    private const double Gravity = 9.80665;
    private const double RadiansToDegrees = 180 / Math.PI;
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;

    private const double BalanceBarWidth = 6;
    private static readonly Brush NeutralBrush = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush UndersteerBrush = Frozen(Color.FromRgb(0x3B, 0x8B, 0xFF));
    private static readonly Brush OversteerBrush = Frozen(Color.FromRgb(0xEF, 0x44, 0x44));
    private static readonly Brush TickBrush = Frozen(Color.FromRgb(0x48, 0x4A, 0x52));
    private static readonly Brush CenterBrush = Frozen(Color.FromRgb(0x6B, 0x6D, 0x75));

    private readonly CollectorEngine _engine;
    private readonly BalanceGauge _severity;
    private readonly BalanceGauge _confidence;
    // 20 times a second: the telemetry itself is 60 Hz, faster than anyone can read
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(50) };

    internal RotationWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        _severity = new BalanceGauge(SeverityGauge, SeverityText);
        _confidence = new BalanceGauge(ConfidenceGauge, ConfidenceText);
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();
    }

    private void Refresh()
    {
        if (!_engine.TryGetLatest(out var d))
        {
            StatusText.Text = "Waiting for iRacing…";
            foreach (var box in new[] { SteeringBox, SpeedBox, YawRateBox, YawBox, VelocityXBox, VelocityYBox, LatAccelBox, LongAccelBox, ThrottleBox, BrakeBox })
                box.Text = "—";
            foreach (var raw in new[] { SteeringRaw, SpeedRaw, YawRateRaw, YawRaw, VelocityXRaw, VelocityYRaw, LatAccelRaw, LongAccelRaw, ThrottleRaw, BrakeRaw })
                raw.Text = "";
            ClearRotationModel();
            return;
        }

        var session = _engine.Session;
        StatusText.Text = session is null ? "Live" : session.TrackConfig is null ? session.Track : $"{session.Track} ({session.TrackConfig})";

        // iRacing's angles are radians, positive to the left (counterclockwise)
        Show(SteeringBox, SteeringRaw, d.SteeringWheelAngle, v => LeftRight(v * RadiansToDegrees, "°"), "rad");
        // Speeds in the user's Preferred Units: mph, or kph for Metric
        var (perMetersPerSecond, speedUnit) = _engine.Metric ? (MetersPerSecondToKph, "kph") : (MetersPerSecondToMph, "mph");
        Show(SpeedBox, SpeedRaw, d.Speed, v => $"{v * perMetersPerSecond:0.0} {speedUnit}", "m/s");
        Show(YawRateBox, YawRateRaw, d.YawRate, v => LeftRight(v * RadiansToDegrees, "°/s"), "rad/s");
        Show(YawBox, YawRaw, d.Yaw, v => $"{v * RadiansToDegrees:0.0}°", "rad");
        Show(VelocityXBox, VelocityXRaw, d.VelocityX, v => $"{v * perMetersPerSecond:0.0} {speedUnit}", "m/s");
        // Y is positive to the left
        Show(VelocityYBox, VelocityYRaw, d.VelocityY, v => LeftRight(v * perMetersPerSecond, $" {speedUnit}"), "m/s");
        Show(LatAccelBox, LatAccelRaw, d.LatAccel, v => $"{v / Gravity:+0.00;−0.00;0.00} g", "m/s²");
        Show(LongAccelBox, LongAccelRaw, d.LongAccel, v => $"{v / Gravity:+0.00;−0.00;0.00} g", "m/s²");
        Show(ThrottleBox, ThrottleRaw, d.Throttle, v => $"{Math.Clamp(v, 0, 1) * 100:0}%", "");
        Show(BrakeBox, BrakeRaw, d.Brake, v => $"{Math.Clamp(v, 0, 1) * 100:0}%", "");
        ShowRotationModel();
    }

    // The Rotation Model's verdict, and why it can't give one when it can't
    private void ShowRotationModel()
    {
        var rotation = _engine.Rotation;
        if (!rotation.TryGetLatest(out var r))
        {
            ClearRotationModel();
            return;
        }

        // Severity is 0-100, confidence 0-1
        _severity.Show(r.OversteerSeverity > r.UndersteerSeverity ? r.OversteerSeverity / 100 : -r.UndersteerSeverity / 100);
        _confidence.Show(r.OversteerConfidence > r.UndersteerConfidence ? r.OversteerConfidence : -r.UndersteerConfidence);

        var label = r.IsValid ? r.DisplayLabel : "";
        HandlingBox.Text = label.Length > 0 ? label : r.State == Rotation.RotationState.Neutral ? "—" : "";
        HandlingBox.Foreground = label == "UNDERSTEER" ? Brush(rotation.Config.Display.UndersteerColor)
            : label == "OVERSTEER" ? Brush(rotation.Config.Display.OversteerColor)
            : Brushes.Gray;
        var calibration = rotation.Calibration?.CalibrationId ?? "no calibration for this car";
        var why = r.InvalidReason is null ? Rotation.RotationNames.Of(r.State) : $"UNKNOWN: {r.InvalidReason}";
        var phase = r.CornerPhase == Rotation.CornerPhase.Straight ? "" : $" · {Rotation.RotationNames.Of(r.CornerPhase)}";
        HandlingStatus.Text = $"{why}{phase} · {(r.FullCapability ? "yaw + sideslip" : "yaw only")} · {calibration}\n"
            + $"This session: {rotation.UndersteerEvents} understeer, {rotation.OversteerEvents} oversteer";

        SideslipBox.Text = r.SideslipAngleDegrees is { } beta ? LeftRight(beta, "°") : "—";
        SideslipRaw.Text = r.SideslipRateDegreesPerSecond is { } rate ? $"{rate.ToString("+0.0;−0.0;0.0", Culture)} °/s" : "";
        YawRatioBox.Text = r.YawResponseRatio is { } ratio ? $"{ratio * 100:0}%" : "—";
        YawRatioRaw.Text = r.YawRateExpected is { } expected && r.YawRateActual is { } actual
            ? $"{actual * RadiansToDegrees:0.0} of {expected * RadiansToDegrees:0.0} °/s"
            : "";
        UndersteerBox.Text = $"{r.UndersteerConfidence * 100:0}%";
        UndersteerRaw.Text = $"confidence · severity {r.UndersteerSeverity:0}";
        OversteerBox.Text = $"{r.OversteerConfidence * 100:0}%";
        OversteerRaw.Text = $"confidence · severity {r.OversteerSeverity:0}"
            + (r.OversteerType is { } type ? $" · {Rotation.RotationNames.Of(type)}" : "");
    }

    // The center line and the 50% ticks each way; redrawn when the window is resized
    private void Gauge_SizeChanged(object sender, SizeChangedEventArgs e) => ((sender as Canvas)?.Tag as BalanceGauge)?.Draw();

    /// <summary>
    /// One understeer/oversteer gauge: a bar in the middle when neutral that moves left and turns blue by the
    /// understeer, or right and red by the oversteer, with ticks at 50% each way and the reading under it.
    /// </summary>
    private sealed class BalanceGauge
    {
        private readonly Canvas _canvas;
        private readonly TextBlock _text;
        private readonly Rectangle _bar = new() { Width = BalanceBarWidth, Fill = NeutralBrush, RadiusX = 2, RadiusY = 2 };
        // -1 (full understeer) to +1 (full oversteer); 0 is neutral
        private double _value;

        public BalanceGauge(Canvas canvas, TextBlock text)
        {
            _canvas = canvas;
            _text = text;
            canvas.Tag = this;
            Draw();
        }

        public void Show(double value)
        {
            _value = Math.Clamp(value, -1, 1);
            _bar.Fill = _value > 0 ? OversteerBrush : _value < 0 ? UndersteerBrush : NeutralBrush;
            _text.Text = _value > 0 ? $"{_value * 100:0}% oversteer" : _value < 0 ? $"{-_value * 100:0}% understeer" : "neutral";
            Place();
        }

        public void Draw()
        {
            var width = _canvas.ActualWidth;
            var height = _canvas.ActualHeight;
            _canvas.Children.Clear();
            foreach (var (x, brush, inset) in new[] { (width / 4, TickBrush, height * 0.25), (width * 3 / 4, TickBrush, height * 0.25), (width / 2, CenterBrush, 0.0) })
                _canvas.Children.Add(new Line { X1 = x, X2 = x, Y1 = inset, Y2 = height - inset, Stroke = brush, StrokeThickness = 1 });
            _canvas.Children.Add(_bar);
            Place();
        }

        private void Place()
        {
            var half = _canvas.ActualWidth / 2;
            Canvas.SetLeft(_bar, Math.Clamp(half + _value * half - BalanceBarWidth / 2, 0, Math.Max(0, _canvas.ActualWidth - BalanceBarWidth)));
            _bar.Height = _canvas.ActualHeight;
        }
    }

    private void ClearRotationModel()
    {
        _severity.Show(0);
        _confidence.Show(0);
        HandlingBox.Text = "";
        HandlingStatus.Text = "";
        foreach (var box in new[] { SideslipBox, YawRatioBox, UndersteerBox, OversteerBox })
            box.Text = "—";
        foreach (var raw in new[] { SideslipRaw, YawRatioRaw, UndersteerRaw, OversteerRaw })
            raw.Text = "";
    }

    private static Brush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }

    private static Brush Brush(string color)
    {
        try
        {
            return new BrushConverter().ConvertFromInvariantString(color) as Brush ?? Brushes.White;
        }
        catch (FormatException)
        {
            return Brushes.White;
        }
    }

    private static void Show(TextBox box, TextBlock raw, float? value, Func<double, string> format, string units)
    {
        box.Text = value is { } v ? format(v) : "—";
        raw.Text = value is { } r ? $"{r.ToString("0.0000", Culture)} {units}".TrimEnd() : "";
    }

    // 12.3 -> "12.3°L", -12.3 -> "12.3°R"
    private static string LeftRight(double value, string units) =>
        Math.Abs(value) < 0.05 ? $"0.0{units}" : $"{Math.Abs(value).ToString("0.0", Culture)}{units} {(value > 0 ? "L" : "R")}";

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState == MouseButtonState.Pressed)
            DragMove();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        _timer.Stop();
        base.OnClosed(e);
    }
}
