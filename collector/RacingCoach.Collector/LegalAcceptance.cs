using Microsoft.Win32;

namespace RacingCoach.Collector;

/// <summary>
/// The installer's record of the Terms of Service and Privacy Policy its legal page accepted
/// (HKLM\Software\RacingCoach.app\Collector\LegalAcceptance, collector/installer/RacingCoach.Collector.iss), which the
/// collector reports to the account its upload key belongs to (POST /api/collector/policy-acceptance). Null when the
/// collector wasn't installed by an installer that records it (an older one, or the plain exe).
/// </summary>
internal sealed record LegalAcceptance(string TermsVersion, string PrivacyVersion, string? AcceptedAtUtc, string? InstallerVersion)
{
    private const string KeyPath = @"Software\RacingCoach.app\Collector\LegalAcceptance";

    public static LegalAcceptance? Read()
    {
        try
        {
            // The installer is 64-bit, so it writes the 64-bit registry
            using var hklm = RegistryKey.OpenBaseKey(RegistryHive.LocalMachine, RegistryView.Registry64);
            using var key = hklm.OpenSubKey(KeyPath);
            if (key?.GetValue("TermsVersion") is not string terms || key.GetValue("PrivacyVersion") is not string privacy)
                return null;
            return new LegalAcceptance(terms, privacy, key.GetValue("AcceptedAtUtc") as string, key.GetValue("InstallerVersion") as string);
        }
        catch (Exception e) when (e is System.Security.SecurityException or UnauthorizedAccessException or IOException)
        {
            return null;
        }
    }
}
