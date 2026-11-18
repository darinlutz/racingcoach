using System.Diagnostics;
using System.Net.Http.Headers;
using System.Reflection;

namespace RacingCoach.Collector;

/// <summary>
/// Replaces the collector's exe with a newer release (UpdateCheck finds it). A running exe can't be
/// overwritten but can be renamed, so installing renames it to RacingCoach.Collector.exe.old and moves the
/// downloaded one into its place; the next start deletes the .old file. Only for the published single-file
/// exe (a dotnet run build has its DLLs beside it and isn't replaced).
/// A collector installed in Program Files (collector/installer) can't write its own folder, so there it
/// downloads the release's installer instead and runs it (Windows asks to allow it); the installer waits
/// for this collector to close.
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

    /// <summary>The exe's folder can't be written without admin rights (Program Files), so updates go
    /// through the installer.</summary>
    public static bool UsesInstaller { get; } = ExePath is not null && !CanWrite(Path.GetDirectoryName(ExePath)!);

    private static bool CanWrite(string folder)
    {
        try
        {
            using var _ = new FileStream(Path.Combine(folder, $".write-test-{Guid.NewGuid():N}"),
                FileMode.CreateNew, FileAccess.Write, FileShare.None, 1, FileOptions.DeleteOnClose);
            return true;
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException)
        {
            return false;
        }
    }

    // The installer goes in the temp folder, as the exe's folder can't be written
    private const string SetupPrefix = "RacingCoach.Collector.Setup-";
    private static string? _setupPath;

    private static string NewPath => ExePath + ".new";
    private static string OldPath => ExePath + ".old";
    private static string PartialPath => ExePath + ".download";

    /// <summary>The downloaded update is waiting to be installed.</summary>
    public static bool Ready { get; private set; }

    /// <summary>Downloads the update next to the exe (as .new), or its installer to the temp folder. Throws
    /// if it can't, or if the file isn't the size GitHub lists, isn't a Windows program, or (when this collector is
    /// signed) isn't signed by the same publisher (<see cref="Authenticode"/>).</summary>
    public static async Task DownloadAsync(AvailableUpdate update, IProgress<double> progress, CancellationToken ct)
    {
        if (ExePath is null || update.DownloadUrl is null)
            throw new InvalidOperationException("this collector can't update itself");

        var partialPath = UsesInstaller ? Path.Combine(Path.GetTempPath(), $"{SetupPrefix}{update.Version}.download") : PartialPath;
        // Off the UI thread: the read loop's continuations and the signature check would otherwise run there,
        // competing with the live telemetry, map and log updates
        await Task.Run(() => DownloadFileAsync(update, partialPath, progress, ct), ct);
        await Task.Run(() => CheckDownload(update, partialPath), ct);
        if (UsesInstaller)
        {
            _setupPath = Path.Combine(Path.GetTempPath(), $"{SetupPrefix}{update.Version}.exe");
            File.Move(partialPath, _setupPath, overwrite: true);
        }
        else
            File.Move(partialPath, NewPath, overwrite: true);
        Ready = true;
    }

    /// <summary>A read that gets no data for this long is given up (HttpClient.Timeout doesn't cover reading
    /// the body), and the download resumes where it stopped.</summary>
    private static readonly TimeSpan StallTimeout = TimeSpan.FromSeconds(30);
    private const int MaxAttempts = 5;

    private static async Task DownloadFileAsync(AvailableUpdate update, string partialPath, IProgress<double> progress, CancellationToken ct)
    {
        using var http = new HttpClient { Timeout = Timeout.InfiniteTimeSpan }; // the stall timeout below instead
        http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("RacingCoach-Collector", UpdateCheck.Current.ToString()));

        await using var output = new FileStream(partialPath, FileMode.Create, FileAccess.Write, FileShare.None);
        var buffer = new byte[81920];
        long total = 0;
        var shownPercent = -1;
        for (var attempt = 1; ; attempt++)
        {
            using var stall = CancellationTokenSource.CreateLinkedTokenSource(ct);
            try
            {
                using var request = new HttpRequestMessage(HttpMethod.Get, update.DownloadUrl);
                if (total > 0)
                    request.Headers.Range = new RangeHeaderValue(total, null);
                stall.CancelAfter(StallTimeout);
                using var response = await http.SendAsync(request, HttpCompletionOption.ResponseHeadersRead, stall.Token);
                response.EnsureSuccessStatusCode();
                if (total > 0 && response.StatusCode != System.Net.HttpStatusCode.PartialContent)
                {
                    // The server sent the whole file again rather than the rest
                    total = 0;
                    output.SetLength(0);
                }

                await using var input = await response.Content.ReadAsStreamAsync(stall.Token);
                while (true)
                {
                    stall.CancelAfter(StallTimeout);
                    var read = await input.ReadAsync(buffer, stall.Token);
                    if (read == 0)
                        break;
                    await output.WriteAsync(buffer.AsMemory(0, read), ct);
                    total += read;
                    // Only when the shown percentage changes, not for every few kilobytes
                    var percent = (int)(Math.Min(1, (double)total / update.Size) * 100);
                    if (percent != shownPercent)
                    {
                        shownPercent = percent;
                        progress.Report(percent / 100.0);
                    }
                }
                if (total >= update.Size)
                    return;
                throw new IOException($"the connection closed after {total:N0} of {update.Size:N0} bytes");
            }
            catch (Exception e) when (!ct.IsCancellationRequested
                && e is HttpRequestException or IOException or OperationCanceledException)
            {
                var reason = e is OperationCanceledException ? $"no data for {StallTimeout.TotalSeconds:0} s" : e.Message;
                if (attempt >= MaxAttempts)
                    throw new IOException(reason, e);
                ActivityLog.Shared.Write($"Downloading the update stalled at {total:N0} of {update.Size:N0} bytes ({reason}); trying again.");
                await Task.Delay(TimeSpan.FromSeconds(2 * attempt), ct);
            }
        }
    }

    private static void CheckDownload(AvailableUpdate update, string partialPath)
    {
        var file = new FileInfo(partialPath);
        if (file.Length != update.Size)
            throw new InvalidDataException($"the download was {file.Length:N0} bytes, expected {update.Size:N0}");
        using (var check = File.OpenRead(partialPath))
        {
            // Every Windows program starts with "MZ"
            if (check.ReadByte() != 'M' || check.ReadByte() != 'Z')
                throw new InvalidDataException("the download isn't a Windows program");
        }
        try
        {
            // Signed by the same publisher as this collector (Clarivex LLC), or it isn't run
            Authenticode.RequireSamePublisher(partialPath);
        }
        catch
        {
            File.Delete(partialPath);
            throw;
        }
    }

    /// <summary>Puts the downloaded exe in place of the running one (it runs from the next start), and starts
    /// it with the same options if <paramref name="restart"/>. On failure the running exe is put back and this
    /// throws. Installed in Program Files, this starts the installer instead, which waits for this collector
    /// to close (and starts the new one if <paramref name="restart"/>); it throws if Windows' permission
    /// prompt is declined.</summary>
    public static void Install(bool restart, IEnumerable<string> args)
    {
        if (ExePath is null || !Ready)
            throw new InvalidOperationException("no update is ready");
        if (UsesInstaller)
        {
            // Verb runas: Windows asks to allow it (the installer needs admin rights for Program Files)
            var setup = new ProcessStartInfo(_setupPath!) { UseShellExecute = true, Verb = "runas" };
            setup.Arguments = "/SILENT /SUPPRESSMSGBOXES /NORESTART /UPDATE=1" + (restart ? " /LAUNCH=1" : "");
            Process.Start(setup);
            Ready = false;
            return;
        }
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
        if (restart)
            StartNewVersion(args);
    }

    /// <summary>Starts the (just installed) exe with the same options, waiting for this one to close.</summary>
    private static void StartNewVersion(IEnumerable<string> args)
    {
        if (ExePath is null)
            return;
        var start = new ProcessStartInfo(ExePath) { UseShellExecute = false };
        foreach (var arg in args.Where(a => a != AfterUpdateArg))
            start.ArgumentList.Add(arg);
        start.ArgumentList.Add(AfterUpdateArg);
        Process.Start(start);
    }

    /// <summary>Deletes what an earlier update left behind (the previous exe, a half-finished download, an
    /// installer).</summary>
    public static void CleanUp()
    {
        if (ExePath is null)
            return;
        IEnumerable<string> leftovers = UsesInstaller
            ? Directory.EnumerateFiles(Path.GetTempPath(), SetupPrefix + "*")
            : [OldPath, PartialPath, NewPath];
        foreach (var leftover in leftovers)
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
