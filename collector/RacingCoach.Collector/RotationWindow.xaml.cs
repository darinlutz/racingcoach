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
/// shows the value in readable units, with iRacing's own value and units under it. In the user's Preferred Language
/// and Units.
/// </summary>
public partial class RotationWindow : Window
{
    private const double MetersPerSecondToMph = 2.23694;
    private const double MetersPerSecondToKph = 3.6;
    private const double Gravity = 9.80665;
    private const double RadiansToDegrees = 180 / Math.PI;
    private static readonly CultureInfo Invariant = CultureInfo.InvariantCulture;

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
    // The user's Preferred Language, and its number format
    private string _language = "";
    private CultureInfo _culture = Invariant;

    internal RotationWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        _severity = new BalanceGauge(this, SeverityGauge, SeverityText);
        _confidence = new BalanceGauge(this, ConfidenceGauge, ConfidenceText);
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();
    }

    private void Refresh()
    {
        if (_engine.Language != _language)
        {
            _language = _engine.Language;
            _culture = Loc.Culture(_language);
            Loc.Apply(this, _language);
        }
        if (!_engine.TryGetLatest(out var d))
        {
            StatusText.Text = Loc.T(_language, "waitingForIRacing");
            foreach (var box in new[] { SteeringBox, SpeedBox, YawRateBox, YawBox, VelocityXBox, VelocityYBox, LatAccelBox, LongAccelBox, ThrottleBox, BrakeBox })
                box.Text = "—";
            foreach (var raw in new[] { SteeringRaw, SpeedRaw, YawRateRaw, YawRaw, VelocityXRaw, VelocityYRaw, LatAccelRaw, LongAccelRaw, ThrottleRaw, BrakeRaw })
                raw.Text = "";
            ClearRotationModel();
            TrackIdText.Text = LapPctText.Text = "";
            return;
        }

        var session = _engine.Session;
        // The recorder's track name, "Track (Config)", which is what TrackKeys is keyed by
        var track = session is null ? null : session.TrackConfig is null ? session.Track : $"{session.Track} ({session.TrackConfig})";
        StatusText.Text = track ?? Loc.T(_language, "live");
        TrackIdText.Text = track is null ? "" : TrackKeys.For(track) ?? "";
        LapPctText.Text = d.LapDistPct is { } pct && float.IsFinite(pct) && pct >= 0 ? $"{N(pct * 100, "0.00")}%" : "";

        // iRacing's angles are radians, positive to the left (counterclockwise)
        Show(SteeringBox, SteeringRaw, d.SteeringWheelAngle, v => LeftRight(v * RadiansToDegrees, "°"), "rad");
        // Speeds in the user's Preferred Units: mph, or km/h for Metric
        var perMetersPerSecond = _engine.Metric ? MetersPerSecondToKph : MetersPerSecondToMph;
        var speedUnit = Loc.SpeedUnit(_engine.Metric);
        Show(SpeedBox, SpeedRaw, d.Speed, v => $"{N(v * perMetersPerSecond, "0.0")} {speedUnit}", "m/s");
        Show(YawRateBox, YawRateRaw, d.YawRate, v => LeftRight(v * RadiansToDegrees, "°/s"), "rad/s");
        Show(YawBox, YawRaw, d.Yaw, v => $"{N(v * RadiansToDegrees, "0.0")}°", "rad");
        Show(VelocityXBox, VelocityXRaw, d.VelocityX, v => $"{N(v * perMetersPerSecond, "0.0")} {speedUnit}", "m/s");
        // Y is positive to the left
        Show(VelocityYBox, VelocityYRaw, d.VelocityY, v => LeftRight(v * perMetersPerSecond, $" {speedUnit}"), "m/s");
        Show(LatAccelBox, LatAccelRaw, d.LatAccel, v => $"{N(v / Gravity, "+0.00;−0.00;0.00")} g", "m/s²");
        Show(LongAccelBox, LongAccelRaw, d.LongAccel, v => $"{N(v / Gravity, "+0.00;−0.00;0.00")} g", "m/s²");
        Show(ThrottleBox, ThrottleRaw, d.Throttle, v => $"{N(Math.Clamp(v, 0, 1) * 100, "0")}%", "");
        Show(BrakeBox, BrakeRaw, d.Brake, v => $"{N(Math.Clamp(v, 0, 1) * 100, "0")}%", "");
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
        HandlingBox.Text = label == "UNDERSTEER" ? Loc.T(_language, "understeer")
            : label == "OVERSTEER" ? Loc.T(_language, "oversteer")
            : r.State == Rotation.RotationState.Neutral ? "—" : "";
        HandlingBox.Foreground = label == "UNDERSTEER" ? Brush(rotation.Config.Display.UndersteerColor)
            : label == "OVERSTEER" ? Brush(rotation.Config.Display.OversteerColor)
            : Brushes.Gray;
        var calibration = rotation.Calibration?.CalibrationId ?? Loc.T(_language, "rotation.noCalibration");
        var why = r.InvalidReason is null ? StateName(r.State) : Loc.T(_language, "rotation.unknownBecause", Loc.T(_language, $"reason.{r.InvalidReason}"));
        var phase = r.CornerPhase == Rotation.CornerPhase.Straight ? "" : $" · {Loc.T(_language, $"phase.{Rotation.RotationNames.Of(r.CornerPhase)}")}";
        var capability = Loc.T(_language, r.FullCapability ? "rotation.yawAndSideslip" : "rotation.yawOnly");
        HandlingStatus.Text = $"{why}{phase} · {capability} · {calibration}\n"
            + Loc.T(_language, "rotation.thisSession", rotation.UndersteerEvents, rotation.OversteerEvents);

        SideslipBox.Text = r.SideslipAngleDegrees is { } beta ? LeftRight(beta, "°") : "—";
        SideslipRaw.Text = r.SideslipRateDegreesPerSecond is { } rate ? $"{N(rate, "+0.0;−0.0;0.0")} °/s" : "";
        YawRatioBox.Text = r.YawResponseRatio is { } ratio ? $"{N(ratio * 100, "0")}%" : "—";
        YawRatioRaw.Text = r.YawRateExpected is { } expected && r.YawRateActual is { } actual
            ? Loc.T(_language, "rotation.ofExpected", actual * RadiansToDegrees, expected * RadiansToDegrees)
            : "";
        UndersteerBox.Text = $"{N(r.UndersteerConfidence * 100, "0")}%";
        UndersteerRaw.Text = Loc.T(_language, "rotation.confidenceSeverity", r.UndersteerSeverity);
        OversteerBox.Text = $"{N(r.OversteerConfidence * 100, "0")}%";
        OversteerRaw.Text = Loc.T(_language, "rotation.confidenceSeverity", r.OversteerSeverity)
            + (r.OversteerType is { } type ? $" · {Loc.T(_language, $"phase.{Rotation.RotationNames.Of(type)}")}" : "");
    }

    // NEUTRAL, UNDERSTEER, OVERSTEER or UNKNOWN in the user's language
    private string StateName(Rotation.RotationState state) => state switch
    {
        Rotation.RotationState.Neutral => Loc.T(_language, "neutral"),
        Rotation.RotationState.Understeer => Loc.T(_language, "understeer"),
        Rotation.RotationState.Oversteer => Loc.T(_language, "oversteer"),
        _ => Loc.T(_language, "unknown"),
    };

    // A number in the user's language's format, e.g. 12,3 in Portuguese
    private string N(double value, string format) => value.ToString(format, _culture);

    // The center line and the 50% ticks each way; redrawn when the window is resized
    private void Gauge_SizeChanged(object sender, SizeChangedEventArgs e) => ((sender as Canvas)?.Tag as BalanceGauge)?.Draw();

    /// <summary>
    /// One understeer/oversteer gauge: a bar in the middle when neutral that moves left and turns blue by the
    /// understeer, or right and red by the oversteer, with ticks at 50% each way and the reading under it.
    /// </summary>
    private sealed class BalanceGauge
    {
        private readonly RotationWindow _window;
        private readonly Canvas _canvas;
        private readonly TextBlock _text;
        private readonly Rectangle _bar = new() { Width = BalanceBarWidth, Fill = NeutralBrush, RadiusX = 2, RadiusY = 2 };
        // -1 (full understeer) to +1 (full oversteer); 0 is neutral
        private double _value;

        public BalanceGauge(RotationWindow window, Canvas canvas, TextBlock text)
        {
            _window = window;
            _canvas = canvas;
            _text = text;
            canvas.Tag = this;
            Draw();
        }

        public void Show(double value)
        {
            _value = Math.Clamp(value, -1, 1);
            _bar.Fill = _value > 0 ? OversteerBrush : _value < 0 ? UndersteerBrush : NeutralBrush;
            var language = _window._language;
            _text.Text = _value > 0 ? Loc.T(language, "rotation.percentOversteer", _value * 100)
                : _value < 0 ? Loc.T(language, "rotation.percentUndersteer", -_value * 100)
                : Loc.T(language, "rotation.neutral");
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
        // iRacing's own value, as iRacing writes it
        raw.Text = value is { } r ? $"{r.ToString("0.0000", Invariant)} {units}".TrimEnd() : "";
    }

    // 12.3 -> "12.3° L", -12.3 -> "12.3° R" (E/D in Portuguese, I/D in Spanish, L/R in German)
    private string LeftRight(double value, string units) =>
        Math.Abs(value) < 0.05 ? $"{N(0, "0.0")}{units}"
        : $"{N(Math.Abs(value), "0.0")}{units} {Loc.T(_language, value > 0 ? "left" : "right")}";

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
