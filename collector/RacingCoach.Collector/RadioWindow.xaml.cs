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

    internal void Display(RadioStatus status)
    {
        var seconds = (int)(DateTime.UtcNow - status.Since).TotalSeconds;
        (Dot.Fill, HeadingText.Text, BodyText.Text) = status.State switch
        {
            RadioState.Recording => (Red, "DRIVER RADIO · RECORDING", $"Speak now… {seconds} s"),
            RadioState.Sending => (Blue, "DRIVER RADIO", "Sending…"),
            RadioState.Said when status.Reply is not null => (Green, "RACE ENGINEER", $"You: “{status.Text}”\n{status.Reply}"),
            RadioState.Said => (Green, "DRIVER RADIO · YOU SAID", $"“{status.Text}”"),
            _ => (Amber, "DRIVER RADIO", status.Text ?? ""),
        };
        if (!IsVisible)
            Show();
    }

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
