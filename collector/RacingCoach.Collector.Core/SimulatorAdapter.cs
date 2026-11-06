namespace RacingCoach.Collector.Simulators;

/// <summary>
/// One simulator's connection to the collector. All that's specific to the simulator lives behind this: how to find
/// it, read it, and turn its data into TelemetryFrames with its documented units and signs converted. Implement this
/// and add it to the registry (SimulatorRegistry in the collector); nothing else should need to change. A feature only
/// some simulators have is one of the optional interfaces below rather than a method that throws.
/// </summary>
public interface ISimulatorAdapter
{
    /// <summary>The simulator's id in simulators/capabilities.json, e.g. "iracing". Sent with each lap.</summary>
    string SimulatorId { get; }
    string DisplayName { get; }
    /// <summary>This adapter's version, in the logs and with each lap. Bump it when frames' meaning changes.</summary>
    string AdapterVersion { get; }
    /// <summary>What it says about the simulator right now. Called every few seconds from a background task, so it
    /// must be cheap, must not throw, and must not connect to or change anything.</summary>
    SimulatorProbe Probe();
    /// <summary>Connects and sends frames to the sink until cancelled, or until the source ends. Reconnecting after the
    /// simulator restarts is up to the caller when this returns, unless the simulator's own library does it. Calls to
    /// the sink are one at a time and in order, on the thread reading telemetry, so a sink must not block. Throwing
    /// means it should be tried again later.</summary>
    Task RunAsync(ITelemetrySink sink, CancellationToken cancel);
}

/// <summary>What a look at a simulator found. Installed is null when that can't be told. ProcessRunning alone isn't
/// enough to select an adapter: the telemetry interface must be there too, and for some simulators it has to be turned
/// on in their settings. Several simulators can share one interface name (AC, ACC and AC Rally all use Local\acpmf_*),
/// so an InterfaceOpen must also be checked against the running process.</summary>
public readonly record struct SimulatorProbe(bool? Installed, bool ProcessRunning, bool InterfaceOpen, bool ProducingTelemetry);

/// <summary>Where an adapter sends what it reads, in the order it happened.</summary>
public interface ITelemetrySink
{
    void OnConnectionChanged(bool connected);
    void OnSession(SimulatorSession session);
    void OnFrame(TelemetryFrame frame);
    void OnError(string message);
}

/// <summary>The simulator's word on a lap just completed, on the first frame after it (TelemetryFrame.LapJustEnded), so
/// it stays in order with the frames; a null means it didn't say.</summary>
public sealed record NativeLapEvent(int? LapNumber, double? LapTimeSeconds, bool? Valid);

/// <summary>An adapter whose simulator's frames are split into laps differently from iRacing's (LapTrackerOptions'
/// defaults): its own lap events, another rate, no tick.</summary>
public interface IHasLapTrackerOptions
{
    LapTrackerOptions LapTrackerOptions { get; }
}

/// <summary>An adapter whose simulator's laps need putting into iRacing's form before they're written, beyond what
/// one frame at a time can do (e.g. ACC's neutral in the middle of a shift, AccFrameBuilder.ForLapFile).</summary>
public interface IShapesLapFiles
{
    IReadOnlyList<TelemetryFrame> ForLapFile(IReadOnlyList<TelemetryFrame> frames);
}

/// <summary>An adapter that can give the finished results of a race.</summary>
public interface IProvidesRaceResults;

/// <summary>An adapter that can play back recorded telemetry through the same path as live.</summary>
public interface ISupportsReplay;

/// <summary>Reads recorded telemetry files into the same frames as live. Separate from ISimulatorAdapter, as a file has
/// no connection, process or lifetime to manage. CanRead looks at the file's contents, never only its extension.</summary>
public interface ITelemetryFileImporter
{
    string SimulatorId { get; }
    string FormatName { get; }
    bool CanRead(Stream start);
    Task ImportAsync(string path, ITelemetrySink sink, CancellationToken cancel);
}

/// <summary>
/// What the session is, in simulator-independent form with the simulator's own identifiers kept. Native ids are never
/// merged across simulators or matched by name: the website maps them to its tracks and cars explicitly.
/// </summary>
public sealed record SimulatorSession
{
    public required string SimulatorId { get; init; }
    /// <summary>The simulator's own id of the track and layout, e.g. iRacing's "limerock full".</summary>
    public string? NativeTrackId { get; init; }
    /// <summary>The track's display name, with the layout in parentheses when there is one.</summary>
    public required string Track { get; init; }
    public string? TrackLayout { get; init; }
    /// <summary>The simulator's length of the layout. Null where it doesn't say: not worked out from the laps.</summary>
    public double? TrackLengthMeters { get; init; }
    public double? TrackLatitude { get; init; }
    public double? TrackLongitude { get; init; }
    public string? NativeCarId { get; init; }
    public required string Car { get; init; }
    public string? NativeDriverId { get; init; }
    public required string Driver { get; init; }
    /// <summary>The simulator's session ids; 0 when it has none (e.g. offline).</summary>
    public int SessionId { get; init; }
    public int SubSessionId { get; init; }
    /// <summary>Each session's type by SessionNumber, in the simulator's words ("Practice", "Race", ...).</summary>
    public IReadOnlyDictionary<int, string> SessionTypes { get; init; } = new Dictionary<int, string>();
    /// <summary>kg per liter, for showing fuel as a weight.</summary>
    public double? FuelKgPerLiter { get; init; }
    /// <summary>Each session's track rubber, in the simulator's words, by SessionNumber.</summary>
    public IReadOnlyDictionary<int, string>? TrackUsage { get; init; }
}
