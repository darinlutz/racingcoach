using System.Reflection;
using System.Text.Json;

namespace RacingCoach.Collector.Simulators;

/// <summary>How far along a simulator is (simulators/capabilities.json).</summary>
public enum SimulatorStatus
{
    /// <summary>An adapter exists and has been tested. The only status the website accepts laps from.</summary>
    Supported,
    /// <summary>Its channels have been read from the publisher's own documentation; no adapter yet.</summary>
    Documented,
    /// <summary>Its interface has been identified; its channels haven't been checked.</summary>
    InterfaceIdentified,
}

/// <summary>How a telemetry channel is known to behave for a simulator.</summary>
public enum ChannelSupport
{
    /// <summary>The adapter reads it, live.</summary>
    Collected,
    /// <summary>The adapter gets it, but only after the stint (iRacing's track positions).</summary>
    CollectedAfterStint,
    /// <summary>The publisher documents it, and no adapter has read it yet, so its behavior is unconfirmed.</summary>
    Documented,
    /// <summary>The simulator doesn't provide it. Show "Not Available"; never a 0.</summary>
    Unavailable,
    /// <summary>Not checked. Treat like Unavailable until it has been.</summary>
    Unknown,
}

/// <summary>A simulator's entry in the matrix. A channel not listed is Unknown.</summary>
public sealed record SimulatorDescription(string Id, string DisplayName, string Priority, SimulatorStatus Status, IReadOnlyDictionary<string, ChannelSupport> Channels)
{
    public ChannelSupport Support(string channel) => Channels.GetValueOrDefault(channel, ChannelSupport.Unknown);
}

/// <summary>simulators/capabilities.json: which simulators there are and what each can give. The one source of truth
/// for this, shared with the website (src/lib/simulators.ts).</summary>
public sealed class SimulatorCatalog
{
    private static readonly Lazy<SimulatorCatalog> Instance = new(Load);

    private readonly Dictionary<string, SimulatorDescription> _simulators;

    private SimulatorCatalog(Dictionary<string, SimulatorDescription> simulators, IReadOnlyList<string> channels)
    {
        _simulators = simulators;
        Channels = channels;
    }

    public static SimulatorCatalog Shared => Instance.Value;

    public IReadOnlyList<string> Channels { get; }
    public IEnumerable<SimulatorDescription> Simulators => _simulators.Values;
    public SimulatorDescription? Find(string id) => _simulators.GetValueOrDefault(id);

    private static SimulatorCatalog Load()
    {
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("simulators.capabilities.json")
            ?? throw new InvalidOperationException("simulators.capabilities.json isn't built in");
        using var json = JsonDocument.Parse(stream);
        var channels = json.RootElement.GetProperty("channels").EnumerateArray().Select(c => c.GetProperty("id").GetString()!).ToList();
        var simulators = new Dictionary<string, SimulatorDescription>();
        foreach (var s in json.RootElement.GetProperty("simulators").EnumerateArray())
        {
            var id = s.GetProperty("id").GetString()!;
            var support = new Dictionary<string, ChannelSupport>();
            foreach (var c in s.GetProperty("channels").EnumerateObject())
                support[c.Name] = ParseSupport(c.Value.GetProperty("support").GetString());
            simulators[id] = new SimulatorDescription(id, s.GetProperty("displayName").GetString()!, s.GetProperty("priority").GetString()!,
                ParseStatus(s.GetProperty("status").GetString()), support);
        }
        return new SimulatorCatalog(simulators, channels);
    }

    private static SimulatorStatus ParseStatus(string? status) => status switch
    {
        "supported" => SimulatorStatus.Supported,
        "documented" => SimulatorStatus.Documented,
        "interfaceIdentified" => SimulatorStatus.InterfaceIdentified,
        _ => throw new InvalidDataException($"unknown simulator status {status}"),
    };

    private static ChannelSupport ParseSupport(string? support) => support switch
    {
        "collected" => ChannelSupport.Collected,
        "collectedAfterStint" => ChannelSupport.CollectedAfterStint,
        "documented" => ChannelSupport.Documented,
        "unavailable" => ChannelSupport.Unavailable,
        "unknown" => ChannelSupport.Unknown,
        _ => throw new InvalidDataException($"unknown channel support {support}"),
    };
}
