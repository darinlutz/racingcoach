using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace RacingCoach.Collector;

/// <summary>
/// The overlay's one row of focus area values, the Upcoming Focus Area (outlined): the area the car is in ("Area"),
/// or the next one as soon as it leaves an area ("Next Area"), with its name and its values on this lap from
/// TelemetryEngine.js; hidden without one. Inside an area, Area Time and Area Exit are blank; once it leaves, they
/// show the area just left against the session's best (purple "BEST" for a new best) until it enters the next,
/// and Brake Pressure shows the next area's target (blank when the Target Lap doesn't brake there).
/// In the Target Telemetry window.
/// </summary>
public partial class OverlayAreaRow : UserControl
{
    // Each column's heading (a Loc key) and share of the width (the area's name first)
    private static readonly (string Heading, double Width)[] Columns =
    [
        ("overlay.focusArea", 95), ("overlay.brakePoint", 115), ("overlay.brakePressure", 105),
        ("overlay.time", 115), ("overlay.exit", 120), ("overlay.coast", 64), ("overlay.overlap", 64),
    ];
    private static readonly Brush BoxBackground = Frozen(Color.FromRgb(0x1A, 0x1B, 0x1E));
    internal static readonly Brush LightText = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush DarkText = Frozen(Color.FromRgb(0x12, 0x13, 0x15));
    private static readonly Brush UpcomingBorder = Frozen(Color.FromRgb(0x8A, 0xB4, 0xF8));
    // The script's color names (e.g. "Firebrick") as brushes; null for a name WPF doesn't know
    private static readonly Dictionary<string, SolidColorBrush?> NamedBrushes = [];

    private readonly TextBox[] _cells = new TextBox[Columns.Length];
    private readonly TextBlock[] _headings = new TextBlock[Columns.Length];
    // The language the headings are in (null before the first Show), and whether the first says Area or Next Area
    private string? _shownIn;
    private bool _shownInArea;

    public OverlayAreaRow()
    {
        InitializeComponent();
        var box = (Style)FindResource("Box");
        var heading = (Style)FindResource("Heading");
        AreaGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        AreaGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var c = 0; c < Columns.Length; c++)
        {
            AreaGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Columns[c].Width, GridUnitType.Star) });
            var text = new TextBlock { Style = heading };
            Grid.SetColumn(text, c);
            AreaGrid.Children.Add(text);
            _headings[c] = text;

            var cell = new TextBox
            {
                Style = box,
                Margin = new Thickness(0, 0, c == Columns.Length - 1 ? 0 : 4, 0),
                Visibility = Visibility.Collapsed,
                BorderBrush = UpcomingBorder,
                BorderThickness = new Thickness(2),
            };
            Grid.SetRow(cell, 1);
            Grid.SetColumn(cell, c);
            AreaGrid.Children.Add(cell);
            _cells[c] = cell;
        }
    }

    internal void Show(OverlaySnapshot snapshot, string language)
    {
        if (_shownIn != language || _shownInArea != snapshot.InArea)
        {
            _shownIn = language;
            _shownInArea = snapshot.InArea;
            for (var c = 0; c < Columns.Length; c++)
                _headings[c].Text = Loc.T(language, c == 0 && !snapshot.InArea ? "overlay.nextArea" : Columns[c].Heading);
        }
        var upcoming = snapshot.UpcomingArea;
        ShowRow(upcoming is { } u ? snapshot.AreaNames[u] : null, upcoming is { } a ? snapshot.Areas[a] : null,
            snapshot.InArea, snapshot.LastArea is { } l ? snapshot.Areas[l] : null);
    }

    // The area's name, then its values on this lap; hidden without a name. Between areas, the time and exit speed
    // are the last area's and the brake pressure is the next one's target
    private void ShowRow(string? name, OverlayAreaValues? area, bool inArea, OverlayAreaValues? last)
    {
        foreach (var cell in _cells)
            cell.Visibility = name is null ? Visibility.Collapsed : Visibility.Visible;
        if (name is null)
            return;

        // The brake point alert colors the row except Brake Pressure: "Transparent" (or nothing yet) leaves it as it is
        var alert = NamedBrush(area?.AlertColor);
        var alertBackground = alert is not null && alert.Color.A > 0 ? alert : null;

        Show(_cells[0], name, null, alertBackground);
        Show(_cells[1], area?.Brake, area?.BrakeColor, alertBackground);
        if (inArea)
            Show(_cells[2], area?.Force, area?.ForceColor, null);
        else
            Show(_cells[2], area?.ForceTarget, null, null);
        // Purple for the session's best ("BEST")
        Show(_cells[3], last?.Time, last?.TimeColor, alertBackground);
        Show(_cells[4], last?.Exit, last?.ExitColor, alertBackground);
        Show(_cells[5], area?.Coast, null, alertBackground);
        Show(_cells[6], area?.Overlap, null, alertBackground);
    }

    // A box's text in its own color, or during a brake point alert on the alert color in plain light or dark
    // text: the alert colors (Firebrick, SteelBlue, Green) are the value colors too, which would vanish on them
    private static void Show(TextBox box, string? text, string? color, SolidColorBrush? alertBackground)
    {
        box.Text = text ?? "";
        box.Background = alertBackground ?? BoxBackground;
        box.Foreground = alertBackground is not null ? (IsLight(alertBackground.Color) ? DarkText : LightText)
            : NamedBrush(color) is { } brush && brush.Color.A > 0 ? brush : LightText;
    }

    internal static SolidColorBrush? NamedBrush(string? name)
    {
        if (string.IsNullOrWhiteSpace(name))
            return null;
        if (!NamedBrushes.TryGetValue(name, out var brush))
        {
            try
            {
                brush = new BrushConverter().ConvertFromInvariantString(name.Trim()) as SolidColorBrush;
                brush?.Freeze();
            }
            catch (FormatException)
            {
                brush = null;
            }
            NamedBrushes[name] = brush;
        }
        return brush;
    }

    // Light backgrounds (e.g. Gainsboro, Orange) take dark text
    private static bool IsLight(Color color) => 0.299 * color.R + 0.587 * color.G + 0.114 * color.B > 150;

    private static SolidColorBrush Frozen(Color color)
    {
        var brush = new SolidColorBrush(color);
        brush.Freeze();
        return brush;
    }
}
