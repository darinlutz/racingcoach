namespace RacingCoach.Collector;

/// <summary>
/// Connects the collector to the user's RacingCoach.app account at startup: asks for an upload key
/// (from the Account page) the first time, or when the saved one stops working, and checks it with
/// the site. Runs before the live display starts, so it uses the console directly.
/// </summary>
internal static class UploadSetup
{
    private static readonly TimeSpan CheckTimeout = TimeSpan.FromSeconds(15);

    /// <summary>A client for uploading, or null if the user chose not to enter a key.</summary>
    public static async Task<RacingCoachApi?> ConnectAsync(string? siteUrlOverride, bool askForNewKey)
    {
        var settings = CollectorSettings.Load();
        var siteUrl = (siteUrlOverride ?? settings.SiteUrl).TrimEnd('/');
        var key = askForNewKey ? null : settings.GetUploadKey();

        if (key is not null)
        {
            var api = new RacingCoachApi(siteUrl, key);
            switch (await CheckAsync(api))
            {
                case (true, var name):
                    Console.WriteLine($"Uploading laps to {name}'s account on {siteUrl}.");
                    return api;
                case (false, var problem) when problem is not null:
                    Console.WriteLine($"Could not reach {siteUrl} to check your upload key ({problem}). Laps will upload when it's reachable.");
                    return api;
                default:
                    api.Dispose();
                    Console.WriteLine("RacingCoach.app no longer accepts your saved upload key.");
                    break;
            }
        }

        key = await AskForKeyAsync(siteUrl);
        if (key is null)
        {
            Console.WriteLine("Laps will only be saved on this PC. Run RacingCoach.Collector.exe --set-key to add your key later.");
            return null;
        }
        settings.SetUploadKey(key);
        settings.Save();
        return new RacingCoachApi(siteUrl, key);
    }

    private static async Task<string?> AskForKeyAsync(string siteUrl)
    {
        Console.WriteLine($"To upload your laps, create an upload key on your Account page ({siteUrl}/account) and paste it here.");
        while (true)
        {
            Console.Write("Upload key (or press Enter to skip): ");
            // Piped input can start with a byte order mark, which Trim() keeps
            var key = Console.ReadLine()?.Trim().Trim('﻿');
            if (string.IsNullOrEmpty(key))
                return null;
            if (!CollectorSettings.LooksLikeUploadKey(key))
            {
                Console.WriteLine("That isn't an upload key. Keys start with rck_ and are 47 characters long.");
                continue;
            }

            using var api = new RacingCoachApi(siteUrl, key);
            switch (await CheckAsync(api))
            {
                case (true, var name):
                    Console.WriteLine($"Key accepted. Uploading laps to {name}'s account.");
                    return key;
                case (false, var problem) when problem is not null:
                    Console.WriteLine($"Could not reach {siteUrl} to check the key ({problem}). Saved it anyway; laps will upload when it's reachable.");
                    return key;
                default:
                    Console.WriteLine("RacingCoach.app doesn't recognise that key. Check you copied all of it, or create a new one.");
                    break;
            }
        }
    }

    /// <summary>(true, account name) if the key works; (false, null) if the site refuses it;
    /// (false, problem) if the site couldn't be reached.</summary>
    private static async Task<(bool Ok, string? Detail)> CheckAsync(RacingCoachApi api)
    {
        using var timeout = new CancellationTokenSource(CheckTimeout);
        try
        {
            var name = await api.CheckKeyAsync(timeout.Token);
            return name is null ? (false, null) : (true, name);
        }
        catch (HttpRequestException e)
        {
            return (false, e.Message);
        }
        catch (TaskCanceledException)
        {
            return (false, "it took too long to answer");
        }
    }
}
