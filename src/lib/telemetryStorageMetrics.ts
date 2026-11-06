import { query } from './db';
import { drainStorageMetrics } from './telemetryStorage';

// The telemetry store's bookkeeping in Postgres (docs/telemetry-storage.md): the daily request counters the Admin page
// reads, filled from the counts telemetryStorage.ts keeps in memory, and the log of backfill, verification, cleanup,
// reconciliation and legacy purge runs ("TelemetryStorageRuns"; counts and messages, never telemetry).

// Counts a failed write couldn't save, added to the next one
let unsent: { metric: string; count: number; bytes: number }[] = [];

// Writes the counts gathered since the last flush (every minute from telemetryStorageJobs.ts). A failed write keeps
// them for the next one.
export async function flushStorageMetrics(): Promise<number> {
  const merged = new Map<string, { count: number; bytes: number }>();
  for (const { metric, count, bytes } of [...unsent, ...drainStorageMetrics()]) {
    const entry = merged.get(metric) ?? { count: 0, bytes: 0 };
    entry.count += count;
    entry.bytes += bytes;
    merged.set(metric, entry);
  }
  unsent = [];
  const rows = [...merged].map(([metric, value]) => ({ metric, ...value }));
  if (rows.length === 0) return 0;
  try {
    await query(
      `INSERT INTO racingcoach."TelemetryStorageCounters" (day, metric, count, bytes)
       SELECT (now() AT TIME ZONE 'UTC')::date, m.metric, m.count, m.bytes
       FROM unnest($1::text[], $2::bigint[], $3::bigint[]) AS m(metric, count, bytes)
       ON CONFLICT (day, metric) DO UPDATE
         SET count = racingcoach."TelemetryStorageCounters".count + EXCLUDED.count,
             bytes = racingcoach."TelemetryStorageCounters".bytes + EXCLUDED.bytes`,
      [rows.map((m) => m.metric), rows.map((m) => m.count), rows.map((m) => m.bytes)]
    );
  } catch (error) {
    unsent = rows;
    throw error;
  }
  return rows.length;
}

export type StorageRunKind = 'backfill' | 'verify' | 'cleanup' | 'reconcile' | 'purgeLegacy';

export type StorageRunCounts = { processed: number; succeeded: number; failed: number; bytes: number; details?: Record<string, unknown> };

export async function startStorageRun(kind: StorageRunKind, startedBy: number | null = null, details?: Record<string, unknown>): Promise<number> {
  const [row] = await query<{ id: string }>(
    'INSERT INTO racingcoach."TelemetryStorageRuns" (kind, started_by, details) VALUES ($1, $2, $3) RETURNING id',
    [kind, startedBy, details ? JSON.stringify(details) : null]
  );
  return Number(row.id);
}

// Records the run's counts and, when it failed, its error message only. Details are merged into what the start had.
export async function finishStorageRun(id: number, counts: StorageRunCounts, error?: unknown): Promise<void> {
  const message = error === undefined ? null : (error instanceof Error ? error.message : String(error)).slice(0, 500);
  await query(
    `UPDATE racingcoach."TelemetryStorageRuns"
     SET finished_at = now(), processed = $2, succeeded = $3, failed = $4, bytes = $5,
         details = COALESCE(details, '{}'::jsonb) || COALESCE($6::jsonb, '{}'::jsonb), error = $7
     WHERE id = $1`,
    [id, counts.processed, counts.succeeded, counts.failed, counts.bytes, counts.details ? JSON.stringify(counts.details) : null, message]
  ).catch((failure) => console.error('Telemetry storage run log error:', failure instanceof Error ? failure.message : failure));
}

// Runs and counters past a year aren't shown anywhere
export async function pruneStorageBookkeeping(): Promise<void> {
  await query(`DELETE FROM racingcoach."TelemetryStorageRuns" WHERE started_at < now() - interval '400 days'`);
  await query(`DELETE FROM racingcoach."TelemetryStorageCounters" WHERE day < (now() - interval '400 days')::date`);
}

// Messages of errors as they're logged: never a row's contents, never a credential
export const errorMessage = (error: unknown) => (error instanceof Error ? `${error.name}: ${error.message}` : String(error)).slice(0, 500);
