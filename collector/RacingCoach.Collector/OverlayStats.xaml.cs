using System.Windows;
using System.Windows.Controls;

namespace RacingCoach.Collector;

/// <summary>
/// The overlay's Max Brake (GetMaximumBrakePressure), Min Speed (GetMinimumSpeed) and Max Steering (the
/// largest steering angle of the last few seconds, held like Min Speed, from OverlayEngine) boxes, and the Rotation
/// Model's UNDERSTEER or OVERSTEER beside them; in the overlay and, as a copy, the Target Telemetry window.
/// </summary>
public partial class OverlayStats : UserControl
{
    // The language and units the Min Speed heading is in (null before the first Show)
    private (string Language, bool Metric)? _shownIn;

    public OverlayStats() => InitializeComponent();

    internal void Show(OverlaySnapshot snapshot, string language, RotationMonitor rotation)
    {
        if (_shownIn != (language, snapshot.Metric))
        {
            _shownIn = (language, snapshot.Metric);
            MinSpeedHeading.Text = Loc.T(language, "overlay.minSpeed", Loc.SpeedUnit(snapshot.Metric));
        }
        MaxBrakeBox.Text = snapshot.MaxBrake ?? "";
        MinSpeedBox.Text = snapshot.MinSpeed ?? "";
        MaxSteeringBox.Text = snapshot.MaxSteering ?? "";
        ShowLastArea(snapshot, language);
        ShowHandling(language, rotation);
    }

    // The focus area just left, while OverlayEngine holds it (3 s): its name in the headings ("T3 Time", "T3 Exit")
    // and its time and exit speed, purple for a session best; hidden otherwise, and when neither has a value yet
    private void ShowLastArea(OverlaySnapshot snapshot, string language)
    {
        var last = snapshot.LastArea;
        var name = snapshot.LastAreaIndex is { } index && index >= 0 && index < snapshot.AreaNames.Count
            ? snapshot.AreaNames[index] : null;
        var time = last?.Time?.Trim() ?? "";
        var exit = last?.Exit?.Trim() ?? "";
        if (last is null || string.IsNullOrEmpty(name) || (time.Length == 0 && exit.Length == 0))
        {
            LastAreaPanel.Visibility = Visibility.Hidden;
            return;
        }
        LastTimeHeading.Text = Loc.T(language, "overlay.areaTime", name);
        LastExitHeading.Text = Loc.T(language, "overlay.areaExit", name);
        LastTimeBox.Text = time;
        LastExitBox.Text = exit;
        LastTimeBox.Foreground = ValueBrush(last.TimeColor);
        LastExitBox.Foreground = ValueBrush(last.ExitColor);
        LastAreaPanel.Visibility = Visibility.Visible;
    }

    private static System.Windows.Media.Brush ValueBrush(string? color) =>
        OverlayAreaRow.NamedBrush(color) is { } brush && brush.Color.A > 0 ? brush : OverlayAreaRow.LightText;

    // The Rotation Model's label: only a confirmed understeer or oversteer, never a guess (see RotationMonitor)
    private void ShowHandling(string language, RotationMonitor rotation)
    {
        var label = rotation.TryGetLatest(out var result) && result.IsValid ? result.DisplayLabel : "";
        HandlingBox.Visibility = label.Length > 0 ? Visibility.Visible : Visibility.Hidden;
        if (label.Length == 0)
            return;
        HandlingBox.Text = Loc.T(language, label == "UNDERSTEER" ? "understeer" : "oversteer");
        var color = label == "UNDERSTEER" ? rotation.Config.Display.UndersteerColor : rotation.Config.Display.OversteerColor;
        HandlingBox.Foreground = OverlayAreaRow.NamedBrush(color) ?? OverlayAreaRow.LightText;
    }
}
