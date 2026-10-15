using System.Windows;
using System.Windows.Controls;

namespace RacingCoach.Collector;

/// <summary>
/// The overlay's Max Brake (GetMaximumBrakePressure) and Min Speed (GetMinimumSpeed) boxes, and the Rotation
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
        ShowHandling(language, rotation);
    }

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
