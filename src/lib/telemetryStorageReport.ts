import { query } from './db';
import { telemetryStorageMode, telemetryStore } from './telemetryStorage';
import { estimateMonthlyR2Cost } from './telemetryStorageRules';
import type { StorageRunKind } from './telemetryStorageMetrics';
import { ensureUserSchema } from './users';

// The Admin page's Telemetry Storage report (docs/telemetry-storage.md). Everything comes from Postgres: the lap rows'
// storage columns, the cleanup queue, the run log and the daily counters. The bucket itself is only listed by the
// weekly reconciliation, whose latest counts are shown here.

export type TelemetryStorageReport = {
  mode: 'postgres' | 'r2';
  configured: boolean;
  bucket: string | null;
  objects: { count: number; bytes: number; csvBytes: number };
  bySimulator: { simulator: string; laps: number; objects: number; objectBytes: number; inlineBytes: number }[];
  topUsers: { userId: number; userName: string; objects: number; objectBytes: number; inlineLaps: number }[];
  migration: {
    totalLaps: number;
    inlineRemaining: number;
    copied: number;
    verified: number;
    switched: number;
    legacyKept: number;
    missing: number;
    failing: number;
    errors: { id: number; attempts: number; error: string }[];
  };
  cleanup: { queued: number; due: number; failing: number; oldest: string | null; errors: { key: string; attempts: number; error: string }[] };
  runs: {
    id: number;
    kind: StorageRunKind;
    startedAt: string;
    finishedAt: string | null;
    processed: number;
    succeeded: number;
    failed: number;
    bytes: number;
    details: Record<string, unknown> | null;
    error: string | null;
  }[];
  counters: { metric: string; count: number; bytes: number }[];
  postgres: { databaseBytes: number; collectorLapsBytes: number; inlineBytes: number; reclaimableBytes: number };
  estimatedMonthlyCost: number;
};

export async function readTelemetryStorageReport(): Promise<TelemetryStorageReport> {
  await ensureUserSchema();
  const store = telemetryStore();

  const [objects] = await query<{ count: string; bytes: string | null; csv_bytes: string | null }>(
    `SELECT count(*) AS count, sum(stored_bytes) AS bytes, sum(csv_bytes) AS csv_bytes
     FROM racingcoach."CollectorLaps" WHERE storage_key IS NOT NULL`
  );
  // octet_length reads only the stored value's header, not the whole CSV
  const bySimulator = await query<{ simulator: string; laps: string; objects: string; object_bytes: string | null; inline_bytes: string | null }>(
    `SELECT simulator, count(*) AS laps, count(storage_key) AS objects, sum(stored_bytes) FILTER (WHERE storage_key IS NOT NULL) AS object_bytes,
            sum(octet_length(csv_gzip)) AS inline_bytes
     FROM racingcoach."CollectorLaps" GROUP BY simulator ORDER BY simulator`
  );
  const topUsers = await query<{ user_id: number; user_name: string | null; objects: string; object_bytes: string | null; inline_laps: string }>(
    `SELECT l.user_id, u.user_name, count(l.storage_key) AS objects, sum(l.stored_bytes) FILTER (WHERE l.storage_key IS NOT NULL) AS object_bytes,
            count(*) FILTER (WHERE l.csv_gzip IS NOT NULL) AS inline_laps
     FROM racingcoach."CollectorLaps" l LEFT JOIN racingcoach."Users" u ON u.id = l.user_id
     GROUP BY l.user_id, u.user_name ORDER BY sum(COALESCE(l.stored_bytes, 0)) DESC, l.user_id LIMIT 20`
  );
  const [migration] = await query<Record<string, string>>(
    `SELECT count(*) AS total,
            count(*) FILTER (WHERE storage_provider = 'postgres' AND storage_key IS NULL) AS inline_remaining,
            count(*) FILTER (WHERE storage_provider = 'postgres' AND storage_key IS NOT NULL) AS copied,
            count(*) FILTER (WHERE storage_key IS NOT NULL AND verified_at IS NOT NULL) AS verified,
            count(*) FILTER (WHERE storage_provider <> 'postgres') AS switched,
            count(*) FILTER (WHERE storage_provider <> 'postgres' AND csv_gzip IS NOT NULL) AS legacy_kept,
            count(*) FILTER (WHERE storage_status = 'missing') AS missing,
            count(*) FILTER (WHERE migration_error IS NOT NULL) AS failing
     FROM racingcoach."CollectorLaps"`
  );
  const migrationErrors = await query<{ id: number; migration_attempts: number; migration_error: string }>(
    `SELECT id, migration_attempts, migration_error FROM racingcoach."CollectorLaps"
     WHERE migration_error IS NOT NULL ORDER BY migration_next_attempt_at DESC NULLS LAST, id DESC LIMIT 10`
  );
  const [cleanup] = await query<{ queued: string; due: string; failing: string; oldest: Date | null }>(
    `SELECT count(*) AS queued, count(*) FILTER (WHERE not_before <= now()) AS due,
            count(*) FILTER (WHERE attempts > 0) AS failing, min(created_at) AS oldest
     FROM racingcoach."TelemetryObjectCleanup"`
  );
  const cleanupErrors = await query<{ storage_key: string; attempts: number; last_error: string }>(
    `SELECT storage_key, attempts, last_error FROM racingcoach."TelemetryObjectCleanup"
     WHERE last_error IS NOT NULL ORDER BY attempts DESC, id LIMIT 10`
  );
  // The latest five of each kind
  const runs = await query<{
    id: string;
    kind: StorageRunKind;
    started_at: Date;
    finished_at: Date | null;
    processed: number;
    succeeded: number;
    failed: number;
    bytes: string;
    details: Record<string, unknown> | null;
    error: string | null;
  }>(
    `SELECT id, kind, started_at, finished_at, processed, succeeded, failed, bytes, details, error FROM (
       SELECT *, row_number() OVER (PARTITION BY kind ORDER BY started_at DESC) AS n FROM racingcoach."TelemetryStorageRuns"
     ) r WHERE n <= 5 ORDER BY started_at DESC`
  );
  const counters = await query<{ metric: string; count: string; bytes: string }>(
    `SELECT metric, sum(count) AS count, sum(bytes) AS bytes FROM racingcoach."TelemetryStorageCounters"
     WHERE day > (now() AT TIME ZONE 'UTC')::date - 30 GROUP BY metric ORDER BY metric`
  );
  const [sizes] = await query<{ database: string; laps: string; inline: string | null; reclaimable: string | null }>(
    `SELECT pg_database_size(current_database()) AS database,
            pg_total_relation_size('racingcoach."CollectorLaps"') AS laps,
            (SELECT sum(octet_length(csv_gzip)) FROM racingcoach."CollectorLaps") AS inline,
            (SELECT sum(octet_length(csv_gzip)) FROM racingcoach."CollectorLaps"
             WHERE storage_provider <> 'postgres' AND verified_at IS NOT NULL) AS reclaimable`
  );

  const n = (value: string | number | null | undefined) => Number(value ?? 0);
  const counted = (metric: string) => n(counters.find((row) => row.metric === metric)?.count);
  const objectBytes = n(objects.bytes);
  return {
    mode: telemetryStorageMode(),
    configured: store !== null,
    bucket: store?.bucket ?? null,
    objects: { count: n(objects.count), bytes: objectBytes, csvBytes: n(objects.csv_bytes) },
    bySimulator: bySimulator.map((row) => ({
      simulator: row.simulator,
      laps: n(row.laps),
      objects: n(row.objects),
      objectBytes: n(row.object_bytes),
      inlineBytes: n(row.inline_bytes),
    })),
    topUsers: topUsers.map((row) => ({
      userId: Number(row.user_id),
      userName: row.user_name ?? `#${row.user_id}`,
      objects: n(row.objects),
      objectBytes: n(row.object_bytes),
      inlineLaps: n(row.inline_laps),
    })),
    migration: {
      totalLaps: n(migration.total),
      inlineRemaining: n(migration.inline_remaining),
      copied: n(migration.copied),
      verified: n(migration.verified),
      switched: n(migration.switched),
      legacyKept: n(migration.legacy_kept),
      missing: n(migration.missing),
      failing: n(migration.failing),
      errors: migrationErrors.map((row) => ({ id: row.id, attempts: row.migration_attempts, error: row.migration_error })),
    },
    cleanup: {
      queued: n(cleanup.queued),
      due: n(cleanup.due),
      failing: n(cleanup.failing),
      oldest: cleanup.oldest?.toISOString() ?? null,
      errors: cleanupErrors.map((row) => ({ key: row.storage_key, attempts: row.attempts, error: row.last_error })),
    },
    runs: runs.map((row) => ({
      id: Number(row.id),
      kind: row.kind,
      startedAt: row.started_at.toISOString(),
      finishedAt: row.finished_at?.toISOString() ?? null,
      processed: row.processed,
      succeeded: row.succeeded,
      failed: row.failed,
      bytes: n(row.bytes),
      details: row.details,
      error: row.error,
    })),
    counters: counters.map((row) => ({ metric: row.metric, count: n(row.count), bytes: n(row.bytes) })),
    postgres: {
      databaseBytes: n(sizes.database),
      collectorLapsBytes: n(sizes.laps),
      inlineBytes: n(sizes.inline),
      reclaimableBytes: n(sizes.reclaimable),
    },
    // The last 30 days' writes are class A operations (each put also makes a HEAD, class B) and reads class B
    estimatedMonthlyCost: estimateMonthlyR2Cost(objectBytes, counted('put_ok') + counted('put_fail'), counted('get_ok') + counted('get_missing') + counted('put_ok')),
  };
}
