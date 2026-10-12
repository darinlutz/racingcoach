using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;

namespace RacingCoach.Collector;

/// <summary>
/// The overlay the Launch Overlay button opens: a see-through, always-on-top window with the current
/// track's focus areas (from the user's Track Data on RacingCoach.app) and each one's values on this lap from
/// TelemetryEngine.js (OverlayEngine), plus the recent peak brake pressure and minimum speed. Rows for areas the
/// track doesn't have are hidden. Loads the track again whenever it changes.
/// </summary>
public partial class OverlayWindow : Window
{
    // After the site couldn't be reached, try loading the track again this often
    private static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);

    private readonly CollectorEngine _engine;
    private readonly OverlayEngine _overlay;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    // Each column's heading and share of the width (the Focus Area name first)
    private static readonly (string Heading, double Width)[] Columns =
    [
        ("Focus Area", 95), ("Brake", 115), ("Force", 95), ("Gas", 115),
        ("Time", 80), ("Exit", 90), ("Coast", 80), ("Overlap", 80),
    ];
    private static readonly Brush BoxBackground = Frozen(Color.FromRgb(0x1A, 0x1B, 0x1E));
    private static readonly Brush LightText = Frozen(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush DarkText = Frozen(Color.FromRgb(0x12, 0x13, 0x15));
    // The script's color names (e.g. "Firebrick") as brushes; null for a name WPF doesn't know
    private static readonly Dictionary<string, SolidColorBrush?> NamedBrushes = [];

    private readonly TextBox[,] _boxes = new TextBox[OverlayEngine.AreaCount, Columns.Length];

    // The track (and connection) Track Data was last asked for, and how that went
    private string? _loadedTrack;
    private RacingCoachApi? _loadedWith;
    private bool _loading;
    private string? _loadProblem;
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
            var text = new TextBlock { Style = heading, Text = Columns[c].Heading };
            Grid.SetColumn(text, c);
            AreaGrid.Children.Add(text);
        }
        for (var i = 0; i < OverlayEngine.AreaCount; i++)
        {
            AreaGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            for (var c = 0; c < Columns.Length; c++)
            {
                var cell = new TextBox
                {
                    Style = box,
                    TextAlignment = c == 0 ? TextAlignment.Left : TextAlignment.Right,
                    Margin = new Thickness(0, 0, c == Columns.Length - 1 ? 0 : 4, 5),
                    Visibility = Visibility.Collapsed,
                };
                Grid.SetRow(cell, i + 1);
                Grid.SetColumn(cell, c);
                AreaGrid.Children.Add(cell);
                _boxes[i, c] = cell;
            }
        }

        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();
    }

    private void Refresh()
    {
        var session = _engine.Session;
        // The same name the collector gives the session's laps, which is how Track Data names tracks
        var track = session is null ? null : session.TrackConfig is null ? session.Track : $"{session.Track} ({session.TrackConfig})";
        var api = _engine.Api;

        if (track is not null && !_loading && (track != _loadedTrack || api != _loadedWith || (_loadProblem is not null && DateTime.UtcNow >= _retryAt)))
            _ = LoadTrackAsync(track, api);

        var snapshot = _overlay.Snapshot();
        TrackText.Text = track ?? "Waiting for iRacing…";
        MaxBrakeBox.Text = snapshot.MaxBrake ?? "";
        MinSpeedBox.Text = snapshot.MinSpeed ?? "";
        for (var i = 0; i < OverlayEngine.AreaCount; i++)
        {
            var name = snapshot.AreaNames[i];
            // Only the track's own areas get a row
            for (var c = 0; c < Columns.Length; c++)
                _boxes[i, c].Visibility = name is null ? Visibility.Collapsed : Visibility.Visible;
            if (name is null)
                continue;

            var area = snapshot.Areas[i];
            // The brake point alert colors the whole row: "Transparent" (or nothing yet) leaves it as it is
            var alert = NamedBrush(area?.AlertColor);
            var alertBackground = alert is not null && alert.Color.A > 0 ? alert : null;

            Show(_boxes[i, 0], name, null, alertBackground);
            Show(_boxes[i, 1], area?.Brake, area?.BrakeColor, alertBackground);
            Show(_boxes[i, 2], area?.Force, area?.ForceColor, alertBackground);
            Show(_boxes[i, 3], area?.Gas, area?.GasColor, alertBackground);
            Show(_boxes[i, 4], area?.Time, null, alertBackground);
            Show(_boxes[i, 5], area?.Exit, null, alertBackground);
            Show(_boxes[i, 6], area?.Coast, null, alertBackground);
            Show(_boxes[i, 7], area?.Overlap, null, alertBackground);
        }

        var status = snapshot.Error is not null ? $"TelemetryEngine.js: {snapshot.Error}"
            : track is null ? null
            : _loadProblem ?? (_loading && snapshot.Track is null ? "Loading your focus areas…" : null);
        StatusText.Text = status ?? "";
        StatusText.Visibility = status is null ? Visibility.Collapsed : Visibility.Visible;

        var coach = _engine.Coach.LatestMessage;
        var showCoach = coach is not null && DateTime.UtcNow - coach.At < InCarCoach.MessageShownFor;
        CoachText.Text = showCoach ? coach!.Text : "";
        CoachText.Visibility = showCoach ? Visibility.Visible : Visibility.Collapsed;
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
                _overlay.SetTrack(track, null);
                _loadProblem = "Enter your upload key in the collector (Upload Key) to load your focus areas.";
                _retryAt = DateTime.MaxValue; // loads again once a key is entered (the connection changes)
                return;
            }
            var json = await api.GetTrackJsonAsync(track, CancellationToken.None);
            _overlay.SetTrack(track, json);
            _loadProblem = json is null ? $"{track} isn't in your Track Data on RacingCoach.app. Add it there with its focus areas." : null;
            // Checked again now and then, so a track added on the site shows up without reopening the overlay
            _retryAt = DateTime.UtcNow + RetryAfter;
            if (json is not null)
                ActivityLog.Shared.Write($"Overlay: loaded the focus areas for {track}.");
        }
        catch (UnauthorizedAccessException)
        {
            _overlay.SetTrack(track, null);
            _loadProblem = "RacingCoach.app doesn't accept your upload key. Enter your current one in the collector.";
            _retryAt = DateTime.MaxValue;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            _loadProblem = $"Couldn't reach RacingCoach.app to load your focus areas ({e.Message}). Trying again shortly.";
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
