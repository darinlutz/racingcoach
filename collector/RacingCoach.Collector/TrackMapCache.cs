using System.Text.Json;

namespace RacingCoach.Collector;

/// <summary>
/// The approximate track maps Live Racing draws from a clean lap (LiveRacing.cs), kept on this PC in
/// %APPDATA%\RacingCoach\maps, one file per simulator and track, so the next session at the track (or the next run of
/// the collector) has its map straight away, and sends it to the website, instead of waiting for another clean lap.
/// The site's exact map (from a lap uploaded with track positions) replaces it, and its file is deleted then.
/// The website never stores these: they're the driver's own collector's, sent with their live position.
/// </summary>
internal static class TrackMapCache
{
    private const int Version = 1;

    private static readonly string Folder =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RacingCoach", "maps");

    private sealed record Stored(int Version, double[][] Points);

    private static string? PathFor(string simulator, string track)
    {
        var name = $"{simulator}-{track}".ToLowerInvariant();
        var safe = new string(name.Select(c => char.IsLetterOrDigit(c) || c is '-' or '_' ? c : '_').ToArray());
        return safe.Length == 0 ? null : Path.Combine(Folder, safe + ".json");
    }

    /// <summary>The approximate outline saved for this track, or null when there's none (or it can't be read).</summary>
    public static IReadOnlyList<(double X, double Y)>? Load(string simulator, string track)
    {
        try
        {
            if (PathFor(simulator, track) is not { } path || !File.Exists(path))
                return null;
            var stored = JsonSerializer.Deserialize<Stored>(File.ReadAllText(path));
            if (stored is not { Version: Version, Points.Length: > 0 })
                return null;
            var points = stored.Points.Where(p => p.Length >= 2 && double.IsFinite(p[0]) && double.IsFinite(p[1]))
                .Select(p => (p[0], p[1])).ToArray();
            return points.Length == stored.Points.Length ? points : null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or JsonException)
        {
            return null;
        }
    }

    /// <summary>Saves the approximate outline drawn for this track, on a background task. A failure only means it's
    /// drawn again from a lap next time.</summary>
    public static void Save(string simulator, string track, IReadOnlyList<(double X, double Y)> points)
    {
        var copy = points.Select(p => new[] { p.X, p.Y }).ToArray();
        _ = Task.Run(() =>
        {
            try
            {
                if (PathFor(simulator, track) is not { } path)
                    return;
                Directory.CreateDirectory(Folder);
                var temp = path + ".tmp";
                File.WriteAllText(temp, JsonSerializer.Serialize(new Stored(Version, copy)));
                File.Move(temp, path, overwrite: true);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // drawn again from the next clean lap
            }
        });
    }

    /// <summary>The site has the track's exact map: the approximate one isn't needed any more.</summary>
    public static void Delete(string simulator, string track)
    {
        _ = Task.Run(() =>
        {
            try
            {
                if (PathFor(simulator, track) is { } path && File.Exists(path))
                    File.Delete(path);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
            }
        });
    }
}
