using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>What Driver Radio is doing, for the Radio window: Recording while the button is held, Sending while the
/// site turns it into text (and the Race Engineer answers), then Said (the text, and the engineer's Reply when it
/// answered) or Problem (why not) for a few seconds; Since is when it started.</summary>
internal enum RadioState { Idle, Recording, Sending, Said, Problem }

internal sealed record RadioStatus(RadioState State, string? Text, DateTime Since, string? Reply = null);

/// <summary>
/// Driver Radio (src/lib/driverRadio.ts in the website): while the driver holds iRacing's radio (push to talk) button,
/// or the wheel button picked in the window's Live Racing tab, the microphone is recorded; once it's let go the
/// recording goes to RacingCoach.app (POST /api/collector/radio), which turns it into text, shows it on the Live
/// Racing page and plays it there in the site's Driver Radio voice. The text comes back and is shown in the Radio
/// window over the sim, and in the activity log.
///
/// iRacing's radio button is seen in telemetry: RadioTransmitCarIdx is the driver's own car while they transmit. That
/// needs iRacing's voice chat (online sessions), and what's said also goes out on iRacing's radio channel as usual. A
/// wheel button works anywhere, iRacing running or not, and goes to nobody else in iRacing unless it's also bound
/// there.
///
/// The site's Race Engineer answers when what was said needs an answer (a question, "box this lap", ...): it knows the
/// live timing (gaps, position, fuel, laps left) and looks through the session's uploaded laps, and its reply is said
/// in the coach voice and shown in the Radio window. Silver and Gold members only, like the In-Car AI Coach.
///
/// The In-Car AI Coach waits while the driver talks, so the microphone doesn't hear it.
/// </summary>
internal sealed class DriverRadio : IDisposable
{
    private const int MaxSeconds = 30;
    // Held for less than this is a slip of the thumb; and recording goes on this long after letting go, so the last
    // word isn't cut off
    private static readonly TimeSpan MinHold = TimeSpan.FromMilliseconds(400);
    private static readonly TimeSpan Tail = TimeSpan.FromMilliseconds(250);
    private static readonly TimeSpan PollEvery = TimeSpan.FromMilliseconds(20);
    // iRacing's radio counts as held only while telemetry keeps coming
    private static readonly TimeSpan SampleFresh = TimeSpan.FromMilliseconds(500);
    // The speech to text, then the Race Engineer, which may look through the laps
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(45);

    private readonly Func<RacingCoachApi?> _api;
    private readonly Func<IReadOnlyCollection<Guid>> _sessionLaps;
    private readonly Action<string, bool> _log;
    // Told once a run that the Race Engineer is for Silver and Gold members
    private bool _toldMembersOnly;
    private readonly MicRecorder _mic = new();
    private readonly CancellationTokenSource _stop = new();
    private readonly object _lock = new();
    private RadioStatus _status = new(RadioState.Idle, null, DateTime.UtcNow);
    private bool _iRacingHeld;
    private DateTime _sampleAt = DateTime.MinValue;
    private WheelButton? _button;
    // Set Wheel Button: waiting for any controller button to be pressed, with what was held when it started
    private Dictionary<(int Id, int Vendor, int Product, string Name), uint>? _picking;
    private Action<WheelButton?>? _picked;
    private DateTime _pickUntil;

    public DriverRadio(Func<RacingCoachApi?> api, Func<IReadOnlyCollection<Guid>> sessionLaps, Action<string, bool> log, WheelButton? button)
    {
        _api = api;
        _sessionLaps = sessionLaps;
        _log = log;
        _button = button;
        new Thread(Run) { IsBackground = true, Name = "Driver Radio" }.Start();
    }

    public RadioStatus Status { get { lock (_lock) return _status; } }

    /// <summary>The wheel button that's push to talk, or null for iRacing's radio button only.</summary>
    public WheelButton? Button
    {
        get { lock (_lock) return _button; }
        set { lock (_lock) _button = value; }
    }

    /// <summary>Waits up to 10 s for a controller button to be pressed, then calls picked with it (null if none was),
    /// on the Driver Radio thread.</summary>
    public void PickButton(Action<WheelButton?> picked)
    {
        lock (_lock)
        {
            _picking = WheelButtons.Snapshot();
            _picked = picked;
            _pickUntil = DateTime.UtcNow.AddSeconds(10);
        }
    }

    public void OnSample(in TelemetryData d)
    {
        var held = d.IsReplayPlaying != true && d.RadioTransmitCarIdx is { } talking and >= 0 && talking == d.PlayerCarIdx;
        lock (_lock)
        {
            _iRacingHeld = held;
            _sampleAt = DateTime.UtcNow;
        }
    }

    public void Dispose()
    {
        _stop.Cancel();
        _mic.Dispose();
    }

    private void Set(RadioState state, string? text = null)
    {
        lock (_lock)
            _status = new RadioStatus(state, text, DateTime.UtcNow);
    }

    private bool Held()
    {
        WheelButton? button;
        lock (_lock)
        {
            if (_iRacingHeld && DateTime.UtcNow - _sampleAt < SampleFresh)
                return true;
            button = _button;
        }
        return button is not null && WheelButtons.IsDown(button);
    }

    private void Run()
    {
        DateTime? pressedAt = null;
        DateTime? releasedAt = null;
        while (!_stop.IsCancellationRequested)
        {
            Thread.Sleep(PollEvery);
            try
            {
                if (Picking())
                    continue;
                var held = Held();
                var now = DateTime.UtcNow;
                if (pressedAt is null)
                {
                    if (!held)
                        continue;
                    if (!StartRecording())
                    {
                        while (Held() && !_stop.IsCancellationRequested)
                            Thread.Sleep(PollEvery); // wait for the button to be let go before trying again
                        continue;
                    }
                    pressedAt = now;
                    releasedAt = null;
                    continue;
                }
                if (held)
                    releasedAt = null;
                else
                    releasedAt ??= now;
                var tooLong = _mic.Recorded >= TimeSpan.FromSeconds(MaxSeconds);
                if (releasedAt is { } released && now - released < Tail && !tooLong)
                    continue;
                if (releasedAt is null && !tooLong)
                    continue;

                var wav = _mic.Stop();
                Voice.HoldFor(TimeSpan.Zero);
                var heldFor = (releasedAt ?? now) - pressedAt.Value;
                pressedAt = null;
                if (wav is null || heldFor < MinHold)
                {
                    Set(RadioState.Idle);
                    continue;
                }
                Send(wav);
                if (tooLong)
                {
                    while (Held() && !_stop.IsCancellationRequested)
                        Thread.Sleep(PollEvery); // the next message starts with the next press
                }
            }
            catch (Exception e)
            {
                pressedAt = null;
                _mic.Stop();
                Set(RadioState.Problem, e.Message);
                _log($"Driver Radio: {e.Message}", true);
            }
        }
    }

    // Set Wheel Button: true while it's waiting for a button
    private bool Picking()
    {
        Dictionary<(int Id, int Vendor, int Product, string Name), uint>? before;
        lock (_lock)
            before = _picking;
        if (before is null)
            return false;
        var pressed = WheelButtons.NewlyPressed(before);
        if (pressed is null && DateTime.UtcNow < _pickUntil)
            return true;
        Action<WheelButton?>? picked;
        lock (_lock)
        {
            picked = _picked;
            _picking = null;
            _picked = null;
        }
        picked?.Invoke(pressed);
        // the button is still down: it starts a message only once it's been let go
        while (pressed is not null && WheelButtons.IsDown(pressed) && !_stop.IsCancellationRequested)
            Thread.Sleep(PollEvery);
        return true;
    }

    private bool StartRecording()
    {
        try
        {
            _mic.Start(MaxSeconds + 1);
        }
        catch (InvalidOperationException e)
        {
            var problem = $"Couldn't record: {e.Message}. Check the microphone in Windows' Sound settings, and that Privacy & security > Microphone lets desktop apps use it.";
            Set(RadioState.Problem, problem);
            _log($"Driver Radio: {problem}", true);
            return false;
        }
        // The In-Car AI Coach waits, so the microphone doesn't hear it (released once the recording stops)
        Voice.HoldFor(TimeSpan.FromSeconds(MaxSeconds + 1));
        Set(RadioState.Recording);
        return true;
    }

    // Turns the recording into text on the site, on its own task so the next press is seen meanwhile
    private void Send(byte[] wav)
    {
        var client = _api();
        if (client is null)
        {
            Set(RadioState.Problem, "Driver Radio needs your upload key (Upload Key button).");
            return;
        }
        Set(RadioState.Sending);
        _ = Task.Run(async () =>
        {
            try
            {
                using var timeout = CancellationTokenSource.CreateLinkedTokenSource(_stop.Token);
                timeout.CancelAfter(RequestTimeout);
                var answer = await client.SendRadioAsync(wav, _sessionLaps(), timeout.Token);
                if (string.IsNullOrWhiteSpace(answer.Text))
                {
                    SetUnlessRecording(RadioState.Problem, "Didn't catch that. Hold the button while you speak.");
                    return;
                }
                var reply = string.IsNullOrWhiteSpace(answer.Reply) ? null : answer.Reply.Trim();
                SetUnlessRecording(RadioState.Said, answer.Text, reply);
                _log(answer.Shared
                    ? $"Driver Radio: “{answer.Text}” (sent to Live Racing)"
                    : $"Driver Radio: “{answer.Text}” (not on Live Racing: you're not sharing live right now)", false);
                if (reply is not null)
                {
                    _log($"Race Engineer: “{reply}”", false);
                    Voice.Say(reply);
                }
                else if (answer.Engineer == "membershipRequired" && !_toldMembersOnly)
                {
                    _toldMembersOnly = true;
                    _log("Race Engineer: answers over the radio are for Silver and Gold members.", false);
                }
                else if (answer.Engineer is "rateLimited" or "failed")
                    _log(answer.Engineer == "rateLimited"
                        ? "Race Engineer: no answer, you've reached your AI limit for now."
                        : "Race Engineer: couldn't answer that one.", true);
            }
            catch (Exception e) when (e is HttpRequestException or UnauthorizedAccessException or TaskCanceledException)
            {
                var problem = e is TaskCanceledException ? "RacingCoach.app didn't answer in time" : e.Message;
                SetUnlessRecording(RadioState.Problem, problem);
                _log($"Driver Radio: {problem}", true);
            }
        });
    }

    // A late answer doesn't hide the next message being recorded
    private void SetUnlessRecording(RadioState state, string? text, string? reply = null)
    {
        lock (_lock)
        {
            if (_status.State != RadioState.Recording)
                _status = new RadioStatus(state, text, DateTime.UtcNow, reply);
        }
    }
}
