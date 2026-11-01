using System.Threading.Channels;

namespace RacingCoach.Collector.Simulators;

/// <summary>
/// Moves frames off an adapter's reading thread, so slow processing can never hold it up. Bounded: when the consumer
/// falls behind by Capacity frames the oldest are dropped and counted, rather than memory growing. No frames are made
/// up to fill the gap: FrameLapTracker sees the jump and discards the lap, as it would for any telemetry gap.
/// </summary>
public sealed class FramePump
{
    /// <summary>10 seconds at 60 Hz.</summary>
    public const int DefaultCapacity = 600;

    private readonly Channel<TelemetryFrame> _frames;
    private long _dropped;

    public FramePump(int capacity = DefaultCapacity)
    {
        _frames = Channel.CreateBounded<TelemetryFrame>(
            new BoundedChannelOptions(capacity) { FullMode = BoundedChannelFullMode.Wait, SingleWriter = true });
    }

    public long Dropped => Interlocked.Read(ref _dropped);

    /// <summary>Never blocks.</summary>
    public void Post(TelemetryFrame frame)
    {
        while (!_frames.Writer.TryWrite(frame))
        {
            if (!_frames.Reader.TryRead(out _))
                return; // completed
            Interlocked.Increment(ref _dropped);
        }
    }

    public void Complete() => _frames.Writer.TryComplete();

    /// <summary>Hands each frame to consume in order until Complete, then returns once the rest are done.</summary>
    public async Task ConsumeAsync(Action<TelemetryFrame> consume, CancellationToken cancel = default)
    {
        await foreach (var frame in _frames.Reader.ReadAllAsync(cancel))
            consume(frame);
    }
}
