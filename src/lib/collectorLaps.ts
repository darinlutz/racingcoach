import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { isUniqueViolation, query } from './db';
import { ensureUserSchema } from './users';

// Laps uploaded by the telemetry collector (collector/ in this repo), stored in
// racingcoach."CollectorLaps". Each lap is one CSV as the collector writes it (iRacing variable names
// and units, one row per 60 Hz sample), kept gzip-compressed. Only this module touches csv_gzip, so
// the CSVs can move from Postgres to object storage without changing its callers.

// Same limit as the lap CSVs the Racing page's tabs accept (lapData.ts)
const MAX_CSV_BYTES = 25 * 1024 * 1024;
// A compressed lap is typically a quarter of the CSV, so this leaves plenty of room
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Columns the lap analysis reads (readLapSamples in lapData.ts)
const REQUIRED_COLUMNS = ['Speed', 'LapDistPct', 'Brake', 'Throttle'];

// The lap's details, as the collector sends them next to the CSV: its session.json lap entry plus the
// session's track, car, driver and iRacing IDs. clientLapId is the collector's own ID for the lap.
export const collectorLapSchema = z.object({
  clientLapId: z.uuid(),
  track: z.string().trim().min(1).max(200),
  car: z.string().trim().min(1).max(200),
  driver: z.string().trim().min(1).max(200),
  sessionId: z.number().int().min(0),
  subSessionId: z.number().int().min(0),
  sessionNum: z.number().int().min(0).max(1000),
  sessionType: z.string().trim().min(1).max(100),
  lapNumber: z.number().int().min(0).max(100_000),
  lapTimeSeconds: z.number().positive().max(3600),
  samples: z.number().int().positive().max(1_000_000),
  missingSamples: z.number().int().min(0),
  incidents: z.number().int().min(0).max(1000),
  pitRoad: z.boolean(),
  offTrack: z.boolean(),
  recordedAt: z.iso.datetime({ offset: true }),
});

export type CollectorLap = z.infer<typeof collectorLapSchema>;

export class InvalidLapCsvError extends Error {}

// Track position columns the collector adds from iRacing's .ibt file once the session's file is written
// (iRacing's live telemetry doesn't include them). Lat/Lon in degrees, Alt in meters.
const POSITION_COLUMNS = ['Lat', 'Lon'];

// Checks the upload is a gzip-compressed lap CSV with one row per sample and the columns the analysis
// needs. Returns the CSV's uncompressed size in bytes, and whether every row has a track position.
export function checkLapCsv(csvGzip: Buffer, samples: number): { csvBytes: number; hasPosition: boolean } {
  let csv: Buffer;
  try {
    csv = gunzipSync(csvGzip, { maxOutputLength: MAX_CSV_BYTES });
  } catch {
    throw new InvalidLapCsvError('csv must be a gzip-compressed CSV of at most 25 MB');
  }

  const lines = csv.toString('utf8').split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  const header = (lines[0] ?? '').split(',').map((column) => column.trim());
  const missing = REQUIRED_COLUMNS.filter((column) => !header.includes(column));
  if (missing.length > 0) {
    throw new InvalidLapCsvError(`csv is missing columns: ${missing.join(', ')}`);
  }
  if (lines.length - 1 !== samples) {
    throw new InvalidLapCsvError(`csv has ${lines.length - 1} rows but the lap has ${samples} samples`);
  }

  const positionIndexes = POSITION_COLUMNS.map((column) => header.indexOf(column));
  const hasPosition =
    positionIndexes.every((index) => index >= 0) &&
    lines.slice(1).every((line) => {
      const cells = line.split(',');
      return positionIndexes.every((index) => (cells[index] ?? '').trim() !== '');
    });
  return { csvBytes: csv.length, hasPosition };
}

// A stored lap's details, as listed on the Racing page (the CSV itself comes from readCollectorLapCsv)
export type CollectorLapSummary = {
  id: number;
  clientLapId: string;
  track: string;
  car: string;
  driver: string;
  sessionId: number;
  subSessionId: number;
  sessionNum: number;
  sessionType: string;
  lapNumber: number;
  lapTimeSeconds: number;
  samples: number;
  missingSamples: number;
  incidents: number;
  pitRoad: boolean;
  offTrack: boolean;
  recordedAt: string;
};

// How many of the user's most recent laps the Racing page lists
const LIST_LIMIT = 1000;

// The user's laps, or with a null userId every driver's (Coaches and Admins, see canSeeAllLaps)
export async function listCollectorLaps(userId: number | null): Promise<CollectorLapSummary[]> {
  await ensureUserSchema();
  const rows = await query<{
    id: number;
    client_lap_id: string;
    track: string;
    car: string;
    driver: string;
    iracing_session_id: string;
    iracing_subsession_id: string;
    session_num: number;
    session_type: string;
    lap_number: number;
    lap_time_seconds: number;
    sample_count: number;
    missing_samples: number;
    incidents: number;
    pit_road: boolean;
    off_track: boolean;
    recorded_at: Date;
  }>(
    `SELECT id, client_lap_id, track, car, driver, iracing_session_id, iracing_subsession_id, session_num, session_type,
            lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road, off_track, recorded_at
     FROM racingcoach."CollectorLaps" WHERE ($1::integer IS NULL OR user_id = $1)
     ORDER BY recorded_at DESC, id DESC LIMIT $2`,
    [userId, LIST_LIMIT]
  );
  return rows.map((row) => ({
    id: row.id,
    clientLapId: row.client_lap_id,
    track: row.track,
    car: row.car,
    driver: row.driver,
    // BIGINT columns come back from pg as strings
    sessionId: Number(row.iracing_session_id),
    subSessionId: Number(row.iracing_subsession_id),
    sessionNum: row.session_num,
    sessionType: row.session_type,
    lapNumber: row.lap_number,
    lapTimeSeconds: row.lap_time_seconds,
    samples: row.sample_count,
    missingSamples: row.missing_samples,
    incidents: row.incidents,
    pitRoad: row.pit_road,
    offTrack: row.off_track,
    recordedAt: row.recorded_at.toISOString(),
  }));
}

// The lap's CSV, or null if there's no lap with that id. With a userId, only that user's lap is returned
// (a User opening their own laps); null opens anyone's (Coaches and Admins, see canSeeAllLaps).
export async function readCollectorLapCsv(userId: number | null, id: number): Promise<string | null> {
  await ensureUserSchema();
  const [row] = await query<{ csv_gzip: Buffer }>(
    'SELECT csv_gzip FROM racingcoach."CollectorLaps" WHERE id = $1 AND ($2::integer IS NULL OR user_id = $2)',
    [id, userId]
  );
  return row ? gunzipSync(row.csv_gzip).toString('utf8') : null;
}

// A driver whose laps a Coach or Admin can open in Debrief Coach
export type LapOwner = { userId: number; userName: string; lapCount: number };

// Every account with recorded laps, by name
export async function listLapOwners(): Promise<LapOwner[]> {
  await ensureUserSchema();
  const rows = await query<{ id: number; user_name: string; lap_count: string }>(
    `SELECT u.id, u.user_name, count(*) AS lap_count
     FROM racingcoach."CollectorLaps" l JOIN racingcoach."Users" u ON u.id = l.user_id
     GROUP BY u.id, u.user_name ORDER BY lower(u.user_name), u.id`
  );
  return rows.map((row) => ({ userId: Number(row.id), userName: row.user_name, lapCount: Number(row.lap_count) }));
}

// Saves a lap for the user. Uploading the same clientLapId again (a retry) keeps the first copy and
// reports it as a duplicate, unless the new CSV has track positions and the stored one doesn't: the
// collector uploads each lap again once it has added them from the .ibt file, and that copy replaces it.
export async function saveCollectorLap(
  userId: number,
  lap: CollectorLap,
  csvGzip: Buffer,
  csvBytes: number,
  hasPosition: boolean
): Promise<{ id: number; duplicate: boolean; replaced: boolean }> {
  await ensureUserSchema();
  try {
    const [row] = await query<{ id: number }>(
      `INSERT INTO racingcoach."CollectorLaps" (
         user_id, client_lap_id, track, car, driver, iracing_session_id, iracing_subsession_id, session_num,
         session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road,
         off_track, recorded_at, csv_bytes, csv_gzip, has_position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20)
       RETURNING id`,
      [
        userId,
        lap.clientLapId,
        lap.track,
        lap.car,
        lap.driver,
        lap.sessionId,
        lap.subSessionId,
        lap.sessionNum,
        lap.sessionType,
        lap.lapNumber,
        lap.lapTimeSeconds,
        lap.samples,
        lap.missingSamples,
        lap.incidents,
        lap.pitRoad,
        lap.offTrack,
        lap.recordedAt,
        csvBytes,
        csvGzip,
        hasPosition,
      ]
    );
    return { id: row.id, duplicate: false, replaced: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    if (hasPosition) {
      // The samples and lap details are the same as the first upload's; only the CSV gains columns
      const [replaced] = await query<{ id: number }>(
        `UPDATE racingcoach."CollectorLaps"
         SET csv_gzip = $3, csv_bytes = $4, has_position = true, uploaded_at = now()
         WHERE user_id = $1 AND client_lap_id = $2 AND NOT has_position
         RETURNING id`,
        [userId, lap.clientLapId, csvGzip, csvBytes]
      );
      if (replaced) return { id: replaced.id, duplicate: true, replaced: true };
    }
    const [existing] = await query<{ id: number }>(
      'SELECT id FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND client_lap_id = $2',
      [userId, lap.clientLapId]
    );
    return { id: existing.id, duplicate: true, replaced: false };
  }
}
