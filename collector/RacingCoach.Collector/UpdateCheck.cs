using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json.Serialization;

namespace RacingCoach.Collector;

/// <summary>
/// Looks for a newer collector on GitHub Releases, where the release workflow
/// (.github/workflows/collector-release.yml) publishes each collector-v* tag. SelfUpdater downloads and
/// installs the release's exe; the release page is the fallback.
/// </summary>
internal static class UpdateCheck
{
    public const string ReleasesPage = "https://github.com/darinlutz/racingcoach/releases/latest";
    private const string LatestReleaseApi = "https://api.github.com/repos/darinlutz/racingcoach/releases/latest";
    private const string TagPrefix = "collector-v";
    // The file the release workflow attaches to each release
    private const string AssetName = "RacingCoach.Collector.exe";

    /// <summary>This build's version, e.g. 1.1.0.</summary>
    public static Version Current { get; } =
        Assembly.GetExecutingAssembly().GetName().Version is { } v ? new Version(v.Major, v.Minor, Math.Max(v.Build, 0)) : new Version(0, 0, 0);

    /// <summary>The newer release, or null if this is the latest (or GitHub can't be reached).</summary>
    public static async Task<AvailableUpdate?> FindNewerAsync()
    {
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(10) };
            // GitHub's API refuses requests without a User-Agent
            http.DefaultRequestHeaders.UserAgent.Add(new ProductInfoHeaderValue("RacingCoach-Collector", Current.ToString()));
            var release = await http.GetFromJsonAsync<Release>(LatestReleaseApi);
            if (release?.TagName is not { } tag || !tag.StartsWith(TagPrefix, StringComparison.Ordinal)
                || !Version.TryParse(tag[TagPrefix.Length..], out var latest))
                return null;
            if (latest <= Current)
                return null;
            var exe = release.Assets?.FirstOrDefault(a => a.Name == AssetName && a.Size > 0 && a.DownloadUrl is not null);
            return new AvailableUpdate(latest, release.HtmlUrl ?? ReleasesPage, exe?.DownloadUrl, exe?.Size ?? 0);
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return null; // offline or rate-limited; try again next start
        }
    }

    private sealed record Release(
        [property: JsonPropertyName("tag_name")] string? TagName,
        [property: JsonPropertyName("html_url")] string? HtmlUrl,
        [property: JsonPropertyName("assets")] List<Asset>? Assets);

    private sealed record Asset(
        [property: JsonPropertyName("name")] string? Name,
        [property: JsonPropertyName("size")] long Size,
        [property: JsonPropertyName("browser_download_url")] string? DownloadUrl);
}

/// <summary>A newer collector on GitHub: its release page, and its exe (DownloadUrl is null if the release
/// has none, then only the release page is offered).</summary>
internal sealed record AvailableUpdate(Version Version, string PageUrl, string? DownloadUrl, long Size);
