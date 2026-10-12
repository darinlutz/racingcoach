using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;

namespace RacingCoach.Collector;

/// <summary>
/// The window the Rotation button opens: a see-through, always-on-top window, like the overlay, with the live
/// telemetry that shows how the car rotates (steering, yaw, velocities, accelerations) and the pedals. Each box
/// shows the value in readable units, with iRacing's own value and units under it.
/// </summary>
public partial class RotationWindow : Window
{
    private const double MetersPerSecondToMph = 2.23694;
    private const double Gravity = 9.80665;
    private const double RadiansToDegrees = 180 / Math.PI;
    private static readonly CultureInfo Culture = CultureInfo.InvariantCulture;

    private readonly CollectorEngine _engine;
    // 20 times a second: the telemetry itself is 60 Hz, faster than anyone can read
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(50) };

    internal RotationWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
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
            return;
        }

        var session = _engine.Session;
        StatusText.Text = session is null ? "Live" : session.TrackConfig is null ? session.Track : $"{session.Track} ({session.TrackConfig})";

        // iRacing's angles are radians, positive to the left (counterclockwise)
        Show(SteeringBox, SteeringRaw, d.SteeringWheelAngle, v => LeftRight(v * RadiansToDegrees, "°"), "rad");
        Show(SpeedBox, SpeedRaw, d.Speed, v => $"{v * MetersPerSecondToMph:0.0} mph", "m/s");
        Show(YawRateBox, YawRateRaw, d.YawRate, v => LeftRight(v * RadiansToDegrees, "°/s"), "rad/s");
        Show(YawBox, YawRaw, d.Yaw, v => $"{v * RadiansToDegrees:0.0}°", "rad");
        Show(VelocityXBox, VelocityXRaw, d.VelocityX, v => $"{v * MetersPerSecondToMph:0.0} mph", "m/s");
        // Y is positive to the left
        Show(VelocityYBox, VelocityYRaw, d.VelocityY, v => LeftRight(v * MetersPerSecondToMph, " mph"), "m/s");
        Show(LatAccelBox, LatAccelRaw, d.LatAccel, v => $"{v / Gravity:+0.00;−0.00;0.00} g", "m/s²");
        Show(LongAccelBox, LongAccelRaw, d.LongAccel, v => $"{v / Gravity:+0.00;−0.00;0.00} g", "m/s²");
        Show(ThrottleBox, ThrottleRaw, d.Throttle, v => $"{Math.Clamp(v, 0, 1) * 100:0}%", "");
        Show(BrakeBox, BrakeRaw, d.Brake, v => $"{Math.Clamp(v, 0, 1) * 100:0}%", "");
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
