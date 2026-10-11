using System.Text.Json;
using System.Text.Json.Serialization;

namespace RacingCoach.Collector;

/// <summary>
/// The session.json manifest in each session folder: the session's track, car, driver and iRacing IDs,
/// and one entry per saved lap CSV. Only the LapWriter's task reads or writes it.
/// </summary>
internal sealed class SessionManifest
{
    public int Version { get; set; } = 3;
    public string Track { get; set; } = "";
    public string Car { get; set; } = "";
    public string Driver { get; set; } = "";
    public int SessionId { get; set; }
    public int SubSessionId { get; set; }
    public List<ManifestLap> Laps { get; set; } = [];

    private const string FileName = "session.json";

    private static readonly JsonSerializerOptions JsonOptions = new()
    {
        WriteIndented = true,
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull,
    };

    public static SessionManifest? Load(string folder)
    {
        var path = Path.Combine(folder, FileName);
        return File.Exists(path) ? JsonSerializer.Deserialize<SessionManifest>(File.ReadAllText(path), JsonOptions) : null;
    }

    /// <summary>Writes to a temp file first so a crash never leaves a half-written manifest.</summary>
    public void Save(string folder)
    {
        var path = Path.Combine(folder, FileName);
        File.WriteAllText(path + ".tmp", JsonSerializer.Serialize(this, JsonOptions));
        File.Move(path + ".tmp", path, overwrite: true);
    }
}

internal sealed class ManifestLap
{
    public string File { get; set; } = "";
    /// <summary>Our ID for the lap, sent with its upload so RacingCoach.app recognises a retried upload.
    /// Missing in manifests written before uploads existed; given one when the lap is first uploaded.</summary>
    public Guid? ClientLapId { get; set; }
    public int LapNumber { get; set; }
    public int SessionNum { get; set; }
    public string SessionType { get; set; } = "Unknown";
    public double LapTimeSeconds { get; set; }
    public int Samples { get; set; }
    public int MissingSamples { get; set; }
    public int Incidents { get; set; }
    public bool PitRoad { get; set; }
    public bool OffTrack { get; set; }
    public DateTimeOffset RecordedAt { get; set; }
    /// <summary>True once the CSV's Lat/Lon/Alt columns are filled in. Live laps get them after the session,
    /// from iRacing's .ibt file (IbtEnricher), and are then uploaded again.</summary>
    public bool HasPosition { get; set; }
    /// <summary>The session's .ibt file didn't cover the whole lap (e.g. its recording started mid-lap),
    /// so the lap stays without track positions.</summary>
    public bool PositionMissing { get; set; }
    /// <summary>True once RacingCoach.app has the lap.</summary>
    public bool Uploaded { get; set; }
    /// <summary>Why RacingCoach.app refused the lap (or why it isn't uploaded). Refused laps are tried
    /// again the next time the collector starts.</summary>
    public string? UploadError { get; set; }

    /// <summary>A copy for another thread (every property is a value or a string).</summary>
    public ManifestLap Copy() => (ManifestLap)MemberwiseClone();
}
