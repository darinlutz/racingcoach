using System.Net.Http;
using System.Text;
using System.Text.RegularExpressions;
using RacingCoach.Collector.Setups;

namespace RacingCoach.Collector;

/// <summary>
/// Get Car Setups (CarSetupsWindow) and the automatic sync (CarSetupSync; docs/setups.md's iRacing setup collection):
/// copies iRacing's setup files from this PC's setups folder to the RacingCoach.app iRacing Setups library, for Admins
/// only. Finds the folder (SetupFolderScanner), reads every car folder's .sto and .htm files (never changing them),
/// lists them with their SHA-256 hashes (POST /api/collector/car-setups/plan), sends only the new and changed ones, then
/// ends the import with what failed. A setups folder with more than SetupsPerImport setups is sent as several imports.
/// The site checks the Admin role, the files' hashes, names and sizes and the car itself; nothing here is trusted.
/// One run at a time on this PC. Progress is reported as Loc keys, so the window shows it in the user's language and
/// the activity log in English; a quiet run (CarSetupSync) reports only problems and, when something was imported or
/// failed, the summary.
/// </summary>
internal sealed class CarSetupImporter(RacingCoachApi api, Action<string, object?[], bool> report, bool quiet = false)
{
    /// <summary>Setups one import lists (CAR_SETUP_LIMITS.setupsPerImport in src/lib/carSetupLibraryRules.ts).</summary>
    public const int SetupsPerImport = 1000;

    private static readonly SemaphoreSlim OneAtATime = new(1, 1);

    /// <summary>Skipped: setups of car folders that aren't Car Data cars (said once per folder, not failures).</summary>
    public sealed record Summary(int Processed, int New, int Changed, int Unchanged, int Skipped, int Failed);

    // What the site accepts (cleanCarFolder, cleanSetupPath in src/lib/carSetupLibraryRules.ts), so one odd name fails
    // only its own setup, never the whole list
    private static readonly Regex CarFolderName = new(@"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$");
    private static readonly Regex PathPart = new(@"^[^\\/:*?""<>|\x00-\x1f]{1,100}$");

    private static bool Acceptable(ScannedSetup setup) =>
        CarFolderName.IsMatch(setup.CarFolder) && setup.SetupPath.Length <= 200 && setup.SetupPath.Split('/').Length <= 4 &&
        setup.SetupPath.Split('/').All(p => PathPart.IsMatch(p) && p.Trim() == p && p is not "." and not ".." && !p.EndsWith('.'));

    /// <summary>Where iRacing's setups folder is on this PC, or null.</summary>
    public static string? FindSetupsRoot() => SetupFolderScanner.FindRoot(CandidateRoots());

    private static IReadOnlyList<string> CandidateRoots() => SetupFolderScanner.CandidateRoots(
        Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
        Environment.GetEnvironmentVariable("OneDrive"),
        Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));

    /// <summary>A cheap fingerprint of the setups folder's setups (paths, sizes and times written; no file is read),
    /// so CarSetupSync imports only when something changed. Null when there's no setups folder.</summary>
    public static string? Fingerprint(string? root)
    {
        if (root is null || !Directory.Exists(root))
            return null;
        var scan = SetupFolderScanner.Scan(root, null);
        var text = new StringBuilder();
        foreach (var setup in scan.Setups)
            foreach (var path in new[] { setup.StoPath, setup.HtmPath })
            {
                if (path is null)
                    continue;
                try
                {
                    var info = new FileInfo(path);
                    text.Append(path).Append('|').Append(info.Length).Append('|').Append(info.LastWriteTimeUtc.Ticks).Append('\n');
                }
                catch (Exception e) when (e is IOException or UnauthorizedAccessException)
                {
                    text.Append(path).Append("|?\n");
                }
            }
        return SetupFolderScanner.Sha256(Encoding.UTF8.GetBytes(text.ToString()));
    }

    private void Say(string key, params object?[] args)
    {
        if (!quiet)
            report(key, args, false);
    }

    private void Error(string key, params object?[] args) => report(key, args, true);

    /// <summary>Imports every car folder's setups (only carFolders', when given). Waits while another run is going.</summary>
    public async Task<Summary?> RunAsync(IReadOnlyList<string>? carFolders, CancellationToken ct)
    {
        await OneAtATime.WaitAsync(ct);
        try
        {
            return await RunOnceAsync(carFolders, ct);
        }
        finally
        {
            OneAtATime.Release();
        }
    }

    private async Task<Summary?> RunOnceAsync(IReadOnlyList<string>? carFolders, CancellationToken ct)
    {
        Say("setups.scanning");
        var roots = CandidateRoots();
        var root = SetupFolderScanner.FindRoot(roots);
        if (root is null)
        {
            Error("setups.noFolder", string.Join("; ", roots.Select(Shorten)));
            return null;
        }
        Say("setups.folder", Shorten(root));
        var scan = await Task.Run(() => SetupFolderScanner.Scan(root, carFolders), ct);
        foreach (var (path, error) in scan.Problems)
            Error("setups.listFailed", Shorten(path), error);
        foreach (var missing in (carFolders ?? []).Where(f => !scan.CarFolders.Contains(f, StringComparer.OrdinalIgnoreCase)))
            Error("setups.noCarFolder", missing);
        foreach (var car in scan.CarFolders)
            Say("setups.scanningCar", car);
        Say("setups.foundSetups", scan.Setups.Count);
        Say("setups.foundSto", scan.Setups.Count);
        Say("setups.foundHtm", scan.Setups.Count(s => s.HtmPath is not null));
        if (scan.HtmWithoutSto.Count > 0)
            Say("setups.htmWithoutSto", scan.HtmWithoutSto.Count);
        if (scan.Setups.Count == 0)
        {
            Say("setups.importComplete");
            return new Summary(0, 0, 0, 0, 0, 0);
        }

        // Every file read first, so what's listed is exactly what's sent
        var failures = new List<CarSetupProblem>();
        var ready = new List<ReadSetup>();
        foreach (var setup in scan.Setups)
        {
            if (!Acceptable(setup))
            {
                failures.Add(new CarSetupProblem($"{setup.CarFolder}/{setup.SetupPath}", "the name has characters RacingCoach.app doesn't accept"));
                continue;
            }
            try
            {
                var sto = await SetupFolderScanner.ReadAsync(setup.StoPath, ct);
                var htm = setup.HtmPath is null ? null : await SetupFolderScanner.ReadAsync(setup.HtmPath, ct);
                ready.Add(new ReadSetup(setup,
                    new CarSetupListing(setup.SetupPath, sto.FileName, sto.Sha256, sto.Bytes.Length, htm?.FileName, htm?.Sha256, htm?.Bytes.Length),
                    sto.Bytes, htm?.Bytes));
            }
            catch (IOException e)
            {
                failures.Add(new CarSetupProblem($"{setup.CarFolder}/{setup.SetupPath}", $"couldn't read the file: {e.Message}"));
            }
        }

        Say("setups.uploading");
        var total = scan.Setups.Count;
        var index = 0;
        // The setups that couldn't be read or named are counted and shown first
        foreach (var failure in failures)
            Error("setups.itemFailed", ++index, total, failure.Path, failure.Error);
        int added = 0, changed = 0, unchanged = 0, skipped = 0, uploadFailures = 0;
        var unresolvedShown = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        // Several imports when there are more setups than one takes; the read failures go with the first
        var batches = ready.Chunk(SetupsPerImport).ToList();
        if (batches.Count == 0)
            batches.Add([]);
        for (var b = 0; b < batches.Count; b++)
        {
            var result = await ImportBatchAsync(batches[b], b == 0 ? failures : [], total, index, unresolvedShown, ct);
            if (result is null)
                return null;
            index += batches[b].Length;
            added += result.Value.Added;
            changed += result.Value.Changed;
            unchanged += result.Value.Unchanged;
            skipped += result.Value.Skipped;
            uploadFailures += result.Value.Failed;
            if (result.Value.Stop)
                break;
        }

        var failed = failures.Count + uploadFailures;
        var summary = new Summary(total, added, changed, unchanged, skipped, failed);
        // A quiet run that imported nothing and had no failures says nothing
        if (quiet && added + changed + failed == 0)
            return summary;
        report("setups.importComplete", [], false);
        report("setups.summaryProcessed", [total], false);
        report("setups.summaryNew", [added], false);
        if (changed > 0)
            report("setups.summaryChanged", [changed], false);
        report("setups.summaryUnchanged", [unchanged], false);
        if (skipped > 0)
            report("setups.summarySkipped", [skipped], false);
        report("setups.summaryFailed", [failed], failed > 0);
        return summary;
    }

    private sealed record ReadSetup(ScannedSetup Setup, CarSetupListing Listing, byte[] Sto, byte[]? Htm);

    private readonly record struct BatchResult(int Added, int Changed, int Unchanged, int Skipped, int Failed, bool Stop);

    // One import on the site: plan, the new and changed setups' files, then finish. Null when the plan itself failed
    // (not an Admin, offline), which ends the run
    private async Task<BatchResult?> ImportBatchAsync(ReadSetup[] ready, List<CarSetupProblem> failures, int total, int index,
        HashSet<string> unresolvedShown, CancellationToken ct)
    {
        CarSetupPlan plan;
        try
        {
            var listed = ready.GroupBy(r => r.Setup.CarFolder, StringComparer.OrdinalIgnoreCase)
                .Select(g => new CarSetupCarListing(g.Key, g.Select(r => r.Listing).ToList()))
                .ToList();
            plan = await api.PlanCarSetupImportAsync(UpdateCheck.Current.ToString(), listed, failures, ct);
        }
        catch (CarSetupRequestException e)
        {
            Error(e.Code == "adminOnly" ? "setups.notAdmin" : "setups.failed", e.Message);
            return null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            Error("setups.offline", e.Message);
            return null;
        }
        foreach (var car in plan.Cars.Where(c => !c.Resolved && unresolvedShown.Add(c.Folder)))
            Error("setups.unresolved", car.Folder);

        int added = 0, changed = 0, unchanged = 0, skipped = 0;
        var stop = false;
        var uploadFailures = new List<CarSetupProblem>();
        foreach (var (setup, listing, sto, htm) in ready)
        {
            ct.ThrowIfCancellationRequested();
            index++;
            var name = setup.SetupPath;
            var planned = plan.Setups.FirstOrDefault(p =>
                string.Equals(p.Folder, setup.CarFolder, StringComparison.OrdinalIgnoreCase) &&
                string.Equals(p.Path, listing.Path, StringComparison.OrdinalIgnoreCase));
            switch (planned?.Decision)
            {
                case "unchanged":
                    unchanged++;
                    Say("setups.itemUnchanged", index, total, name);
                    continue;
                case "unresolvedCar":
                    // Said once for the folder above; the site records the folder with the import
                    skipped++;
                    Say("setups.itemSkipped", index, total, $"{setup.CarFolder}/{name}");
                    continue;
                case "new" or "changed":
                    break;
                default:
                    uploadFailures.Add(new CarSetupProblem($"{setup.CarFolder}/{name}", "the site didn't plan it"));
                    Error("setups.itemFailed", index, total, name, "?");
                    continue;
            }
            try
            {
                var stored = await api.UploadCarSetupAsync(plan.ImportId, setup.CarFolder, listing, sto, htm, ct);
                if (stored.Decision == "changed")
                    changed++;
                else if (stored.Decision == "new")
                    added++;
                else
                    unchanged++;
                Say(stored.HtmStatus == "missing" ? "setups.itemCompleteNoHtm" : "setups.itemComplete", index, total, $"{setup.CarFolder}/{name}");
            }
            catch (CarSetupRequestException e)
            {
                uploadFailures.Add(new CarSetupProblem($"{setup.CarFolder}/{name}", e.Message));
                Error("setups.itemFailed", index, total, $"{setup.CarFolder}/{name}", e.Message);
                if (e.Code == "adminOnly")
                {
                    stop = true;
                    break;
                }
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                uploadFailures.Add(new CarSetupProblem($"{setup.CarFolder}/{name}", e.Message));
                Error("setups.itemFailed", index, total, $"{setup.CarFolder}/{name}", e.Message);
            }
        }

        try
        {
            // The read failures went with the plan already
            await api.FinishCarSetupImportAsync(plan.ImportId, uploadFailures, ct);
        }
        catch (Exception e) when (e is CarSetupRequestException or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            Error("setups.finishFailed", e.Message);
        }
        return new BatchResult(added, changed, unchanged, skipped, uploadFailures.Count, stop);
    }

    // The Windows user folder as %USERPROFILE%, like the activity log, so paths shown or logged don't carry the name
    private static string Shorten(string path)
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return profile.Length > 0 && path.StartsWith(profile, StringComparison.OrdinalIgnoreCase) ? "%USERPROFILE%" + path[profile.Length..] : path;
    }
}
