namespace RacingCoach.Collector;

internal enum KeyStatus
{
    /// <summary>RacingCoach.app accepts the key.</summary>
    Accepted,
    /// <summary>RacingCoach.app doesn't know the key (revoked, replaced or mistyped).</summary>
    Refused,
    /// <summary>RacingCoach.app couldn't be reached; the key may well be fine.</summary>
    Unreachable,
}

/// <param name="AccountName">The RacingCoach.app account the key belongs to, when Accepted.</param>
/// <param name="Problem">Why the site couldn't be reached, when Unreachable.</param>
internal sealed record KeyCheck(KeyStatus Status, string? AccountName = null, string? Problem = null);

/// <summary>
/// Checks upload keys (from the Account page) with RacingCoach.app. The window asks for the key the first
/// time, or when RacingCoach.app stops accepting the saved one.
/// </summary>
internal static class UploadSetup
{
    private static readonly TimeSpan CheckTimeout = TimeSpan.FromSeconds(15);

    public static async Task<KeyCheck> CheckAsync(string siteUrl, string key)
    {
        using var api = new RacingCoachApi(siteUrl, key);
        using var timeout = new CancellationTokenSource(CheckTimeout);
        try
        {
            var name = await api.CheckKeyAsync(timeout.Token);
            return name is null ? new KeyCheck(KeyStatus.Refused) : new KeyCheck(KeyStatus.Accepted, name);
        }
        catch (HttpRequestException e)
        {
            return new KeyCheck(KeyStatus.Unreachable, Problem: e.Message);
        }
        catch (TaskCanceledException)
        {
            return new KeyCheck(KeyStatus.Unreachable, Problem: "it took too long to answer");
        }
    }
}
