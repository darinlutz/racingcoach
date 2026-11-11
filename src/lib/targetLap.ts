import { gunzipSync, gzipSync } from 'node:zlib';
import { query, transaction } from './db';
import { dropPending, moveError, storeLapObjectPending, type LapObjectMove } from './lapObjects';
import { getLapObject, lapObjectExists, telemetryStorageMode, telemetryStore } from './telemetryStorage';
import { sha256Hex, STORAGE_PROVIDERS, targetLapObjectKey } from './telemetryStorageRules';
import { ensureUserSchema } from './users';

// Each user's Target Lap: one lap CSV (gzip-compressed), with its file name and when it was set. Set on Debrief
// Coach's Target Lap card (dropping or browsing for a CSV) or with Debrief Coach's Set Target button, through
// /api/account/target-lap. Only this file reads or writes the CSV, and the columns stay out of USER_COLUMNS so loading
// a user doesn't read a lap.
//
// Where the CSV is kept follows the uploaded laps' and Expert Laps' design (docs/telemetry-storage.md):
// "Users"."TargetLapStorageProvider" says postgres (inline in "TargetLap") or r2 (an object in the telemetry bucket,
// target-laps/u{userId}/{sha256}.csv.gz, its bucket, key, size and SHA-256 in the other "TargetLapStorage..." columns).
// A new one goes to the bucket when TELEMETRY_STORAGE_MODE is r2 and the store is configured, else inline (also when
// the bucket fails). Reads follow the row. Triggers on "Users" queue the object for deletion whenever the row moves off
// it (a new Target Lap, Remove, a privacy erasure, a move back to Postgres) or is deleted (Delete Account), and the
// cleanup worker deletes it once nothing references it. The Admin page's Telemetry Storage section moves the existing
// ones across, or back.

// The largest CSV accepted, as for laps dropped on the Racing page
export const MAX_TARGET_LAP_BYTES = 25 * 1024 * 1024;
// A lap CSV has at least these columns (iRacing's names, as Garage 61 and the collector write them)
const REQUIRED_COLUMNS = ['LapDistPct', 'Speed', 'Brake', 'Throttle'];

// Garage 61 - {driver} - {car} - {track} - {lap time} - {id}.csv, and the collector's RacingCoach - ... the same way
const LAP_FILE_NAME = /^(?:Garage 61|RacingCoach) - (.+?) - (.+?) - (.+) - (\d+\.\d{2}\.\d{3}) - ([A-Za-z0-9]+)\.csv$/i;

export type TargetLapInfo = { fileName: string; setAt: string };

// The track a Target Lap's file name names, or null when it doesn't follow the Garage 61 / RacingCoach naming
export function targetLapTrackName(fileName: string): string | null {
  return lapFileNameParts(fileName)?.track ?? null;
}

// The driver, car, track and lap time a Garage 61 / RacingCoach lap file name names, or null for any other name
export function lapFileNameParts(fileName: string): { driver: string; car: string; track: string; lapTime: string } | null {
  const match = LAP_FILE_NAME.exec(fileName);
  if (!match) return null;
  const [, driver, car, track, lapTime] = match;
  return { driver: driver.trim(), car: car.trim(), track: track.trim(), lapTime };
}

export class TargetLapError extends Error {
  constructor(public code: 'notCsv' | 'tooLarge' | 'missingColumns', public columns: string[] = []) {
    super(code);
  }
}

// A user has a Target Lap, inline or in the bucket
export const HAS_TARGET_LAP_SQL = '("TargetLap" IS NOT NULL OR "TargetLapStorageKey" IS NOT NULL)';
// Removes it, wherever it is (the replace trigger queues an object)
export const CLEAR_TARGET_LAP_SQL = `"TargetLap" = NULL, "TargetLapFileName" = NULL, "TargetLapSetAt" = NULL,
  "TargetLapStorageProvider" = 'postgres', "TargetLapStorageBucket" = NULL, "TargetLapStorageKey" = NULL,
  "TargetLapStoredBytes" = NULL, "TargetLapChecksum" = NULL`;

const TARGET_LAP_SCHEMA = [
  'ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLap" BYTEA',
  'ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapFileName" TEXT',
  'ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapSetAt" TIMESTAMPTZ',
  // Where it is: existing Target Laps read as inline, which they are
  `ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapStorageProvider" TEXT NOT NULL DEFAULT 'postgres'`,
  'ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapStorageBucket" TEXT',
  'ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapStorageKey" TEXT',
  'ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapStoredBytes" INTEGER',
  // SHA-256 (hex) of the compressed bytes, checked on every read of an object
  'ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapChecksum" TEXT',
  `DO $$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_target_lap_storage_check'
                    AND conrelid = 'racingcoach."Users"'::regclass) THEN
       ALTER TABLE racingcoach."Users" ADD CONSTRAINT users_target_lap_storage_check CHECK (
         "TargetLapStorageProvider" = 'postgres'
         OR ("TargetLapStorageKey" IS NOT NULL AND "TargetLapStorageBucket" IS NOT NULL));
     END IF;
   END $$`,
  `CREATE INDEX IF NOT EXISTS users_target_lap_storage_key_idx ON racingcoach."Users" ("TargetLapStorageBucket", "TargetLapStorageKey")
   WHERE "TargetLapStorageKey" IS NOT NULL`,
  `CREATE OR REPLACE FUNCTION racingcoach.queue_target_lap_object_cleanup() RETURNS trigger LANGUAGE plpgsql AS $$
   BEGIN
     INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, user_id, reason)
     VALUES (OLD."TargetLapStorageProvider", OLD."TargetLapStorageBucket", OLD."TargetLapStorageKey", OLD.id,
             CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE 'replaced' END)
     ON CONFLICT (storage_bucket, storage_key) DO UPDATE
       SET reason = EXCLUDED.reason, not_before = LEAST(racingcoach."TelemetryObjectCleanup".not_before, now());
     RETURN NULL;
   END $$`,
  `DROP TRIGGER IF EXISTS users_target_lap_object_deleted ON racingcoach."Users"`,
  `CREATE TRIGGER users_target_lap_object_deleted AFTER DELETE ON racingcoach."Users"
   FOR EACH ROW WHEN (OLD."TargetLapStorageKey" IS NOT NULL)
   EXECUTE FUNCTION racingcoach.queue_target_lap_object_cleanup()`,
  `DROP TRIGGER IF EXISTS users_target_lap_object_replaced ON racingcoach."Users"`,
  `CREATE TRIGGER users_target_lap_object_replaced AFTER UPDATE OF "TargetLapStorageKey", "TargetLapStorageBucket" ON racingcoach."Users"
   FOR EACH ROW WHEN (OLD."TargetLapStorageKey" IS NOT NULL
     AND (OLD."TargetLapStorageKey" IS DISTINCT FROM NEW."TargetLapStorageKey"
          OR OLD."TargetLapStorageBucket" IS DISTINCT FROM NEW."TargetLapStorageBucket"))
   EXECUTE FUNCTION racingcoach.queue_target_lap_object_cleanup()`,
];

// Adds the Target Lap columns and triggers; "Users" itself comes from ensureUserSchema
let schemaReady: Promise<void> | null = null;
export function ensureTargetLapSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await ensureUserSchema();
    await transaction(async (client) => {
      // One server at a time: the triggers are dropped and made again
      await client.query("SELECT pg_advisory_xact_lock(hashtext('racingcoach_target_lap_schema'))");
      for (const statement of TARGET_LAP_SCHEMA) await client.query(statement);
    });
  })().catch((error) => {
    schemaReady = null; // try again next time
    throw error;
  });
  return schemaReady;
}

// Throws TargetLapError when it isn't a lap CSV
export function checkTargetLap(fileName: string, csv: string) {
  if (!fileName.toLowerCase().endsWith('.csv')) throw new TargetLapError('notCsv');
  if (Buffer.byteLength(csv) > MAX_TARGET_LAP_BYTES) throw new TargetLapError('tooLarge');
  const header = csv.split(/\r?\n/, 1)[0].split(',').map((column) => column.trim().replace(/^"|"$/g, ''));
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) throw new TargetLapError('missingColumns', missing);
}

export async function setTargetLap(userId: number, fileName: string, csv: string): Promise<TargetLapInfo> {
  checkTargetLap(fileName, csv);
  await ensureTargetLapSchema();
  const gzip = gzipSync(csv);
  const sha256 = sha256Hex(gzip);
  const stored =
    telemetryStorageMode() === 'r2'
      ? await storeLapObjectPending(targetLapObjectKey(userId, sha256), gzip, sha256, { csvBytes: Buffer.byteLength(csv), userId, kind: 'targetLap' })
      : null;
  const row = await transaction(async (client) => {
    const { rows } = await client.query<{ set_at: Date }>(
      `UPDATE racingcoach."Users"
       SET "TargetLap" = $1, "TargetLapFileName" = $2, "TargetLapSetAt" = now(), "TargetLapStorageProvider" = $4,
           "TargetLapStorageBucket" = $5, "TargetLapStorageKey" = $6, "TargetLapStoredBytes" = $7, "TargetLapChecksum" = $8
       WHERE id = $3 RETURNING "TargetLapSetAt" AS set_at`,
      [stored ? null : gzip, fileName, userId, stored?.provider ?? STORAGE_PROVIDERS.postgres, stored?.bucket ?? null, stored?.key ?? null, stored?.storedBytes ?? null, sha256]
    );
    // Saved: the object is the row's now. No such user: the pending entry deletes it later
    if (rows[0] && stored) await dropPending(client, stored);
    return rows[0];
  });
  return { fileName, setAt: new Date(row.set_at).toISOString() };
}

// The user's Target Lap without its CSV, or null when they have none
export async function getTargetLapInfo(userId: number): Promise<TargetLapInfo | null> {
  await ensureTargetLapSchema();
  const [row] = await query<{ file_name: string | null; set_at: Date | null }>(
    `SELECT "TargetLapFileName" AS file_name, "TargetLapSetAt" AS set_at FROM racingcoach."Users"
      WHERE id = $1 AND ${HAS_TARGET_LAP_SQL}`,
    [userId]
  );
  if (!row?.file_name || !row.set_at) return null;
  return { fileName: row.file_name, setAt: new Date(row.set_at).toISOString() };
}

type StorageRow = {
  id: number;
  file_name: string | null;
  set_at: Date | null;
  csv_gzip: Buffer | null;
  provider: string;
  bucket: string | null;
  key: string | null;
  checksum: string | null;
};
const STORAGE_COLUMNS = `id, "TargetLapFileName" AS file_name, "TargetLapSetAt" AS set_at, "TargetLap" AS csv_gzip,
  "TargetLapStorageProvider" AS provider, "TargetLapStorageBucket" AS bucket, "TargetLapStorageKey" AS key,
  "TargetLapChecksum" AS checksum`;

// The compressed CSV from wherever the row says; null when the object is gone (logged). A bucket that fails, or bytes
// that don't match the checksum, throw
async function rowGzip(row: StorageRow): Promise<Buffer | null> {
  if (row.provider === STORAGE_PROVIDERS.postgres) return row.csv_gzip;
  const gzip = await getLapObject(row.bucket!, row.key!, row.checksum);
  if (!gzip) console.error(`Target lap of user ${row.id}: its object is missing from the telemetry bucket`);
  return gzip;
}

async function readRow(userId: number): Promise<StorageRow | null> {
  await ensureTargetLapSchema();
  const [row] = await query<StorageRow>(`SELECT ${STORAGE_COLUMNS} FROM racingcoach."Users" WHERE id = $1`, [userId]);
  return row ?? null;
}

// The Target Lap's CSV and file name, or null when the user has none
export async function readTargetLap(userId: number): Promise<{ fileName: string; csv: string } | null> {
  const row = await readRow(userId);
  if (!row?.file_name) return null;
  const gzip = await rowGzip(row);
  return gzip ? { fileName: row.file_name, csv: gunzipSync(gzip).toString('utf8') } : null;
}

// For Download My Data (src/lib/personalDataExport.ts): the file name, when it was set and the CSV's bytes
export async function readTargetLapForExport(userId: number): Promise<{ fileName: string; setAt: Date | null; csv: Buffer } | null> {
  const row = await readRow(userId);
  if (!row?.file_name) return null;
  const gzip = await rowGzip(row);
  return gzip ? { fileName: row.file_name, setAt: row.set_at, csv: gunzipSync(gzip) } : null;
}

export async function clearTargetLap(userId: number): Promise<void> {
  await ensureTargetLapSchema();
  await query(`UPDATE racingcoach."Users" SET ${CLEAR_TARGET_LAP_SQL} WHERE id = $1`, [userId]);
}

export type TargetLapStorage = { inline: number; inlineBytes: number; stored: number; storedBytes: number };

// How many Target Laps are kept where, for the Admin page
export async function readTargetLapStorage(): Promise<TargetLapStorage> {
  await ensureTargetLapSchema();
  const [row] = await query<{ inline: string; inline_bytes: string | null; stored: string; stored_bytes: string | null }>(
    `SELECT count(*) FILTER (WHERE "TargetLapStorageProvider" = 'postgres' AND "TargetLap" IS NOT NULL) AS inline,
            sum(octet_length("TargetLap")) FILTER (WHERE "TargetLapStorageProvider" = 'postgres') AS inline_bytes,
            count(*) FILTER (WHERE "TargetLapStorageProvider" <> 'postgres') AS stored,
            sum("TargetLapStoredBytes") FILTER (WHERE "TargetLapStorageProvider" <> 'postgres') AS stored_bytes
     FROM racingcoach."Users"`
  );
  return { inline: Number(row.inline), inlineBytes: Number(row.inline_bytes ?? 0), stored: Number(row.stored), storedBytes: Number(row.stored_bytes ?? 0) };
}

// The Admin page's Move Target Laps to object storage: copies each inline Target Lap to the bucket, checks the stored
// object's size and checksum, then points the user's row at it and clears "TargetLap" in one UPDATE, only if it's still
// the same inline lap (one set meanwhile leaves the pending entry to delete the copy). Null without the bucket.
export async function moveTargetLapsToObjectStorage(): Promise<LapObjectMove | null> {
  if (!telemetryStore()) return null;
  await ensureTargetLapSchema();
  const rows = await query<{ id: number; csv_gzip: Buffer }>(
    `SELECT id, "TargetLap" AS csv_gzip FROM racingcoach."Users"
     WHERE "TargetLapStorageProvider" = 'postgres' AND "TargetLap" IS NOT NULL ORDER BY id`
  );
  const result: LapObjectMove = { moved: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const gzip = row.csv_gzip;
      const sha256 = sha256Hex(gzip);
      const stored = await storeLapObjectPending(targetLapObjectKey(row.id, sha256), gzip, sha256, {
        csvBytes: gunzipSync(gzip).length,
        userId: row.id,
        kind: 'targetLap',
      });
      if (!stored) throw new Error('the telemetry bucket refused the copy');
      const head = await lapObjectExists(stored.bucket, stored.key);
      if (!head || head.size !== gzip.length || (head.sha256 && head.sha256 !== sha256)) throw new Error('the stored copy does not match');
      const updated = await transaction(async (client) => {
        const { rowCount } = await client.query(
          `UPDATE racingcoach."Users"
           SET "TargetLapStorageProvider" = $2, "TargetLapStorageBucket" = $3, "TargetLapStorageKey" = $4,
               "TargetLapStoredBytes" = $5, "TargetLapChecksum" = $6, "TargetLap" = NULL
           WHERE id = $1 AND "TargetLapStorageProvider" = 'postgres' AND encode(sha256("TargetLap"), 'hex') = $6`,
          [row.id, stored.provider, stored.bucket, stored.key, stored.storedBytes, sha256]
        );
        if (rowCount) await dropPending(client, stored);
        return (rowCount ?? 0) > 0;
      });
      if (updated) result.moved++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: row.id, error: moveError(error) });
    }
  }
  return result;
}

// Move Target Laps back to PostgreSQL: the rollback. Downloads each object (checking its checksum), stores it inline and
// forgets the key, which queues the object for deletion. A Target Lap whose object is gone is reported and left alone.
export async function moveTargetLapsToPostgres(): Promise<LapObjectMove> {
  await ensureTargetLapSchema();
  const rows = await query<StorageRow>(`SELECT ${STORAGE_COLUMNS} FROM racingcoach."Users" WHERE "TargetLapStorageProvider" <> 'postgres' ORDER BY id`);
  const result: LapObjectMove = { moved: 0, failed: 0, errors: [] };
  for (const row of rows) {
    try {
      const gzip = await getLapObject(row.bucket!, row.key!, row.checksum);
      if (!gzip) throw new Error('its object is missing from the telemetry bucket');
      const updated = await query(
        `UPDATE racingcoach."Users"
         SET "TargetLapStorageProvider" = 'postgres', "TargetLap" = $3, "TargetLapStorageBucket" = NULL,
             "TargetLapStorageKey" = NULL, "TargetLapStoredBytes" = NULL, "TargetLapChecksum" = $4
         WHERE id = $1 AND "TargetLapStorageKey" = $2 RETURNING id`,
        [row.id, row.key, gzip, sha256Hex(gzip)]
      );
      if (updated.length > 0) result.moved++;
    } catch (error) {
      result.failed++;
      result.errors.push({ id: row.id, error: moveError(error) });
    }
  }
  return result;
}
