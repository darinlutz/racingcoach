using RacingCoach.Collector.Simulators;

namespace RacingCoach.Collector;

/// <summary>
/// The path for simulators other than iRacing: an adapter's frames become laps (FrameLapTracker) that are saved and
/// uploaded by the same LapWriter and LapUploader as iRacing's. Frames are moved off the adapter's reading thread with
/// a bounded queue. Only laps so far: the live features (coach, overlays, brake beeps, Live Racing) read iRacing's
/// TelemetryData, and aren't on this path until they've been moved to frames and checked for each simulator.
/// </summary>
internal sealed class CanonicalLapPipeline : ITelemetrySink
{
    private readonly ISimulatorAdapter _adapter;
    private readonly Action<CompletedLap> _save;
    private readonly Action<string, bool> _log;
    private readonly FramePump _pump;
    private readonly FrameLapTracker _tracker;
    private SessionContext? _session;

    public CanonicalLapPipeline(ISimulatorAdapter adapter, Action<CompletedLap> save, Action<string, bool> log, LapTrackerOptions? options = null, int pumpCapacity = FramePump.DefaultCapacity)
    {
        _pump = new FramePump(pumpCapacity);
        _adapter = adapter;
        _save = save;
        _log = log;
        _tracker = new FrameLapTracker(OnLap, message => log(message, false), options ?? (adapter as IHasLapTrackerOptions)?.LapTrackerOptions);
    }

    /// <summary>Runs the adapter until it ends, then finishes the frames it read.</summary>
    public async Task RunAsync(CancellationToken cancel)
    {
        var consumer = Task.Run(() => _pump.ConsumeAsync(_tracker.OnFrame), CancellationToken.None);
        try
        {
            await _adapter.RunAsync(this, cancel);
        }
        finally
        {
            _pump.Complete();
            await consumer;
            if (_pump.Dropped > 0)
                _log($"{_adapter.DisplayName}: {_pump.Dropped} telemetry frames dropped because processing fell behind; laps with gaps aren't saved.", true);
        }
    }

    public void OnConnectionChanged(bool connected) =>
        _log(connected ? $"Connected to {_adapter.DisplayName}." : $"Disconnected from {_adapter.DisplayName}.", false);

    public void OnSession(SimulatorSession session)
    {
        if (session.SimulatorId != _adapter.SimulatorId)
            throw new InvalidOperationException($"{_adapter.SimulatorId} adapter sent a {session.SimulatorId} session");
        Volatile.Write(ref _session, new SessionContext(
            session.Track, session.Car, session.Driver, session.SessionId, session.SubSessionId, session.SessionTypes,
            session.FuelKgPerLiter, session.TrackUsage, session.SimulatorId, _adapter.AdapterVersion, session.NativeCarId, session.NativeTrackId));
    }

    public void OnFrame(TelemetryFrame frame)
    {
        if (frame.SimulatorId != _adapter.SimulatorId)
            throw new InvalidOperationException($"{_adapter.SimulatorId} adapter sent a {frame.SimulatorId} frame");
        _pump.Post(frame);
    }

    public void OnError(string message) => _log($"{_adapter.DisplayName}: {message}", true);

    private void OnLap(TrackedLap lap) => _save(new CompletedLap(
        Volatile.Read(ref _session),
        lap.LapNumber,
        lap.SessionNumber,
        lap.LapTimeSeconds,
        new CanonicalLapSamples((_adapter as IShapesLapFiles)?.ForLapFile(lap.Frames) ?? lap.Frames),
        lap.MissingFrames,
        lap.Incidents,
        lap.OnPitRoad,
        lap.OffTrack));
}
