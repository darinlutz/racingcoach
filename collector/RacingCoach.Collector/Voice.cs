using System.Media;
using System.Speech.Synthesis;
using System.Threading.Channels;

namespace RacingCoach.Collector;

/// <summary>
/// Speaks to the driver (the In-Car AI Coach, the overlay's "Starting new lap", the in-session debrief) in the coach
/// voice they picked on the Account page, with a native accent in their Preferred Language: RacingCoach.app makes
/// the speech with OpenAI (POST /api/collector/speech) and it's played here. One thing at a time, in order. Speech
/// is kept for a while, so things said often (e.g. "Starting new lap") play straight away after the first time.
/// Without an upload key, or when the site can't make it, Windows' own voice says it instead.
/// </summary>
internal static class Voice
{
    private sealed record Item(string? Text, string? Phrase, string Fallback, long Generation);

    private const int CacheSize = 64;
    private static readonly TimeSpan CacheFor = TimeSpan.FromMinutes(30);
    private static readonly TimeSpan ReportProblemsEvery = TimeSpan.FromMinutes(5);

    private static readonly Channel<Item> Queue = Channel.CreateUnbounded<Item>(new UnboundedChannelOptions { SingleReader = true });
    private static readonly object Lock = new();
    private static readonly Dictionary<string, (byte[] Wav, DateTime At)> Cache = [];
    private static Func<RacingCoachApi?> _site = () => null;
    private static RacingCoachApi? _cachedFor;
    private static Action<string> _log = _ => { };
    private static long _generation;
    private static SoundPlayer? _playing;
    private static DateTime _problemReportedAt = DateTime.MinValue;

    // Windows' voice, created on first use and kept for the app's lifetime (null if Windows has no voice)
    private static readonly Lazy<SpeechSynthesizer?> Synthesizer = new(() =>
    {
        try
        {
            var voice = new SpeechSynthesizer();
            voice.SetOutputToDefaultAudioDevice();
            return voice;
        }
        catch
        {
            return null;
        }
    });

    static Voice() => _ = Task.Factory.StartNew(RunAsync, TaskCreationOptions.LongRunning).Unwrap();

    /// <summary>Where speech comes from (the site connection for the upload key in use), and where problems are logged.</summary>
    public static void UseSite(Func<RacingCoachApi?> site, Action<string> log)
    {
        _site = site;
        _log = log;
    }

    /// <summary>Says text (in the driver's language) after anything already being said, or instead of it with interrupt.</summary>
    public static void Say(string text, bool interrupt = false)
    {
        if (!string.IsNullOrWhiteSpace(text))
            Enqueue(new Item(text.Trim(), null, text.Trim(), 0), interrupt);
    }

    /// <summary>Says a fixed phrase in the driver's language (coachSpeech in the website's dictionaries, e.g.
    /// "newLap"); Windows' voice says the English fallback when the site can't.</summary>
    public static void SayPhrase(string phrase, string fallback, bool interrupt = false) =>
        Enqueue(new Item(null, phrase, fallback, 0), interrupt);

    private static void Enqueue(Item item, bool interrupt)
    {
        long generation;
        lock (Lock)
        {
            if (interrupt)
            {
                _generation++; // whatever is queued or being fetched is dropped
                _playing?.Stop();
                Synthesizer.Value?.SpeakAsyncCancelAll();
            }
            generation = _generation;
        }
        Queue.Writer.TryWrite(item with { Generation = generation });
    }

    private static bool Current(Item item)
    {
        lock (Lock)
            return item.Generation == _generation;
    }

    private static async Task RunAsync()
    {
        await foreach (var item in Queue.Reader.ReadAllAsync())
        {
            try
            {
                if (!Current(item))
                    continue;
                var wav = await GetSpeechAsync(item);
                if (!Current(item))
                    continue;
                if (wav is not null)
                {
                    Play(wav);
                }
                else if (Synthesizer.Value is { } windowsVoice)
                {
                    // Async so an interrupt (SpeakAsyncCancelAll) can cut it short
                    var prompt = windowsVoice.SpeakAsync(item.Fallback);
                    while (!prompt.IsCompleted)
                        await Task.Delay(50);
                }
            }
            catch (Exception e) when (e is InvalidOperationException or OperationCanceledException or IOException)
            {
                // a cancelled Windows voice, or a sound device that went away; carry on with the next
            }
        }
    }

    private static void Play(byte[] wav)
    {
        using var player = new SoundPlayer(new MemoryStream(wav));
        lock (Lock)
            _playing = player;
        try
        {
            player.PlaySync(); // returns early when Stop() interrupts it
        }
        finally
        {
            lock (Lock)
                _playing = null;
        }
    }

    // The speech from the site (or kept from earlier), or null to use Windows' voice
    private static async Task<byte[]?> GetSpeechAsync(Item item)
    {
        if (_site() is not { } site)
            return null;
        var key = item.Phrase is not null ? $"phrase:{item.Phrase}" : $"text:{item.Text}";
        lock (Lock)
        {
            if (site != _cachedFor)
            {
                Cache.Clear(); // another account, maybe another voice
                _cachedFor = site;
            }
            if (Cache.TryGetValue(key, out var kept) && DateTime.UtcNow - kept.At < CacheFor)
                return kept.Wav;
        }

        try
        {
            var wav = await site.GetSpeechAsync(item.Text, item.Phrase, CancellationToken.None);
            lock (Lock)
            {
                if (Cache.Count >= CacheSize)
                    Cache.Remove(Cache.MinBy(entry => entry.Value.At).Key);
                Cache[key] = (wav, DateTime.UtcNow);
            }
            return wav;
        }
        catch (Exception e) when (e is HttpRequestException or TaskCanceledException)
        {
            if (DateTime.UtcNow - _problemReportedAt > ReportProblemsEvery)
            {
                _problemReportedAt = DateTime.UtcNow;
                _log($"The coach voice isn't available ({e.Message}); using Windows' voice for now.");
            }
            return null;
        }
    }
}
