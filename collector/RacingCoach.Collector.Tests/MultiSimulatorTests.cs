using System.Diagnostics;
using System.IO.MemoryMappedFiles;
using System.Text.Json;
using System.Text.Json.Nodes;
using RacingCoach.Collector.Simulators;
using SVappsLAB.iRacingTelemetrySDK;
using static RacingCoach.Collector.Tests.SyntheticTelemetry;

namespace RacingCoach.Collector.Tests;

/// <summary>The canonical path holds iRacing to its own behavior: same telemetry in, same laps and files out.</summary>
public sealed class IRacingEquivalenceTests
{
    private const int Lap = (int)(LapSeconds * Hz);

    private static List<TelemetryFrame> ReadIbtFrames(string ibt, RecordingSink sink)
    {
        new IRacingAdapter(ibt, 100).RunAsync(sink, new CancellationTokenSource(TimeSpan.FromSeconds(90)).Token).GetAwaiter().GetResult();
        return sink.Frames;
    }

    public static TheoryData<string> Scenarios() => new(IRacingRegressionTests.Scenarios.Keys);

    [Theory]
    [MemberData(nameof(Scenarios))]
    public void FrameLapTracker_agrees_with_LapRecorder(string scenario)
    {
        var samples = IRacingRegressionTests.Scenarios[scenario]().ToList();

        var native = new List<string>();
        var recorder = new LapRecorder(l => native.Add($"lap {l.LapNumber} s{l.SessionNum} {l.LapTimeSeconds:F6} n{l.Samples.Count} m{l.MissingSamples} i{l.Incidents} p{l.OnPitRoad} o{l.OffTrack}"), native.Add);
        foreach (var sample in samples)
            recorder.OnSample(sample);

        var canonical = new List<string>();
        var tracker = new FrameLapTracker(l => canonical.Add($"lap {l.LapNumber} s{l.SessionNumber} {l.LapTimeSeconds:F6} n{l.Frames.Count} m{l.MissingFrames} i{l.Incidents} p{l.OnPitRoad} o{l.OffTrack}"), canonical.Add);
        foreach (var sample in samples)
            tracker.OnFrame(IRacingAdapter.ToFrame(sample));

        Assert.Equal(native, canonical);
    }

    [Fact]
    public async Task The_canonical_path_writes_iRacing_lap_files_byte_for_byte()
    {
        using var temp = new TempFolder();
        var ibt = Path.Combine(temp.Path, "test.ibt");
        WriteIbt(ibt, 3 * Lap + 100);
        var root = Path.Combine(temp.Path, "Laps");
        var writer = new LapWriter(root, null, _ => { }) { PlaybackStartedAt = DateTimeOffset.FromUnixTimeSeconds(IbtStartUnixSeconds) };
        writer.Start();

        var pipeline = new CanonicalLapPipeline(new IRacingAdapter(ibt, 100), writer.Enqueue, (_, _) => { }, pumpCapacity: 100_000); // played back far faster than real time
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        await pipeline.RunAsync(timeout.Token);
        await writer.FlushAsync();
        await writer.DisposeAsync();

        var folder = Directory.GetDirectories(root).Single();
        var written = Directory.GetFiles(folder, "*.csv").OrderBy(f => f, StringComparer.Ordinal)
            .Select(f => new { Name = Path.GetFileName(f), Sha256 = Golden.Sha256(f) }).ToList();
        // The same files, by name and contents, as iRacing's own path wrote at the baseline
        var baseline = JsonNode.Parse(File.ReadAllText(GoldenPath("engine-playback")))!["Files"]!.AsArray();
        Assert.Equal(baseline.Count, written.Count);
        for (var i = 0; i < written.Count; i++)
        {
            Assert.Equal(baseline[i]!["Name"]!.GetValue<string>(), written[i].Name);
            Assert.Equal(baseline[i]!["Sha256"]!.GetValue<string>(), written[i].Sha256);
        }
    }

    private static string GoldenPath(string name, [System.Runtime.CompilerServices.CallerFilePath] string caller = "") =>
        Path.Combine(Path.GetDirectoryName(caller)!, "Golden", name + ".json");

    [Fact]
    public void Header_is_the_one_the_website_has_always_read()
    {
        var baseline = JsonNode.Parse(File.ReadAllText(GoldenPath("lap-csvs")))!["Header"]!.GetValue<string>();
        Assert.Equal(baseline, LapCsvFormat.Header);
    }

    [Fact]
    public void An_empty_sample_stays_empty_rather_than_becoming_zero()
    {
        var frame = IRacingAdapter.ToFrame(default);
        Assert.Null(frame.SpeedMps);
        Assert.Null(frame.Latitude);
        Assert.Null(frame.OffTrack);
        Assert.Null(frame.FrontLeft.PressureKpa);
        Assert.DoesNotContain(LapCsvFormat.Row(frame, null).Split(','), cell => cell.Length > 0);
    }

    [Fact]
    public void Wheels_map_to_their_own_corners()
    {
        var f = IRacingAdapter.ToFrame(Sample(100));
        var s = Sample(100);
        Assert.Equal(s.LFtempCL, f.FrontLeft.CarcassTempLeftC);
        Assert.Equal(s.RFtempCR, f.FrontRight.CarcassTempRightC);
        Assert.Equal(s.LRpressure, f.RearLeft.PressureKpa);
        Assert.Equal(s.RRrideHeight, f.RearRight.RideHeightMeters);
    }

    [Fact]
    public void Off_track_means_what_it_does_in_LapRecorder()
    {
        Assert.True(IRacingAdapter.ToFrame(Sample(1) with { PlayerTrackSurface = TrackLocation.OffTrack }).OffTrack);
        Assert.False(IRacingAdapter.ToFrame(Sample(1) with { PlayerTrackSurface = TrackLocation.OnTrack }).OffTrack);
    }

    [Fact]
    public void Session_info_maps_with_iRacing_identifiers_kept()
    {
        using var temp = new TempFolder();
        var ibt = Path.Combine(temp.Path, "test.ibt");
        WriteIbt(ibt, 200);
        var sink = new RecordingSink();
        ReadIbtFrames(ibt, sink);
        var session = sink.Sessions[0];
        Assert.Equal("iracing", session.SimulatorId);
        Assert.Equal("limerock full", session.NativeTrackId);
        Assert.Equal("Lime Rock Park (Grand Prix)", session.Track);
        Assert.Equal("testcar", session.NativeCarId);
        Assert.Equal(222, session.SubSessionId);
        Assert.Equal(2420, session.TrackLengthMeters!.Value, 3);
    }
}

public sealed class AdapterContractTests
{
    [Fact]
    public void The_iRacing_adapter_meets_the_contract()
    {
        using var temp = new TempFolder();
        var ibt = Path.Combine(temp.Path, "test.ibt");
        WriteIbt(ibt, 300);
        var sink = new RecordingSink();
        new IRacingAdapter(ibt, 100).RunAsync(sink, new CancellationTokenSource(TimeSpan.FromSeconds(60)).Token).GetAwaiter().GetResult();

        Assert.Empty(AdapterContract.Violations("iracing", sink.Frames, SimulatorCatalog.Shared.Find("iracing")));
        Assert.Contains(true, sink.Connections);
        Assert.NotEmpty(sink.Sessions);
        Assert.Empty(sink.Errors);
    }

    [Fact]
    public async Task An_adapter_can_be_cancelled()
    {
        var adapter = new ScriptedAdapter("x", ScriptedAdapter.Laps("x", 1)) { HoldOpen = true };
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(100));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => adapter.RunAsync(new RecordingSink(), cancel.Token));
    }

    [Fact]
    public void Scripted_frames_for_ACC_meet_the_contract_and_it_catches_a_faked_channel()
    {
        var acc = SimulatorCatalog.Shared.Find("acc");
        var frames = ScriptedAdapter.Laps("acc", 1);
        Assert.Empty(AdapterContract.Violations("acc", frames, acc));

        // An adapter that filled ride heights, which ACC doesn't give, with zeros fails
        var zeros = frames.Select(f => f with { FrontLeft = new WheelTelemetry { RideHeightMeters = 0f } }).ToList();
        Assert.Contains("rideHeightCorner is Unavailable in the matrix but has values", AdapterContract.Violations("acc", zeros, acc));
    }

    [Fact]
    public void The_contract_catches_frames_out_of_order_or_from_another_simulator()
    {
        var frames = ScriptedAdapter.Laps("x", 1);
        Assert.Contains("a frame says it's from another simulator", AdapterContract.Violations("y", frames, null));
        Assert.Contains("time went backwards in session 0", AdapterContract.Violations("x", frames.AsEnumerable().Reverse().ToList(), null));
    }

    [Fact]
    public void Only_tested_simulators_are_claimed_and_the_registry_only_has_those()
    {
        var supported = SimulatorCatalog.Shared.Simulators.Where(s => s.Status == SimulatorStatus.Supported).Select(s => s.Id).ToList();
        Assert.Equal(["iracing", "acc"], supported);
        foreach (var adapter in SimulatorRegistry.Create(new IRacingAdapter(), named: "acc"))
            Assert.Contains(adapter.SimulatorId, supported);
        // ACC only when --simulator names it, never for auto: detection hasn't been proven beside a running iRacing
        Assert.Equal(["iracing"], SimulatorRegistry.Create(new IRacingAdapter(), named: null).Select(a => a.SimulatorId));
        Assert.Equal(["iracing", "acc"], SimulatorRegistry.Create(new IRacingAdapter(), named: "acc").Select(a => a.SimulatorId));
    }

    [Fact]
    public void The_matrix_lists_every_target_and_only_known_channels()
    {
        var catalog = SimulatorCatalog.Shared;
        Assert.Equal(["iracing", "acc", "ac", "ams2", "lmu", "rf2", "r3e", "acevo", "f1"], catalog.Simulators.Select(s => s.Id));
        foreach (var simulator in catalog.Simulators)
            Assert.All(simulator.Channels.Keys, channel => Assert.Contains(channel, catalog.Channels));
        Assert.All(catalog.Channels, channel => Assert.True(catalog.Find("iracing")!.Channels.ContainsKey(channel), channel));
        Assert.All(catalog.Channels, channel => Assert.True(catalog.Find("acc")!.Channels.ContainsKey(channel), channel));
    }

    [Theory] // What ACC Shared Memory v1.8.12 says, including what it marks as not used, and what the two Spa
             // recordings of 2026-11-05 confirmed (docs/multi-simulator.md)
    [InlineData("steeringAngle", "Collected")]
    [InlineData("rideHeightAxle", "Unavailable")]
    [InlineData("tireSurfaceTemp", "Unavailable")]
    [InlineData("tireLoad", "Unavailable")]
    [InlineData("tireWear", "Unavailable")]
    [InlineData("geoPosition", "Unavailable")]
    [InlineData("trackLength", "Unavailable")]
    [InlineData("speed", "Collected")]
    [InlineData("clutch", "Collected")]
    [InlineData("yaw", "Collected")]
    [InlineData("fuelLevel", "Collected")]
    [InlineData("lapValid", "Collected")]
    [InlineData("slipRatio", "Documented")]
    [InlineData("tireCoreTemp", "Documented")]
    public void ACC_channels_stay_as_its_documentation_says(string channel, string support) =>
        Assert.Equal(support, SimulatorCatalog.Shared.Find("acc")!.Support(channel).ToString());

    [Fact]
    public void Units_convert_and_keep_null()
    {
        Assert.Equal(10f, Units.KmhToMps(36f)!.Value, 4);
        Assert.Equal(186.158f, Units.PsiToKpa(27f)!.Value, 2);
        Assert.Equal(9.80665f, Units.GToMps2(1f)!.Value, 4);
        Assert.Equal(0.05f, Units.MmToMeters(50f)!.Value, 5);
        Assert.Equal(MathF.PI, Units.DegreesToRadians(180f)!.Value, 5);
        Assert.Null(Units.KmhToMps(null));
        Assert.Null(Units.PsiToKpa(null));
    }
}

public sealed class SimulatorSelectionTests
{
    private static ScriptedAdapter Sim(string id, bool running, bool open, bool producing) =>
        new(id, []) { ProbeResult = new SimulatorProbe(null, running, open, producing) };

    [Fact]
    public void Producing_telemetry_beats_running_and_registry_order_breaks_ties()
    {
        var idle = Sim("idle", true, true, false);
        var a = Sim("a", true, true, true);
        var b = Sim("b", true, true, true);
        Assert.Same(a, SimulatorSelection.Select([idle, a, b], null));
        Assert.Same(a, SimulatorSelection.Select([idle, a, b], null)); // the same state, the same choice
        Assert.Same(b, SimulatorSelection.Select([idle, b, a], null));
    }

    [Fact]
    public void A_process_without_its_telemetry_interface_is_not_selected()
    {
        Assert.Null(SimulatorSelection.Select([Sim("a", true, false, false)], null));
        Assert.Null(SimulatorSelection.Select([Sim("a", false, false, false)], null));
    }

    [Fact]
    public void The_user_can_override_the_choice()
    {
        var a = Sim("a", true, true, true);
        var b = Sim("b", false, false, false);
        Assert.Same(b, SimulatorSelection.Select([a, b], "B"));
        Assert.Null(SimulatorSelection.Select([a, b], "nope"));
    }

    [Fact]
    public async Task The_supervisor_runs_one_adapter_at_a_time_and_tries_again_after_a_failure()
    {
        var failing = new ScriptedAdapter("a", []) { FailWith = new IOException("boom") };
        var log = new List<(string Message, bool IsError)>();
        var supervisor = new SimulatorSupervisor([failing], null, (m, e) => { lock (log) log.Add((m, e)); })
        {
            PollInterval = TimeSpan.FromMilliseconds(1),
            RetryDelay = TimeSpan.FromMilliseconds(1),
        };
        using var cancel = new CancellationTokenSource(TimeSpan.FromMilliseconds(200));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            supervisor.RunAsync((adapter, ct) => adapter.RunAsync(new RecordingSink(), ct), cancel.Token));
        Assert.True(failing.Runs > 1);
        Assert.Equal(1, failing.MostAtOnce);
        Assert.Contains(log, l => l.IsError && l.Message.Contains("boom"));
    }

    [Fact]
    public async Task The_supervisor_waits_quietly_with_no_simulator_and_starts_when_one_appears()
    {
        var sim = Sim("a", false, false, false);
        var supervisor = new SimulatorSupervisor([sim], null, (_, _) => { }) { PollInterval = TimeSpan.FromMilliseconds(5) };
        using var cancel = new CancellationTokenSource();
        var ran = new TaskCompletionSource();
        var run = supervisor.RunAsync((_, _) => { ran.TrySetResult(); cancel.Cancel(); return Task.CompletedTask; }, cancel.Token);
        await Task.Delay(50);
        Assert.False(ran.Task.IsCompleted);
        sim.ProbeResult = new SimulatorProbe(null, true, true, true);
        await ran.Task.WaitAsync(TimeSpan.FromSeconds(5));
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => run);
    }

    [Fact]
    public async Task An_unknown_simulator_is_an_error_not_a_silent_fallback()
    {
        var log = new List<string>();
        var ran = false;
        await new SimulatorSupervisor([Sim("a", true, true, true)], "acc", (m, _) => log.Add(m))
            .RunAsync((_, _) => { ran = true; return Task.CompletedTask; }, CancellationToken.None);
        Assert.False(ran);
        Assert.Contains("No adapter for simulator \"acc\"", log.Single());
    }

    [Fact]
    public void The_iRacing_probe_reads_its_shared_memory_status_without_needing_iRacing()
    {
        var adapter = new IRacingAdapter();
        MemoryMappedFile map;
        try
        {
            using (MemoryMappedFile.OpenExisting(@"Local\IRSDKMemMapFileName"))
                return; // iRacing is really running on this PC: leave its memory alone
        }
        catch (FileNotFoundException)
        {
            Assert.False(adapter.Probe().InterfaceOpen);
            map = MemoryMappedFile.CreateNew(@"Local\IRSDKMemMapFileName", 16);
        }
        using (map)
        using (var view = map.CreateViewAccessor())
        {
            Assert.True(adapter.Probe().InterfaceOpen);
            Assert.False(adapter.Probe().ProducingTelemetry);
            view.Write(4, 1); // irsdk_stConnected
            Assert.True(adapter.Probe().ProducingTelemetry);
        }
    }
}

public sealed class LapTrackerTests
{
    private static (List<TrackedLap> Laps, List<string> Discarded, FrameLapTracker Tracker) Tracker(LapTrackerOptions? options = null)
    {
        var laps = new List<TrackedLap>();
        var discarded = new List<string>();
        return (laps, discarded, new FrameLapTracker(laps.Add, discarded.Add, options));
    }

    [Fact]
    public void Frames_without_ticks_use_the_clock_for_gaps()
    {
        var (laps, discarded, tracker) = Tracker();
        var frames = ScriptedAdapter.Laps("x", 3);
        foreach (var frame in frames.Where(f => f.SessionTimeSeconds is not (> 30 and < 31)))
            tracker.OnFrame(frame);
        Assert.Contains(discarded, d => d.Contains("telemetry paused"));
        Assert.DoesNotContain(laps, l => l.LapNumber == 2);
        Assert.NotEmpty(laps);
    }

    [Fact]
    public void Lap_times_are_interpolated_and_say_so()
    {
        var (laps, _, tracker) = Tracker();
        foreach (var frame in ScriptedAdapter.Laps("x", 2))
            tracker.OnFrame(frame);
        Assert.Equal(20, laps[0].LapTimeSeconds, 3);
        Assert.True(laps[0].LapTimeEstimated);
    }

    [Fact]
    public void A_simulators_own_lap_events_end_laps_and_keep_its_time_and_validity()
    {
        var (laps, _, tracker) = Tracker(new LapTrackerOptions { UseNativeLapEvents = true });
        var frames = ScriptedAdapter.Laps("x", 2);
        var ended = false;
        foreach (var frame in frames)
        {
            var end = !ended && frame.SessionTimeSeconds > 22;
            tracker.OnFrame(end ? frame with { LapJustEnded = new NativeLapEvent(7, 19.876, false) } : frame);
            ended |= end;
        }
        var lap = Assert.Single(laps);
        Assert.Equal(19.876, lap.LapTimeSeconds);
        Assert.False(lap.LapTimeEstimated);
        Assert.False(lap.Valid);
        Assert.Equal(7, lap.LapNumber);
    }

    [Fact]
    public void Validity_is_unknown_rather_than_true_when_the_simulator_doesnt_judge_laps()
    {
        var (laps, _, tracker) = Tracker();
        foreach (var frame in ScriptedAdapter.Laps("x", 2).Select(f => f with { LapValid = null }))
            tracker.OnFrame(frame);
        Assert.Null(laps[0].Valid);
    }

    [Fact]
    public void Validity_follows_the_simulator_within_a_lap()
    {
        var (laps, _, tracker) = Tracker();
        foreach (var frame in ScriptedAdapter.Laps("x", 2).Select(f => f.SessionTimeSeconds is > 5 and < 6 ? f with { LapValid = false } : f))
            tracker.OnFrame(frame);
        Assert.False(laps[0].Valid);
        Assert.True(laps[1].Valid);
    }

    [Fact]
    public void Out_and_in_laps_are_told_apart_and_replays_are_not_recorded()
    {
        var (laps, _, tracker) = Tracker();
        var frames = ScriptedAdapter.Laps("x", 3);
        foreach (var frame in frames.Select(f => f.SessionTimeSeconds < 2 ? f with { OnPitRoad = true } : f.SessionTimeSeconds > 40 ? f with { OnPitRoad = true } : f))
            tracker.OnFrame(frame);
        Assert.Contains(laps, l => l.Kind == LapKind.OutLap);
        Assert.Contains(laps, l => l.Kind is LapKind.InLap or LapKind.OutAndInLap);

        var (replays, _, replayTracker) = Tracker();
        foreach (var frame in ScriptedAdapter.Laps("x", 3).Select(f => f with { IsReplay = true }))
            replayTracker.OnFrame(frame);
        Assert.Empty(replays);
    }

    [Fact]
    public void A_restarted_session_throws_the_lap_away()
    {
        var (laps, discarded, tracker) = Tracker();
        var frames = ScriptedAdapter.Laps("x", 1);
        foreach (var frame in frames.Take(600))
            tracker.OnFrame(frame);
        foreach (var frame in frames.Take(100))
            tracker.OnFrame(frame); // the clock starts again
        Assert.Empty(laps);
        Assert.Contains(discarded, d => d.Contains("backwards"));
    }

    [Fact]
    public void Disconnecting_mid_lap_loses_only_that_lap()
    {
        var (laps, discarded, tracker) = Tracker();
        var frames = ScriptedAdapter.Laps("x", 2);
        foreach (var frame in frames)
            tracker.OnFrame(frame.SessionTimeSeconds is > 25 and < 26 ? frame with { IsOnTrack = false } : frame);
        Assert.Single(discarded);
        Assert.Single(laps);
    }
}

public sealed class PipelineTests
{
    private static async Task<(string Folder, SessionManifest Manifest)> SaveAsync(string root, ScriptedAdapter adapter)
    {
        var writer = new LapWriter(root, null, _ => { });
        writer.Start();
        await new CanonicalLapPipeline(adapter, writer.Enqueue, (_, _) => { }).RunAsync(CancellationToken.None);
        await writer.FlushAsync();
        await writer.DisposeAsync();
        var folder = Directory.GetDirectories(root).Single();
        return (folder, SessionManifest.Load(folder)!);
    }

    [Fact]
    public async Task Another_simulators_laps_are_saved_with_its_id_and_empty_cells_for_what_it_lacks()
    {
        using var temp = new TempFolder();
        var (folder, manifest) = await SaveAsync(temp.Path, new ScriptedAdapter("acc", ScriptedAdapter.Laps("acc", 2), ScriptedAdapter.SessionFor("acc")));

        Assert.Equal("acc", manifest.Simulator);
        Assert.Equal("test-1", manifest.AdapterVersion);
        var lap = manifest.Laps[0];
        Assert.False(lap.HasPosition);
        Assert.True(lap.PositionMissing); // nothing will ever add them, so the lap needn't wait
        var lines = File.ReadAllLines(Path.Combine(folder, lap.File));
        var header = lines[0].Split(',');
        var row = lines[1].Split(',');
        Assert.Equal(LapCsvFormat.Header, lines[0]);
        foreach (var missing in new[] { "SteeringWheelAngle", "LFrideHeight", "RRpressure", "LFtempCM", "Lat", "OilTemp", "SessionTick" })
            Assert.Equal("", row[Array.IndexOf(header, missing)]);
        // ACC's speed was checked in the game, so it reaches the lap file (ChannelGate keeps out what wasn't); the
        // lap's structure always does
        Assert.NotEqual("", row[Array.IndexOf(header, "Speed")]);
        Assert.NotEqual("", row[Array.IndexOf(header, "LapDistPct")]);
    }

    [Fact]
    public async Task A_frame_from_another_simulator_is_refused()
    {
        var mixed = ScriptedAdapter.Laps("acc", 1);
        mixed[10] = mixed[10] with { SimulatorId = "iracing" };
        var saved = new List<CompletedLap>();
        var pipeline = new CanonicalLapPipeline(new ScriptedAdapter("acc", mixed), saved.Add, (_, _) => { });
        await Assert.ThrowsAsync<InvalidOperationException>(() => pipeline.RunAsync(CancellationToken.None));
    }

    [Fact]
    public async Task A_session_from_another_simulator_is_refused()
    {
        var pipeline = new CanonicalLapPipeline(new ScriptedAdapter("acc", [], ScriptedAdapter.SessionFor("iracing")), _ => { }, (_, _) => { });
        await Assert.ThrowsAsync<InvalidOperationException>(() => pipeline.RunAsync(CancellationToken.None));
    }

    [Fact]
    public async Task Laps_upload_with_their_simulator_and_keep_one_id_across_retries()
    {
        using var temp = new TempFolder();
        var (folder, manifest) = await SaveAsync(temp.Path, new ScriptedAdapter("acc", ScriptedAdapter.Laps("acc", 2), ScriptedAdapter.SessionFor("acc")));
        var lap = manifest.Laps[0];

        var attempts = 0;
        await using var site = await FakeSite.StartAsync(statusOf: _ => Interlocked.Increment(ref attempts) == 1 ? 503 : 201);
        using var api = new RacingCoachApi(site.Url, "key");
        var finished = new TaskCompletionSource<string?>();
        var uploader = new LapUploader(api, (_, error) => finished.TrySetResult(error), _ => { });
        uploader.Enqueue(new UploadItem(folder, new SessionInfo(manifest.Track, manifest.Car, manifest.Driver, 0, 0, manifest.Simulator, manifest.AdapterVersion, manifest.CarKey, manifest.TrackKey), lap, false));

        Assert.Null(await finished.Task.WaitAsync(TimeSpan.FromSeconds(30))); // uploaded, after one failure and the 5 s wait
        await uploader.DisposeAsync();
        Assert.Equal(2, site.Uploads.Count);
        var ids = site.Uploads.Select(u => JsonNode.Parse(u.LapJson)!["clientLapId"]!.GetValue<string>()).Distinct();
        Assert.Single(ids);
        var details = JsonNode.Parse(site.Uploads[1].LapJson)!;
        Assert.Equal("acc", details["simulator"]!.GetValue<string>());
        Assert.Equal("test-1", details["adapterVersion"]!.GetValue<string>());
        Assert.Equal(1, details["payloadVersion"]!.GetValue<int>());
        Assert.Equal("native_track", details["trackKey"]!.GetValue<string>());
        Assert.Equal("native_car", details["carKey"]!.GetValue<string>());
    }

    [Fact]
    public async Task A_track_of_the_same_name_never_lends_another_simulator_iRacing_details()
    {
        using var temp = new TempFolder();
        var (folder, manifest) = await SaveAsync(temp.Path, new ScriptedAdapter("acc", ScriptedAdapter.Laps("acc", 2), ScriptedAdapter.SessionFor("acc")));
        TrackKeys.Set(manifest.Track, "iracing key", "2.42 km", "41.9 m", "-73.3 m"); // the same name, driven in iRacing earlier

        await using var site = await FakeSite.StartAsync();
        using var api = new RacingCoachApi(site.Url, "key");
        var info = new SessionInfo(manifest.Track, manifest.Car, manifest.Driver, 0, 0, manifest.Simulator, manifest.AdapterVersion, manifest.CarKey, manifest.TrackKey);
        await api.UploadLapAsync(Path.Combine(folder, manifest.Laps[0].File), info, manifest.Laps[0], CancellationToken.None);

        var details = JsonNode.Parse(Assert.Single(site.Uploads).LapJson)!;
        Assert.Equal("native_track", details["trackKey"]!.GetValue<string>());
        Assert.Null(details["trackLengthFeet"]);
        Assert.Null(details["trackLatitude"]);
    }

    [Fact]
    public async Task The_engine_runs_another_simulator_only_when_asked_and_keeps_its_laps_apart()
    {
        using var temp = new TempFolder();
        var adapter = new ScriptedAdapter("acc", ScriptedAdapter.Laps("acc", 2), ScriptedAdapter.SessionFor("acc"));
        var log = new List<string>();
        var engine = new CollectorEngine(new CollectorOptions(null, 1, false, true, false, null, true, "acc"), (m, _) => { lock (log) log.Add(m); }, _ => { }, temp.Path, [adapter]);
        using var cancel = new CancellationTokenSource(TimeSpan.FromSeconds(90));
        var running = engine.RunAsync(cancel.Token);
        // As soon as a lap is saved: how long the engine takes to start up depends on the PC
        while (!running.IsCompleted && !Directory.GetFiles(temp.Path, "session.json", SearchOption.AllDirectories).Any())
            await Task.Delay(50);
        Assert.False(cancel.IsCancellationRequested, "no lap was saved: " + string.Join(" | ", log));
        cancel.Cancel();
        await running;

        Assert.True(adapter.Runs >= 1);
        Assert.Equal(1, adapter.MostAtOnce);
        Assert.Contains(log, m => m.Contains("Collecting from Scripted acc"));
        var folder = Assert.Single(Directory.GetDirectories(engine.LapsFolder));
        Assert.Equal("acc", SessionManifest.Load(folder)!.Simulator);
    }

    [Fact]
    public async Task Asking_for_a_simulator_with_no_adapter_never_reads_iRacing_instead()
    {
        using var temp = new TempFolder();
        var log = new List<(string, bool)>();
        // A simulator in the matrix with no adapter yet (ACC has one, behind --simulator acc)
        var engine = new CollectorEngine(new CollectorOptions(null, 1, false, true, false, null, true, "ams2"), (m, e) => { lock (log) log.Add((m, e)); }, _ => { }, temp.Path);
        await engine.RunAsync(new CancellationTokenSource(TimeSpan.FromSeconds(20)).Token);
        Assert.Contains(log, l => l.Item2 && l.Item1.Contains("No adapter for simulator \"ams2\""));
        Assert.DoesNotContain(log, l => l.Item1.Contains("Connected to iRacing"));
    }
}

public sealed class PerformanceTests
{
    [Fact]
    public async Task A_stalled_consumer_never_grows_memory_or_blocks_the_reader()
    {
        var pump = new FramePump(capacity: 100);
        var frames = ScriptedAdapter.Laps("x", 5);
        var clock = Stopwatch.StartNew();
        foreach (var frame in frames)
            pump.Post(frame);
        Assert.True(clock.ElapsedMilliseconds < 1000, $"took {clock.ElapsedMilliseconds} ms");
        Assert.Equal(frames.Count - 100, pump.Dropped);

        pump.Complete();
        var received = new List<TelemetryFrame>();
        await pump.ConsumeAsync(received.Add);
        Assert.Equal(100, received.Count);
        Assert.Same(frames[^1], received[^1]); // the newest are kept, in order
        Assert.True(received.Zip(received.Skip(1)).All(p => p.First.SessionTimeSeconds < p.Second.SessionTimeSeconds));
    }

    [Fact]
    public void A_gap_from_dropped_frames_discards_the_lap_rather_than_inventing_samples()
    {
        var laps = new List<TrackedLap>();
        var tracker = new FrameLapTracker(laps.Add, _ => { });
        var frames = ScriptedAdapter.Laps("x", 3);
        foreach (var frame in frames.Where(f => f.SessionTimeSeconds is not (> 30 and < 32)))
            tracker.OnFrame(frame);
        Assert.All(laps, lap => Assert.True(lap.Frames.Zip(lap.Frames.Skip(1)).All(p => p.Second.SessionTimeSeconds - p.First.SessionTimeSeconds < 0.5)));
        Assert.Equal(1201, laps[0].Frames.Count); // the lap before the gap, whole
    }

    [Fact]
    public void An_hour_of_60_Hz_frames_is_processed_many_times_faster_than_real_time()
    {
        var frames = ScriptedAdapter.Laps("x", 1);
        var clock = Stopwatch.StartNew();
        var completed = 0;
        var tracker = new FrameLapTracker(_ => completed++, _ => { });
        var seconds = 0.0;
        for (var i = 0; i < 3600 * 60; i++)
        {
            var progress = 0.95 + i / (20.0 * 60);
            tracker.OnFrame(frames[0] with { SessionTimeSeconds = seconds, LapDistancePct = (float)(progress - Math.Floor(progress)), LapNumber = (int)progress });
            seconds += 1.0 / 60;
        }
        Assert.Equal(179, completed);
        // An hour of driving, in well under a minute on any PC that can run a simulator: at least 60x real time
        Assert.True(clock.Elapsed < TimeSpan.FromSeconds(60), $"took {clock.Elapsed}");
        Console.WriteLine($"An hour of frames tracked in {clock.Elapsed.TotalSeconds:F2} s");
    }
}
