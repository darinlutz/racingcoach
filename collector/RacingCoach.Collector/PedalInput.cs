using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32.SafeHandles;

namespace RacingCoach.Collector;

/// <summary>
/// A USB game controller (pedals, wheelbase) read straight from Windows' HID driver, the way iRacing itself reads
/// it, so Brake Practice works without iRacing running, and Driver Radio's push to talk can be any button on any
/// controller (winmm's joystick API, used before, missed some). Each device reads its reports on its own background
/// thread and keeps the latest value of every axis and button; nothing else is decoded.
/// </summary>
internal sealed class PedalDevice : IDisposable
{
    public string Name { get; }
    public int VendorId { get; }
    public int ProductId { get; }
    public bool IsSimucube => Name.Contains("Simucube", StringComparison.OrdinalIgnoreCase);
    public IReadOnlyList<PedalAxis> Axes { get; }
    /// <summary>False once the device stops answering (unplugged, powered off).</summary>
    public bool Connected => !_failed;

    private readonly SafeFileHandle _handle;
    private readonly IntPtr _preparsed;
    private readonly int _reportLength;
    private readonly List<ButtonRange> _buttonRanges;
    // Held down, by button number (the Button page's usage, as Windows numbers them); replaced whole by each report
    private volatile bool[] _buttons;
    private Thread? _thread;
    private volatile bool _stopping;
    private volatile bool _failed;

    private PedalDevice(string name, int vendorId, int productId, SafeFileHandle handle, IntPtr preparsed, int reportLength,
        List<PedalAxis> axes, List<ButtonRange> buttonRanges)
    {
        Name = name;
        VendorId = vendorId;
        ProductId = productId;
        _buttonRanges = buttonRanges;
        _buttons = new bool[buttonRanges.Count == 0 ? 0 : buttonRanges.Max(r => r.Last) + 1];
        _handle = handle;
        _preparsed = preparsed;
        _reportLength = reportLength;
        foreach (var axis in axes)
            axis.Device = this;
        Axes = axes;
    }

    /// <summary>Every joystick, gamepad or multi-axis controller plugged in that has at least one axis, or, with
    /// buttons, at least one button (button boxes often have no axes).</summary>
    public static List<PedalDevice> FindAll(bool buttons = false)
    {
        var devices = new List<PedalDevice>();
        Native.HidD_GetHidGuid(out var guid);
        var set = Native.SetupDiGetClassDevs(ref guid, IntPtr.Zero, IntPtr.Zero, Native.DIGCF_PRESENT | Native.DIGCF_DEVICEINTERFACE);
        if (set == Native.InvalidHandle)
            return devices;
        try
        {
            var data = new Native.SP_DEVICE_INTERFACE_DATA { cbSize = Marshal.SizeOf<Native.SP_DEVICE_INTERFACE_DATA>() };
            for (uint i = 0; Native.SetupDiEnumDeviceInterfaces(set, IntPtr.Zero, ref guid, i, ref data); i++)
            {
                if (DevicePath(set, ref data) is { } path && TryOpen(path, buttons) is { } device)
                    devices.Add(device);
            }
        }
        finally
        {
            Native.SetupDiDestroyDeviceInfoList(set);
        }
        return devices;
    }

    /// <summary>Whether the button (numbered from 1) is held down.</summary>
    public bool IsButtonDown(int button)
    {
        var held = _buttons;
        return button > 0 && button < held.Length && held[button];
    }

    /// <summary>The buttons held down right now, by number.</summary>
    public int[] ButtonsDown()
    {
        var held = _buttons;
        return Enumerable.Range(0, held.Length).Where(b => held[b]).ToArray();
    }

    /// <summary>Starts reading reports; the axes and buttons have values once the first one arrives.</summary>
    public void Start()
    {
        _thread ??= new Thread(ReadLoop) { IsBackground = true, Name = $"Pedal reader ({Name})" };
        _thread.Start();
    }

    private void ReadLoop()
    {
        var report = new byte[_reportLength];
        try
        {
            while (!_stopping)
            {
                if (!Native.ReadFile(_handle, report, (uint)report.Length, out var read, IntPtr.Zero) || read == 0)
                {
                    if (!_stopping)
                        _failed = true;
                    return;
                }
                foreach (var axis in Axes)
                {
                    // Fails for axes in a different report (report ID) than this one; they keep their last value
                    if (Native.HidP_GetUsageValue(Native.HidP_Input, axis.UsagePage, axis.LinkCollection, axis.Usage,
                            out var raw, _preparsed, report, read) == Native.HIDP_STATUS_SUCCESS)
                        axis.Set(raw);
                }
                if (_buttonRanges.Count > 0)
                    ReadButtons(report, read);
            }
        }
        finally
        {
            _handle.Dispose();
            Native.HidD_FreePreparsedData(_preparsed);
        }
    }

    // The buttons of this report's ID, in each of their collections, take what it says; the rest keep their state (a
    // device can split its buttons over several reports). Without report IDs, every report and button range has ID 0.
    private void ReadButtons(byte[] report, uint read)
    {
        bool[]? next = null;
        foreach (var link in _buttonRanges.Where(r => r.ReportId == report[0]).Select(r => r.LinkCollection).Distinct())
        {
            var count = Native.HidP_MaxUsageListLength(Native.HidP_Input, Native.ButtonPage, _preparsed);
            var usages = new ushort[Math.Max(count, 1)];
            if (Native.HidP_GetUsages(Native.HidP_Input, Native.ButtonPage, link, usages, ref count, _preparsed, report, read)
                != Native.HIDP_STATUS_SUCCESS)
                continue;
            next ??= (bool[])_buttons.Clone();
            foreach (var range in _buttonRanges.Where(r => r.ReportId == report[0] && r.LinkCollection == link))
                Array.Clear(next, range.First, range.Last - range.First + 1);
            foreach (var usage in usages.AsSpan(0, (int)count))
            {
                if (usage < next.Length)
                    next[usage] = true;
            }
        }
        if (next is not null)
            _buttons = next;
    }

    public void Dispose()
    {
        _stopping = true;
        if (_thread is null)
        {
            _handle.Dispose();
            Native.HidD_FreePreparsedData(_preparsed);
            return;
        }
        // Wakes the reader out of ReadFile; it closes the handle itself on the way out
        try
        {
            Native.CancelIoEx(_handle, IntPtr.Zero);
        }
        catch (ObjectDisposedException)
        {
            // The reader has already stopped
        }
    }

    private static string? DevicePath(IntPtr set, ref Native.SP_DEVICE_INTERFACE_DATA data)
    {
        Native.SetupDiGetDeviceInterfaceDetail(set, ref data, IntPtr.Zero, 0, out var size, IntPtr.Zero);
        if (size == 0)
            return null;
        var buffer = Marshal.AllocHGlobal((int)size);
        try
        {
            // SP_DEVICE_INTERFACE_DETAIL_DATA_W: cbSize is the struct's size (8 on 64-bit, 6 on 32-bit), then the path
            Marshal.WriteInt32(buffer, IntPtr.Size == 8 ? 8 : 6);
            return Native.SetupDiGetDeviceInterfaceDetail(set, ref data, buffer, size, out _, IntPtr.Zero)
                ? Marshal.PtrToStringUni(buffer + 4)
                : null;
        }
        finally
        {
            Marshal.FreeHGlobal(buffer);
        }
    }

    private static PedalDevice? TryOpen(string path, bool buttons)
    {
        // Keyboards and mice refuse to open for reading, which leaves them out
        var handle = Native.CreateFile(path, Native.GENERIC_READ, Native.FILE_SHARE_READ | Native.FILE_SHARE_WRITE,
            IntPtr.Zero, Native.OPEN_EXISTING, 0, IntPtr.Zero);
        if (handle.IsInvalid)
            return null;
        if (!Native.HidD_GetPreparsedData(handle, out var preparsed))
        {
            handle.Dispose();
            return null;
        }
        var keep = false;
        try
        {
            if (Native.HidP_GetCaps(preparsed, out var caps) != Native.HIDP_STATUS_SUCCESS
                || caps.UsagePage != Native.GenericDesktop
                || caps.Usage is not (Native.Joystick or Native.Gamepad or Native.MultiAxisController))
                return null;

            var count = caps.NumberInputValueCaps;
            var valueCaps = new Native.HIDP_VALUE_CAPS[count];
            if (count > 0 && Native.HidP_GetValueCaps(Native.HidP_Input, valueCaps, ref count, preparsed) != Native.HIDP_STATUS_SUCCESS)
                count = 0;

            var axes = new List<PedalAxis>();
            foreach (var vc in valueCaps.AsSpan(0, count))
            {
                if (vc.ReportCount > 1)
                    continue; // value arrays, not axes
                var (first, last) = vc.IsRange != 0 ? (vc.UsageMin, vc.UsageMax) : (vc.UsageMin, vc.UsageMin);
                for (int usage = first; usage <= last; usage++)
                {
                    if (PedalAxis.UsageName(vc.UsagePage, (ushort)usage) is { } name)
                        axes.Add(new PedalAxis(name, vc.UsagePage, (ushort)usage, vc.LinkCollection, vc.BitSize, vc.LogicalMin, vc.LogicalMax));
                }
            }
            var buttonCount = caps.NumberInputButtonCaps;
            var buttonCaps = new Native.HIDP_BUTTON_CAPS[buttonCount];
            if (buttonCount > 0 && Native.HidP_GetButtonCaps(Native.HidP_Input, buttonCaps, ref buttonCount, preparsed) != Native.HIDP_STATUS_SUCCESS)
                buttonCount = 0;
            var buttonRanges = new List<ButtonRange>();
            foreach (var bc in buttonCaps.AsSpan(0, buttonCount))
            {
                var (first, last) = bc.IsRange != 0 ? (bc.UsageMin, bc.UsageMax) : (bc.UsageMin, bc.UsageMin);
                if (bc.UsagePage == Native.ButtonPage && first > 0 && last >= first && last <= MaxButton)
                    buttonRanges.Add(new ButtonRange(bc.ReportID, bc.LinkCollection, first, last));
            }
            if (buttons ? buttonRanges.Count == 0 : axes.Count == 0)
                return null;

            var nameBuffer = new byte[256];
            var product = Native.HidD_GetProductString(handle, nameBuffer, nameBuffer.Length)
                ? Encoding.Unicode.GetString(nameBuffer).TrimEnd('\0').Trim()
                : "";
            var attributes = new Native.HIDD_ATTRIBUTES { Size = Marshal.SizeOf<Native.HIDD_ATTRIBUTES>() };
            Native.HidD_GetAttributes(handle, ref attributes);
            keep = true;
            return new PedalDevice(product.Length > 0 ? product : "Game controller", attributes.VendorID, attributes.ProductID,
                handle, preparsed, caps.InputReportByteLength, axes, buttonRanges);
        }
        finally
        {
            if (!keep)
            {
                Native.HidD_FreePreparsedData(preparsed);
                handle.Dispose();
            }
        }
    }

    private const int MaxButton = 1024;

    // A run of buttons (Button page usages) in one report and collection
    private sealed record ButtonRange(byte ReportId, ushort LinkCollection, int First, int Last);

    private static class Native
    {
        public static readonly IntPtr InvalidHandle = new(-1);
        public const int DIGCF_PRESENT = 0x2;
        public const int DIGCF_DEVICEINTERFACE = 0x10;
        public const uint GENERIC_READ = 0x80000000;
        public const uint FILE_SHARE_READ = 0x1;
        public const uint FILE_SHARE_WRITE = 0x2;
        public const uint OPEN_EXISTING = 3;
        public const int HidP_Input = 0;
        public const int HIDP_STATUS_SUCCESS = 0x00110000;
        public const ushort GenericDesktop = 0x01;
        public const ushort Joystick = 0x04;
        public const ushort Gamepad = 0x05;
        public const ushort MultiAxisController = 0x08;
        public const ushort ButtonPage = 0x09;

        [StructLayout(LayoutKind.Sequential)]
        public struct HIDD_ATTRIBUTES
        {
            public int Size;
            public ushort VendorID;
            public ushort ProductID;
            public ushort VersionNumber;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct SP_DEVICE_INTERFACE_DATA
        {
            public int cbSize;
            public Guid InterfaceClassGuid;
            public int Flags;
            public IntPtr Reserved;
        }

        [StructLayout(LayoutKind.Sequential)]
        public struct HIDP_CAPS
        {
            public ushort Usage;
            public ushort UsagePage;
            public ushort InputReportByteLength;
            public ushort OutputReportByteLength;
            public ushort FeatureReportByteLength;
            [MarshalAs(UnmanagedType.ByValArray, SizeConst = 17)]
            public ushort[] Reserved;
            public ushort NumberLinkCollectionNodes;
            public ushort NumberInputButtonCaps;
            public ushort NumberInputValueCaps;
            public ushort NumberInputDataIndices;
            public ushort NumberOutputButtonCaps;
            public ushort NumberOutputValueCaps;
            public ushort NumberOutputDataIndices;
            public ushort NumberFeatureButtonCaps;
            public ushort NumberFeatureValueCaps;
            public ushort NumberFeatureDataIndices;
        }

        // hidpi.h's HIDP_VALUE_CAPS; UsageMin is NotRange.Usage when IsRange is 0
        [StructLayout(LayoutKind.Explicit, Size = 72)]
        public struct HIDP_VALUE_CAPS
        {
            [FieldOffset(0)] public ushort UsagePage;
            [FieldOffset(2)] public byte ReportID;
            [FieldOffset(6)] public ushort LinkCollection;
            [FieldOffset(12)] public byte IsRange;
            [FieldOffset(18)] public ushort BitSize;
            [FieldOffset(20)] public ushort ReportCount;
            [FieldOffset(40)] public int LogicalMin;
            [FieldOffset(44)] public int LogicalMax;
            [FieldOffset(56)] public ushort UsageMin;
            [FieldOffset(58)] public ushort UsageMax;
        }

        // hidpi.h's HIDP_BUTTON_CAPS; UsageMin is NotRange.Usage when IsRange is 0
        [StructLayout(LayoutKind.Explicit, Size = 72)]
        public struct HIDP_BUTTON_CAPS
        {
            [FieldOffset(0)] public ushort UsagePage;
            [FieldOffset(2)] public byte ReportID;
            [FieldOffset(6)] public ushort LinkCollection;
            [FieldOffset(12)] public byte IsRange;
            [FieldOffset(56)] public ushort UsageMin;
            [FieldOffset(58)] public ushort UsageMax;
        }

        [DllImport("hid.dll")]
        public static extern void HidD_GetHidGuid(out Guid guid);

        [DllImport("hid.dll")]
        public static extern bool HidD_GetAttributes(SafeFileHandle device, ref HIDD_ATTRIBUTES attributes);

        [DllImport("hid.dll")]
        public static extern int HidP_GetButtonCaps(int reportType, [Out] HIDP_BUTTON_CAPS[] buttonCaps, ref ushort length, IntPtr preparsed);

        [DllImport("hid.dll")]
        public static extern uint HidP_MaxUsageListLength(int reportType, ushort usagePage, IntPtr preparsed);

        [DllImport("hid.dll")]
        public static extern int HidP_GetUsages(int reportType, ushort usagePage, ushort linkCollection, [Out] ushort[] usages,
            ref uint usageLength, IntPtr preparsed, byte[] report, uint reportLength);

        [DllImport("hid.dll", SetLastError = true)]
        public static extern bool HidD_GetPreparsedData(SafeFileHandle device, out IntPtr preparsed);

        [DllImport("hid.dll")]
        public static extern bool HidD_FreePreparsedData(IntPtr preparsed);

        [DllImport("hid.dll", SetLastError = true)]
        public static extern bool HidD_GetProductString(SafeFileHandle device, byte[] buffer, int length);

        [DllImport("hid.dll")]
        public static extern int HidP_GetCaps(IntPtr preparsed, out HIDP_CAPS caps);

        [DllImport("hid.dll")]
        public static extern int HidP_GetValueCaps(int reportType, [Out] HIDP_VALUE_CAPS[] valueCaps, ref ushort length, IntPtr preparsed);

        [DllImport("hid.dll")]
        public static extern int HidP_GetUsageValue(int reportType, ushort usagePage, ushort linkCollection, ushort usage,
            out uint value, IntPtr preparsed, byte[] report, uint reportLength);

        [DllImport("setupapi.dll", EntryPoint = "SetupDiGetClassDevsW", SetLastError = true)]
        public static extern IntPtr SetupDiGetClassDevs(ref Guid classGuid, IntPtr enumerator, IntPtr parent, int flags);

        [DllImport("setupapi.dll", SetLastError = true)]
        public static extern bool SetupDiEnumDeviceInterfaces(IntPtr set, IntPtr deviceInfo, ref Guid interfaceGuid,
            uint index, ref SP_DEVICE_INTERFACE_DATA data);

        [DllImport("setupapi.dll", EntryPoint = "SetupDiGetDeviceInterfaceDetailW", SetLastError = true)]
        public static extern bool SetupDiGetDeviceInterfaceDetail(IntPtr set, ref SP_DEVICE_INTERFACE_DATA data,
            IntPtr detail, uint detailSize, out uint requiredSize, IntPtr deviceInfo);

        [DllImport("setupapi.dll")]
        public static extern bool SetupDiDestroyDeviceInfoList(IntPtr set);

        [DllImport("kernel32.dll", EntryPoint = "CreateFileW", CharSet = CharSet.Unicode, SetLastError = true)]
        public static extern SafeFileHandle CreateFile(string path, uint access, uint share, IntPtr security,
            uint creation, uint flags, IntPtr template);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool ReadFile(SafeFileHandle file, byte[] buffer, uint toRead, out uint read, IntPtr overlapped);

        [DllImport("kernel32.dll", SetLastError = true)]
        public static extern bool CancelIoEx(SafeFileHandle file, IntPtr overlapped);
    }
}

/// <summary>One axis of a <see cref="PedalDevice"/>, with its latest value.</summary>
internal sealed class PedalAxis
{
    public PedalDevice Device { get; internal set; } = null!;
    public string Name { get; }
    internal ushort UsagePage { get; }
    internal ushort Usage { get; }
    internal ushort LinkCollection { get; }

    private readonly int _bitSize;
    private readonly long _min;
    private readonly long _max;
    private readonly bool _signed;
    private long _value;
    private volatile bool _hasValue;

    internal PedalAxis(string name, ushort usagePage, ushort usage, ushort linkCollection, int bitSize, int logicalMin, int logicalMax)
    {
        Name = name;
        UsagePage = usagePage;
        Usage = usage;
        LinkCollection = linkCollection;
        _bitSize = Math.Clamp(bitSize, 1, 32);
        if (logicalMax > logicalMin)
        {
            (_min, _max, _signed) = (logicalMin, logicalMax, logicalMin < 0);
        }
        else
        {
            // A descriptor that wrote an unsigned maximum as a signed number (e.g. 65535 as -1): use the full bit range
            (_min, _max, _signed) = (0, (1L << _bitSize) - 1, false);
        }
    }

    public bool HasValue => _hasValue;

    /// <summary>Where the axis is in its whole range, 0 to 1 (which end is "pressed" depends on the device).</summary>
    public double Fraction => Math.Clamp((Interlocked.Read(ref _value) - _min) / (double)(_max - _min), 0, 1);

    internal void Set(uint raw)
    {
        long value = raw;
        if (_signed && _bitSize < 32 && (raw & (1u << (_bitSize - 1))) != 0)
            value -= 1L << _bitSize;
        else if (_signed && _bitSize == 32)
            value = (int)raw;
        Interlocked.Exchange(ref _value, value);
        _hasValue = true;
    }

    internal static string? UsageName(ushort page, ushort usage) => (page, usage) switch
    {
        (0x01, 0x30) => "X",
        (0x01, 0x31) => "Y",
        (0x01, 0x32) => "Z",
        (0x01, 0x33) => "Rx",
        (0x01, 0x34) => "Ry",
        (0x01, 0x35) => "Rz",
        (0x01, 0x36) => "Slider",
        (0x01, 0x37) => "Dial",
        (0x01, 0x38) => "Wheel",
        (0x02, 0xBA) => "Rudder",
        (0x02, 0xBB) => "Throttle",
        (0x02, 0xC4) => "Accelerator",
        (0x02, 0xC5) => "Brake",
        (0x02, 0xC6) => "Clutch",
        (0x02, 0xC8) => "Steering",
        _ => null, // hat switches, vendor-specific values
    };
}
