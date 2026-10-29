using System.Text.Json;
using SVappsLAB.iRacingTelemetrySDK;

namespace RacingCoach.Collector;

/// <summary>A focus area from Track Data: its name, and where it starts and ends as fractions of a lap (End &lt; Start
/// when it runs over the start/finish line).</summary>
internal sealed record TrackMapArea(string Name, double Start, double End);

/// <summary>A track's outline for the Live Racing tab, in meters east and north (point i at LapDistPct i / Count).
/// Exact when it's the site's (from a lap uploaded with track positions; north up), otherwise drawn from the car's
/// own speed and yaw rate over a clean lap (turned an arbitrary way). Areas are the track's focus areas.</summary>
internal sealed record TrackMap(IReadOnlyList<(double X, double Y)> Points, bool Exact, IReadOnlyList<TrackMapArea> Areas);

/// <summary>A car in the session from session info, for Live Racing's field: iRacing's car index, the driver, car
/// number, car, class and class color (hex, e.g. "#ffda59"), and the driver's iRating and license (e.g. "A 3.41").</summary>
internal sealed record FieldDriver(int CarIdx, string Name, string? Number, string? Car, string? CarClass, string? ClassColor,
    int? IRating, string? License);

/// <summary>
/// Live Racing (src/lib/liveRacing.ts in the website): sends the driver's live position and lap details to
/// RacingCoach.app twice a second while they're in the car (every few seconds otherwise), so they, their friends
/// and their coaches can watch them go round the track on the website's Live Racing page, and keeps the track's map
/// for the window's Live Racing tab.
///
/// Live telemetry has no track positions (iRacing only writes Lat/Lon to its .ibt files), so the car is placed on
/// the track's outline by its LapDistPct. The outline is the site's (GET /api/collector/track-outline), made from the
/// first clean lap of the track uploaded with track positions. Until the track has one, a clean lap's own path is
/// worked out from the car's speed and yaw rate (dead reckoning), its small drift spread round the lap so it closes,
/// and sent with the next live update, so the website can draw it too.
///
/// Each update also carries the field: every car in the session (iRacing's CarIdx telemetry covers all of them), so
/// the website shows the whole race, not just RacingCoach.app drivers. The drivers' names, cars and classes change
/// rarely, so they're sent only when they change or the site asks for them (needsField).
///
/// Watchers can message the driver from the website (Message Driver): the answer to an update carries the messages,
/// and they're said in the driver's In-Car AI Coach voice.
/// </summary>
internal sealed class LiveRacing(Func<RacingCoachApi?> api, Action<string> log)
{
    private const int OutlinePoints = 500;
    // The share of the lap's steps a path must have samples in to become an outline
    private const double MinCoverage = 0.9;
    // A lap's path that ends further than this share of its length from where it started is too far off to use
    private const double MaxClosureError = 0.15;
    private static readonly TimeSpan OnTrackInterval = TimeSpan.FromMilliseconds(500);
    private static readonly TimeSpan IdleInterval = TimeSpan.FromSeconds(5);
    // How often to ask again for the site's outline while there isn't one
    private static readonly TimeSpan OutlineRetry = TimeSpan.FromMinutes(2);
    private static readonly TimeSpan RequestTimeout = TimeSpan.FromSeconds(5);
    // iRacing's SessionTimeRemain and SessionLapsRemainEx/SessionLapsTotal for a session without a limit
    private const double UnlimitedSeconds = 86400 * 7 - 1;
    private const int UnlimitedLaps = 32767;

    private readonly object _lock = new();
    private TelemetryData _latest;
    private bool _hasLatest;
    private string? _track;
    private string? _trackKey;
    private string? _car;
    private IReadOnlyDictionary<int, string> _sessionTypes = new Dictionary<int, string>();
    private TrackMap? _map;
    // The site wants this run's approximate outline (it has none saved, and hasn't been sent one)
    private bool _sendOutline = true;
    private DateTime _mapLoadedAt = DateTime.MinValue;
    private bool _mapLoading;
    private RacingCoachApi? _mapApi;
    // The site couldn't be reached or refused the update; shown until the next one works
    private RacingCoachApi? _clearedFor;

    // The field: the session's cars from session info, the driver's own car index, the subsession (0 offline), whether
    // to send the cars' details with the next update, and each car's LapDistPct and SessionTime at the last update
    // (for its rate round the lap)
    private IReadOnlyList<FieldDriver> _fieldDrivers = [];
    private int? _myCarIdx;
    private int _subSessionId;
    private bool _sendFieldDrivers = true;
    // Counts changes to the field's cars, so an answer to an update sent before a change doesn't mark it sent
    private int _fieldVersion;
    private readonly Dictionary<int, (double Pct, double Time)> _fieldPrevious = [];

    // Dead reckoning: the car's heading and position since the lap started, and each sample's (LapDistPct, x, y)
    private double? _prevPct;
    private double? _prevTime;
    private double _heading;
    private double _x;
    private double _y;
    private readonly List<(double Pct, double X, double Y)> _path = [];
    private bool _recordingPath;
    private bool _pathClean;

    /// <summary>The track's map, or null until there's one (the site's, or one drawn from a clean lap).</summary>
    public TrackMap? Map { get { lock (_lock) return _map; } }
    /// <summary>How many others are watching on the website right now.</summary>
    public int Watchers { get; private set; }
    /// <summary>The last live update reached the site.</summary>
    public bool Sharing { get; private set; }
    /// <summary>Why the last live update didn't reach the site, or null.</summary>
    public string? Problem { get; private set; }

    /// <summary>Session info: the track being driven (as the laps name it), iRacing's key for it, the car, and each
    /// session's type. A new track starts its map again.</summary>
    public void SetTrack(string track, string? trackKey, string car, IReadOnlyDictionary<int, string> sessionTypes)
    {
        lock (_lock)
        {
            _car = car;
            _sessionTypes = sessionTypes;
            if (_track == track && _trackKey == trackKey)
                return;
            _track = track;
            _trackKey = trackKey;
            _map = null;
            _sendOutline = true;
            _mapLoadedAt = DateTime.MinValue;
            _pendingAreas = null;
            ResetPath();
        }
    }

    /// <summary>Session info: the subsession, the driver's own car index and every car in the session. Sent with the
    /// next update when they've changed.</summary>
    public void SetField(int subSessionId, int? myCarIdx, IReadOnlyList<FieldDriver> drivers)
    {
        lock (_lock)
        {
            if (_subSessionId == subSessionId && _myCarIdx == myCarIdx && _fieldDrivers.SequenceEqual(drivers))
                return;
            if (_subSessionId != subSessionId)
                _fieldPrevious.Clear();
            _subSessionId = subSessionId;
            _myCarIdx = myCarIdx;
            _fieldDrivers = drivers;
            _sendFieldDrivers = true;
            _fieldVersion++;
        }
    }

    /// <summary>The upload key changed: the map is asked for again with it.</summary>
    public void Refresh()
    {
        lock (_lock)
            _mapLoadedAt = DateTime.MinValue;
    }

    public void OnDisconnected()
    {
        lock (_lock)
        {
            _hasLatest = false;
            ResetPath();
            _fieldPrevious.Clear();
            _inputs.Clear();
        }
        _ = ClearAsync();
    }

    public void OnSample(in TelemetryData d)
    {
        lock (_lock)
        {
            _latest = d;
            _hasLatest = true;
            TrackPath(d);
            RecordInputs(d);
        }
    }

    // ---------------------------------------------------------------- The driver's inputs

    // The driver's inputs 20 times a second since the last update, sent with the next one so the website can play
    // them back smoothly: [SessionTime, throttle, brake, steering (radians, + left), gear, speed (m/s), delta to best]
    private const double InputInterval = 0.05;
    // At most 5 s of them, should the site be slow to answer
    private const int MaxInputs = 100;
    private readonly List<double?[]> _inputs = [];
    private double _lastInputTime = double.NegativeInfinity;

    private void RecordInputs(in TelemetryData d)
    {
        if (d.IsOnTrack != true || d.IsReplayPlaying == true || d.SessionTime is not { } time)
        {
            _inputs.Clear();
            return;
        }
        // a new session starts SessionTime again
        if (time < _lastInputTime)
            _inputs.Clear();
        else if (time - _lastInputTime < InputInterval)
            return;
        _lastInputTime = time;
        if (_inputs.Count >= MaxInputs)
            _inputs.RemoveAt(0);
        _inputs.Add([
            Math.Round(time, 3),
            d.Throttle is { } throttle ? Math.Round(Math.Clamp(throttle, 0, 1), 3) : null,
            d.Brake is { } brake ? Math.Round(Math.Clamp(brake, 0, 1), 3) : null,
            d.SteeringWheelAngle is { } steering ? Math.Round(Math.Clamp(steering, -20, 20), 3) : null,
            d.Gear is >= -1 and <= 20 ? d.Gear : null,
            d.Speed is { } speed ? Math.Round(Math.Clamp(speed, 0, 200), 2) : null,
            d.LapDeltaToBestLap is { } delta && Math.Abs(delta) < 3600 ? Math.Round(delta, 3) : null,
        ]);
    }

    // ---------------------------------------------------------------- Drawing the track from a lap

    private void ResetPath()
    {
        _prevPct = _prevTime = null;
        _path.Clear();
        _recordingPath = false;
    }

    private void TrackPath(in TelemetryData d)
    {
        if (d.IsOnTrack != true || d.IsReplayPlaying == true || d.LapDistPct is not { } pctF || pctF < 0
            || d.SessionTime is not { } time || d.Speed is not { } speed || d.YawRate is not { } yawRate)
        {
            ResetPath();
            return;
        }
        double pct = pctF;
        if (_prevPct is not { } prevPct || _prevTime is not { } prevTime || time - prevTime is <= 0 or > 0.5)
        {
            ResetPath();
            _prevPct = pct;
            _prevTime = time;
            return;
        }
        var dt = time - prevTime;
        var crossed = prevPct > 0.9 && pct < 0.1;
        var step = pct - prevPct;
        if (!crossed && step is < -0.001 or > 0.02)
        {
            // backwards, or a jump (a reset or a tow)
            ResetPath();
            _prevPct = pct;
            _prevTime = time;
            return;
        }
        _prevPct = pct;
        _prevTime = time;

        // VelocityX/VelocityY are in the car's frame (forward, left); the heading turns left with a positive yaw rate
        _heading += yawRate * dt;
        double forward = d.VelocityX ?? speed;
        double left = d.VelocityY ?? 0;
        var (sin, cos) = Math.SinCos(_heading);
        _x += (forward * cos - left * sin) * dt;
        _y += (forward * sin + left * cos) * dt;
        if (d.OnPitRoad == true)
            _pathClean = false;

        if (crossed)
        {
            if (_recordingPath && _pathClean && _map is null)
            {
                _path.Add((pct + 1, _x, _y));
                if (OutlineFromPath(_path) is { } points)
                {
                    _map = new TrackMap(points, Exact: false, _pendingAreas ?? []);
                    log("Live Racing: drew an approximate map of the track from your last lap.");
                }
            }
            _path.Clear();
            _recordingPath = true;
            _pathClean = d.OnPitRoad != true;
        }
        if (_recordingPath)
            _path.Add((pct, _x, _y));
    }

    // The lap's path as an outline: its drift spread round the lap so it ends where it started, each step's average
    // position, gaps filled in a straight line. null if it doesn't cover enough of the lap or drifted too far.
    private static IReadOnlyList<(double X, double Y)>? OutlineFromPath(List<(double Pct, double X, double Y)> path)
    {
        if (path.Count < OutlinePoints)
            return null;
        var (start, end) = (path[0], path[^1]);
        var span = end.Pct - start.Pct;
        if (span is < 0.95 or > 1.05)
            return null;
        double length = 0;
        for (var i = 1; i < path.Count; i++)
            length += Math.Sqrt(Math.Pow(path[i].X - path[i - 1].X, 2) + Math.Pow(path[i].Y - path[i - 1].Y, 2));
        var (errorX, errorY) = (end.X - start.X, end.Y - start.Y);
        if (length <= 0 || Math.Sqrt(errorX * errorX + errorY * errorY) > length * MaxClosureError)
            return null;

        var sums = new (double X, double Y, int N)[OutlinePoints];
        foreach (var (pct, x, y) in path)
        {
            var share = (pct - start.Pct) / span;
            var step = (int)Math.Floor((pct % 1 + 1) % 1 * OutlinePoints) % OutlinePoints;
            sums[step] = (sums[step].X + x - errorX * share, sums[step].Y + y - errorY * share, sums[step].N + 1);
        }
        var filled = Enumerable.Range(0, OutlinePoints).Where(i => sums[i].N > 0).ToList();
        if (filled.Count < OutlinePoints * MinCoverage)
            return null;
        var points = new (double X, double Y)[OutlinePoints];
        foreach (var i in filled)
            points[i] = (sums[i].X / sums[i].N, sums[i].Y / sums[i].N);
        for (var k = 0; k < filled.Count; k++)
        {
            var from = filled[k];
            var to = filled[(k + 1) % filled.Count];
            var gap = (to - from + OutlinePoints) % OutlinePoints;
            for (var g = 1; g < gap; g++)
            {
                var t = (double)g / gap;
                points[(from + g) % OutlinePoints] = (points[from].X + (points[to].X - points[from].X) * t,
                    points[from].Y + (points[to].Y - points[from].Y) * t);
            }
        }
        // Centered, so the site gets small numbers
        var (cx, cy) = (points.Average(p => p.X), points.Average(p => p.Y));
        return points.Select(p => (Math.Round(p.X - cx, 2), Math.Round(p.Y - cy, 2))).ToArray();
    }

    // ---------------------------------------------------------------- Sending

    /// <summary>Sends live updates until cancelled, then tells the site the driver has gone.</summary>
    public async Task RunAsync(CancellationToken cancel)
    {
        try
        {
            while (!cancel.IsCancellationRequested)
            {
                var onTrack = await SendAsync(cancel);
                await Task.Delay(onTrack ? OnTrackInterval : IdleInterval, cancel);
            }
        }
        catch (OperationCanceledException) when (cancel.IsCancellationRequested)
        {
            // closing
        }
        await ClearAsync();
    }

    // One live update; true while the driver is in the car (so the next goes soon)
    private async Task<bool> SendAsync(CancellationToken cancel)
    {
        var client = api();
        object payload;
        bool onTrack;
        string? trackKey;
        int fieldVersion;
        lock (_lock)
        {
            if (client is null || !_hasLatest || _track is null || _car is null)
            {
                Sharing = false;
                Watchers = 0;
                Problem = client is null ? "Sharing live needs uploads to RacingCoach.app turned on, with your upload key." : null;
                return false;
            }
            var d = _latest;
            onTrack = d.IsOnTrack == true && d.IsReplayPlaying != true;
            trackKey = _trackKey;
            fieldVersion = _fieldVersion;
            payload = new
            {
                track = _track,
                trackKey,
                car = _car,
                sessionType = d.SessionNum is { } num ? _sessionTypes.GetValueOrDefault(num) : null,
                onTrack,
                onPitRoad = d.OnPitRoad,
                lap = d.Lap,
                pct = d.LapDistPct is { } pct ? Math.Clamp(Math.Round(pct, 5), 0, 1) : (double?)null,
                speed = d.Speed is { } speed ? Math.Clamp(Math.Round(speed, 2), 0, 200) : (double?)null,
                gear = d.Gear,
                rpm = d.RPM is { } rpm ? Math.Max(0, Math.Round(rpm)) : (double?)null,
                throttle = d.Throttle is { } throttle ? Math.Clamp(Math.Round(throttle, 3), 0, 1) : (double?)null,
                brake = d.Brake is { } brake ? Math.Clamp(Math.Round(brake, 3), 0, 1) : (double?)null,
                currentLapTime = LapSeconds(d.LapCurrentLapTime),
                lastLapTime = LapSeconds(d.LapLastLapTime),
                bestLapTime = LapSeconds(d.LapBestLapTime),
                deltaToBest = d.LapDeltaToBestLap is { } delta && Math.Abs(delta) < 3600 ? Math.Round(delta, 3) : (double?)null,
                position = d.PlayerCarPosition is >= 0 and <= 1000 ? d.PlayerCarPosition : null,
                incidents = d.PlayerCarMyIncidentCount is >= 0 ? d.PlayerCarMyIncidentCount : null,
                steering = d.SteeringWheelAngle is { } steer ? Math.Round(Math.Clamp(steer, -20, 20), 3) : (double?)null,
                sessionTimeRemain = d.SessionTimeRemain is >= 0 and < UnlimitedSeconds and var remain ? Math.Round(remain, 1) : (double?)null,
                sessionLapsRemain = d.SessionLapsRemainEx is >= 0 and < UnlimitedLaps and var lapsLeft ? lapsLeft : (int?)null,
                sessionLapsTotal = d.SessionLapsTotal is > 0 and < UnlimitedLaps and var lapsTotal ? lapsTotal : (int?)null,
                acceptsMessages = true,
                inputs = TakeInputs(),
                outline = _sendOutline && _map is { Exact: false } map
                    ? new { kind = "meters", points = map.Points.Select(p => new[] { p.X, p.Y }).ToArray() }
                    : null,
                field = Field(d),
            };
        }

        _ = LoadMapIfDueAsync(client, trackKey);
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(cancel);
        timeout.CancelAfter(RequestTimeout);
        try
        {
            var answer = await client.SendLiveAsync(payload, timeout.Token);
            if (!Sharing)
                log("Live Racing: sharing your driving live on RacingCoach.app.");
            Sharing = true;
            Problem = null;
            Watchers = answer.Watchers;
            _clearedFor = null;
            foreach (var message in answer.Messages ?? [])
            {
                log($"Live Racing: message from {message.From}: {message.Text}");
                Voice.Say(message.Text);
            }
            lock (_lock)
            {
                _sendOutline = answer.NeedsOutline;
                if (_fieldVersion == fieldVersion)
                    _sendFieldDrivers = answer.NeedsField;
                // The site has had an outline made since the map was loaded (a lap with track positions uploaded)
                if (answer.SavedOutline && _map is not { Exact: true })
                    _mapLoadedAt = DateTime.MinValue;
            }
        }
        catch (Exception e) when (e is HttpRequestException or UnauthorizedAccessException or JsonException
            || (e is TaskCanceledException && !cancel.IsCancellationRequested))
        {
            Sharing = false;
            Watchers = 0;
            Problem = e is TaskCanceledException ? "RacingCoach.app didn't answer in time" : e.Message;
        }
        return onTrack;
    }

    // Every car in the session as it is now, with the cars' details when they're due; null without session info.
    // Called under the lock.
    private object? Field(in TelemetryData d)
    {
        if (_fieldDrivers.Count == 0 || d.CarIdxLapDistPct is not { } pcts)
            return null;
        double? time = d.SessionTime;
        var cars = new List<object>(_fieldDrivers.Count);
        foreach (var driver in _fieldDrivers)
        {
            var i = driver.CarIdx;
            double? pct = At(pcts, i) is >= 0 and <= 1 and var p ? Math.Round(p, 5) : null;
            double? rate = null;
            if (pct is { } now && time is { } t)
            {
                if (_fieldPrevious.TryGetValue(i, out var previous) && t - previous.Time is > 0.1 and < 10)
                {
                    // the short way round the lap, so crossing the line isn't a lap backwards
                    var step = ((now - previous.Pct) % 1 + 1.5) % 1 - 0.5;
                    rate = step > 0 ? Math.Round(Math.Min(step / (t - previous.Time), 0.1), 6) : 0;
                }
                _fieldPrevious[i] = (now, t);
            }
            else
                _fieldPrevious.Remove(i);
            cars.Add(new
            {
                idx = i,
                pct,
                rate,
                lap = At(d.CarIdxLap, i) is >= 0 and var lap ? lap : (int?)null,
                lapsDone = At(d.CarIdxLapCompleted, i) is >= 0 and var done ? done : (int?)null,
                position = At(d.CarIdxPosition, i) is > 0 and <= 1000 and var pos ? pos : (int?)null,
                classPosition = At(d.CarIdxClassPosition, i) is > 0 and <= 1000 and var cpos ? cpos : (int?)null,
                onPitRoad = At(d.CarIdxOnPitRoad, i),
                offTrack = At(d.CarIdxTrackSurface, i) == TrackLocation.OffTrack,
                lastLapTime = LapSeconds(At(d.CarIdxLastLapTime, i)),
                bestLapTime = LapSeconds(At(d.CarIdxBestLapTime, i)),
                f2Time = At(d.CarIdxF2Time, i) is >= 0 and < 86400 and var f2 ? Math.Round(f2, 3) : (double?)null,
                gear = At(d.CarIdxGear, i) is >= -1 and <= 20 and var gear ? gear : (int?)null,
            });
        }
        var drivers = _sendFieldDrivers
            ? _fieldDrivers.Select(f => new
            {
                idx = f.CarIdx,
                name = f.Name,
                number = f.Number,
                car = f.Car,
                carClass = f.CarClass,
                classColor = f.ClassColor,
                iRating = f.IRating,
                license = f.License,
            }).ToArray()
            : null;
        return new { subSessionId = _subSessionId, myCarIdx = _myCarIdx, cars, drivers };
    }

    // The inputs recorded since the last update, or null when there are none. Called under the lock.
    private double?[][]? TakeInputs()
    {
        if (_inputs.Count == 0)
            return null;
        var inputs = _inputs.ToArray();
        _inputs.Clear();
        return inputs;
    }

    private static T? At<T>(T[]? values, int i) where T : struct => values is not null && i >= 0 && i < values.Length ? values[i] : null;

    // iRacing gives 0 or -1 when there's no time
    private static double? LapSeconds(float? seconds) => seconds is > 0 and < 86400 ? Math.Round(seconds.Value, 3) : null;

    // The site's outline of the track, when it hasn't been asked for since the track (or key) changed, or for a while
    // without one
    private async Task LoadMapIfDueAsync(RacingCoachApi client, string? trackKey)
    {
        lock (_lock)
        {
            var due = _mapApi != client || (_map is not { Exact: true } && DateTime.UtcNow - _mapLoadedAt >= OutlineRetry);
            if (trackKey is null || _mapLoading || !due)
                return;
            _mapLoading = true;
            _mapLoadedAt = DateTime.UtcNow;
            _mapApi = client;
        }
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(30));
            var track = await client.GetTrackOutlineAsync(trackKey, timeout.Token);
            var areas = track?.Areas?.Select(a => new TrackMapArea(a.Name, a.Start, a.End)).ToList() ?? [];
            lock (_lock)
            {
                if (_trackKey != trackKey)
                    return; // moved on to another track meanwhile
                if (track?.Outline is { Kind: "latlon", Points.Length: > 0 } outline)
                {
                    var wasExact = _map is { Exact: true };
                    _map = new TrackMap(FromLatLon(outline.Points), Exact: true, areas);
                    _sendOutline = false;
                    if (!wasExact)
                        log($"Live Racing: loaded the map of {track.Name}.");
                }
                else if (_map is { Exact: false } approximate)
                    _map = approximate with { Areas = areas };
                else
                    _pendingAreas = areas;
            }
        }
        catch (Exception e) when (e is HttpRequestException or UnauthorizedAccessException or JsonException or TaskCanceledException)
        {
            // asked again later
        }
        finally
        {
            lock (_lock)
                _mapLoading = false;
        }
    }

    // The focus areas of a track without a map yet, for the approximate one once it's drawn
    private List<TrackMapArea>? _pendingAreas;

    // [lat, lon] in degrees as meters east and north of their middle
    private static IReadOnlyList<(double X, double Y)> FromLatLon(double[][] points)
    {
        var valid = points.Where(p => p.Length >= 2).ToArray();
        var lat0 = valid.Average(p => p[0]);
        var lon0 = valid.Average(p => p[1]);
        var cos = Math.Cos(lat0 * Math.PI / 180);
        return valid.Select(p => ((p[1] - lon0) * cos * 111_320, (p[0] - lat0) * 110_574)).ToArray();
    }

    // Tells the site the driver has gone (closing, or iRacing closed), so they leave Live Racing at once
    private async Task ClearAsync()
    {
        var client = api();
        if (client is null || _clearedFor == client)
            return;
        _clearedFor = client;
        Sharing = false;
        Watchers = 0;
        try
        {
            using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(3));
            await client.ClearLiveAsync(timeout.Token);
        }
        catch (Exception e) when (e is HttpRequestException or UnauthorizedAccessException or TaskCanceledException)
        {
            // the site drops it after a few seconds anyway
        }
    }
}
