import { gunzipSync, gzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { query, transaction } from './db';
import { checkTargetLap, lapFileNameParts } from './targetLap';
import { getLapObject, lapObjectExists, putLapObject, telemetryStorageMode, telemetryStore, type StoredLapObject } from './telemetryStorage';
import { expertLapObjectKey, sha256Hex, STORAGE_PROVIDERS } from './telemetryStorageRules';
import { PENDING_GRACE_SQL } from './telemetryStorageSchema';
import { ensureUserSchema } from './users';

// Expert Laps (racingcoach."ExpertLaps"): lap CSVs Coaches and Admins drop on the Coach page's Expert Laps
// section (src/components/ExpertLapsManager.tsx, /api/coach/expert-laps), at most one per car and track
// (matched ignoring case). Not tied to a driver: shared by every user. The car, track, driver and lap time come
// from the Garage 61 / RacingCoach file name, as lap CSVs carry no car or track. CSVs are gzip-compressed and only
// this file reads or writes them.
//
// Where each CSV is kept follows the uploaded laps' design (docs/telemetry-storage.md): storage_provider says
// postgres (inline in csv_gzip) or r2 (an object in the telemetry bucket, expert-laps/{sha256}.csv.gz, with its
// bucket, key, size and SHA-256 on the row). New ones go to the bucket when TELEMETRY_STORAGE_MODE is r2 and the
// store is configured, else inline (also when the bucket fails). Reads follow each row. Triggers queue an object
// in "TelemetryObjectCleanup" whenever its row is deleted or moves off it (a replacement, a move back to Postgres),
// and the cleanup worker deletes it once no Expert Lap references it. The Admin page's Telemetry Storage section
// moves the existing ones across, or back (moveExpertLapsToObjectStorage, moveExpertLapsToPostgres).

export type ExpertLapInfo = {
  id: number;
  car: string;
  track: string;
  driver: string;
  lapTime: string;
  fileName: string;
  uploadedAt: string;
};

export class ExpertLapError extends Error {
  constructor(public code: 'badFileName') {
    super(code);
  }
}

const EXPERT_LAP_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS racingcoach."ExpertLaps" (
     id SERIAL PRIMARY KEY,
     car TEXT NOT NULL,
     track TEXT NOT NULL,
     driver TEXT NOT NULL,
     lap_time TEXT NOT NULL,
     file_name TEXT NOT NULL,
     csv_gzip BYTEA NOT NULL,
     uploaded_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "ExpertLaps_car_track" ON racingcoach."ExpertLaps" (lower(car), lower(track))',
  // Where the CSV is: existing rows read as inline Postgres laps, which they are
  `ALTER TABLE racingcoach."ExpertLaps" ADD COLUMN IF NOT EXISTS storage_provider TEXT NOT NULL DEFAULT 'postgres'`,
  `ALTER TABLE racingcoach."ExpertLaps" ADD COLUMN IF NOT EXISTS storage_bucket TEXT`,
  `ALTER TABLE racingcoach."ExpertLaps" ADD COLUMN IF NOT EXISTS storage_key TEXT`,
  `ALTER TABLE racingcoach."ExpertLaps" ADD COLUMN IF NOT EXISTS stored_bytes INTEGER`,
  // SHA-256 (hex) of the compressed bytes, checked on every read of an object
  `ALTER TABLE racingcoach."ExpertLaps" ADD COLUMN IF NOT EXISTS checksum_sha256 TEXT`,
  `ALTER TABLE racingcoach."ExpertLaps" ADD COLUMN IF NOT EXISTS stored_at TIMESTAMPTZ`,
  `ALTER TABLE racingcoach."ExpertLaps" ALTER COLUMN csv_gzip DROP NOT NULL`,
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expert_laps_storage_check'
                    AND conrelid = 'racingcoach."ExpertLaps"'::regclass) THEN
       ALTER TABLE racingcoach."ExpertLaps" ADD CONSTRAINT expert_laps_storage_check CHECK (
         (storage_provider = 'postgres' AND csv_gzip IS NOT NULL)
         OR (storage_provider <> 'postgres' AND storage_key IS NOT NULL AND storage_bucket IS NOT NULL));
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS expert_laps_storage_key_idx ON racingcoach."ExpertLaps" (storage_bucket, storage_key)
   WHERE storage_key IS NOT NULL`,
  // Like "CollectorLaps"' triggers (telemetryStorageSchema.ts), with no user
  `CREATE OR REPLACE FUNCTION racingcoach.queue_expert_lap_object_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, user_id, reason)
     VALUES (OLD.storage_provider, OLD.storage_bucket, OLD.storage_key, NULL,
             CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'replaced' END)
     ON CONFLICT (storage_bucket, storage_key) DO UPDATE
       SET reason = EXCLUDED.reason, not_before = LEAST(racingcoach."TelemetryObjectCleanup".not_before, now());
     RETURN NULL;
   END $$`,
  `DROP TRIGGER IF EXISTS expert_laps_object_deleted ON racingcoach."ExpertLaps"`,
  `CREATE TRIGGER expert_laps_object_deleted AFTER DELETE ON racingcoach."ExpertLaps"
   FOR EACH ROW WHEN (OLD.storage_key IS NOT NULL)
   EXECUTE FUNCTION racingcoach.queue_expert_lap_object_cleanup()`,
  `DROP TRIGGER IF EXISTS expert_laps_object_replaced ON racingcoach."ExpertLaps"`,
  `CREATE TRIGGER expert_laps_object_replaced AFTER UPDATE OF storage_key, storage_bucket ON racingcoach."ExpertLaps"
   FOR EACH ROW WHEN (OLD.storage_key IS NOT NULL
     AND (OLD.storage_key IS DISTINCT FROM NEW.storage_key OR OLD.storage_bucket IS DISTINCT FROM NEW.storage_bucket))
   EXECUTE FUNCTION racingcoach.queue_expert_lap_object_cleanup()`,
];

let schemaReady: Promise<void> | null = null;
export function ensureExpertLapSchema(): Promise<void> {
  schemaReady ??= (async () => {
    // "TelemetryObjectCleanup" comes with the user schema
    await ensureUserSchema();
    await transaction(async (client) => {
      // One server at a time: the triggers are dropped and made again
      await client.query("SELECT pg_advisory_xact_lock(hashtext('racingcoach_expert_lap_schema'))");
      for (const statement of EXPERT_LAP_SCHEMA) await client.query(statement);
    });
  })().catch((error) => {
    schemaReady = null; // try again next time
    throw error;
  });
  return schemaReady;
}

type ExpertLapRow = {
  id: number;
  car: string;
  track: string;
  driver: string;
  lap_time: string;
  file_name: string;
  uploaded_at: Date;
};

const INFO_COLUMNS = 'id, car, track, driver, lap_time, file_name, uploaded_at';

function toInfo(row: ExpertLapRow): ExpertLapInfo {
  return {
    id: row.id,
    car: row.car,
    track: row.track,
    driver: row.driver,
    lapTime: row.lap_time,
    fileName: row.file_name,
    uploadedAt: new Date(row.uploaded_at).toISOString(),
  };
}

export async function listExpertLaps(): Promise<ExpertLapInfo[]> {
  await ensureExpertLapSchema();
  const rows = await query<ExpertLapRow>(
    `SELECT ${INFO_COLUMNS} FROM racingcoach."ExpertLaps" ORDER BY lower(track), lower(car)`
  );
  return rows.map(toInfo);
}

async function findExpertLap(car: string, track: string): Promise<ExpertLapInfo | null> {
  const [row] = await query<ExpertLapRow>(
    `SELECT ${INFO_COLUMNS} FROM racingcoach."ExpertLaps" WHERE lower(car) = lower($1) AND lower(track) = lower($2)`,
    [car, track]
  );
  return row ? toInfo(row) : null;
}

// Writes the compressed CSV to the telemetry bucket, after a 'pending' cleanup entry so an object whose row never
// commits is deleted later (and one already queued for deletion waits out the grace, then is kept once a row references
// it). Null when it isn't to go there, or the bucket failed, in which case the CSV stays inline.
async function storeExpertLapObject(gzip: Buffer, sha256: string, csvBytes: number): Promise<StoredLapObject | null> {
  const store = telemetryStore();
  if (!store) return null;
  const key = expertLapObjectKey(sha256);
  try {
    await query(
      `INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, reason, not_before)
       VALUES ($1, $2, $3, 'pending', now() + ${PENDING_GRACE_SQL})
       ON CONFLICT (storage_bucket, storage_key) DO UPDATE
         SET not_before = GREATEST(racingcoach."TelemetryObjectCleanup".not_before, now() + ${PENDING_GRACE_SQL})`,
      [store.provider, store.bucket, key]
    );
    return await putLapObject(key, gzip, { sha256, csvBytes, kind: 'expertLap' });
  } catch (error) {
    console.error('Expert lap object storage error, kept in PostgreSQL:', error instanceof Error ? error.message : error);
    return null;
  }
}

const dropPending = (client: PoolClient, stored: StoredLapObject) =>
  client.query(`DELETE FROM racingcoach."TelemetryObjectCleanup" WHERE storage_bucket = $1 AND storage_key = $2 AND reason = 'pending'`, [
    stored.bucket,
    stored.key,
  ]);

// Saves the lap. Without replace, an Expert Lap already there for its car and track is left alone and answered
// as { existing }; with replace, it's overwritten. Throws TargetLapError when it isn't a lap CSV, and
// ExpertLapError when its name doesn't say the car and track.
export async function saveExpertLap(
  userId: number,
  fileName: string,
  csv: string,
  replace: boolean
): Promise<{ saved: ExpertLapInfo } | { existing: ExpertLapInfo }> {
  checkTargetLap(fileName, csv);
  const parts = lapFileNameParts(fileName);
  if (!parts) throw new ExpertLapError('badFileName');
  await ensureExpertLapSchema();
  if (!replace) {
    // Nothing is written to the bucket for a lap that won't be saved
    const existing = await findExpertLap(parts.car, parts.track);
    if (existing) return { existing };
  }

  const gzip = gzipSync(csv);
  const sha256 = sha256Hex(gzip);
  const stored = telemetryStorageMode() === 'r2' ? await storeExpertLapObject(gzip, sha256, Buffer.byteLength(csv)) : null;
  const params = [
    parts.car,
    parts.track,
    parts.driver,
    parts.lapTime,
    fileName,
    stored ? null : gzip,
    userId,
    stored?.provider ?? STORAGE_PROVIDERS.postgres,
    stored?.bucket ?? null,
    stored?.key ?? null,
    stored?.storedBytes ?? null,
    sha256,
  ];
  const row = await transaction(async (client) => {
    const { rows } = await client.query<ExpertLapRow>(
      `INSERT INTO racingcoach."ExpertLaps"
         (car, track, driver, lap_time, file_name, csv_gzip, uploaded_by,
          storage_provider, storage_bucket, storage_key, stored_bytes, checksum_sha256, stored_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, CASE WHEN $10::text IS NULL THEN NULL ELSE now() END)
       ON CONFLICT ((lower(car)), (lower(track))) ${
         replace
           ? `DO UPDATE SET car = EXCLUDED.car, track = EXCLUDED.track, driver = EXCLUDED.driver,
                lap_time = EXCLUDED.lap_time, file_name = EXCLUDED.file_name, csv_gzip = EXCLUDED.csv_gzip,
                uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now(),
                storage_provider = EXCLUDED.storage_provider, storage_bucket = EXCLUDED.storage_bucket,
                storage_key = EXCLUDED.storage_key, stored_bytes = EXCLUDED.stored_bytes,
                checksum_sha256 = EXCLUDED.checksum_sha256, stored_at = EXCLUDED.stored_at`
           : 'DO NOTHING'
       }
       RETURNING ${INFO_COLUMNS}`,
      params
    );
    // Saved: the object is the row's now. Not saved (another arrived first): the pending entry deletes it later
    if (rows[0] && stored) await dropPending(client, stored);
    return rows[0];
  });
  if (row) return { saved: toInfo(row) };
  return { existing: (await findExpertLap(parts.car, parts.track))! };
}

type StorageRow = {
  id: number;
  file_name: string;
  csv_gzip: Buffer | null;
  storage_provider: string;
  storage_bucket: string | null;
  storage_key: string | null;
  checksum_sha256: string | null;
};

// The lap's CSV, from wherever its row says it is; null when there's no such lap, or its object is gone. A bucket
// that fails, or bytes that don't match the checksum, throw
export async function readExpertLap(id: number): Promise<{ fileName: string; csv: string } | null> {
  await ensureExpertLapSchema();
  const [row] = await query<StorageRow>(
    `SELECT id, file_name, csv_gzip, storage_provider, storage_bucket, storage_key, checksum_sha256
     FROM racingcoach."ExpertLaps" WHERE id = $1`,
    [id]
  );
  if (!row) return null;
  let gzip = row.csv_gzip;
  if (row.storage_provider !== STORAGE_PROVIDERS.postgres) {
    gzip = await getLapObject(row.storage_bucket!, row.storage_key!, row.checksum_sha256);
    if (!gzip) console.error(`Expert lap ${id}: its object is missing from the telemetry bucket`);
  }
  return gzip ? { fileName: row.file_name, csv: gunzipSync(gzip).toString('utf8') } : null;
}

export async function deleteExpertLap(id: number): Promise<boolean> {
  await ensureExpertLapSchema();
  // The delete trigger queues its object, if it has one
  const rows = await query('DELETE FROM racingcoach."ExpertLaps" WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

export type ExpertLapStorage = { inline: number; inlineBytes: number; stored: number; storedBytes: number };

// How many Expert Laps are kept where, for the Admin page
export async function readExpertLapStorage(): Promise<ExpertLapStorage> {
  await ensureExpertLapSchema();
  const [row] = await query<{ inline: string; inline_bytes: string | null; stored: string; stored_bytes: string | null }>(
    `SELECT count(*) FILTER (WHERE storage_provider = 'postgres') AS inline,
            sum(octet_length(csv_gzip)) FILTER (WHERE storage_provider = 'postgres') AS inline_bytes,
            count(*) FILTER (WHERE storage_provider <> 'postgres') AS stored,
            sum(stored_bytes) FILTER (WHERE storage_provider <> 'postgres') AS stored_bytes
     FROM racingcoach."ExpertLaps"`
  );
  return { inline: Number(row.inline), inlineBytes: Number(row.inline_bytes ?? 0), stored: Number(row.stored), storedBytes: Number(row.stored_bytes ?? 0) };
}

export type ExpertLapMove = { moved: number; failed: number; errors: { id: number; error: string }[] };
const message = (error: unknown) => (error instanceof Error ? error.message : String(error)).slice(0, 300);

// The Admin page's Move Expert Laps to object storage: copies each inline Expert Lap to the bucket, checks the stored
// object's size and checksum, then points its row at it and clears csv_gzip in one UPDATE, only if the row is still the
// same inline lap (a replacement meanwhile leaves its pending entry to delete the copy). Null without the bucket.
export async function moveExpertLapsToObjectStorage(): Promise<ExpertLapMove | null> {
  const store = telemetryStore();
  if (!store) return null;
  await ensureExpertLapSchema();
  const rows = await query<{ id: number; csv_gzip: Buffer }>(
    `SELECT id, csv_gzip FROM racingcoach."ExpertLaps" WHERE storage_provider = 'postgres' ORDER BY id`
  );
  const result: ExpertLapMove = { moved: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const gzip = row.csv_gzip;
      const sha256 = sha256Hex(gzip);
      const stored = await storeExpertLapObject(gzip, sha256, gunzipSync(gzip).length);
      if (!stored) throw new Error('the telemetry bucket refused the copy');
      const head = await lapObjectExists(stored.bucket, stored.key);
      if (!head || head.size !== gzip.length || (head.sha256 && head.sha256 !== sha256)) throw new Error('the stored copy does not match');
      const updated = await transaction(async (client) => {
        const { rowCount } = await client.query(
          `UPDATE racingcoach."ExpertLaps"
           SET storage_provider = $2, storage_bucket = $3, storage_key = $4, stored_bytes = $5, checksum_sha256 = $6,
               stored_at = now(), csv_gzip = NULL
           WHERE id = $1 AND storage_provider = 'postgres' AND encode(sha256(csv_gzip), 'hex') = $6`,
          [row.id, stored.provider, stored.bucket, stored.key, stored.storedBytes, sha256]
        );
        if (rowCount) await dropPending(client, stored);
        return (rowCount ?? 0) > 0;
      });
      if (updated) result.moved++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: row.id, error: message(error) });
    }
  }
  return result;
}

// Move Expert Laps back to PostgreSQL: the rollback. Downloads each object (checking its checksum), stores it inline
// and forgets the key, which queues the object for deletion. A lap whose object is gone is reported and left alone.
export async function moveExpertLapsToPostgres(): Promise<ExpertLapMove> {
  await ensureExpertLapSchema();
  const rows = await query<StorageRow>(
    `SELECT id, file_name, csv_gzip, storage_provider, storage_bucket, storage_key, checksum_sha256
     FROM racingcoach."ExpertLaps" WHERE storage_provider <> 'postgres' ORDER BY id`
  );
  const result: ExpertLapMove = { moved: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const gzip = await getLapObject(row.storage_bucket!, row.storage_key!, row.checksum_sha256);
      if (!gzip) throw new Error('its object is missing from the telemetry bucket');
      const updated = await query(
        `UPDATE racingcoach."ExpertLaps"
         SET storage_provider = 'postgres', csv_gzip = $3, storage_bucket = NULL, storage_key = NULL, stored_bytes = NULL,
             stored_at = NULL, checksum_sha256 = $4
         WHERE id = $1 AND storage_key = $2 RETURNING id`,
        [row.id, row.storage_key, gzip, sha256Hex(gzip)]
      );
      if (updated.length > 0) result.moved++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: row.id, error: message(error) });
    }
  }
  return result;
}
