using System.Text.Json;
using System.Text.Json.Serialization;
using SVappsLAB.iRacingTelemetrySDK;

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
    /// <summary>True once the lap's CSV has been deleted from this PC, which happens once RacingCoach.app has it
    /// and it won't get track positions any more (LapWriter.DeleteUploadedCsvs). The entry stays for the lap list.</summary>
    public bool CsvDeleted { get; set; }
    /// <summary>The weather at the end of the lap and the session's track usage, sent with its upload for the
    /// Debrief Coach's recorded laps. Missing in laps saved by collectors before 1.40.0.</summary>
    public LapConditions? Conditions { get; set; }

    /// <summary>A copy for another thread (every property is a value, a string or an immutable record).</summary>
    public ManifestLap Copy() => (ManifestLap)MemberwiseClone();
}

/// <summary>A lap's weather, in iRacing's units: temperatures in °C, humidity 0-1, wind in m/s and radians (WindDir).
/// TrackUsage is iRacing's words for the session's rubber, e.g. "moderate usage".</summary>
internal sealed record LapConditions(
    double? TrackTempC,
    double? AirTempC,
    double? RelativeHumidity,
    double? WindVelocity,
    double? WindDirection,
    string? TrackUsage)
{
    /// <summary>The conditions on the lap's last sample; null when telemetry has none of them.</summary>
    public static LapConditions? From(TelemetryData last, string? trackUsage)
    {
        static double? Round(float? value, int digits) => value is { } v && float.IsFinite(v) ? Math.Round(v, digits) : null;
        var conditions = new LapConditions(
            Round(last.TrackTempCrew, 1),
            Round(last.AirTemp, 1),
            Round(last.RelativeHumidity, 3),
            Round(last.WindVel, 2),
            Round(last.WindDir, 3),
            string.IsNullOrWhiteSpace(trackUsage) ? null : trackUsage);
        return conditions == new LapConditions(null, null, null, null, null, null) ? null : conditions;
    }
}
