using System.Globalization;
using System.Text;

namespace RacingCoach.Collector;

/// <summary>
/// Adds track positions (Lat, Lon, Alt) to live laps once iRacing has finished the session's .ibt file.
/// Live telemetry never has them, so laps are saved and uploaded without them first; this fills in the
/// CSV's columns afterwards, matching each row to the .ibt by SessionNum, SessionTick and SessionTime.
/// It also adds the tires' surface temperatures, which only .ibt files have, and replaces the carcass
/// temperatures, tire pressures and ride heights with the .ibt's: live telemetry only updates the carcass
/// temperatures in the pit stall and leaves the others empty.
/// Runs on the LapWriter's task (it rewrites lap CSVs and session.json), which then uploads the laps again.
/// </summary>
internal sealed class IbtEnricher(string ibtFolder, Action<string> log)
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static readonly string[] PositionColumns = ["Lat", "Lon", "Alt"];
    // Taken from the .ibt where it has them (LapWriter's columns of the same names, and the surface temperatures,
    // which are added after the CSV's columns)
    private static readonly string[] IbtColumns =
    [
        .. new[] { "LF", "RF", "LR", "RR" }.SelectMany(corner => new[]
        {
            $"{corner}tempL", $"{corner}tempM", $"{corner}tempR",
            $"{corner}tempCL", $"{corner}tempCM", $"{corner}tempCR", $"{corner}pressure", $"{corner}rideHeight",
        }),
    ];
    // Older laps are left alone; iRacing's .ibt files may be long gone
    public static readonly TimeSpan MaxLapAge = TimeSpan.FromDays(14);
    // Slack around an .ibt file's start and last write times when deciding which laps it covers
    private static readonly TimeSpan Slack = TimeSpan.FromMinutes(1);

    public string IbtFolder => ibtFolder;

    /// <summary>iRacing telemetry files older than this are deleted from iRacing's telemetry folder: the collector turns
    /// iRacing's recording on, and they hold the same telemetry as the laps, which aren't kept longer than
    /// LapWriter.MaxLocalAge either.</summary>
    public static readonly TimeSpan MaxIbtAge = LapWriter.MaxLocalAge;

    /// <summary>Deletes the .ibt files in the folder last written more than MaxIbtAge ago; answers how many. A file
    /// that can't be deleted (e.g. open in another program) is left for the next time.</summary>
    public static int DeleteOldIbtFiles(string folder, Action<string> log)
    {
        if (!Directory.Exists(folder))
            return 0;
        var cutoff = DateTime.UtcNow - MaxIbtAge;
        var deleted = 0;
        foreach (var path in Directory.EnumerateFiles(folder, "*.ibt"))
        {
            try
            {
                if (File.GetLastWriteTimeUtc(path) >= cutoff)
                    continue;
                File.Delete(path);
                deleted++;
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                log($"Could not delete the old iRacing telemetry file {Path.GetFileName(path)}: {e.Message}");
            }
        }
        if (deleted > 0)
            log($"Deleted {deleted} iRacing telemetry (.ibt) file(s) more than {MaxIbtAge.TotalDays:0} days old from {folder}.");
        return deleted;
    }

    /// <summary>A lap that now has track positions; its session.json is already saved.</summary>
    public sealed record EnrichedLap(string Folder, SessionManifest Manifest, ManifestLap Lap);

    /// <summary>What a run did: laps that now have positions, every session whose session.json changed
    /// (including laps marked PositionMissing), whether a waiting lap's .ibt file is still being recorded,
    /// and how many laps are still waiting.</summary>
    public sealed record Result(List<EnrichedLap> Enriched, Dictionary<string, SessionManifest> Changed, bool StillWriting, int Waiting);

    private sealed record WaitingLap(string Folder, SessionManifest Manifest, ManifestLap Lap);

    // A lap CSV read into memory, with each row's SessionTick and SessionTime (null if a row lacks them)
    private sealed record LapCsv(string Path, List<string> Header, List<string[]> Rows, (int Tick, double Time)[]? Samples);

    /// <summary>Fills in positions for every recent lap waiting for them whose .ibt file is finished.</summary>
    public Result Run(string lapsRoot)
    {
        var enriched = new List<EnrichedLap>();
        var changed = new Dictionary<string, SessionManifest>(); // folder -> manifest to save
        if (!Directory.Exists(ibtFolder) || !Directory.Exists(lapsRoot))
            return new Result(enriched, changed, false, 0);

        var since = DateTimeOffset.UtcNow - MaxLapAge;
        var waiting = new List<WaitingLap>();
        foreach (var folder in Directory.GetDirectories(lapsRoot))
        {
            var manifest = SessionManifest.Load(folder);
            if (manifest is null)
                continue;
            foreach (var lap in manifest.Laps)
                if (!lap.HasPosition && !lap.PositionMissing && lap.RecordedAt >= since)
                    waiting.Add(new WaitingLap(folder, manifest, lap));
        }
        if (waiting.Count == 0)
            return new Result(enriched, changed, false, 0);

        var stillWriting = false;
        foreach (var path in Directory.GetFiles(ibtFolder, "*.ibt").Order(StringComparer.Ordinal))
        {
            var lastWrite = File.GetLastWriteTimeUtc(path);
            if (waiting.Count == 0 || lastWrite + Slack < since)
                continue;
            try
            {
                if (IbtFile.IsBeingWritten(path))
                {
                    // Can't read its header yet; only matters if it might cover a waiting lap
                    if (waiting.Any(w => w.Lap.RecordedAt.UtcDateTime >= File.GetCreationTimeUtc(path) - Slack))
                        stillWriting = true;
                    continue;
                }

                var ibt = new IbtFile(path);
                if (!ibt.HasPositions)
                    continue;
                // The file covers the laps saved while it was being recorded
                var from = (ibt.StartedAt?.UtcDateTime ?? File.GetCreationTimeUtc(path)) - Slack;
                var to = lastWrite + Slack;
                var laps = waiting.Where(w => w.Lap.RecordedAt.UtcDateTime >= from && w.Lap.RecordedAt.UtcDateTime <= to
                    // Another session's file that happens to overlap in time
                    && (w.Manifest.SubSessionId == 0 || ibt.SubSessionId == 0 || w.Manifest.SubSessionId == ibt.SubSessionId)).ToList();
                if (laps.Count == 0)
                    continue;

                var csvs = laps.ToDictionary(w => w, w => ReadCsv(Path.Combine(w.Folder, w.Lap.File)));
                var wanted = new HashSet<(int, int)>();
                foreach (var (w, csv) in csvs)
                    foreach (var (tick, _) in csv.Samples ?? [])
                        wanted.Add((w.Lap.SessionNum, tick));
                var extras = ibt.Has(IbtColumns);
                var positions = ibt.ReadPositions(wanted, extras);

                var added = 0;
                foreach (var (w, csv) in csvs)
                {
                    if (TryAddPositions(csv, w.Lap.SessionNum, positions, extras))
                    {
                        w.Lap.HasPosition = true;
                        enriched.Add(new EnrichedLap(w.Folder, w.Manifest, w.Lap));
                        added++;
                    }
                    else
                    {
                        w.Lap.PositionMissing = true;
                    }
                    changed[w.Folder] = w.Manifest;
                }
                waiting.RemoveAll(laps.Contains);
                log(added == laps.Count
                    ? $"Added track positions to {added} lap(s) from {Path.GetFileName(path)}."
                    : $"Added track positions to {added} of {laps.Count} lap(s) from {Path.GetFileName(path)}; it doesn't cover the others completely.");
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidDataException)
            {
                log($"Could not add track positions from {Path.GetFileName(path)}: {e.Message}");
            }
        }

        foreach (var (folder, manifest) in changed)
            manifest.Save(folder);
        return new Result(enriched, changed, stillWriting, waiting.Count);
    }

    private static LapCsv ReadCsv(string path)
    {
        var lines = File.ReadAllLines(path);
        var header = (lines.FirstOrDefault() ?? "").Split(',').ToList();
        var rows = lines.Skip(1).Select(l => l.Split(',')).ToList();
        var tickIndex = header.IndexOf("SessionTick");
        var timeIndex = header.IndexOf("SessionTime");
        var samples = new (int, double)[rows.Count];
        for (var i = 0; i < rows.Count; i++)
        {
            if (tickIndex < 0 || timeIndex < 0 || rows[i].Length <= Math.Max(tickIndex, timeIndex)
                || !int.TryParse(rows[i][tickIndex], NumberStyles.Integer, Inv, out var tick)
                || !double.TryParse(rows[i][timeIndex], NumberStyles.Float, Inv, out var time))
                return new LapCsv(path, header, rows, null);
            samples[i] = (tick, time);
        }
        return new LapCsv(path, header, rows, samples);
    }

    // Fills in the CSV's Lat/Lon/Alt columns and the extras (adding any the CSV was saved without). False, with
    // the CSV untouched, if the .ibt doesn't have every row.
    private static bool TryAddPositions(LapCsv csv, int sessionNum, Dictionary<(int, int), IbtPosition> positions,
        IReadOnlyList<string> extras)
    {
        if (csv.Samples is not { Length: > 0 } samples)
            return false;
        var found = new IbtPosition[samples.Length];
        for (var i = 0; i < samples.Length; i++)
        {
            if (!positions.TryGetValue((sessionNum, samples[i].Tick), out found[i]) || Math.Abs(found[i].SessionTime - samples[i].Time) > 0.001)
                return false;
        }

        var header = csv.Header.ToList();
        foreach (var name in PositionColumns.Concat(extras).Where(n => !header.Contains(n)))
            header.Add(name);
        var columns = PositionColumns.Select(name => header.IndexOf(name)).ToArray();
        var extraColumns = extras.Select(name => header.IndexOf(name)).ToArray();

        var output = new StringBuilder(string.Join(',', header)).Append('\n');
        for (var i = 0; i < csv.Rows.Count; i++)
        {
            var cells = csv.Rows[i].Concat(Enumerable.Repeat("", Math.Max(0, header.Count - csv.Rows[i].Length))).ToArray();
            cells[columns[0]] = found[i].Lat.ToString(Inv);
            cells[columns[1]] = found[i].Lon.ToString(Inv);
            cells[columns[2]] = ((float)found[i].Alt).ToString(Inv);
            for (var e = 0; e < extraColumns.Length; e++)
                cells[extraColumns[e]] = ((float)found[i].Extras[e]).ToString(Inv);
            output.AppendJoin(',', cells).Append('\n');
        }

        // Write to a temp file first so a crash never leaves a half-written CSV behind.
        var temp = csv.Path + ".tmp";
        File.WriteAllText(temp, output.ToString(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        File.Move(temp, csv.Path, overwrite: true);
        return true;
    }
}
