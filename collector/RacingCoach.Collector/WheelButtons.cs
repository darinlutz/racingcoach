namespace RacingCoach.Collector;

/// <summary>A button on a game controller (a wheel, button box or pedals), picked for Driver Radio's push to talk: the
/// controller by its USB vendor and product IDs (its place in Windows' list can change), and the button's number from 1.</summary>
internal sealed record WheelButton(int VendorId, int ProductId, int Button, string Controller)
{
    public override string ToString() => $"{Controller}, button {Button}";
}

/// <summary>
/// Reads game controller buttons straight from Windows' HID driver, the way Brake Practice reads the pedals
/// (<see cref="PedalDevice"/>), shared, so iRacing keeps them too: every button of every joystick, gamepad or button
/// box. While picking, every controller is open; otherwise only the push to talk button's, opened again (at most every
/// 2 s) when it isn't connected. No polling of its own; callers ask as often as they need.
/// </summary>
internal static class WheelButtons
{
    private static readonly TimeSpan RescanEvery = TimeSpan.FromSeconds(2);
    private static readonly object Lock = new();
    private static List<PedalDevice> _devices = [];
    private static DateTime _scannedAt = DateTime.MinValue;

    /// <summary>Whether the button is held down; false when its controller isn't connected.</summary>
    public static bool IsDown(WheelButton button)
    {
        bool Matches(PedalDevice d) => d.VendorId == button.VendorId && d.ProductId == button.ProductId;
        lock (Lock)
        {
            Close(d => !d.Connected || !Matches(d));
            if (!_devices.Any(Matches) && DateTime.UtcNow - _scannedAt >= RescanEvery)
            {
                Open();
                Close(d => !Matches(d));
            }
            return _devices.Any(d => Matches(d) && d.IsButtonDown(button.Button));
        }
    }

    /// <summary>Opens every connected controller and answers the buttons held down on each right now.</summary>
    public static Dictionary<PedalDevice, int[]> Snapshot()
    {
        lock (Lock)
        {
            Close(_ => true);
            Open();
            return _devices.ToDictionary(d => d, d => d.ButtonsDown());
        }
    }

    /// <summary>The first button pressed since before (a Snapshot), or null.</summary>
    public static WheelButton? NewlyPressed(Dictionary<PedalDevice, int[]> before)
    {
        lock (Lock)
        {
            foreach (var device in _devices)
            {
                var held = before.GetValueOrDefault(device) ?? [];
                foreach (var pressed in device.ButtonsDown())
                {
                    if (!held.Contains(pressed))
                        return new WheelButton(device.VendorId, device.ProductId, pressed, device.Name);
                }
            }
            return null;
        }
    }

    /// <summary>Done picking: closes every controller but the button's (all of them without one).</summary>
    public static void Keep(WheelButton? button)
    {
        lock (Lock)
            Close(d => button is null || d.VendorId != button.VendorId || d.ProductId != button.ProductId);
    }

    private static void Open()
    {
        _devices = PedalDevice.FindAll(buttons: true);
        foreach (var device in _devices)
            device.Start();
        _scannedAt = DateTime.UtcNow;
    }

    private static void Close(Func<PedalDevice, bool> which)
    {
        foreach (var device in _devices.Where(which).ToList())
        {
            device.Dispose();
            _devices.Remove(device);
        }
    }
}
