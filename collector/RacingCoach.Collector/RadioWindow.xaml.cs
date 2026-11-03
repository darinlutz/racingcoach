using System.Runtime.InteropServices;
using System.Windows;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;

namespace RacingCoach.Collector;

/// <summary>
/// Driver Radio over the sim: Recording while the radio button is held, then what the driver said and the Race
/// Engineer's answer (or why it didn't work) for a few seconds. MainWindow shows it when Driver Radio starts recording and hides it after; it's made
/// never to take the keyboard or mouse focus from iRacing.
/// </summary>
public partial class RadioWindow : Window
{
    private static readonly Brush Red = Frozen("#DE3341");
    private static readonly Brush Amber = Frozen("#E3A82B");
    private static readonly Brush Green = Frozen("#2EB872");
    private static readonly Brush Blue = Frozen("#3B8BFF");

    public RadioWindow()
    {
        InitializeComponent();
        SourceInitialized += (_, _) =>
        {
            // Not activated by being shown or clicked, and not in Alt+Tab
            var handle = new WindowInteropHelper(this).Handle;
            SetWindowLong(handle, GwlExStyle, GetWindowLong(handle, GwlExStyle) | WsExNoActivate | WsExToolWindow);
        };
    }

    /// <summary>Shows the status in the user's Preferred Language.</summary>
    internal void Display(RadioStatus status, string language)
    {
        var seconds = (int)(DateTime.UtcNow - status.Since).TotalSeconds;
        (Dot.Fill, HeadingText.Text, BodyText.Text) = status.State switch
        {
            RadioState.Recording => (Red, Loc.T(language, "radio.recording"), Loc.T(language, "radio.speakNow", seconds)),
            RadioState.Sending => (Blue, Loc.T(language, "main.driverRadio"), Loc.T(language, "main.radioSending")),
            RadioState.Said when status.Reply is not null => (Green, Loc.T(language, "radio.engineer"),
                $"{Loc.T(language, "radio.you", status.Text)}\n{status.Reply}"),
            RadioState.Said => (Green, Loc.T(language, "radio.youSaid"), $"“{status.Text}”"),
            _ => (Amber, Loc.T(language, "main.driverRadio"), ProblemText(status, language)),
        };
        if (!IsVisible)
            Show();
    }

    /// <summary>A problem's text: Driver Radio's own in the user's language, or the site's or the network's message.</summary>
    internal static string ProblemText(RadioStatus status, string language) =>
        status.TextKey is { } key ? Loc.T(language, key, status.Text) : status.Text ?? "";

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ButtonState == MouseButtonState.Pressed)
            DragMove();
    }

    private static Brush Frozen(string hex)
    {
        var brush = new SolidColorBrush((Color)ColorConverter.ConvertFromString(hex));
        brush.Freeze();
        return brush;
    }

    private const int GwlExStyle = -20;
    private const int WsExNoActivate = 0x08000000;
    private const int WsExToolWindow = 0x00000080;

    [DllImport("user32.dll")]
    private static extern int GetWindowLong(IntPtr hwnd, int index);

    [DllImport("user32.dll")]
    private static extern int SetWindowLong(IntPtr hwnd, int index, int value);
}
