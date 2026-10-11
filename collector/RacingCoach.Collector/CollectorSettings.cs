using System.Security.Cryptography;
using System.Text;
using System.Text.Json;

namespace RacingCoach.Collector;

/// <summary>
/// The collector's saved settings, in %APPDATA%\RacingCoach\collector.json. The upload key is
/// encrypted with Windows DPAPI, so only the same Windows user on the same PC can read it.
/// </summary>
internal sealed class CollectorSettings
{
    public const string DefaultSiteUrl = "https://racingcoach.app";

    private static readonly string FilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "RacingCoach", "collector.json");

    private static readonly JsonSerializerOptions JsonOptions = new() { WriteIndented = true, PropertyNamingPolicy = JsonNamingPolicy.CamelCase };

    // Distinguishes our DPAPI blobs from any other program's
    private static readonly byte[] Entropy = Encoding.UTF8.GetBytes("RacingCoach.Collector upload key");

    public string SiteUrl { get; set; } = DefaultSiteUrl;
    /// <summary>The upload key, DPAPI-encrypted and base64-encoded.</summary>
    public string? EncryptedUploadKey { get; set; }

    public static CollectorSettings Load()
    {
        try
        {
            return File.Exists(FilePath)
                ? JsonSerializer.Deserialize<CollectorSettings>(File.ReadAllText(FilePath), JsonOptions) ?? new()
                : new();
        }
        catch (JsonException)
        {
            return new(); // unreadable; start over and ask for the key again
        }
    }

    public void Save()
    {
        Directory.CreateDirectory(Path.GetDirectoryName(FilePath)!);
        File.WriteAllText(FilePath, JsonSerializer.Serialize(this, JsonOptions));
    }

    /// <summary>The upload key, or null if none is saved or it can't be decrypted (e.g. copied from another PC).</summary>
    public string? GetUploadKey()
    {
        if (EncryptedUploadKey is null)
            return null;
        try
        {
            var bytes = ProtectedData.Unprotect(Convert.FromBase64String(EncryptedUploadKey), Entropy, DataProtectionScope.CurrentUser);
            return Encoding.UTF8.GetString(bytes);
        }
        catch (Exception e) when (e is CryptographicException or FormatException)
        {
            return null;
        }
    }

    public void SetUploadKey(string key) =>
        EncryptedUploadKey = Convert.ToBase64String(
            ProtectedData.Protect(Encoding.UTF8.GetBytes(key), Entropy, DataProtectionScope.CurrentUser));

    /// <summary>Upload keys come from the Account page: rck_ and 43 base64url characters.</summary>
    public static bool LooksLikeUploadKey(string key) =>
        key.Length == 47 && key.StartsWith("rck_", StringComparison.Ordinal)
        && key.Skip(4).All(c => char.IsAsciiLetterOrDigit(c) || c is '-' or '_');
}
