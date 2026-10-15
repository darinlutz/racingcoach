using System.Windows;
using System.Windows.Input;
using System.Windows.Threading;

namespace RacingCoach.Collector;

/// <summary>
/// The overlay the Launch Overlay button opens: a see-through, always-on-top window with the current
/// track's focus areas (from the user's Track Data on RacingCoach.app) and each one's values on this lap from
/// TelemetryEngine.js (OverlayFeed), plus the recent peak brake pressure and minimum speed (OverlayStats). Only one
/// row of focus area values is shown, the Upcoming Focus Area (OverlayAreaRow): the area the car is in, or the next
/// one as soon as it leaves an area. Everything is in the user's Preferred Language and Units (Loc, and
/// OverlayEngine for the script's text).
/// </summary>
public partial class OverlayWindow : Window
{
    private readonly CollectorEngine _engine;
    private readonly OverlayFeed _feed;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    // The language the window is in (null before the first Refresh)
    private string? _shownIn;

    internal OverlayWindow(CollectorEngine engine, OverlayFeed feed)
    {
        InitializeComponent();
        _engine = engine;
        _feed = feed;
        _timer.Tick += (_, _) => Refresh();
        _timer.Start();
        Refresh();
    }

    private void Refresh()
    {
        var snapshot = _feed.Refresh();
        var language = _engine.Language;
        if (_shownIn != language)
        {
            _shownIn = language;
            Loc.Apply(this, language);
        }
        TrackText.Text = _feed.Track ?? Loc.T(language, "waitingForIRacing");
        Stats.Show(snapshot, language, _engine.Rotation);
        AreaRow.Show(snapshot, language);

        var status = _feed.Status(language, snapshot);
        StatusText.Text = status ?? "";
        StatusText.Visibility = status is null ? Visibility.Collapsed : Visibility.Visible;

        var coach = _engine.Coach.LatestMessage;
        var showCoach = coach is not null && DateTime.UtcNow - coach.At < InCarCoach.MessageShownFor;
        CoachText.Text = showCoach ? coach!.Text : "";
        CoachText.Visibility = showCoach ? Visibility.Visible : Visibility.Collapsed;
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
        base.OnClosed(e);
    }
}
