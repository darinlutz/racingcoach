using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Reflection;
using System.Text.Json.Serialization;

namespace RacingCoach.Collector;

/// <summary>
/// Looks for a newer collector on GitHub Releases, where the release workflow
/// (.github/workflows/collector-release.yml) publishes each collector-v* tag. Only tells the user; the
/// window links to the download.
/// </summary>
internal static class UpdateCheck
{
    public const string ReleasesPage = "https://github.com/darinlutz/racingcoach/releases/latest";
    private const string LatestReleaseApi = "https://api.github.com/repos/darinlutz/racingcoach/releases/latest";
    private const string TagPrefix = "collector-v";

    /// <summary>This build's version, e.g. 1.1.0.</summary>
    public static Version Current { get; } =
        Assembly.GetExecutingAssembly().GetName().Version is { } v ? new Version(v.Major, v.Minor, Math.Max(v.Build, 0)) : new Version(0, 0, 0);

    /// <summary>The newer version and its release page, or null if this is the latest (or GitHub can't be reached).</summary>
    public static async Task<(Version Version, string Url)?> FindNewerAsync()
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
            return latest > Current ? (latest, release.HtmlUrl ?? ReleasesPage) : null;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException or System.Text.Json.JsonException)
        {
            return null; // offline or rate-limited; try again next start
        }
    }

    private sealed record Release([property: JsonPropertyName("tag_name")] string? TagName, [property: JsonPropertyName("html_url")] string? HtmlUrl);
}
