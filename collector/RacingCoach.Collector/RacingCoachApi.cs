using System.IO.Compression;
using System.Net;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;

namespace RacingCoach.Collector;

/// <summary>The session details sent with every lap of a session folder.</summary>
internal sealed record SessionInfo(string Track, string Car, string Driver, int SessionId, int SubSessionId);

internal enum UploadOutcome
{
    /// <summary>RacingCoach.app has the lap (just now, or from an earlier attempt).</summary>
    Uploaded,
    /// <summary>RacingCoach.app refused the lap itself; sending it again won't help.</summary>
    Rejected,
    /// <summary>RacingCoach.app doesn't accept the upload key.</summary>
    Unauthorized,
    /// <summary>No connection, a timeout or a server error; try again later.</summary>
    RetryLater,
}

/// <summary>
/// Talks to RacingCoach.app's collector API (src/app/api/collector in the website), authenticated with
/// the user's upload key from the Account page.
/// </summary>
internal sealed class RacingCoachApi(string siteUrl, string uploadKey) : IDisposable
{
    private static readonly JsonSerializerOptions JsonOptions = new() { PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    private readonly HttpClient _http = new()
    {
        BaseAddress = new Uri(siteUrl.TrimEnd('/') + "/"),
        Timeout = TimeSpan.FromSeconds(60),
        DefaultRequestHeaders = { Authorization = new AuthenticationHeaderValue("Bearer", uploadKey) },
    };

    public string SiteUrl { get; } = siteUrl.TrimEnd('/');

    /// <summary>The account name the key belongs to, or null if RacingCoach.app doesn't accept it.
    /// Throws HttpRequestException or TaskCanceledException if the site can't be reached.</summary>
    public async Task<string?> CheckKeyAsync(CancellationToken ct)
    {
        using var response = await _http.GetAsync("api/collector/me", ct);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            return null;
        response.EnsureSuccessStatusCode();
        var body = await response.Content.ReadFromJsonAsync<MeResponse>(JsonOptions, ct);
        return body?.UserName ?? "your account";
    }

    /// <summary>Uploads one lap: its details as JSON and its CSV, gzip-compressed.</summary>
    public async Task<(UploadOutcome Outcome, string Message)> UploadLapAsync(string csvPath, SessionInfo session, ManifestLap lap, CancellationToken ct)
    {
        byte[] csvGzip;
        try
        {
            csvGzip = await CompressAsync(csvPath, ct);
        }
        catch (Exception e) when (e is FileNotFoundException or DirectoryNotFoundException)
        {
            return (UploadOutcome.Rejected, "the lap's CSV file is missing");
        }

        var details = new
        {
            clientLapId = lap.ClientLapId,
            session.Track,
            session.Car,
            session.Driver,
            session.SessionId,
            session.SubSessionId,
            lap.SessionNum,
            lap.SessionType,
            lap.LapNumber,
            lap.LapTimeSeconds,
            lap.Samples,
            lap.MissingSamples,
            lap.Incidents,
            lap.PitRoad,
            lap.OffTrack,
            lap.RecordedAt,
        };

        using var form = new MultipartFormDataContent
        {
            { new StringContent(JsonSerializer.Serialize(details, JsonOptions), Encoding.UTF8, "application/json"), "lap" },
        };
        var csvContent = new ByteArrayContent(csvGzip);
        csvContent.Headers.ContentType = new MediaTypeHeaderValue("application/gzip");
        form.Add(csvContent, "csv", "lap.csv.gz");

        try
        {
            using var response = await _http.PostAsync("api/collector/laps", form, ct);
            if (response.IsSuccessStatusCode)
                return (UploadOutcome.Uploaded, "");
            var message = await ErrorMessageAsync(response, ct);
            return (int)response.StatusCode switch
            {
                401 => (UploadOutcome.Unauthorized, message),
                400 or 413 or 422 => (UploadOutcome.Rejected, message),
                _ => (UploadOutcome.RetryLater, message),
            };
        }
        catch (HttpRequestException e)
        {
            return (UploadOutcome.RetryLater, e.Message);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return (UploadOutcome.RetryLater, "the request timed out");
        }
    }

    private static async Task<byte[]> CompressAsync(string path, CancellationToken ct)
    {
        await using var input = File.OpenRead(path);
        using var output = new MemoryStream();
        await using (var gzip = new GZipStream(output, CompressionLevel.Optimal, leaveOpen: true))
            await input.CopyToAsync(gzip, ct);
        return output.ToArray();
    }

    private static async Task<string> ErrorMessageAsync(HttpResponseMessage response, CancellationToken ct)
    {
        try
        {
            var body = await response.Content.ReadFromJsonAsync<ErrorResponse>(JsonOptions, ct);
            if (!string.IsNullOrWhiteSpace(body?.Error))
                return body.Error;
        }
        catch (Exception e) when (e is JsonException or NotSupportedException)
        {
            // not JSON (e.g. a proxy's error page)
        }
        return $"HTTP {(int)response.StatusCode}";
    }

    public void Dispose() => _http.Dispose();

    private sealed record MeResponse(string? UserName);

    private sealed record ErrorResponse(string? Error);
}
