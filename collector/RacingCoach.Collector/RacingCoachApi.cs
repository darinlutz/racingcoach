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

    /// <summary>The user's Track Data track for an iRacing track name, as the JSON TelemetryEngine.js reads from
    /// its TrackConfig (TrackFileName, TrackLengthInFeet, Notes and areas), or null if they have no such track;
    /// and whether their Preferred Units on the Account page are Metric (meters, kph) rather than Standard
    /// (feet, mph; also for a site from before there were units).
    /// Throws UnauthorizedAccessException if the key isn't accepted, and HttpRequestException or
    /// TaskCanceledException if the site can't be reached.</summary>
    public async Task<(string? Json, bool Metric)> GetTrackJsonAsync(string trackName, CancellationToken ct)
    {
        using var response = await _http.GetAsync($"api/collector/track?name={Uri.EscapeDataString(trackName)}", ct);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new UnauthorizedAccessException("RacingCoach.app doesn't accept the upload key");
        response.EnsureSuccessStatusCode();
        using var body = await JsonDocument.ParseAsync(await response.Content.ReadAsStreamAsync(ct), cancellationToken: ct);
        var json = body.RootElement.TryGetProperty("track", out var track) && track.ValueKind == JsonValueKind.Object
            ? track.GetRawText()
            : null;
        var metric = body.RootElement.TryGetProperty("units", out var units) && units.ValueKind == JsonValueKind.String
            && units.GetString() == "metric";
        return (json, metric);
    }

    /// <summary>The in-session debrief for uploaded laps (by clientLapId): what to say, e.g. "Area 1 average
    /// time was 12.3 seconds", and the focus area's name; or the reason there's none as Error.</summary>
    public async Task<(string? Message, string? AreaName, string? Error)> GetDebriefAsync(IEnumerable<Guid> clientLapIds, CancellationToken ct)
    {
        try
        {
            using var response = await _http.PostAsJsonAsync("api/collector/debrief", new { clientLapIds }, JsonOptions, ct);
            if (!response.IsSuccessStatusCode)
                return (null, null, await ErrorMessageAsync(response, ct));
            var body = await response.Content.ReadFromJsonAsync<DebriefResponse>(JsonOptions, ct);
            return string.IsNullOrWhiteSpace(body?.Message) ? (null, null, "the site sent no debrief") : (body.Message, body.Area?.Name, null);
        }
        catch (HttpRequestException e)
        {
            return (null, null, e.Message);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return (null, null, "the request timed out");
        }
    }

    /// <summary>The In-Car AI Coach's plan for a track: the user's In-Car AI Coach Instructions turned into rules
    /// to run on live telemetry, how to deliver lap feedback, and the track's focus areas. Throws
    /// UnauthorizedAccessException if the key isn't accepted, HttpRequestException (also for a server error,
    /// e.g. the AI being unavailable) or TaskCanceledException if the site can't be reached.</summary>
    public async Task<CoachPlanResponse> GetCoachPlanAsync(string trackName, CancellationToken ct)
    {
        using var response = await _http.GetAsync($"api/collector/in-car-coach?track={Uri.EscapeDataString(trackName)}", ct);
        if (response.StatusCode == HttpStatusCode.Unauthorized)
            throw new UnauthorizedAccessException("RacingCoach.app doesn't accept the upload key");
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(await ErrorMessageAsync(response, ct));
        return await response.Content.ReadFromJsonAsync<CoachPlanResponse>(JsonOptions, ct)
            ?? throw new HttpRequestException("the site sent no plan");
    }

    /// <summary>What the In-Car AI Coach wants to tell the driver now, from the session's uploaded laps (by
    /// clientLapId, oldest first) and what it said recently; often nothing. Error is why there's no answer.</summary>
    public async Task<(IReadOnlyList<CoachCallout> Callouts, string? Error)> GetCoachCalloutsAsync(
        IEnumerable<Guid> clientLapIds, IEnumerable<string> recentCallouts, CancellationToken ct)
    {
        try
        {
            using var response = await _http.PostAsJsonAsync("api/collector/in-car-coach", new { clientLapIds, recentCallouts }, JsonOptions, ct);
            if (!response.IsSuccessStatusCode)
                return ([], await ErrorMessageAsync(response, ct));
            var body = await response.Content.ReadFromJsonAsync<CalloutsResponse>(JsonOptions, ct);
            return (body?.Callouts ?? [], null);
        }
        catch (HttpRequestException e)
        {
            return ([], e.Message);
        }
        catch (TaskCanceledException) when (!ct.IsCancellationRequested)
        {
            return ([], "the request timed out");
        }
    }

    /// <summary>Speech in the user's coach voice and Preferred Language, as a WAV file: text (already in their
    /// language), or a fixed phrase (coachSpeech in the website's dictionaries, e.g. "newLap"). Throws
    /// HttpRequestException (also for a refused key or a server error) or TaskCanceledException.</summary>
    public async Task<byte[]> GetSpeechAsync(string? text, string? phrase, CancellationToken ct)
    {
        object body = phrase is not null ? new { phrase } : new { text };
        using var response = await _http.PostAsJsonAsync("api/collector/speech", body, JsonOptions, ct);
        if (!response.IsSuccessStatusCode)
            throw new HttpRequestException(await ErrorMessageAsync(response, ct));
        return await response.Content.ReadAsByteArrayAsync(ct);
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

        // The parts' Content-Disposition headers are written by hand: .NET's own leave the names unquoted
        // and add a filename* parameter, and Node 20's form parser (the website's server) rejects both.
        using var form = new MultipartFormDataContent();
        var lapContent = new StringContent(JsonSerializer.Serialize(details, JsonOptions), Encoding.UTF8, "application/json");
        lapContent.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data") { Name = "\"lap\"" };
        form.Add(lapContent);
        var csvContent = new ByteArrayContent(csvGzip);
        csvContent.Headers.ContentType = new MediaTypeHeaderValue("application/gzip");
        csvContent.Headers.ContentDisposition = new ContentDispositionHeaderValue("form-data") { Name = "\"csv\"", FileName = "\"lap.csv.gz\"" };
        form.Add(csvContent);

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

    private sealed record DebriefResponse(string? Message, DebriefArea? Area);

    private sealed record DebriefArea(string? Name);

    private sealed record CalloutsResponse(List<CoachCallout>? Callouts);
}

/// <summary>GET /api/collector/in-car-coach (src/lib/inCarCoach.ts in the website).</summary>
internal sealed record CoachPlanResponse(string? Instructions, CoachPlan? Plan, List<CoachArea>? Areas, string? Locale);

/// <summary>Rules to run on live telemetry, and how to deliver the lap feedback.</summary>
internal sealed record CoachPlan(List<CoachRule>? Rules, bool Speak, bool Show, bool HoldInFocusAreas, bool LapFeedback, int FeedbackEveryLaps);

/// <summary>On Event (in Area, for areaEntry/areaExit; null = any), say or show Text, or play Sound.</summary>
internal sealed record CoachRule(string Event, string? Area, string Action, string? Text, string? Sound);

/// <summary>A focus area from Track Data: where it starts and ends, as fractions of a lap.</summary>
internal sealed record CoachArea(string Name, double Start, double End);

/// <summary>Something the coach wants to tell the driver, and a sound to play first (null for none).</summary>
internal sealed record CoachCallout(string Text, string? Sound);
