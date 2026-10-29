using System.Runtime.InteropServices;

namespace RacingCoach.Collector;

/// <summary>
/// Records the default microphone (Windows' sound settings pick it) for Driver Radio: 16 kHz 16-bit mono, which is
/// all speech to text needs, through Windows' waveIn directly, like TonePlayer's waveOut. The microphone is open only
/// between Start and Stop. Start throws InvalidOperationException when there's no microphone or Windows' privacy
/// settings don't let desktop apps use it.
/// </summary>
internal sealed class MicRecorder : IDisposable
{
    public const int SampleRate = 16000;
    private const int BufferMs = 100;
    private const int BufferCount = 4;
    private const int BufferBytes = SampleRate * 2 * BufferMs / 1000;

    private readonly object _lock = new();
    private readonly MemoryStream _pcm = new();
    private IntPtr _device;
    private readonly IntPtr[] _headers = new IntPtr[BufferCount];
    private readonly IntPtr[] _buffers = new IntPtr[BufferCount];
    private Thread? _reader;
    private volatile bool _running;
    private int _maxBytes;

    /// <summary>Starts recording, keeping at most maxSeconds of it.</summary>
    public void Start(int maxSeconds)
    {
        lock (_lock)
        {
            if (_device != IntPtr.Zero)
                return;
            _pcm.SetLength(0);
            _maxBytes = maxSeconds * SampleRate * 2;
            var format = new WaveFormat
            {
                FormatTag = 1, // PCM
                Channels = 1,
                SamplesPerSec = SampleRate,
                AvgBytesPerSec = SampleRate * 2,
                BlockAlign = 2,
                BitsPerSample = 16,
            };
            Check(waveInOpen(out _device, WaveMapper, ref format, IntPtr.Zero, IntPtr.Zero, 0));
            try
            {
                var headerSize = Marshal.SizeOf<WaveHeader>();
                for (var i = 0; i < BufferCount; i++)
                {
                    _buffers[i] = Marshal.AllocHGlobal(BufferBytes);
                    _headers[i] = Marshal.AllocHGlobal(headerSize);
                    Marshal.StructureToPtr(new WaveHeader { Data = _buffers[i], BufferLength = BufferBytes }, _headers[i], false);
                    Check(waveInPrepareHeader(_device, _headers[i], headerSize));
                    Check(waveInAddBuffer(_device, _headers[i], headerSize));
                }
                Check(waveInStart(_device));
            }
            catch
            {
                Close();
                throw;
            }
            _running = true;
            _reader = new Thread(Read) { IsBackground = true, Name = "Driver Radio microphone" };
            _reader.Start();
        }
    }

    /// <summary>Stops recording; the recording as a WAV file, or null if nothing was recorded.</summary>
    public byte[]? Stop()
    {
        lock (_lock)
        {
            if (_device == IntPtr.Zero)
                return null;
            _running = false;
        }
        _reader?.Join(TimeSpan.FromSeconds(1));
        lock (_lock)
        {
            waveInReset(_device); // hands back the buffers still being filled, marked done
            Collect(requeue: false);
            Close();
            return _pcm.Length == 0 ? null : Wav(_pcm.ToArray());
        }
    }

    /// <summary>How long the recording is so far.</summary>
    public TimeSpan Recorded
    {
        get
        {
            lock (_lock)
                return TimeSpan.FromSeconds(_pcm.Length / (SampleRate * 2.0));
        }
    }

    public void Dispose()
    {
        lock (_lock)
        {
            _running = false;
            if (_device != IntPtr.Zero)
            {
                waveInReset(_device);
                Close();
            }
        }
    }

    // Takes the filled buffers as they come and hands them back to be filled again
    private void Read()
    {
        while (_running)
        {
            Thread.Sleep(20);
            lock (_lock)
            {
                if (_running && _device != IntPtr.Zero)
                    Collect(requeue: true);
            }
        }
    }

    // Called under the lock
    private void Collect(bool requeue)
    {
        var headerSize = Marshal.SizeOf<WaveHeader>();
        for (var i = 0; i < BufferCount; i++)
        {
            if (_headers[i] == IntPtr.Zero)
                continue;
            var header = Marshal.PtrToStructure<WaveHeader>(_headers[i]);
            if ((header.Flags & WhdrDone) == 0)
                continue;
            var take = (int)Math.Min(header.BytesRecorded, Math.Max(0, _maxBytes - _pcm.Length));
            if (take > 0)
            {
                var bytes = new byte[take];
                Marshal.Copy(_buffers[i], bytes, 0, take);
                _pcm.Write(bytes);
            }
            if (!requeue)
                continue;
            header.Flags &= ~WhdrDone;
            header.BytesRecorded = 0;
            Marshal.StructureToPtr(header, _headers[i], false);
            waveInAddBuffer(_device, _headers[i], headerSize);
        }
    }

    // Called under the lock
    private void Close()
    {
        var headerSize = Marshal.SizeOf<WaveHeader>();
        for (var i = 0; i < BufferCount; i++)
        {
            if (_headers[i] != IntPtr.Zero)
            {
                waveInUnprepareHeader(_device, _headers[i], headerSize);
                Marshal.FreeHGlobal(_headers[i]);
                _headers[i] = IntPtr.Zero;
            }
            if (_buffers[i] != IntPtr.Zero)
            {
                Marshal.FreeHGlobal(_buffers[i]);
                _buffers[i] = IntPtr.Zero;
            }
        }
        waveInClose(_device);
        _device = IntPtr.Zero;
    }

    // 16-bit mono PCM with a WAV header
    private static byte[] Wav(byte[] pcm)
    {
        using var stream = new MemoryStream(44 + pcm.Length);
        using var w = new BinaryWriter(stream);
        w.Write("RIFF"u8);
        w.Write(36 + pcm.Length);
        w.Write("WAVE"u8);
        w.Write("fmt "u8);
        w.Write(16);
        w.Write((short)1);
        w.Write((short)1);
        w.Write(SampleRate);
        w.Write(SampleRate * 2);
        w.Write((short)2);
        w.Write((short)16);
        w.Write("data"u8);
        w.Write(pcm.Length);
        w.Write(pcm);
        w.Flush();
        return stream.ToArray();
    }

    private static void Check(int result)
    {
        if (result != 0)
            throw new InvalidOperationException(result == 2 // MMSYSERR_BADDEVICEID
                ? "no microphone found"
                : $"the microphone couldn't be opened (waveIn error {result})");
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
    private static extern int waveInOpen(out IntPtr device, uint deviceId, ref WaveFormat format, IntPtr callback, IntPtr instance, uint flags);

    [DllImport("winmm.dll")]
    private static extern int waveInPrepareHeader(IntPtr device, IntPtr header, int size);

    [DllImport("winmm.dll")]
    private static extern int waveInUnprepareHeader(IntPtr device, IntPtr header, int size);

    [DllImport("winmm.dll")]
    private static extern int waveInAddBuffer(IntPtr device, IntPtr header, int size);

    [DllImport("winmm.dll")]
    private static extern int waveInStart(IntPtr device);

    [DllImport("winmm.dll")]
    private static extern int waveInReset(IntPtr device);

    [DllImport("winmm.dll")]
    private static extern int waveInClose(IntPtr device);
}
