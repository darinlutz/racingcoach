using System.Globalization;
using System.Text;

namespace RacingCoach.Collector;

/// <summary>
/// Adds track positions (Lat, Lon, Alt) to live laps once iRacing has finished the session's .ibt file.
/// Live telemetry never has them, so laps are saved and uploaded without them first; this fills in the
/// CSV's columns afterwards, matching each row to the .ibt by SessionNum, SessionTick and SessionTime.
/// Runs on the LapWriter's task (it rewrites lap CSVs and session.json), which then uploads the laps again.
/// </summary>
internal sealed class IbtEnricher(string ibtFolder, Action<string> log)
{
    private static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    private static readonly string[] PositionColumns = ["Lat", "Lon", "Alt"];
    // Older laps are left alone; iRacing's .ibt files may be long gone
    private static readonly TimeSpan MaxLapAge = TimeSpan.FromDays(14);
    // Slack around an .ibt file's start and last write times when deciding which laps it covers
    private static readonly TimeSpan Slack = TimeSpan.FromMinutes(1);

    public string IbtFolder => ibtFolder;

    /// <summary>A lap that now has track positions; its session.json is already saved.</summary>
    public sealed record EnrichedLap(string Folder, SessionManifest Manifest, ManifestLap Lap);

    private sealed record WaitingLap(string Folder, SessionManifest Manifest, ManifestLap Lap);

    // A lap CSV read into memory, with each row's SessionTick and SessionTime (null if a row lacks them)
    private sealed record LapCsv(string Path, List<string> Header, List<string[]> Rows, (int Tick, double Time)[]? Samples);

    /// <summary>Fills in positions for every recent lap waiting for them whose .ibt file is finished.
    /// StillWriting is true when some waiting laps' .ibt file is still being recorded.</summary>
    public (List<EnrichedLap> Enriched, bool StillWriting) Run(string lapsRoot)
    {
        var enriched = new List<EnrichedLap>();
        if (!Directory.Exists(ibtFolder) || !Directory.Exists(lapsRoot))
            return (enriched, false);

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
            return (enriched, false);

        var stillWriting = false;
        var changed = new Dictionary<string, SessionManifest>(); // folder -> manifest to save
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
                var positions = ibt.ReadPositions(wanted);

                var added = 0;
                foreach (var (w, csv) in csvs)
                {
                    if (TryAddPositions(csv, w.Lap.SessionNum, positions))
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
        return (enriched, stillWriting);
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

    // Fills in the CSV's Lat/Lon/Alt columns (adding them to CSVs saved before they existed). False, with the
    // CSV untouched, if the .ibt doesn't have every row.
    private static bool TryAddPositions(LapCsv csv, int sessionNum, Dictionary<(int, int), IbtPosition> positions)
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
        foreach (var name in PositionColumns.Where(n => !header.Contains(n)))
            header.Add(name);
        var columns = PositionColumns.Select(name => header.IndexOf(name)).ToArray();

        var output = new StringBuilder(string.Join(',', header)).Append('\n');
        for (var i = 0; i < csv.Rows.Count; i++)
        {
            var cells = csv.Rows[i].Concat(Enumerable.Repeat("", Math.Max(0, header.Count - csv.Rows[i].Length))).ToArray();
            cells[columns[0]] = found[i].Lat.ToString(Inv);
            cells[columns[1]] = found[i].Lon.ToString(Inv);
            cells[columns[2]] = ((float)found[i].Alt).ToString(Inv);
            output.AppendJoin(',', cells).Append('\n');
        }

        // Write to a temp file first so a crash never leaves a half-written CSV behind.
        var temp = csv.Path + ".tmp";
        File.WriteAllText(temp, output.ToString(), new UTF8Encoding(encoderShouldEmitUTF8Identifier: false));
        File.Move(temp, csv.Path, overwrite: true);
        return true;
    }
}
