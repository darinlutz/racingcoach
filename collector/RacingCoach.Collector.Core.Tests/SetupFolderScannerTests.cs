using RacingCoach.Collector.Setups;

namespace RacingCoach.Collector.Core.Tests;

public sealed class SetupFolderScannerTests : IDisposable
{
    private readonly string _root = Path.Combine(Path.GetTempPath(), "rc-setups-" + Guid.NewGuid().ToString("N"));

    public SetupFolderScannerTests() => Directory.CreateDirectory(_root);

    public void Dispose()
    {
        try
        {
            Directory.Delete(_root, true);
        }
        catch (IOException)
        {
        }
    }

    private string Write(string relative, string text)
    {
        var path = Path.Combine(_root, relative);
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        File.WriteAllText(path, text);
        return path;
    }

    [Fact]
    public void Pairs_sto_and_htm_by_name_case_aside_and_keeps_setups_without_an_htm()
    {
        Write("ferrari296gt3/baseline.sto", "a");
        Write("ferrari296gt3/Baseline.HTM", "b");
        Write("ferrari296gt3/fixed.sto", "c");
        Write("ferrari296gt3/fixed.htm", "d");
        Write("ferrari296gt3/nohtm.sto", "e");
        Write("ferrari296gt3/orphan.htm", "f");
        Write("ferrari296gt3/readme.txt", "g");
        Write("ferrari296gt3/Season 4/race.sto", "h");
        Write("ferrari296gt3/Season 4/race.htm", "i");
        Write("bmwm4gt3/other.sto", "j");

        var scan = SetupFolderScanner.Scan(_root, ["FERRARI296GT3"]);

        Assert.Equal(["ferrari296gt3"], scan.CarFolders);
        Assert.Equal(["baseline", "fixed", "nohtm", "Season 4/race"], scan.Setups.Select(s => s.SetupPath));
        Assert.EndsWith("Baseline.HTM", scan.Setups[0].HtmPath);
        Assert.Null(scan.Setups[2].HtmPath);
        Assert.EndsWith("race.htm", scan.Setups[3].HtmPath);
        Assert.All(scan.Setups, s => Assert.Equal("ferrari296gt3", s.CarFolder));
        Assert.Single(scan.HtmWithoutSto);
        Assert.Empty(scan.Problems);
    }

    [Fact]
    public void Without_a_filter_every_car_folder_is_scanned()
    {
        Write("ferrari296gt3/a.sto", "a");
        Write("bmwm4gt3/b.sto", "b");
        var scan = SetupFolderScanner.Scan(_root, null);
        Assert.Equal(["bmwm4gt3", "ferrari296gt3"], scan.CarFolders);
        Assert.Equal(2, scan.Setups.Count);
    }

    [Fact]
    public async Task Reads_the_exact_bytes_with_their_hash_and_leaves_the_file_alone()
    {
        var path = Write("ferrari296gt3/baseline.sto", "setup bytes");
        var before = File.GetLastWriteTimeUtc(path);
        // iRacing may have the file open: reading shares it
        await using var open = new FileStream(path, FileMode.Open, FileAccess.ReadWrite, FileShare.ReadWrite);
        var content = await SetupFolderScanner.ReadAsync(path, CancellationToken.None);
        Assert.Equal("setup bytes"u8.ToArray(), content.Bytes);
        Assert.Equal("baseline.sto", content.FileName);
        // SHA-256 of "setup bytes"
        Assert.Equal(SetupFolderScanner.Sha256("setup bytes"u8.ToArray()), content.Sha256);
        Assert.Equal(64, content.Sha256.Length);
        Assert.Equal(before, File.GetLastWriteTimeUtc(path));
    }

    [Fact]
    public async Task Refuses_empty_and_oversized_files()
    {
        var empty = Write("ferrari296gt3/empty.sto", "");
        await Assert.ThrowsAsync<IOException>(() => SetupFolderScanner.ReadAsync(empty, CancellationToken.None, attempts: 1));
        var big = Path.Combine(_root, "ferrari296gt3", "big.sto");
        await File.WriteAllBytesAsync(big, new byte[SetupFolderScanner.MaxFileBytes + 1]);
        var e = await Assert.ThrowsAsync<IOException>(() => SetupFolderScanner.ReadAsync(big, CancellationToken.None));
        Assert.Contains("larger", e.Message);
    }

    [Fact]
    public void Candidate_roots_put_OneDrive_first_then_the_Documents_known_folder()
    {
        var profile = Path.Combine(_root, "user");
        var roots = SetupFolderScanner.CandidateRoots(profile, null, Path.Combine(profile, "Documents"));
        Assert.Equal(Path.Combine(profile, "OneDrive", "Documents", "iRacing", "setups"), roots[0]);
        Assert.Equal(Path.Combine(profile, "Documents", "iRacing", "setups"), roots[1]);
        Assert.Equal(2, roots.Count);
        Assert.Null(SetupFolderScanner.FindRoot(roots));
        Directory.CreateDirectory(roots[1]);
        Assert.Equal(roots[1], SetupFolderScanner.FindRoot(roots));
    }
}
