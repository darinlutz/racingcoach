import { gunzipSync, gzipSync } from 'node:zlib';
import { query } from '@/lib/db';
import { ensureUserSchema } from '@/lib/users';

// Each user's Target Lap: one lap CSV kept in racingcoach."Users"."TargetLap" (gzip-compressed, like
// "CollectorLaps".csv_gzip), with its file name and when it was set. Set on the Account page's Target Lap card
// (dropping or browsing for a CSV) or with Debrief Coach's Set Target button, through /api/account/target-lap.
// Only this file reads or writes the CSV, and the columns stay out of USER_COLUMNS so loading a user doesn't
// read a lap.

// The largest CSV accepted, as for laps dropped on the Racing page
export const MAX_TARGET_LAP_BYTES = 25 * 1024 * 1024;
// A lap CSV has at least these columns (iRacing's names, as Garage 61 and the collector write them)
const REQUIRED_COLUMNS = ['LapDistPct', 'Speed', 'Brake', 'Throttle'];

// Garage 61 - {driver} - {car} - {track} - {lap time} - {id}.csv, and the collector's RacingCoach - ... the same way
const LAP_FILE_NAME = /^(?:Garage 61|RacingCoach) - (.+?) - (.+?) - (.+) - (\d+\.\d{2}\.\d{3}) - ([A-Za-z0-9]+)\.csv$/i;

export type TargetLapInfo = { fileName: string; setAt: string };

// The track a Target Lap's file name names, or null when it doesn't follow the Garage 61 / RacingCoach naming
export function targetLapTrackName(fileName: string): string | null {
  return LAP_FILE_NAME.exec(fileName)?.[3] ?? null;
}

export class TargetLapError extends Error {
  constructor(public code: 'notCsv' | 'tooLarge' | 'missingColumns', public columns: string[] = []) {
    super(code);
  }
}

// Adds the Target Lap columns; "Users" itself comes from ensureUserSchema
let schemaReady: Promise<void> | null = null;
function ensureTargetLapSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await ensureUserSchema();
    await query('ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLap" BYTEA');
    await query('ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapFileName" TEXT');
    await query('ALTER TABLE racingcoach."Users" ADD COLUMN IF NOT EXISTS "TargetLapSetAt" TIMESTAMPTZ');
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
  const [row] = await query<{ set_at: Date }>(
    `UPDATE racingcoach."Users" SET "TargetLap" = $1, "TargetLapFileName" = $2, "TargetLapSetAt" = now()
      WHERE id = $3 RETURNING "TargetLapSetAt" AS set_at`,
    [gzipSync(csv), fileName, userId]
  );
  return { fileName, setAt: new Date(row.set_at).toISOString() };
}

// The user's Target Lap without its CSV, or null when they have none
export async function getTargetLapInfo(userId: number): Promise<TargetLapInfo | null> {
  await ensureTargetLapSchema();
  const [row] = await query<{ file_name: string | null; set_at: Date | null }>(
    `SELECT "TargetLapFileName" AS file_name, "TargetLapSetAt" AS set_at FROM racingcoach."Users"
      WHERE id = $1 AND "TargetLap" IS NOT NULL`,
    [userId]
  );
  if (!row?.file_name || !row.set_at) return null;
  return { fileName: row.file_name, setAt: new Date(row.set_at).toISOString() };
}

// The Target Lap's CSV and file name, or null when the user has none
export async function readTargetLap(userId: number): Promise<{ fileName: string; csv: string } | null> {
  await ensureTargetLapSchema();
  const [row] = await query<{ file_name: string | null; csv_gzip: Buffer | null }>(
    'SELECT "TargetLapFileName" AS file_name, "TargetLap" AS csv_gzip FROM racingcoach."Users" WHERE id = $1',
    [userId]
  );
  if (!row?.csv_gzip || !row.file_name) return null;
  return { fileName: row.file_name, csv: gunzipSync(row.csv_gzip).toString('utf8') };
}

export async function clearTargetLap(userId: number): Promise<void> {
  await ensureTargetLapSchema();
  await query(
    'UPDATE racingcoach."Users" SET "TargetLap" = NULL, "TargetLapFileName" = NULL, "TargetLapSetAt" = NULL WHERE id = $1',
    [userId]
  );
}
