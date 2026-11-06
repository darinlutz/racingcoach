import { query } from './db';
import { reconcileTelemetryStorage, runTelemetryCleanup } from './telemetryCleanup';
import { telemetryStore } from './telemetryStorage';
import { flushStorageMetrics } from './telemetryStorageMetrics';

// The telemetry store's background work in the web server (src/instrumentation.ts starts it; docs/telemetry-storage.md):
// the request counters written every minute, the cleanup queue worked every 5 minutes, and the bucket reconciled with
// the database once a week. Cleanup and reconciliation take advisory locks, so several instances can run this. With no
// store configured only the counters run (and there's nothing to count).

const METRICS_MS = 60 * 1000;
const CLEANUP_MS = 5 * 60 * 1000;
const RECONCILE_CHECK_MS = 6 * 60 * 60 * 1000;
const RECONCILE_EVERY = '7 days';

const globalForJobs = globalThis as typeof globalThis & { telemetryStorageJobs?: boolean };

function every(ms: number, firstMs: number, fn: () => Promise<unknown>) {
  setTimeout(function tick() {
    void fn()
      .catch((error) => console.error('Telemetry storage job failed:', error instanceof Error ? error.message : error))
      .finally(() => setTimeout(tick, ms).unref());
  }, firstMs).unref();
}

export function startTelemetryStorageJobs(): void {
  if (globalForJobs.telemetryStorageJobs || !process.env.DATABASE_URL) return;
  globalForJobs.telemetryStorageJobs = true;
  every(METRICS_MS, METRICS_MS, () => flushStorageMetrics());
  every(CLEANUP_MS, 2 * 60 * 1000, async () => {
    if (telemetryStore()) await runTelemetryCleanup();
  });
  every(RECONCILE_CHECK_MS, 10 * 60 * 1000, async () => {
    if (!telemetryStore()) return;
    const [due] = await query<{ due: boolean }>(
      `SELECT NOT EXISTS (SELECT 1 FROM racingcoach."TelemetryStorageRuns"
                          WHERE kind = 'reconcile' AND error IS NULL AND finished_at > now() - interval '${RECONCILE_EVERY}') AS due`
    );
    if (due?.due) await reconcileTelemetryStorage();
  });
}
