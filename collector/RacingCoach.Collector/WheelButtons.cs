using System.Runtime.InteropServices;

namespace RacingCoach.Collector;

/// <summary>A button on a game controller (a wheel, button box or pedals), picked for Driver Radio's push to talk: the
/// controller by its USB vendor and product IDs (its place in Windows' list can change), and the button's number from 1.</summary>
internal sealed record WheelButton(int VendorId, int ProductId, int Button, string Controller)
{
    public override string ToString() => $"{Controller}, button {Button}";
}

/// <summary>
/// Reads game controller buttons through Windows' joystick API (winmm), which sees every DirectInput controller
/// without taking it from iRacing: the first 32 buttons of the first 16 controllers. No polling of its own; callers
/// ask as often as they need.
/// </summary>
internal static class WheelButtons
{
    private const int MaxControllers = 16;

    /// <summary>Whether the button is held down; false when its controller isn't connected.</summary>
    public static bool IsDown(WheelButton button)
    {
        foreach (var (id, vendor, product, _) in Controllers())
        {
            if (vendor == button.VendorId && product == button.ProductId && Buttons(id) is { } pressed)
                return (pressed & (1u << (button.Button - 1))) != 0;
        }
        return false;
    }

    /// <summary>Every connected controller's buttons held down right now, by controller.</summary>
    public static Dictionary<(int Id, int Vendor, int Product, string Name), uint> Snapshot()
    {
        var held = new Dictionary<(int, int, int, string), uint>();
        foreach (var controller in Controllers())
        {
            if (Buttons(controller.Id) is { } pressed)
                held[controller] = pressed;
        }
        return held;
    }

    /// <summary>The first button pressed since before (a Snapshot), or null.</summary>
    public static WheelButton? NewlyPressed(Dictionary<(int Id, int Vendor, int Product, string Name), uint> before)
    {
        foreach (var (controller, pressed) in Snapshot())
        {
            var added = pressed & ~before.GetValueOrDefault(controller);
            if (added == 0)
                continue;
            var bit = System.Numerics.BitOperations.TrailingZeroCount(added);
            return new WheelButton(controller.Vendor, controller.Product, bit + 1, controller.Name);
        }
        return null;
    }

    private static IEnumerable<(int Id, int Vendor, int Product, string Name)> Controllers()
    {
        var count = Math.Min(joyGetNumDevs(), MaxControllers);
        var size = Marshal.SizeOf<JoyCaps>();
        for (var id = 0; id < count; id++)
        {
            if (joyGetDevCapsW((IntPtr)id, out var caps, size) != 0)
                continue;
            var name = string.IsNullOrWhiteSpace(caps.Name) ? $"Controller {id + 1}" : caps.Name.Trim();
            yield return (id, caps.VendorId, caps.ProductId, name);
        }
    }

    // The controller's buttons held down, a bit each (button 1 the lowest), or null when it isn't connected
    private static uint? Buttons(int id)
    {
        var info = new JoyInfoEx { Size = (uint)Marshal.SizeOf<JoyInfoEx>(), Flags = JoyReturnButtons };
        return joyGetPosEx((uint)id, ref info) == 0 ? info.Buttons : null;
    }

    private const uint JoyReturnButtons = 0x80;

    [StructLayout(LayoutKind.Sequential)]
    private struct JoyInfoEx
    {
        public uint Size;
        public uint Flags;
        public uint X, Y, Z, R, U, V;
        public uint Buttons;
        public uint ButtonNumber;
        public uint Pov;
        public uint Reserved1;
        public uint Reserved2;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct JoyCaps
    {
        public ushort VendorId;
        public ushort ProductId;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Name;
        public uint XMin, XMax, YMin, YMax, ZMin, ZMax;
        public uint NumButtons, PeriodMin, PeriodMax;
        public uint RMin, RMax, UMin, UMax, VMin, VMax;
        public uint Caps, MaxAxes, NumAxes, MaxButtons;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string RegKey;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string OemVxd;
    }

    [DllImport("winmm.dll")]
    private static extern int joyGetNumDevs();

    [DllImport("winmm.dll", CharSet = CharSet.Unicode)]
    private static extern int joyGetDevCapsW(IntPtr id, out JoyCaps caps, int size);

    [DllImport("winmm.dll")]
    private static extern int joyGetPosEx(uint id, ref JoyInfoEx info);
}
