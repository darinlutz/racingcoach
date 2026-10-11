using System.Globalization;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Threading;

namespace RacingCoach.Collector;

/// <summary>
/// The overlay the Launch Overlay button opens: a see-through, always-on-top window with the current
/// track's focus areas (from the user's Track Data on RacingCoach.app) and each one's brake point on this lap,
/// from TelemetryEngine.js's LapBrakePoint (OverlayEngine). Loads the track again whenever it changes.
/// </summary>
public partial class OverlayWindow : Window
{
    private static readonly CultureInfo Culture = CultureInfo.GetCultureInfo("en-US");
    // After the site couldn't be reached, try loading the track again this often
    private static readonly TimeSpan RetryAfter = TimeSpan.FromSeconds(30);

    private readonly CollectorEngine _engine;
    private readonly OverlayEngine _overlay;
    private readonly DispatcherTimer _timer = new() { Interval = TimeSpan.FromMilliseconds(100) };
    private readonly TextBox[] _nameBoxes = new TextBox[OverlayEngine.AreaCount];
    private readonly TextBox[] _brakeBoxes = new TextBox[OverlayEngine.AreaCount];

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
        for (var i = 0; i < OverlayEngine.AreaCount; i++)
        {
            AreaGrid.RowDefinitions.Add(new RowDefinition { Height = GridLength.Auto });
            _nameBoxes[i] = new TextBox { Style = box, TextWrapping = TextWrapping.NoWrap };
            _brakeBoxes[i] = new TextBox { Style = box, TextAlignment = TextAlignment.Right };
            Grid.SetRow(_nameBoxes[i], i + 1);
            Grid.SetRow(_brakeBoxes[i], i + 1);
            Grid.SetColumn(_brakeBoxes[i], 2);
            AreaGrid.Children.Add(_nameBoxes[i]);
            AreaGrid.Children.Add(_brakeBoxes[i]);
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
        for (var i = 0; i < OverlayEngine.AreaCount; i++)
        {
            var name = snapshot.AreaNames[i];
            _nameBoxes[i].Text = name ?? "";
            // No brake point yet this lap (or no braking in the area) comes back as 0
            _brakeBoxes[i].Text = name is null ? ""
                : snapshot.BrakePoints[i] is int feet and not 0 ? $"{feet.ToString("N0", Culture)} ft"
                : "—";
        }

        var status = snapshot.Error is not null ? $"TelemetryEngine.js: {snapshot.Error}"
            : track is null ? null
            : _loadProblem ?? (_loading && snapshot.Track is null ? "Loading your focus areas…" : null);
        StatusText.Text = status ?? "";
        StatusText.Visibility = status is null ? Visibility.Collapsed : Visibility.Visible;
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
