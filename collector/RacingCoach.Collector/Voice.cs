using System.Speech.Synthesis;

namespace RacingCoach.Collector;

/// <summary>Speaks to the driver through Windows' default voice (the overlay's "Starting new lap", the
/// in-session debrief). Does nothing if Windows has no voice.</summary>
internal static class Voice
{
    // Created on first use and kept for the app's lifetime (null if Windows has no voice)
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

    /// <summary>Says text after anything already being said, or instead of it with interrupt.</summary>
    public static void Say(string text, bool interrupt = false)
    {
        if (Synthesizer.Value is not { } voice)
            return;
        if (interrupt)
            voice.SpeakAsyncCancelAll();
        voice.SpeakAsync(text);
    }
}
