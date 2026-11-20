using System.Net.Http;
using System.Text.RegularExpressions;
using RacingCoach.Collector.Setups;

namespace RacingCoach.Collector;

/// <summary>
/// Get Car Setups (CarSetupsWindow; docs/setups.md's iRacing setup collection): copies iRacing's setup files from this
/// PC's setups folder to the RacingCoach.app iRacing Setups library, for Admins only. Finds the folder
/// (SetupFolderScanner), reads each setup's .sto and .htm (never changing them), lists them with their SHA-256 hashes
/// (POST /api/collector/car-setups/plan), sends only the new and changed ones, then ends the import with what failed.
/// The site checks the Admin role, the files' hashes, names and sizes and the car itself; nothing here is trusted.
/// Only ever run by the button: no background or scheduled scans. Progress is reported as Loc keys, so the window shows
/// it in the user's language and the activity log in English.
/// </summary>
internal sealed class CarSetupImporter(RacingCoachApi api, Action<string, object?[], bool> report)
{
    /// <summary>The proof of concept's cars: only these car folders are scanned, until every car is imported.
    /// Nothing else here knows which car it is.</summary>
    public static readonly IReadOnlyList<string> PocCarFolders = ["ferrari296gt3"];

    public sealed record Summary(int Processed, int New, int Changed, int Unchanged, int Failed);

    // What the site accepts (cleanCarFolder, cleanSetupPath in src/lib/carSetupLibraryRules.ts), so one odd name fails
    // only its own setup, never the whole list
    private static readonly Regex CarFolderName = new(@"^[A-Za-z0-9][A-Za-z0-9 _.-]{0,79}$");
    private static readonly Regex PathPart = new(@"^[^\\/:*?""<>|\x00-\x1f]{1,100}$");

    private static bool Acceptable(ScannedSetup setup) =>
        CarFolderName.IsMatch(setup.CarFolder) && setup.SetupPath.Length <= 200 && setup.SetupPath.Split('/').Length <= 4 &&
        setup.SetupPath.Split('/').All(p => PathPart.IsMatch(p) && p.Trim() == p && p is not "." and not ".." && !p.EndsWith('.'));

    private void Say(string key, params object?[] args) => report(key, args, false);
    private void Error(string key, params object?[] args) => report(key, args, true);

    public async Task<Summary?> RunAsync(IReadOnlyList<string> carFolders, CancellationToken ct)
    {
        Say("setups.scanning");
        var roots = SetupFolderScanner.CandidateRoots(
            Environment.GetFolderPath(Environment.SpecialFolder.UserProfile),
            Environment.GetEnvironmentVariable("OneDrive"),
            Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments));
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
        foreach (var missing in carFolders.Where(f => !scan.CarFolders.Contains(f, StringComparer.OrdinalIgnoreCase)))
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
            return new Summary(0, 0, 0, 0, 0);
        }

        // Every file read first, so what's listed is exactly what's sent
        var failures = new List<CarSetupProblem>();
        var ready = new List<(ScannedSetup Setup, CarSetupListing Listing, byte[] Sto, byte[]? Htm)>();
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
                ready.Add((setup,
                    new CarSetupListing(setup.SetupPath, sto.FileName, sto.Sha256, sto.Bytes.Length, htm?.FileName, htm?.Sha256, htm?.Bytes.Length),
                    sto.Bytes, htm?.Bytes));
            }
            catch (IOException e)
            {
                failures.Add(new CarSetupProblem($"{setup.CarFolder}/{setup.SetupPath}", $"couldn't read the file: {e.Message}"));
            }
        }

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
        foreach (var car in plan.Cars.Where(c => !c.Resolved))
            Error("setups.unresolved", car.Folder);

        Say("setups.uploading");
        int added = 0, changed = 0, unchanged = 0, index = 0;
        var total = scan.Setups.Count;
        // The setups that couldn't be read or named are counted and shown first
        foreach (var failure in failures)
            Error("setups.itemFailed", ++index, total, failure.Path, failure.Error);
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
                    uploadFailures.Add(new CarSetupProblem($"{setup.CarFolder}/{name}", "the car folder isn't a Car Data car"));
                    Error("setups.itemFailed", index, total, name, Loc.T(Loc.English, "setups.notCarData"));
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
                Say(stored.HtmStatus == "missing" ? "setups.itemCompleteNoHtm" : "setups.itemComplete", index, total, name);
            }
            catch (CarSetupRequestException e)
            {
                uploadFailures.Add(new CarSetupProblem($"{setup.CarFolder}/{name}", e.Message));
                Error("setups.itemFailed", index, total, name, e.Message);
                if (e.Code == "adminOnly")
                    break;
            }
            catch (Exception e) when (e is HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
            {
                uploadFailures.Add(new CarSetupProblem($"{setup.CarFolder}/{name}", e.Message));
                Error("setups.itemFailed", index, total, name, e.Message);
            }
        }

        var failed = failures.Count + uploadFailures.Count;
        try
        {
            // The read failures went with the plan already
            await api.FinishCarSetupImportAsync(plan.ImportId, uploadFailures, ct);
        }
        catch (Exception e) when (e is CarSetupRequestException or HttpRequestException or TaskCanceledException && !ct.IsCancellationRequested)
        {
            Error("setups.finishFailed", e.Message);
        }
        Say("setups.importComplete");
        Say("setups.summaryProcessed", total);
        Say("setups.summaryNew", added);
        if (changed > 0)
            Say("setups.summaryChanged", changed);
        Say("setups.summaryUnchanged", unchanged);
        report("setups.summaryFailed", [failed], failed > 0);
        return new Summary(total, added, changed, unchanged, failed);
    }

    // The Windows user folder as %USERPROFILE%, like the activity log, so paths shown or logged don't carry the name
    private static string Shorten(string path)
    {
        var profile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        return profile.Length > 0 && path.StartsWith(profile, StringComparison.OrdinalIgnoreCase) ? "%USERPROFILE%" + path[profile.Length..] : path;
    }
}
