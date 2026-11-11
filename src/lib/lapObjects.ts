import type { PoolClient } from 'pg';
import { query } from './db';
import { putLapObject, telemetryStore, type StoredLapObject } from './telemetryStorage';
import { PENDING_GRACE_SQL } from './telemetryStorageSchema';

// Writing an Expert Lap's or a Target Lap's CSV to the telemetry bucket (src/lib/expertLaps.ts, src/lib/targetLap.ts),
// the way uploads do (docs/telemetry-storage.md): a 'pending' entry in "TelemetryObjectCleanup" first, so an object
// whose row never commits is deleted later, then the object (its size checked). The caller saves its row and removes
// the entry in one transaction (dropPending). An entry already there for the key (the same bytes deleted a moment ago)
// waits out the grace instead, and the cleanup worker then keeps the object, as a row references it.

export type LapObjectDetails = { csvBytes: number; userId?: number; kind: 'expertLap' | 'targetLap' };

// The stored object, or null without a configured store or when the bucket failed (logged), so the CSV stays inline
export async function storeLapObjectPending(key: string, gzip: Buffer, sha256: string, details: LapObjectDetails): Promise<StoredLapObject | null> {
  const store = telemetryStore();
  if (!store) return null;
  try {
    await query(
      `INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, user_id, reason, not_before)
       VALUES ($1, $2, $3, $4, 'pending', now() + ${PENDING_GRACE_SQL})
       ON CONFLICT (storage_bucket, storage_key) DO UPDATE
         SET not_before = GREATEST(racingcoach."TelemetryObjectCleanup".not_before, now() + ${PENDING_GRACE_SQL})`,
      [store.provider, store.bucket, key, details.userId ?? null]
    );
    return await putLapObject(key, gzip, { sha256, ...details });
  } catch (error) {
    console.error(`${details.kind === 'expertLap' ? 'Expert' : 'Target'} lap object storage error, kept in PostgreSQL:`, error instanceof Error ? error.message : error);
    return null;
  }
}

// The object is the saved row's now
export async function dropPending(client: PoolClient, stored: StoredLapObject): Promise<void> {
  await client.query(`DELETE FROM racingcoach."TelemetryObjectCleanup" WHERE storage_bucket = $1 AND storage_key = $2 AND reason = 'pending'`, [
    stored.bucket,
    stored.key,
  ]);
}

export type LapObjectMove = { moved: number; failed: number; errors: { id: number; error: string }[] };
export const moveError = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);
