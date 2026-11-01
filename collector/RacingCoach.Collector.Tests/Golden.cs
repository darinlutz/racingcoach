using System.Runtime.CompilerServices;
using System.Security.Cryptography;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;

namespace RacingCoach.Collector.Tests;

/// <summary>
/// Golden files: what the iRacing collector did at commit 64815d5, before the multi-simulator work, kept in Golden/.
/// They were written by running these tests against that code with RC_UPDATE_GOLDEN=1, and are never regenerated to
/// make a test pass: a difference is a change to iRacing's behavior, to be understood first.
/// </summary>
internal static class Golden
{
    private static readonly JsonSerializerOptions Indented = new() { WriteIndented = true };
    private static bool Updating => Environment.GetEnvironmentVariable("RC_UPDATE_GOLDEN") == "1";

    /// <summary>The value must match the golden file exactly.</summary>
    public static void Check(string name, object value, [CallerFilePath] string caller = "")
    {
        var actual = JsonSerializer.Serialize(value, Indented).ReplaceLineEndings("\n");
        var path = PathOf(name, caller);
        if (Updating)
        {
            File.WriteAllText(path, actual);
            return;
        }
        Assert.Equal(File.ReadAllText(path).ReplaceLineEndings("\n"), actual);
    }

    /// <summary>Everything in the golden file must still be there with the same value, in the JSON object(s) given;
    /// the only new properties allowed are those named. For formats that may only ever grow (a lap's upload details
    /// and session.json), where the website and older collectors ignore what they don't know.</summary>
    public static void CheckPreserved(string name, JsonNode actual, string[] allowedNew, [CallerFilePath] string caller = "")
    {
        var path = PathOf(name, caller);
        if (Updating)
        {
            File.WriteAllText(path, actual.ToJsonString(Indented).ReplaceLineEndings("\n"));
            return;
        }
        Compare(JsonNode.Parse(File.ReadAllText(path)), actual, allowedNew, "$");
    }

    private static void Compare(JsonNode? expected, JsonNode? actual, string[] allowedNew, string where)
    {
        switch (expected)
        {
            case JsonObject e:
                var a = Assert.IsType<JsonObject>(actual);
                foreach (var (key, value) in e)
                {
                    Assert.True(a.ContainsKey(key), $"{where}.{key} is gone");
                    Compare(value, a[key], allowedNew, $"{where}.{key}");
                }
                foreach (var (key, _) in a)
                    Assert.True(e.ContainsKey(key) || allowedNew.Contains(key), $"{where}.{key} is new");
                break;
            case JsonArray e:
                var list = Assert.IsType<JsonArray>(actual);
                Assert.Equal(e.Count, list.Count);
                for (var i = 0; i < e.Count; i++)
                    Compare(e[i], list[i], allowedNew, $"{where}[{i}]");
                break;
            default:
                Assert.Equal(expected?.ToJsonString(), actual?.ToJsonString());
                break;
        }
    }

    public static string Sha256(string path) => Convert.ToHexString(SHA256.HashData(File.ReadAllBytes(path)));
    public static string Sha256(byte[] bytes) => Convert.ToHexString(SHA256.HashData(bytes));
    public static string Sha256Text(string text) => Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(text)));

    private static string PathOf(string name, string caller)
    {
        var folder = Path.Combine(Path.GetDirectoryName(caller)!, "Golden");
        Directory.CreateDirectory(folder);
        return Path.Combine(folder, name + ".json");
    }
}

/// <summary>A folder under the temp folder, deleted afterwards.</summary>
internal sealed class TempFolder : IDisposable
{
    public string Path { get; } = System.IO.Path.Combine(System.IO.Path.GetTempPath(), "rc-collector-tests", Guid.NewGuid().ToString("N"));

    public TempFolder() => Directory.CreateDirectory(Path);

    public void Dispose()
    {
        try
        {
            Directory.Delete(Path, recursive: true);
        }
        catch (IOException)
        {
            // something still has a file open; it's the temp folder
        }
    }
}
