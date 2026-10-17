using System.Runtime.InteropServices;
using System.Security.Cryptography.X509Certificates;

namespace RacingCoach.Collector;

/// <summary>
/// Checks Windows code signatures (Authenticode). Releases are signed by Clarivex, LLC through Azure Artifact Signing
/// (.github/workflows/collector-release.yml), so SelfUpdater only installs a download signed by the same publisher as
/// the running collector. A collector that isn't signed itself (a local build, or one from before signing) doesn't
/// check, so local builds still update.
/// </summary>
internal static class Authenticode
{
    /// <summary>The publisher (organization, else common name) of the running exe's valid signature, or null when it
    /// isn't signed.</summary>
    public static string? RunningPublisher { get; } = Environment.ProcessPath is { } exe ? TryPublisher(exe) : null;

    /// <summary>Throws InvalidDataException unless the file has a valid signature, Windows trusts its certificate,
    /// and it's from the same publisher as the running collector. Does nothing when the running collector isn't
    /// signed.</summary>
    public static void RequireSamePublisher(string path)
    {
        if (RunningPublisher is not { } expected)
            return;
        var publisher = TryPublisher(path)
            ?? throw new InvalidDataException("the download isn't signed, or Windows doesn't trust its signature");
        if (publisher != expected)
            throw new InvalidDataException($"the download is signed by {publisher}, not {expected}");
    }

    /// <summary>The publisher of a file's signature when Windows trusts it, else null.</summary>
    private static string? TryPublisher(string path)
    {
        if (!IsTrusted(path))
            return null;
        try
        {
#pragma warning disable SYSLIB0057 // the signer's certificate from the file's signature, not a certificate file
            using var cert = new X509Certificate2(X509Certificate.CreateFromSignedFile(path));
#pragma warning restore SYSLIB0057
            foreach (var rdn in cert.SubjectName.EnumerateRelativeDistinguishedNames())
                if (rdn.GetSingleElementType().Value == "2.5.4.10") // O
                    return rdn.GetSingleElementValue();
            return cert.GetNameInfo(X509NameType.SimpleName, false);
        }
        catch (System.Security.Cryptography.CryptographicException)
        {
            return null;
        }
    }

    // ---- WinVerifyTrust ----

    private static readonly Guid GenericVerifyV2 = new("00AAC56B-CD44-11d0-8CC2-00C04FC295EE");

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WinTrustFileInfo
    {
        public uint StructSize;
        public string FilePath;
        public IntPtr File;
        public IntPtr KnownSubject;
    }

    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    private struct WinTrustData
    {
        public uint StructSize;
        public IntPtr PolicyCallbackData;
        public IntPtr SipClientData;
        public uint UiChoice;
        public uint RevocationChecks;
        public uint UnionChoice;
        public IntPtr FileInfo;
        public uint StateAction;
        public IntPtr StateData;
        public string? UrlReference;
        public uint ProvFlags;
        public uint UiContext;
        public IntPtr SignatureSettings;
    }

    private const uint WtdUiNone = 2;
    private const uint WtdRevokeNone = 0;
    private const uint WtdChoiceFile = 1;
    private const uint WtdStateActionVerify = 1;
    private const uint WtdStateActionClose = 2;
    // Revocation isn't checked (it needs the network); the chain must still lead to a root Windows trusts
    private const uint WtdCacheOnlyUrlRetrieval = 0x1000;

    [DllImport("wintrust.dll", CharSet = CharSet.Unicode)]
    private static extern int WinVerifyTrust(IntPtr hwnd, [MarshalAs(UnmanagedType.LPStruct)] Guid action, ref WinTrustData data);

    /// <summary>Whether the file has a valid Authenticode signature whose certificate Windows trusts (a timestamped
    /// signature stays valid after the certificate expires, as Artifact Signing's do after 3 days).</summary>
    private static bool IsTrusted(string path)
    {
        var fileInfo = new WinTrustFileInfo { StructSize = (uint)Marshal.SizeOf<WinTrustFileInfo>(), FilePath = path };
        var fileInfoPtr = Marshal.AllocHGlobal(Marshal.SizeOf<WinTrustFileInfo>());
        try
        {
            Marshal.StructureToPtr(fileInfo, fileInfoPtr, false);
            var data = new WinTrustData
            {
                StructSize = (uint)Marshal.SizeOf<WinTrustData>(),
                UiChoice = WtdUiNone,
                RevocationChecks = WtdRevokeNone,
                UnionChoice = WtdChoiceFile,
                FileInfo = fileInfoPtr,
                StateAction = WtdStateActionVerify,
                ProvFlags = WtdCacheOnlyUrlRetrieval,
            };
            var result = WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, ref data);
            data.StateAction = WtdStateActionClose;
            WinVerifyTrust(IntPtr.Zero, GenericVerifyV2, ref data);
            return result == 0;
        }
        finally
        {
            Marshal.DestroyStructure<WinTrustFileInfo>(fileInfoPtr);
            Marshal.FreeHGlobal(fileInfoPtr);
        }
    }
}
