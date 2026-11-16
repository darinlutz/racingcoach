using System.Collections.Concurrent;
using System.Runtime.InteropServices;

namespace RacingCoach.Collector;

/// <summary>
/// Plays beeps (sine tones) at a chosen volume, for BrakeBeeps, which Console.Beep can't do. Uses Windows' waveOut
/// directly rather than SoundPlayer, because SoundPlayer plays one sound per process and would cut off the coach
/// voice (Voice.cs).
///
/// It keeps one stream running, never stopped between beeps, while it's kept awake (KeepAwake, or a beep, in the
/// last IdleAfterMs): short buffers of an inaudible signal, with each beep mixed into the next buffer free. Starting
/// a stream for each beep after a quiet straight let the sound device (a USB or Bluetooth headset, HDMI audio, or
/// Windows' own power saving) swallow the start of the first beep, and a 120 ms beep could be lost entirely, so the
/// driver heard 3 of the 4; and stopping it after each one (waveOutReset) could cut off what was still on its way to
/// the speakers. The signal isn't pure zeros, as some devices also mute on digital silence.
///
/// Play queues a beep and returns at once, from any thread; beeps play one after another, in order, each followed
/// by a short gap so two in a row are heard as two. With no sound device, beeps are dropped and it tries again later.
/// </summary>
internal sealed class TonePlayer : IDisposable
{
    private const int SampleRate = 44100;
    private const int FadeMs = 5; // in and out, so the tone doesn't click
    private const double FullAmplitude = 0.9 * short.MaxValue;
    private const int BufferMs = 20;
    private const int BufferCount = 3; // at most about 60 ms between a beep queued and heard
    private const int BufferSamples = SampleRate * BufferMs / 1000;
    internal const int GapMs = 60;
    private const long IdleAfterMs = 30_000;
    private const int RetryAfterMs = 5_000;

    private readonly ConcurrentQueue<short[]> _tones = new();
    private readonly AutoResetEvent _wake = new(false);
    private readonly object _start = new();
    private Thread? _thread;
    private long _awakeUntil;
    private volatile bool _idle;
    private volatile bool _disposed;

    /// <summary>Queues hz for ms at volume (0 to 1 of full volume), then a short gap.</summary>
    public void Play(int hz, int ms, double volume)
    {
        if (_disposed)
            return;
        _tones.Enqueue(Sine(hz, ms, Math.Clamp(volume, 0, 1)));
        _tones.Enqueue(new short[SampleRate * GapMs / 1000]);
        KeepAwake();
    }

    /// <summary>Queues silence, e.g. to space the Test button's beeps.</summary>
    public void Pause(int ms)
    {
        if (_disposed || ms <= 0)
            return;
        _tones.Enqueue(new short[SampleRate * ms / 1000]);
        KeepAwake();
    }

    /// <summary>Keeps the stream running for the next IdleAfterMs, so the next beep plays at once and in full. Cheap
    /// enough to call on every telemetry sample.</summary>
    public void KeepAwake()
    {
        if (_disposed)
            return;
        Volatile.Write(ref _awakeUntil, Environment.TickCount64 + IdleAfterMs);
        if (_thread is null)
        {
            lock (_start)
            {
                if (_thread is null)
                {
                    _thread = new Thread(Run) { IsBackground = true, Name = "Brake beeps" };
                    _thread.Start();
                }
            }
        }
        else if (_idle)
            _wake.Set();
    }

    public void Dispose()
    {
        _disposed = true;
        _wake.Set();
    }

    private bool Awake => Environment.TickCount64 < Volatile.Read(ref _awakeUntil);

    private void Run()
    {
        while (!_disposed)
        {
            if (!Awake && _tones.IsEmpty)
            {
                _idle = true;
                if (!Awake && _tones.IsEmpty && !_disposed)
                    _wake.WaitOne(500);
                _idle = false;
                continue;
            }
            try
            {
                Stream();
            }
            catch (Exception e) when (e is InvalidOperationException or DllNotFoundException or EntryPointNotFoundException)
            {
                // No sound device, or it went away: these beeps are stale by the time one comes back
                _tones.Clear();
                _wake.WaitOne(RetryAfterMs);
            }
        }
    }

    // One stream, from the first beep (or KeepAwake) until it's been idle IdleAfterMs
    private void Stream()
    {
        using var done = new AutoResetEvent(false);
        var format = new WaveFormat
        {
            FormatTag = 1, // PCM
            Channels = 1,
            SamplesPerSec = SampleRate,
            AvgBytesPerSec = SampleRate * 2,
            BlockAlign = 2,
            BitsPerSample = 16,
        };
        Check(waveOutOpen(out var device, WaveMapper, ref format, done.SafeWaitHandle.DangerousGetHandle(), IntPtr.Zero, CallbackEvent));

        var headerSize = Marshal.SizeOf<WaveHeader>();
        var flagsOffset = (int)Marshal.OffsetOf<WaveHeader>(nameof(WaveHeader.Flags));
        var buffers = new short[BufferCount][];
        var pins = new GCHandle[BufferCount];
        var headers = new IntPtr[BufferCount];
        var prepared = new bool[BufferCount];
        var queued = new bool[BufferCount];
        short[]? tone = null;
        var toneAt = 0;
        var phase = 0;
        try
        {
            for (var i = 0; i < BufferCount; i++)
            {
                buffers[i] = new short[BufferSamples];
                pins[i] = GCHandle.Alloc(buffers[i], GCHandleType.Pinned);
                headers[i] = Marshal.AllocHGlobal(headerSize);
                Marshal.StructureToPtr(new WaveHeader { Data = pins[i].AddrOfPinnedObject(), BufferLength = BufferSamples * 2 }, headers[i], false);
                Check(waveOutPrepareHeader(device, headers[i], headerSize));
                prepared[i] = true;
            }

            while (!_disposed)
            {
                var playing = tone is not null || !_tones.IsEmpty;
                if (!playing && !Awake)
                    break;
                for (var i = 0; i < BufferCount; i++)
                {
                    if (queued[i] && (Marshal.ReadInt32(headers[i], flagsOffset) & WhdrDone) == 0)
                        continue;
                    Fill(buffers[i], ref tone, ref toneAt, ref phase);
                    Check(waveOutWrite(device, headers[i], headerSize));
                    queued[i] = true;
                }
                done.WaitOne(BufferMs * 2);
            }

            // Let the last beep's tail reach the speakers before stopping
            var until = Environment.TickCount64 + BufferMs * BufferCount * 2 + 200;
            while (Environment.TickCount64 < until && Enumerable.Range(0, BufferCount)
                       .Any(i => queued[i] && (Marshal.ReadInt32(headers[i], flagsOffset) & WhdrDone) == 0))
                done.WaitOne(BufferMs);
        }
        finally
        {
            waveOutReset(device);
            for (var i = 0; i < BufferCount; i++)
            {
                if (prepared[i])
                    waveOutUnprepareHeader(device, headers[i], headerSize);
                if (headers[i] != IntPtr.Zero)
                    Marshal.FreeHGlobal(headers[i]);
                if (pins[i].IsAllocated)
                    pins[i].Free();
            }
            waveOutClose(device);
        }
    }

    // The next BufferMs: the queued beeps (and gaps), back to back, and the inaudible signal once they run out
    private void Fill(short[] buffer, ref short[]? tone, ref int toneAt, ref int phase)
    {
        for (var i = 0; i < buffer.Length; i++)
        {
            if (tone is null || toneAt >= tone.Length)
            {
                tone = _tones.TryDequeue(out var next) ? next : null;
                toneAt = 0;
            }
            var sample = tone is not null ? tone[toneAt++] : (short)0;
            buffer[i] = sample != 0 ? sample : Quiet(ref phase);
        }
        if (tone is not null && toneAt >= tone.Length)
            tone = null;
    }

    // One step either way at half the sample rate: far below hearing (-90 dB, and above 20 kHz), but not silence
    private static short Quiet(ref int phase) => (phase ^= 1) == 0 ? (short)-1 : (short)1;

    // 16-bit mono samples of a sine tone, faded in and out
    private static short[] Sine(int hz, int ms, double volume)
    {
        var count = SampleRate * ms / 1000;
        var fade = SampleRate * FadeMs / 1000;
        var pcm = new short[count];
        for (var i = 0; i < count; i++)
        {
            var envelope = Math.Min(1.0, Math.Min(i, count - 1 - i) / (double)fade);
            pcm[i] = (short)(Math.Sin(2 * Math.PI * hz * i / SampleRate) * FullAmplitude * volume * envelope);
        }
        return pcm;
    }

    private static void Check(int result)
    {
        if (result != 0)
            throw new InvalidOperationException($"waveOut error {result}");
    }

    private const uint WaveMapper = unchecked((uint)-1);
    private const uint CallbackEvent = 0x00050000;
    private const int WhdrDone = 1;

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
