namespace RacingCoach.Collector.Simulators;

/// <summary>Picks which one simulator to collect from. There's never more than one: frames of different simulators
/// must not end up in one session.</summary>
public static class SimulatorSelection
{
    /// <summary>The user's choice, if it's registered, whether or not it's running. Otherwise the first adapter, in
    /// registry order, that's producing telemetry; then the first that's running with its interface open. Null if
    /// none: a process running without its interface isn't enough, as there'd be no data to read. Registry order is the
    /// tie-break, so the same state always gives the same choice.</summary>
    public static ISimulatorAdapter? Select(IReadOnlyList<ISimulatorAdapter> adapters, string? manualId)
    {
        if (manualId is not null)
            return adapters.FirstOrDefault(a => string.Equals(a.SimulatorId, manualId, StringComparison.OrdinalIgnoreCase));
        var probes = adapters.Select(a => (Adapter: a, Probe: SafeProbe(a))).ToList();
        return probes.FirstOrDefault(p => p.Probe.ProducingTelemetry).Adapter
            ?? probes.FirstOrDefault(p => p.Probe.ProcessRunning && p.Probe.InterfaceOpen).Adapter;
    }

    private static SimulatorProbe SafeProbe(ISimulatorAdapter adapter)
    {
        try
        {
            return adapter.Probe();
        }
        catch (Exception e) when (e is IOException or UnauthorizedAccessException or InvalidOperationException)
        {
            return default; // one simulator's probe failing never stops looking for the others
        }
    }
}

/// <summary>
/// Runs the selected adapter, one at a time: waits for a simulator, runs it until it ends, then starts looking again.
/// Looks every PollInterval and does nothing in between, so it costs next to nothing with no simulator running.
/// </summary>
public sealed class SimulatorSupervisor(IReadOnlyList<ISimulatorAdapter> adapters, string? manualId, Action<string, bool> log)
{
    public TimeSpan PollInterval { get; init; } = TimeSpan.FromSeconds(2);
    /// <summary>How long to wait before trying again after an adapter fails.</summary>
    public TimeSpan RetryDelay { get; init; } = TimeSpan.FromSeconds(5);

    /// <param name="run">Runs an adapter until it ends.</param>
    public async Task RunAsync(Func<ISimulatorAdapter, CancellationToken, Task> run, CancellationToken cancel)
    {
        if (manualId is not null && !adapters.Any(a => string.Equals(a.SimulatorId, manualId, StringComparison.OrdinalIgnoreCase)))
        {
            log($"No adapter for simulator \"{manualId}\". Available: {string.Join(", ", adapters.Select(a => a.SimulatorId))}.", true);
            return;
        }

        string? last = null;
        while (!cancel.IsCancellationRequested)
        {
            var adapter = SimulatorSelection.Select(adapters, manualId);
            if (adapter is null)
            {
                last = null;
                await Task.Delay(PollInterval, cancel);
                continue;
            }

            if (last != adapter.SimulatorId)
                log($"Collecting from {adapter.DisplayName} (adapter {adapter.AdapterVersion}).", false);
            last = adapter.SimulatorId;
            try
            {
                await run(adapter, cancel);
                await Task.Delay(PollInterval, cancel);
            }
            catch (OperationCanceledException) when (cancel.IsCancellationRequested)
            {
                throw;
            }
            catch (Exception e)
            {
                log($"{adapter.DisplayName} adapter failed: {e.Message}. Trying again in {RetryDelay.TotalSeconds:0} s.", true);
                await Task.Delay(RetryDelay, cancel);
            }
        }
    }
}
