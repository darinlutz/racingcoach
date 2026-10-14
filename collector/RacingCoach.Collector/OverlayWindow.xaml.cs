using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace RacingCoach.Collector;

/// <summary>
/// The overlay the Launch Overlay button opens: a see-through, always-on-top window with the current
/// track's focus areas (from the user's Track Data on RacingCoach.app) and each one's values on this lap from
/// TelemetryEngine.js (OverlayEngine), plus the recent peak brake pressure and minimum speed. Only one row of
/// focus area values is shown, the Upcoming Focus Area: the area the car is in, or the next one as soon as it
/// leaves an area. Loads the track again whenever it changes. Everything is in the user's Preferred Language and
/// Units (Loc, and OverlayEngine for the script's text).
/// </summary>
public partial class OverlayWindow : Window
{
    // After the site couldn't be reached, try loading the track again this often
    private static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);

    private readonly CollectorEngine _engine;
    private readonly OverlayEngine _overlay;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    // Each column's heading (a Loc key) and share of the width (the Focus Area name first)
    private static readonly (string Heading, double Width)[] Columns =
    [
        ("overlay.focusArea", 95), ("overlay.brakePoint", 115), ("overlay.brakePressure", 105), ("overlay.gas", 115),
        ("overlay.time", 80), ("overlay.exit", 90), ("overlay.coast", 80), ("overlay.overlap", 80),
    ];
    private static readonly Brush BoxBackground = Frozen(Color.FromRgb(0x1A, 0x1B, 0x1E));
    private static readonly Brush LightText = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush DarkText = Frozen(Color.FromRgb(0x12, 0x13, 0x15));
    private static readonly Brush UpcomingBorder = Frozen(Color.FromRgb(0x8A, 0xB4, 0xF8));
    // The script's color names (e.g. "Firebrick") as brushes; null for a name WPF doesn't know
    private static readonly Dictionary<string, SolidColorBrush?> NamedBrushes = [];

    private readonly TextBox[] _upcomingBoxes;
    private readonly TextBlock[] _headings = new TextBlock[Columns.Length];
    // The language and units the headings are in (null before the first Refresh)
    private (string Language, bool Metric)? _shownIn;

    // The track (and connection) Track Data was last asked for, and how that went
    private string? _loadedTrack;
    private RacingCoachApi? _loadedWith;
    private bool _loading;
    // Why the focus areas aren't showing: a Loc key, and what fills its {0}
    private (string Key, string? Arg)? _loadProblem;
    private DateTime _retryAt;

    internal OverlayWindow(CollectorEngine engine, OverlayEngine overlay)
    {
        InitializeComponent();
        _engine = engine;
        _overlay = overlay;

        var box = (Style)FindResource("Box");
        var heading = (Style)FindResource("Heading");
        AreaGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        for (var c = 0; c < Columns.Length; c++)
        {
            AreaGrid.ColumnDefinitions.Add(new ColumnDefinition { Width = new GridLength(Columns[c].Width, GridUnitType.Star) });
            var text = new TextBlock { Style = heading };
            Grid.SetColumn(text, c);
            AreaGrid.Children.Add(text);
            _headings[c] = text;
        }
        // The Upcoming Focus Area row (outlined), the only row of area values
        _upcomingBoxes = AddRow(box, 1, UpcomingBorder, 0);

        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();
    }

    private TextBox[] AddRow(Style box, int row, Brush? border, double bottomMargin)
    {
        AreaGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
        var cells = new TextBox[Columns.Length];
        for (var c = 0; c < Columns.Length; c++)
        {
            var cell = new TextBox
            {
                Style = box,
                TextAlignment = c == 0 ? TextAlignment.Left : TextAlignment.Right,
                Margin = new Thickness(0, 0, c == Columns.Length - 1 ? 0 : 4, bottomMargin),
                Visibility = Visibility.Collapsed,
            };
            if (border is not null)
            {
                cell.BorderBrush = border;
                cell.BorderThickness = new Thickness(2);
            }
            Grid.SetRow(cell, row);
            Grid.SetColumn(cell, c);
            AreaGrid.Children.Add(cell);
            cells[c] = cell;
        }
        return cells;
    }

    private void Refresh()
    {
        var session = _engine.Session;
        // The same name the collector gives the session's laps, which is how Track Data names tracks
        var track = session is null ? null : session.TrackConfig is null ? session.Track : $"{session.Track} ({session.TrackConfig})";
        var api = _engine.Api;

        if (track is not null && !_loading && (track != _loadedTrack || api != _loadedWith || (_loadProblem is not null && DateTime.UtcNow >= _retryAt)))
            _ = LoadTrackAsync(track, api);

        var language = _engine.Language;
        _overlay.Language = language;
        var snapshot = _overlay.Snapshot();
        if (_shownIn != (language, snapshot.Metric))
        {
            _shownIn = (language, snapshot.Metric);
            Loc.Apply(this, language);
            for (var c = 0; c < Columns.Length; c++)
                _headings[c].Text = Loc.T(language, Columns[c].Heading);
            MinSpeedHeading.Text = Loc.T(language, "overlay.minSpeed", Loc.SpeedUnit(snapshot.Metric));
        }
        TrackText.Text = track ?? Loc.T(language, "waitingForIRacing");
        MaxBrakeBox.Text = snapshot.MaxBrake ?? "";
        MinSpeedBox.Text = snapshot.MinSpeed ?? "";
        ShowHandling(language);
        var upcoming = snapshot.UpcomingArea;
        ShowRow(_upcomingBoxes, upcoming is { } u ? snapshot.AreaNames[u] : null, upcoming is { } a ? snapshot.Areas[a] : null);

        var status = snapshot.Error is not null ? $"TelemetryEngine.js: {snapshot.Error}"
            : track is null ? null
            : _loadProblem is { } problem ? Loc.T(language, problem.Key, problem.Arg)
            : _loading && snapshot.Track is null ? Loc.T(language, "overlay.loading") : null;
        StatusText.Text = status ?? "";
        StatusText.Visibility = status is null ? Visibility.Collapsed : Visibility.Visible;

        var coach = _engine.Coach.LatestMessage;
        var showCoach = coach is not null && DateTime.UtcNow - coach.At < InCarCoach.MessageShownFor;
        CoachText.Text = showCoach ? coach!.Text : "";
        CoachText.Visibility = showCoach ? Visibility.Visible : Visibility.Collapsed;
    }

    // One area's row: its name, then its values on this lap; hidden without a name
    private static void ShowRow(TextBox[] cells, string? name, OverlayAreaValues? area)
    {
        foreach (var cell in cells)
            cell.Visibility = name is null ? Visibility.Collapsed : Visibility.Visible;
        if (name is null)
            return;

        // The brake point alert colors the row except Brake Pressure: "Transparent" (or nothing yet) leaves it as it is
        var alert = NamedBrush(area?.AlertColor);
        var alertBackground = alert is not null && alert.Color.A > 0 ? alert : null;

        Show(cells[0], name, null, alertBackground);
        Show(cells[1], area?.Brake, area?.BrakeColor, alertBackground);
        Show(cells[2], area?.Force, area?.ForceColor, null);
        Show(cells[3], area?.Gas, area?.GasColor, alertBackground);
        // Purple for the session's best ("BEST")
        Show(cells[4], area?.Time, area?.TimeColor, alertBackground);
        Show(cells[5], area?.Exit, area?.ExitColor, alertBackground);
        Show(cells[6], area?.Coast, null, alertBackground);
        Show(cells[7], area?.Overlap, null, alertBackground);
    }

    // The Rotation Model's label: only a confirmed understeer or oversteer, never a guess (see RotationMonitor)
    private void ShowHandling(string language)
    {
        var rotation = _engine.Rotation;
        var label = rotation.TryGetLatest(out var result) && result.IsValid ? result.DisplayLabel : "";
        HandlingBox.Visibility = label.Length > 0 ? Visibility.Visible : Visibility.Hidden;
        if (label.Length == 0)
            return;
        HandlingBox.Text = Loc.T(language, label == "UNDERSTEER" ? "understeer" : "oversteer");
        var color = label == "UNDERSTEER" ? rotation.Config.Display.UndersteerColor : rotation.Config.Display.OversteerColor;
        HandlingBox.Foreground = NamedBrush(color) ?? LightText;
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

    private static SolidColorBrush? NamedBrush(string? name)
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

    private async Task LoadTrackAsync(string track, RacingCoachApi? api)
    {
        _loading = true;
        _loadedTrack = track;
        _loadedWith = api;
        try
        {
            if (api is null)
            {
                _overlay.SetTrack(track, null, metric: false);
                _loadProblem = ("overlay.noKey", null);
                _retryAt = DateTime.MaxValue; // loads again once a key is entered (the connection changes)
                return;
            }
            var (json, metric) = await api.GetTrackJsonAsync(track, CancellationToken.None);
            _overlay.SetTrack(track, json, metric);
            _loadProblem = json is null ? ("overlay.noTrack", track) : null;
            // Checked again now and then, so a track added on the site shows up without reopening the overlay
            _retryAt = DateTime.UtcNow + RetryAfter;
            if (json is not null)
                ActivityLog.Shared.Write($"Overlay: loaded the focus areas for {track}.");
        }
        catch (UnauthorizedAccessException)
        {
            _overlay.SetTrack(track, null, metric: false);
            _loadProblem = ("overlay.keyRefused", null);
            _retryAt = DateTime.MaxValue;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _loadProblem = ("overlay.unreachable", e.Message);
            _retryAt = DateTime.UtcNow + RetryAfter;
        }
        finally
        {
            _loading = false;
        }
    }

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState == MouseButtonState.Pressed)
            DragMove();
    }

    private void Close_Click(object sender, RoutedEventArgs e) => Close();

    protected override void OnClosed(EventArgs e)
    {
        _timer.Stop();
        if (_engine.Overlay == _overlay)
            _engine.Overlay = null;
        base.OnClosed(e);
    }
}
