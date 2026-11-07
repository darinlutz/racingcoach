import { gunzipSync } from 'node:zlib';
import { query, transaction, withClient } from './db';
import { MAX_LAP_OBJECT_BYTES, mapLimited, putLapObject, telemetryStore } from './telemetryStorage';
import { LAP_COMPRESSION, LAP_CONTENT_TYPE, lapObjectKey, sha256Hex, STORAGE_PROVIDERS, STORAGE_STATUS } from './telemetryStorageRules';
import { PENDING_GRACE_SQL } from './telemetryStorageSchema';
import { errorMessage, finishStorageRun, startStorageRun, type StorageRunCounts, type StorageRunKind } from './telemetryStorageMetrics';
import { ensureUserSchema } from './users';

// Moving laps stored the old way (csv_gzip in "CollectorLaps") to the telemetry store, in the agreed phases
// (docs/telemetry-storage.md), each started from the Admin page's Telemetry Storage section:
//   C. backfillTelemetry copies each inline lap to an object and records its key, but the row stays a postgres row:
//      reads don't move yet.
//   D. verifyTelemetryObjects downloads every copied object again and checks its SHA-256 against the row's and
//      csv_gzip's; switchReadsToObjectStorage then points verified rows at their objects (storage_provider r2), and
//      rollbackReadsToPostgres points them back while csv_gzip is still there.
//   E. purgeLegacyTelemetry clears csv_gzip from verified object rows, only with the typed word PURGE and a backup
//      confirmed. Never automatic. Postgres frees the space for reuse after VACUUM; giving it back to the disk takes
//      VACUUM FULL, run by hand (the docs say how).
// Every step can stop and run again: rows are picked by their state, objects are named by their content, and a row
// that changed while it was copied (a re-upload with track positions) is left for the next run.

const BACKFILL_LOCK = "hashtext('racingcoach_telemetry_backfill')";
const MAX_CSV_BYTES = 25 * 1024 * 1024;

export const BACKFILL_DEFAULTS = { batchSize: 25, concurrency: 4 };
const clamp = (value: number | undefined, min: number, max: number, fallback: number) =>
  Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value as number))) : fallback;

export class PurgeNotConfirmedError extends Error {}

type CopyResult = 'copied' | 'changed' | 'failed';

// The wait doubles with each failure, as cleanupRetryDelayMs: 1, 2, 4 minutes... at most a day. SET reads the attempts
// from before the increment.
async function recordMigrationFailure(id: number, error: unknown): Promise<void> {
  await query(
    `UPDATE racingcoach."CollectorLaps"
     SET migration_attempts = migration_attempts + 1, migration_error = $2,
         migration_next_attempt_at = now() + make_interval(secs => LEAST(86400, 60 * power(2, LEAST(migration_attempts, 20))))
     WHERE id = $1`,
    [id, errorMessage(error)]
  );
}

// Copies one inline lap to the store. The CSV is read alone, so a batch never holds more than `concurrency` laps.
async function copyLap(id: number): Promise<{ result: CopyResult; bytes: number }> {
  const store = telemetryStore()!;
  const [row] = await query<{ user_id: number; client_lap_id: string; simulator: string; csv_bytes: number; csv_gzip: Buffer | null }>(
    `SELECT user_id, client_lap_id, simulator, csv_bytes, csv_gzip FROM racingcoach."CollectorLaps"
     WHERE id = $1 AND storage_provider = 'postgres' AND storage_key IS NULL AND csv_gzip IS NOT NULL`,
    [id]
  );
  if (!row?.csv_gzip) return { result: 'changed', bytes: 0 };
  try {
    const gzip = row.csv_gzip;
    // A lap that doesn't decompress isn't copied: it stays inline, reported with its error
    gunzipSync(gzip, { maxOutputLength: MAX_CSV_BYTES });
    if (gzip.length > MAX_LAP_OBJECT_BYTES) throw new Error(`Compressed lap is ${gzip.length} bytes, over the object limit`);
    const sha256 = sha256Hex(gzip);
    const key = lapObjectKey({ simulator: row.simulator, userId: Number(row.user_id), clientLapId: row.client_lap_id, sha256 });
    // Written before the object, so an object whose row never gets its key is deleted by the cleanup worker
    await query(
      `INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, user_id, reason, not_before)
       VALUES ($1, $2, $3, $4, 'pending', now() + ${PENDING_GRACE_SQL})
       ON CONFLICT (storage_bucket, storage_key) DO UPDATE
         SET reason = 'pending', not_before = GREATEST(racingcoach."TelemetryObjectCleanup".not_before, EXCLUDED.not_before)`,
      [store.provider, store.bucket, key, row.user_id]
    );
    const stored = await putLapObject(key, gzip, {
      sha256,
      csvBytes: row.csv_bytes,
      userId: Number(row.user_id),
      clientLapId: row.client_lap_id,
      simulator: row.simulator,
    });
    const updated = await transaction(async (client) => {
      const { rowCount } = await client.query(
        `UPDATE racingcoach."CollectorLaps"
         SET storage_bucket = $2, storage_key = $3, stored_bytes = $4, checksum_sha256 = $5, content_type = $6,
             compression = $7, stored_at = now(), verified_at = NULL, migration_error = NULL, migration_next_attempt_at = NULL
         WHERE id = $1 AND storage_provider = 'postgres' AND storage_key IS NULL AND encode(sha256(csv_gzip), 'hex') = $5`,
        [id, stored.bucket, stored.key, stored.storedBytes, sha256, LAP_CONTENT_TYPE, LAP_COMPRESSION]
      );
      // The pending entry stays when the row changed meanwhile, so the object is deleted unless something uses it
      if (rowCount) {
        await client.query(
          `DELETE FROM racingcoach."TelemetryObjectCleanup" WHERE storage_bucket = $1 AND storage_key = $2 AND reason = 'pending'`,
          [stored.bucket, stored.key]
        );
      }
      return (rowCount ?? 0) > 0;
    });
    return updated ? { result: 'copied', bytes: stored.storedBytes } : { result: 'changed', bytes: 0 };
  } catch (error) {
    await recordMigrationFailure(id, error);
    return { result: 'failed', bytes: 0 };
  }
}

// Phase C. One run copies batches until there's nothing left to copy, maxBatches is reached or shouldStop says so.
// Answers null when the store isn't configured or another backfill holds the lock.
export async function backfillTelemetry(
  options: { batchSize?: number; concurrency?: number; maxBatches?: number; startedBy?: number | null; shouldStop?: () => boolean } = {}
) {
  if (!telemetryStore()) return null;
  await ensureUserSchema();
  const batchSize = clamp(options.batchSize, 1, 500, BACKFILL_DEFAULTS.batchSize);
  const concurrency = clamp(options.concurrency, 1, 16, BACKFILL_DEFAULTS.concurrency);
  return withClient(async (client) => {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock(${BACKFILL_LOCK}) AS locked`);
    if (!rows[0]?.locked) return null;
    const runId = await startStorageRun('backfill', options.startedBy ?? null, { batchSize, concurrency });
    const counts: StorageRunCounts = { processed: 0, succeeded: 0, failed: 0, bytes: 0, details: { changed: 0 } };
    try {
      // Rows that fail get a next attempt in the future and rows that change get a key or stop being inline, so a
      // run never sees the same row twice
      for (let batch = 0; batch < (options.maxBatches ?? Number.POSITIVE_INFINITY); batch++) {
        if (options.shouldStop?.()) break;
        const ids = await query<{ id: number }>(
          `SELECT id FROM racingcoach."CollectorLaps"
           WHERE storage_provider = 'postgres' AND csv_gzip IS NOT NULL AND storage_key IS NULL AND expires_at > now()
             AND (migration_next_attempt_at IS NULL OR migration_next_attempt_at <= now())
           ORDER BY id LIMIT $1`,
          [batchSize]
        );
        const results = await mapLimited(ids, concurrency, (row) => copyLap(row.id));
        for (const { result, bytes } of results) {
          counts.processed++;
          if (result === 'copied') counts.succeeded++;
          else if (result === 'failed') counts.failed++;
          else (counts.details as { changed: number }).changed++;
          counts.bytes += bytes;
        }
        if (ids.length < batchSize) break;
      }
      await finishStorageRun(runId, counts);
      return { runId, ...counts };
    } catch (error) {
      await finishStorageRun(runId, counts, error);
      throw error;
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${BACKFILL_LOCK})`).catch(() => {});
    }
  });
}

// Phase D, first half. Downloads each copied object that isn't verified yet straight from the store (not the cache) and
// checks its SHA-256 against the row's checksum and, while it's there, csv_gzip's. A copy that's missing or different is
// forgotten on a postgres row (the replace trigger queues the bad object; the backfill copies it again); an object row
// is marked missing or reported, as it has nothing else to read from.
export async function verifyTelemetryObjects(
  options: { batchSize?: number; concurrency?: number; startedBy?: number | null; shouldStop?: () => boolean } = {}
) {
  const store = telemetryStore();
  if (!store) return null;
  await ensureUserSchema();
  const batchSize = clamp(options.batchSize, 1, 500, BACKFILL_DEFAULTS.batchSize);
  const concurrency = clamp(options.concurrency, 1, 16, BACKFILL_DEFAULTS.concurrency);
  const runId = await startStorageRun('verify', options.startedBy ?? null, { batchSize, concurrency });
  const counts: StorageRunCounts = { processed: 0, succeeded: 0, failed: 0, bytes: 0, details: { missing: 0, mismatched: 0 } };
  const details = counts.details as { missing: number; mismatched: number };
  try {
    let after = 0;
    for (;;) {
      if (options.shouldStop?.()) break;
      const rows = await query<{
        id: number;
        storage_provider: string;
        storage_bucket: string;
        storage_key: string;
        checksum_sha256: string | null;
        inline_sha: string | null;
      }>(
        `SELECT id, storage_provider, storage_bucket, storage_key, checksum_sha256,
                CASE WHEN csv_gzip IS NULL THEN NULL ELSE encode(sha256(csv_gzip), 'hex') END AS inline_sha
         FROM racingcoach."CollectorLaps"
         WHERE storage_key IS NOT NULL AND verified_at IS NULL AND storage_status <> 'missing' AND expires_at > now() AND id > $1
         ORDER BY id LIMIT $2`,
        [after, batchSize]
      );
      if (rows.length === 0) break;
      after = rows.at(-1)!.id;
      await mapLimited(rows, concurrency, async (row) => {
        counts.processed++;
        try {
          if (row.storage_bucket !== store.bucket) throw new Error(`Object is in bucket ${row.storage_bucket}, not ${store.bucket}`);
          const bytes = await store.getObject(row.storage_key, MAX_LAP_OBJECT_BYTES);
          const sha = bytes ? sha256Hex(bytes) : null;
          const good = sha !== null && sha === row.checksum_sha256 && (row.inline_sha === null || row.inline_sha === sha);
          if (good) {
            await query('UPDATE racingcoach."CollectorLaps" SET verified_at = now() WHERE id = $1 AND storage_key = $2', [row.id, row.storage_key]);
            counts.succeeded++;
            counts.bytes += bytes!.length;
            return;
          }
          counts.failed++;
          if (bytes) details.mismatched++;
          else details.missing++;
          const problem = bytes ? 'verify: checksum mismatch' : 'verify: object missing';
          if (row.storage_provider === STORAGE_PROVIDERS.postgres && row.inline_sha) {
            await query(
              `UPDATE racingcoach."CollectorLaps"
               SET storage_bucket = NULL, storage_key = NULL, stored_bytes = NULL, stored_at = NULL, verified_at = NULL,
                   checksum_sha256 = $3, migration_error = $4, migration_next_attempt_at = NULL
               WHERE id = $1 AND storage_key = $2 AND storage_provider = 'postgres'`,
              [row.id, row.storage_key, row.inline_sha, problem]
            );
          } else {
            await query(
              `UPDATE racingcoach."CollectorLaps" SET migration_error = $3${bytes ? '' : `, storage_status = '${STORAGE_STATUS.missing}'`}
               WHERE id = $1 AND storage_key = $2`,
              [row.id, row.storage_key, problem]
            );
          }
        } catch (error) {
          counts.failed++;
          await query('UPDATE racingcoach."CollectorLaps" SET migration_error = $2 WHERE id = $1', [row.id, `verify: ${errorMessage(error)}`.slice(0, 500)]);
        }
      });
    }
    await finishStorageRun(runId, counts);
    return { runId, ...counts };
  } catch (error) {
    await finishStorageRun(runId, counts, error);
    throw error;
  }
}

const SWITCH_BATCH = 200;

// Phase D, second half: verified copies become what's read. Only where the object's checksum is still csv_gzip's, so a
// lap re-uploaded since its copy was verified stays inline.
export async function switchReadsToObjectStorage(): Promise<number> {
  await ensureUserSchema();
  let switched = 0;
  for (;;) {
    const rows = await query(
      `UPDATE racingcoach."CollectorLaps" SET storage_provider = $1, storage_status = $2
       WHERE id IN (
         SELECT id FROM racingcoach."CollectorLaps"
         WHERE storage_provider = 'postgres' AND storage_key IS NOT NULL AND verified_at IS NOT NULL
           AND csv_gzip IS NOT NULL AND checksum_sha256 = encode(sha256(csv_gzip), 'hex')
         ORDER BY id LIMIT ${SWITCH_BATCH} FOR UPDATE SKIP LOCKED)
       RETURNING id`,
      [STORAGE_PROVIDERS.r2, STORAGE_STATUS.stored]
    );
    switched += rows.length;
    if (rows.length < SWITCH_BATCH) return switched;
  }
}

// The rollback: object rows that still have csv_gzip are read from it again. Their keys stay, so no object is deleted
// and switching back needs no new copy.
export async function rollbackReadsToPostgres(): Promise<number> {
  await ensureUserSchema();
  let rolledBack = 0;
  for (;;) {
    const rows = await query(
      `UPDATE racingcoach."CollectorLaps" SET storage_provider = 'postgres', storage_status = $1
       WHERE id IN (
         SELECT id FROM racingcoach."CollectorLaps" WHERE storage_provider <> 'postgres' AND csv_gzip IS NOT NULL
         ORDER BY id LIMIT ${SWITCH_BATCH} FOR UPDATE SKIP LOCKED)
       RETURNING id`,
      [STORAGE_STATUS.inline]
    );
    rolledBack += rows.length;
    if (rows.length < SWITCH_BATCH) return rolledBack;
  }
}

export const PURGE_CONFIRMATION = 'PURGE';
const PURGE_BATCH = 50;

// Phase E: clears csv_gzip from rows read from verified objects, in small batches. Needs the typed word and the Admin's
// confirmation that a database backup was taken, both recorded with who started it. After it, rollback is impossible
// for those rows: the objects are the only copy.
export async function purgeLegacyTelemetry(options: { confirm: string; backupTaken: boolean; startedBy: number }) {
  if (options.confirm !== PURGE_CONFIRMATION || options.backupTaken !== true) {
    throw new PurgeNotConfirmedError('Type PURGE and confirm a database backup was taken');
  }
  await ensureUserSchema();
  const runId = await startStorageRun('purgeLegacy', options.startedBy, { backupTaken: true, confirmedBy: options.startedBy });
  const counts: StorageRunCounts = { processed: 0, succeeded: 0, failed: 0, bytes: 0 };
  try {
    for (;;) {
      const rows = await query<{ bytes: number }>(
        `WITH doomed AS (
           SELECT id, octet_length(csv_gzip) AS bytes FROM racingcoach."CollectorLaps"
           WHERE storage_provider <> 'postgres' AND verified_at IS NOT NULL AND csv_gzip IS NOT NULL
           ORDER BY id LIMIT ${PURGE_BATCH} FOR UPDATE SKIP LOCKED
         )
         UPDATE racingcoach."CollectorLaps" l SET csv_gzip = NULL FROM doomed WHERE l.id = doomed.id RETURNING doomed.bytes`
      );
      counts.processed += rows.length;
      counts.succeeded += rows.length;
      counts.bytes += rows.reduce((sum, row) => sum + Number(row.bytes), 0);
      if (rows.length < PURGE_BATCH) break;
    }
    await finishStorageRun(runId, counts);
    return { runId, ...counts };
  } catch (error) {
    await finishStorageRun(runId, counts, error);
    throw error;
  }
}

// A plain VACUUM: the purged space becomes reusable inside Postgres, without the exclusive lock VACUUM FULL takes. It
// doesn't shrink the files; VACUUM FULL, by hand, does (docs/telemetry-storage.md).
// The pool's statement timeout (src/lib/db.ts) would stop a VACUUM of a big table, so this connection has none
export async function vacuumCollectorLaps(): Promise<void> {
  await withClient(async (client) => {
    await client.query('SET statement_timeout = 0');
    try {
      await client.query('VACUUM (ANALYZE) racingcoach."CollectorLaps"');
    } finally {
      await client.query('RESET statement_timeout');
    }
  });
}

// The Admin page's long-running actions, one at a time on this server, in the background so the request returns at
// once; the page polls the status. Another server instance still can't run a second backfill (advisory lock).
export type StorageTaskKind = Extract<StorageRunKind, 'backfill' | 'verify' | 'cleanup' | 'reconcile' | 'purgeLegacy'>;
export type StorageTaskStatus = {
  kind: StorageTaskKind | null;
  running: boolean;
  stopping: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  result: unknown;
  error: string | null;
};

const globalForTask = globalThis as typeof globalThis & { telemetryStorageTask?: StorageTaskStatus & { stop: boolean } };
const task = () =>
  (globalForTask.telemetryStorageTask ??= {
    kind: null,
    running: false,
    stopping: false,
    stop: false,
    startedAt: null,
    finishedAt: null,
    result: null,
    error: null,
  });

export function storageTaskStatus(): StorageTaskStatus {
  const { stop, ...status } = task();
  return { ...status, stopping: stop && status.running };
}

// Starts fn in the background; false when another action is still running
export function startStorageTask(kind: StorageTaskKind, fn: (shouldStop: () => boolean) => Promise<unknown>): boolean {
  const current = task();
  if (current.running) return false;
  Object.assign(current, { kind, running: true, stop: false, startedAt: new Date().toISOString(), finishedAt: null, result: null, error: null });
  void fn(() => current.stop)
    .then((result) => {
      current.result = result ?? null;
    })
    .catch((error) => {
      current.error = errorMessage(error);
      console.error(`Telemetry storage ${kind} failed:`, current.error);
    })
    .finally(() => {
      current.running = false;
      current.finishedAt = new Date().toISOString();
    });
  return true;
}

export function stopStorageTask(): boolean {
  const current = task();
  if (!current.running) return false;
  current.stop = true;
  return true;
}
