using System.Windows;
using System.Windows.Controls;
using System.Windows.Media;

namespace RacingCoach.Collector;

/// <summary>
/// Get Car Setups' window (MainWindow's button, Admins only): runs CarSetupImporter for the proof of concept's cars as
/// soon as it opens and shows each step in the user's language, also writing it to the activity log in English. The
/// import runs off the UI thread, so the collector keeps recording and uploading laps meanwhile. Closing the window
/// cancels a run in progress; what was already stored stays stored, and the next run carries on from it.
/// </summary>
public partial class CarSetupsWindow : Window
{
    private static readonly Brush Normal = new SolidColorBrush(Color.FromRgb(0xF3, 0xF4, 0xF6));
    private static readonly Brush ErrorBrush = new SolidColorBrush(Color.FromRgb(0xF0, 0x6A, 0x74));

    private readonly CollectorEngine _engine;
    private readonly string _language;
    private CancellationTokenSource? _run;

    internal CarSetupsWindow(CollectorEngine engine)
    {
        InitializeComponent();
        _engine = engine;
        _language = engine.Language;
        Loc.Apply(this, _language);
        Loaded += (_, _) => _ = RunAsync();
        Closed += (_, _) => _run?.Cancel();
    }

    private void Add(string key, object?[] args, bool isError)
    {
        var text = Loc.T(_language, key, args);
        ActivityLog.Shared.Write("Get Car Setups: " + Loc.T(Loc.English, key, args), isError);
        Dispatcher.BeginInvoke(() =>
        {
            Lines.Children.Add(new TextBlock
            {
                Text = text,
                TextWrapping = TextWrapping.Wrap,
                Foreground = isError ? ErrorBrush : Normal,
                FontWeight = key is "setups.importComplete" ? FontWeights.Bold : FontWeights.Normal,
                Margin = new Thickness(0, key is "setups.uploading" or "setups.importComplete" ? 10 : 0, 0, 2),
            });
            Scroller.ScrollToEnd();
        });
    }

    private async Task RunAsync()
    {
        RunButton.IsEnabled = false;
        Lines.Children.Clear();
        _run = new CancellationTokenSource();
        var ct = _run.Token;
        try
        {
            var api = _engine.Api;
            if (api is null)
            {
                Add("setups.noKey", [], true);
                return;
            }
            // The window offers the button to Admins only; the site checks again on every request
            if (!_engine.IsAdmin)
            {
                Add("setups.notAdmin", [], true);
                return;
            }
            var importer = new CarSetupImporter(api, Add);
            await Task.Run(() => importer.RunAsync(CarSetupImporter.PocCarFolders, ct), ct);
        }
        catch (OperationCanceledException)
        {
            // the window was closed
        }
        catch (Exception e)
        {
            Add("setups.failed", [e.Message], true);
        }
        finally
        {
            if (IsLoaded)
                RunButton.IsEnabled = true;
        }
    }

    private void Run_Click(object sender, RoutedEventArgs e) => _ = RunAsync();

    private void Close_Click(object sender, RoutedEventArgs e) => Close();
}
