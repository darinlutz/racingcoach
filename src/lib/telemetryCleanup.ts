import { query, withClient } from './db';
import { deleteLapObject, listLapObjects, telemetryStore } from './telemetryStorage';
import { cleanupRetryDelayMs, isExpertLapObjectKey, isTargetLapObjectKey, STORAGE_PROVIDERS, STORAGE_STATUS, TELEMETRY_PREFIX } from './telemetryStorageRules';
import { PENDING_GRACE_SQL } from './telemetryStorageSchema';
import { errorMessage, finishStorageRun, pruneStorageBookkeeping, startStorageRun, type StorageRunCounts } from './telemetryStorageMetrics';
import { ensureUserSchema } from './users';

// Deleting lap objects from the telemetry store (docs/telemetry-storage.md). Nothing here decides what's deleted: the
// triggers on "CollectorLaps" (telemetryStorageSchema.ts) queue an object in "TelemetryObjectCleanup" in the same
// statement that deletes its row or moves it to a new key, whatever made the change (the lap retention job, a privacy
// erasure, Delete Account's cascade, a re-upload with track positions), and uploads leave a 'pending' entry until their
// row is committed. This worker deletes the queued objects, retrying failures with backoff, and the weekly
// reconciliation finds what slipped through anyway: objects no row references and rows whose object is gone.

const CLEANUP_LOCK = "hashtext('racingcoach_telemetry_cleanup')";
const RECONCILE_LOCK = "hashtext('racingcoach_telemetry_reconcile')";

export const CLEANUP_BATCH_SIZE = 100;
// A run stops after this many batches; the rest wait for the next run five minutes later
const CLEANUP_MAX_BATCHES = 50;

type CleanupEntry = { id: string; storage_bucket: string; storage_key: string; attempts: number };

// Holds a session advisory lock on one connection for fn, or answers null when another run (another server instance,
// or the last one still going) holds it
async function withLock<T>(lock: string, fn: () => Promise<T>): Promise<T | null> {
  return withClient(async (client) => {
    const { rows } = await client.query(`SELECT pg_try_advisory_lock(${lock}) AS locked`);
    if (!rows[0]?.locked) return null;
    try {
      return await fn();
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${lock})`).catch(() => {});
    }
  });
}

// An Expert Lap's object is referenced by "ExpertLaps" and a Target Lap's by "Users" (their columns exist, as their
// triggers queued the key), a lap's by "CollectorLaps"
function referenceQuery(key: string): string {
  if (isTargetLapObjectKey(key))
    return 'SELECT 1 FROM racingcoach."Users" WHERE "TargetLapStorageBucket" = $1 AND "TargetLapStorageKey" = $2';
  return `SELECT 1 FROM racingcoach."${isExpertLapObjectKey(key) ? 'ExpertLaps' : 'CollectorLaps'}" WHERE storage_bucket = $1 AND storage_key = $2`;
}
const referenced = async (bucket: string, key: string) =>
  (await query<{ used: boolean }>(`SELECT EXISTS (${referenceQuery(key)}) AS used`, [bucket, key]))[0].used;

// Deletes the objects whose cleanup is due. An object a lap row still references (a re-upload of the same bytes, an
// upload whose row did commit) is never deleted: only its entry goes. Answers null when the store isn't configured or
// another run holds the lock.
export async function runTelemetryCleanup(options: { batchSize?: number; maxBatches?: number; startedBy?: number | null } = {}) {
  if (!telemetryStore()) return null;
  await ensureUserSchema();
  const batchSize = options.batchSize ?? CLEANUP_BATCH_SIZE;
  return withLock(CLEANUP_LOCK, async () => {
    const runId = await startStorageRun('cleanup', options.startedBy ?? null);
    const counts: StorageRunCounts = { processed: 0, succeeded: 0, failed: 0, bytes: 0, details: { kept: 0 } };
    try {
      for (let batch = 0; batch < (options.maxBatches ?? CLEANUP_MAX_BATCHES); batch++) {
        // Failures move their not_before into the future, so a batch never picks the same entry twice in one run
        const entries = await query<CleanupEntry>(
          `SELECT id, storage_bucket, storage_key, attempts FROM racingcoach."TelemetryObjectCleanup"
           WHERE not_before <= now() ORDER BY not_before, id LIMIT $1`,
          [batchSize]
        );
        for (const entry of entries) {
          counts.processed++;
          try {
            if (await referenced(entry.storage_bucket, entry.storage_key)) {
              (counts.details as { kept: number }).kept++;
            } else {
              await deleteLapObject(entry.storage_bucket, entry.storage_key);
            }
            await query('DELETE FROM racingcoach."TelemetryObjectCleanup" WHERE id = $1', [entry.id]);
            counts.succeeded++;
          } catch (error) {
            counts.failed++;
            const attempts = entry.attempts + 1;
            await query(
              `UPDATE racingcoach."TelemetryObjectCleanup"
               SET attempts = $2, last_error = $3, not_before = now() + make_interval(secs => $4)
               WHERE id = $1`,
              [entry.id, attempts, errorMessage(error), cleanupRetryDelayMs(attempts) / 1000]
            );
          }
        }
        if (entries.length < batchSize) break;
      }
      await pruneStorageBookkeeping();
      await finishStorageRun(runId, counts);
      return { runId, ...counts };
    } catch (error) {
      await finishStorageRun(runId, counts, error);
      throw error;
    }
  });
}

// Compares the bucket with the database: objects under telemetry/ that no lap row references and nothing has queued
// are queued as orphans (after the pending-upload grace, and the worker checks references again before deleting), and
// rows whose object isn't there are marked missing. Lists the whole prefix, so it's for the weekly run and the Admin
// page's Reconcile Now, never a routine page. Keys are held in memory: about 150 bytes each.
export async function reconcileTelemetryStorage(options: { startedBy?: number | null } = {}) {
  const store = telemetryStore();
  if (!store) return null;
  await ensureUserSchema();
  return withLock(RECONCILE_LOCK, async () => {
    const runId = await startStorageRun('reconcile', options.startedBy ?? null);
    const counts: StorageRunCounts = { processed: 0, succeeded: 0, failed: 0, bytes: 0 };
    try {
      // Rows read after the listing would include objects written while it ran, which it may have passed already, so
      // only rows stored before it started are judged missing
      const [{ started }] = await query<{ started: Date }>('SELECT now() AS started');
      const listed = new Map<string, number>();
      for await (const object of listLapObjects(TELEMETRY_PREFIX)) {
        listed.set(object.key, object.size);
        counts.bytes += object.size;
      }
      counts.processed = listed.size;

      const rows = await query<{ id: number; storage_key: string; storage_provider: string; storage_status: string; stored_at: Date | null }>(
        `SELECT id, storage_key, storage_provider, storage_status, stored_at FROM racingcoach."CollectorLaps"
         WHERE storage_bucket = $1 AND storage_key IS NOT NULL`,
        [store.bucket]
      );
      const queued = new Set(
        (await query<{ storage_key: string }>('SELECT storage_key FROM racingcoach."TelemetryObjectCleanup" WHERE storage_bucket = $1', [store.bucket])).map(
          (row) => row.storage_key
        )
      );
      const referencedKeys = new Set(rows.map((row) => row.storage_key));

      let orphans = 0;
      let orphanBytes = 0;
      for (const [key, size] of listed) {
        if (referencedKeys.has(key) || queued.has(key)) continue;
        const inserted = await query(
          `INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, reason, not_before)
           VALUES ($1, $2, $3, 'orphan', now() + ${PENDING_GRACE_SQL}) ON CONFLICT (storage_bucket, storage_key) DO NOTHING RETURNING id`,
          [store.provider, store.bucket, key]
        );
        if (inserted.length > 0) {
          orphans++;
          orphanBytes += size;
        }
      }

      let missing = 0;
      let found = 0;
      for (const row of rows) {
        const there = listed.has(row.storage_key);
        if (!there && row.stored_at && row.stored_at < started) {
          missing++;
          if (row.storage_provider === STORAGE_PROVIDERS.postgres) {
            // Still read from csv_gzip: forget the copy so the backfill makes it again
            await query(
              `UPDATE racingcoach."CollectorLaps"
               SET storage_bucket = NULL, storage_key = NULL, stored_bytes = NULL, stored_at = NULL, verified_at = NULL,
                   checksum_sha256 = encode(sha256(csv_gzip), 'hex'), migration_error = 'reconcile: object missing'
               WHERE id = $1 AND storage_key = $2 AND storage_provider = 'postgres'`,
              [row.id, row.storage_key]
            );
          } else if (row.storage_status !== STORAGE_STATUS.missing) {
            await query(`UPDATE racingcoach."CollectorLaps" SET storage_status = $3 WHERE id = $1 AND storage_key = $2`, [
              row.id,
              row.storage_key,
              STORAGE_STATUS.missing,
            ]);
          }
        } else if (there && row.storage_status === STORAGE_STATUS.missing && row.storage_provider !== STORAGE_PROVIDERS.postgres) {
          found++;
          await query(`UPDATE racingcoach."CollectorLaps" SET storage_status = $3 WHERE id = $1 AND storage_key = $2`, [
            row.id,
            row.storage_key,
            STORAGE_STATUS.stored,
          ]);
        }
      }
      counts.succeeded = listed.size - orphans;
      counts.failed = missing;
      counts.details = { objects: listed.size, objectBytes: counts.bytes, orphans, orphanBytes, missing, foundAgain: found };
      await finishStorageRun(runId, counts);
      return { runId, ...counts, orphans, missing };
    } catch (error) {
      await finishStorageRun(runId, counts, error);
      throw error;
    }
  });
}
