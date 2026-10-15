using System.Diagnostics;
using System.Runtime.InteropServices;

namespace RacingCoach.Collector;

/// <summary>
/// Plays a beep (a sine tone) at a chosen volume, for BrakeBeeps, which Console.Beep can't do. Uses Windows' waveOut
/// directly rather than SoundPlayer, because SoundPlayer plays one sound per process and would cut off the coach
/// voice (Voice.cs). The device stays open between beeps so each starts at once; Play blocks until the tone ends, so
/// call it from one thread. Throws InvalidOperationException when there's no sound device.
/// </summary>
internal sealed class TonePlayer : IDisposable
{
    private const int SampleRate = 44100;
    private const int FadeMs = 5; // in and out, so the tone doesn't click
    private const double FullAmplitude = 0.9 * short.MaxValue;

    private IntPtr _device;

    /// <summary>Plays hz for ms at volume (0 to 1 of full volume).</summary>
    public void Play(int hz, int ms, double volume)
    {
        if (_device == IntPtr.Zero)
            Open();

        var pcm = Sine(hz, ms, Math.Clamp(volume, 0, 1));
        var data = GCHandle.Alloc(pcm, GCHandleType.Pinned);
        var headerSize = Marshal.SizeOf<WaveHeader>();
        // waveOut marks the header done when it's played, so it lives in unmanaged memory
        var header = Marshal.AllocHGlobal(headerSize);
        try
        {
            Marshal.StructureToPtr(new WaveHeader { Data = data.AddrOfPinnedObject(), BufferLength = (uint)pcm.Length }, header, false);
            Check(waveOutPrepareHeader(_device, header, headerSize));
            try
            {
                Check(waveOutWrite(_device, header, headerSize));
                var waited = Stopwatch.StartNew();
                while ((Marshal.PtrToStructure<WaveHeader>(header).Flags & WhdrDone) == 0 && waited.ElapsedMilliseconds < ms + 1000)
                    Thread.Sleep(2);
            }
            finally
            {
                waveOutReset(_device); // stops it if it never finished, so the header can be released
                waveOutUnprepareHeader(_device, header, headerSize);
            }
        }
        catch (InvalidOperationException)
        {
            Dispose(); // e.g. the sound device went away; the next beep opens the current one
            throw;
        }
        finally
        {
            Marshal.FreeHGlobal(header);
            data.Free();
        }
    }

    public void Dispose()
    {
        if (_device == IntPtr.Zero)
            return;
        waveOutClose(_device);
        _device = IntPtr.Zero;
    }

    private void Open()
    {
        var format = new WaveFormat
        {
            FormatTag = 1, // PCM
            Channels = 1,
            SamplesPerSec = SampleRate,
            AvgBytesPerSec = SampleRate * 2,
            BlockAlign = 2,
            BitsPerSample = 16,
        };
        Check(waveOutOpen(out _device, WaveMapper, ref format, IntPtr.Zero, IntPtr.Zero, 0));
    }

    // 16-bit mono samples of a sine tone, faded in and out
    private static byte[] Sine(int hz, int ms, double volume)
    {
        var count = SampleRate * ms / 1000;
        var fade = SampleRate * FadeMs / 1000;
        var pcm = new byte[count * 2];
        for (var i = 0; i < count; i++)
        {
            var envelope = Math.Min(1.0, Math.Min(i, count - 1 - i) / (double)fade);
            var sample = (short)(Math.Sin(2 * Math.PI * hz * i / SampleRate) * FullAmplitude * volume * envelope);
            pcm[i * 2] = (byte)sample;
            pcm[i * 2 + 1] = (byte)(sample >> 8);
        }
        return pcm;
    }

    private static void Check(int result)
    {
        if (result != 0)
            throw new InvalidOperationException($"waveOut error {result}");
    }

    private const uint WaveMapper = unchecked((uint)-1);
    private const uint WhdrDone = 1;

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveFormat
    {
        public ushort FormatTag;
        public ushort Channels;
        public uint SamplesPerSec;
        public uint AvgBytesPerSec;
        public ushort BlockAlign;
        public ushort BitsPerSample;
        public ushort Size;
    }

    [StructLayout(LayoutKind.Sequential)]
    private struct WaveHeader
    {
        public IntPtr Data;
        public uint BufferLength;
        public uint BytesRecorded;
        public IntPtr User;
        public uint Flags;
        public uint Loops;
        public IntPtr Next;
        public IntPtr Reserved;
    }

    [DllImport("winmm.dll")]
    private static extern int waveOutOpen(out IntPtr device, uint deviceId, ref WaveFormat format, IntPtr callback, IntPtr instance, uint flags);

    [DllImport("winmm.dll")]
    private static extern int waveOutPrepareHeader(IntPtr device, IntPtr header, int size);

    [DllImport("winmm.dll")]
    private static extern int waveOutWrite(IntPtr device, IntPtr header, int size);

    [DllImport("winmm.dll")]
    private static extern int waveOutUnprepareHeader(IntPtr device, IntPtr header, int size);

    [DllImport("winmm.dll")]
    private static extern int waveOutReset(IntPtr device);

    [DllImport("winmm.dll")]
    private static extern int waveOutClose(IntPtr device);
}
