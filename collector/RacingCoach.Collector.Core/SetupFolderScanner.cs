using System.Security.Cryptography;

namespace RacingCoach.Collector.Setups;

/// <summary>One setup found in iRacing's setups folder: its car folder (iRacing's car path, e.g. ferrari296gt3), its
/// path below that folder without the extension, with forward slashes ("baseline", "Season 4/race"), and its files: the
/// .sto, and the .htm iRacing exported beside it when there is one (same name, case aside).</summary>
public sealed record ScannedSetup(string CarFolder, string SetupPath, string StoPath, string? HtmPath);

/// <summary>What a scan found: the setups, .htm files with no .sto beside them, and files or folders it couldn't
/// list.</summary>
public sealed record SetupScan(
    string Root,
    IReadOnlyList<string> CarFolders,
    IReadOnlyList<ScannedSetup> Setups,
    IReadOnlyList<string> HtmWithoutSto,
    IReadOnlyList<(string Path, string Error)> Problems);

/// <summary>A setup file's bytes as read, and their SHA-256 (lowercase hex).</summary>
public sealed record SetupFileContent(string FileName, byte[] Bytes, string Sha256);

/// <summary>
/// Finds and reads iRacing's setup files for the iRacing Setups library (Get Car Setups; docs/setups.md's iRacing setup
/// collection). Read only: files are opened for reading, sharing read, write and delete with iRacing and OneDrive, and
/// never moved, renamed, changed or deleted. Nothing here knows any car: which car folders to scan is the caller's
/// choice. No WPF or network, so it's tested on any OS (RacingCoach.Collector.Core.Tests).
/// </summary>
public static class SetupFolderScanner
{
    /// <summary>The largest setup file read (the website takes 512 KB); a bigger one is reported, not read.</summary>
    public const int MaxFileBytes = 512 * 1024;
    /// <summary>Subfolders below a car folder (the website takes 4 parts in a setup's path).</summary>
    public const int MaxDepth = 3;

    /// <summary>Where iRacing's setups folder may be, in order: OneDrive's Documents first, then Windows' Documents
    /// known folder (wherever it's redirected), then the plain Documents folder. Each ends in iRacing\setups.</summary>
    public static IReadOnlyList<string> CandidateRoots(string userProfile, string? oneDrive, string? documents)
    {
        var roots = new List<string> { Path.Combine(userProfile, "OneDrive", "Documents", "iRacing", "setups") };
        if (!string.IsNullOrWhiteSpace(oneDrive))
            roots.Add(Path.Combine(oneDrive, "Documents", "iRacing", "setups"));
        if (!string.IsNullOrWhiteSpace(documents))
            roots.Add(Path.Combine(documents, "iRacing", "setups"));
        roots.Add(Path.Combine(userProfile, "Documents", "iRacing", "setups"));
        return roots.Select(Path.GetFullPath).Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    /// <summary>The first candidate that exists, or null.</summary>
    public static string? FindRoot(IEnumerable<string> candidates) => candidates.FirstOrDefault(Directory.Exists);

    /// <summary>Lists the setups in the car folders under root (only those named in carFilter, case aside, when it's
    /// given). Folders that are links (junctions, symbolic links) aren't followed. OneDrive's online-only files are
    /// listed like any other; reading them downloads them.</summary>
    public static SetupScan Scan(string root, IReadOnlyCollection<string>? carFilter)
    {
        var problems = new List<(string, string)>();
        var setups = new List<ScannedSetup>();
        var orphans = new List<string>();
        var cars = new List<string>();
        IEnumerable<string> carDirs;
        try
        {
            carDirs = Directory.EnumerateDirectories(root).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return new SetupScan(root, [], [], [], [(root, e.Message)]);
        }
        foreach (var carDir in carDirs.OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
        {
            var folder = Path.GetFileName(carDir);
            if (carFilter is not null && !carFilter.Contains(folder, StringComparer.OrdinalIgnoreCase))
                continue;
            if (IsLink(carDir))
                continue;
            cars.Add(folder);
            ScanFolder(carDir, folder, "", 0, setups, orphans, problems);
        }
        return new SetupScan(root, cars, setups, orphans, problems);
    }

    private static bool IsLink(string path)
    {
        try
        {
            return new DirectoryInfo(path).Attributes.HasFlag(FileAttributes.ReparsePoint) && new DirectoryInfo(path).LinkTarget is not null;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return true;
        }
    }

    private static void ScanFolder(string dir, string carFolder, string prefix, int depth, List<ScannedSetup> setups, List<string> orphans,
        List<(string, string)> problems)
    {
        List<string> files;
        try
        {
            files = Directory.EnumerateFiles(dir).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            problems.Add((dir, e.Message));
            return;
        }
        var htms = files
            .Where(f => f.EndsWith(".htm", StringComparison.OrdinalIgnoreCase) || f.EndsWith(".html", StringComparison.OrdinalIgnoreCase))
            .GroupBy(f => Path.GetFileNameWithoutExtension(f), StringComparer.OrdinalIgnoreCase)
            // .htm before .html when a setup has both
            .ToDictionary(g => g.Key, g => g.OrderBy(f => f.Length).First(), StringComparer.OrdinalIgnoreCase);
        var matched = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var sto in files.Where(f => f.EndsWith(".sto", StringComparison.OrdinalIgnoreCase)).OrderBy(f => f, StringComparer.OrdinalIgnoreCase))
        {
            var stem = Path.GetFileNameWithoutExtension(sto);
            htms.TryGetValue(stem, out var htm);
            if (htm is not null)
                matched.Add(stem);
            setups.Add(new ScannedSetup(carFolder, prefix + stem, sto, htm));
        }
        orphans.AddRange(htms.Where(h => !matched.Contains(h.Key)).Select(h => h.Value));
        if (depth >= MaxDepth)
            return;
        List<string> subdirs;
        try
        {
            subdirs = Directory.EnumerateDirectories(dir).ToList();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            problems.Add((dir, e.Message));
            return;
        }
        foreach (var sub in subdirs.OrderBy(d => d, StringComparer.OrdinalIgnoreCase))
        {
            if (IsLink(sub))
                continue;
            ScanFolder(sub, carFolder, prefix + Path.GetFileName(sub) + "/", depth + 1, setups, orphans, problems);
        }
    }

    /// <summary>Reads a setup file without locking it from iRacing, retrying a moment later while it's locked or
    /// still being written (its size changes while it's read). Throws IOException with a reason when it can't: too
    /// large, still changing, locked, or an online-only OneDrive file that couldn't be downloaded.</summary>
    public static async Task<SetupFileContent> ReadAsync(string path, CancellationToken ct, int attempts = 4)
    {
        Exception? last = null;
        for (var attempt = 1; attempt <= attempts; attempt++)
        {
            try
            {
                var before = new FileInfo(path).Length;
                if (before > MaxFileBytes)
                    throw new IOException($"the file is larger than {MaxFileBytes / 1024} KB");
                if (before == 0)
                    throw new IOException("the file is empty (still being written?)");
                byte[] bytes;
                await using (var stream = new FileStream(path, FileMode.Open, FileAccess.Read, FileShare.ReadWrite | FileShare.Delete, 64 * 1024,
                                 FileOptions.Asynchronous | FileOptions.SequentialScan))
                {
                    using var buffer = new MemoryStream();
                    await stream.CopyToAsync(buffer, ct);
                    bytes = buffer.ToArray();
                }
                var after = new FileInfo(path).Length;
                if (bytes.Length != before || after != before)
                    throw new IOException("the file changed while it was read");
                return new SetupFileContent(Path.GetFileName(path), bytes, Sha256(bytes));
            }
            catch (FileNotFoundException)
            {
                throw;
            }
            catch (IOException e) when (attempt < attempts && !e.Message.StartsWith("the file is larger", StringComparison.Ordinal))
            {
                last = e;
                await Task.Delay(TimeSpan.FromMilliseconds(400 * attempt), ct);
            }
            catch (UnauthorizedAccessException e)
            {
                throw new IOException($"no permission to read it ({e.Message})", e);
            }
        }
        throw last as IOException ?? new IOException("the file couldn't be read");
    }

    public static string Sha256(byte[] bytes) => Convert.ToHexStringLower(SHA256.HashData(bytes));
}
