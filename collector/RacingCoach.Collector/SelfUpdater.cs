using System.Diagnostics;
using System.Net.Http.Headers;
using System.Reflection;

namespace RacingCoach.Collector;

/// <summary>
/// Replaces the collector's exe with a newer release (UpdateCheck finds it). A running exe can't be
/// overwritten but can be renamed, so installing renames it to RacingCoach.Collector.exe.old and moves the
/// downloaded one into its place; the next start deletes the .old file. Only for the published single-file
/// exe (a dotnet run build has its DLLs beside it and isn't replaced).
/// </summary>
internal static class SelfUpdater
{
    /// <summary>Given to a collector started by Restart Now, so it waits for the old one to close instead of
    /// stopping as a second copy (Program.Main).</summary>
    public const string AfterUpdateArg = "--after-update";

    /// <summary>The running exe, or null when this build can't update itself.</summary>
    // A single-file app's assemblies have no file of their own, so Location is empty
    private static readonly string? ExePath =
        string.IsNullOrEmpty(Assembly.GetExecutingAssembly().Location) ? Environment.ProcessPath : null;

    public static bool CanUpdate => ExePath is not null;

    private static string NewPath => ExePath + ".new";
    private static string OldPath => ExePath + ".old";
    private static string PartialPath => ExePath + ".download";

    /// <summary>The downloaded update is waiting to be installed.</summary>
    public static bool Ready { get; private set; }

    /// <summary>Downloads the update next to the exe (as .new). Throws if it can't, or if the file isn't
    /// the size GitHub lists or isn't a Windows program.</summary>
    public static async Task DownloadAsync(AvailableUpdate update, IProgress<double> progress, CancellationToken ct)
    {
        if (ExePath is null || update.DownloadUrl is null)
            throw new InvalidOperationException("this collector can't update itself");

        using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(15) };
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("RacingCoach-Collector", UpdateCheck.Current.ToString()));
        using var response = await http.GetAsync(update.DownloadUrl, HttpCompletionOption.ResponseHeadersRead, ct);
        response.EnsureSuccessStatusCode();

        await using (var input = await response.Content.ReadAsStreamAsync(ct))
        await using (var output = new FileStream(PartialPath, FileMode.Create, FileAccess.Write, FileShare.None))
        {
            var buffer = new byte[81920];
            long total = 0;
            int read;
            while ((read = await input.ReadAsync(buffer, ct)) > 0)
            {
                await output.WriteAsync(buffer.AsMemory(0, read), ct);
                total += read;
                progress.Report(Math.Min(1, (double)total / update.Size));
            }
        }

        var file = new FileInfo(PartialPath);
        if (file.Length != update.Size)
            throw new InvalidDataException($"the download was {file.Length:N0} bytes, expected {update.Size:N0}");
        await using (var check = File.OpenRead(PartialPath))
        {
            // Every Windows program starts with "MZ"
            if (check.ReadByte() != 'M' || check.ReadByte() != 'Z')
                throw new InvalidDataException("the download isn't a Windows program");
        }
        File.Move(PartialPath, NewPath, overwrite: true);
        Ready = true;
    }

    /// <summary>Puts the downloaded exe in place of the running one (it runs from the next start). On failure
    /// the running exe is put back and this throws.</summary>
    public static void Install()
    {
        if (ExePath is null || !Ready)
            throw new InvalidOperationException("no update is ready");
        File.Move(ExePath, OldPath, overwrite: true);
        try
        {
            File.Move(NewPath, ExePath);
        }
        catch
        {
            File.Move(OldPath, ExePath);
            throw;
        }
        Ready = false;
    }

    /// <summary>Starts the (just installed) exe with the same options, waiting for this one to close.</summary>
    public static void StartNewVersion(IEnumerable<string> args)
    {
        if (ExePath is null)
            return;
        var start = new ProcessStartInfo(ExePath) { UseShellExecute = false };
        foreach (var arg in args.Where(a => a != AfterUpdateArg))
            start.ArgumentList.Add(arg);
        start.ArgumentList.Add(AfterUpdateArg);
        Process.Start(start);
    }

    /// <summary>Deletes what an earlier update left behind (the previous exe, a half-finished download).</summary>
    public static void CleanUp()
    {
        if (ExePath is null)
            return;
        foreach (var leftover in new[] { OldPath, PartialPath, NewPath })
        {
            try
            {
                File.Delete(leftover);
            }
            catch (Exception e) when (e is IOException or UnauthorizedAccessException)
            {
                // still in use (the old collector hasn't quite exited); tried again next start
            }
        }
    }
}
