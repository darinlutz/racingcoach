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

// Checks the upload is a gzip-compressed lap CSV with one row per sample and the columns the analysis
// needs. Returns the CSV's uncompressed size in bytes.
export function checkLapCsv(csvGzip: Buffer, samples: number): number {
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
  return csv.length;
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

export async function listCollectorLaps(userId: number): Promise<CollectorLapSummary[]> {
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
     FROM racingcoach."CollectorLaps" WHERE user_id = $1 ORDER BY recorded_at DESC, id DESC LIMIT $2`,
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

// The lap's CSV, or null if the user has no lap with that id
export async function readCollectorLapCsv(userId: number, id: number): Promise<string | null> {
  await ensureUserSchema();
  const [row] = await query<{ csv_gzip: Buffer }>(
    'SELECT csv_gzip FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND id = $2',
    [userId, id]
  );
  return row ? gunzipSync(row.csv_gzip).toString('utf8') : null;
}

// Saves a lap for the user. Uploading the same clientLapId again (a retry) keeps the first copy and
// reports it as a duplicate.
export async function saveCollectorLap(
  userId: number,
  lap: CollectorLap,
  csvGzip: Buffer,
  csvBytes: number
): Promise<{ id: number; duplicate: boolean }> {
  await ensureUserSchema();
  try {
    const [row] = await query<{ id: number }>(
      `INSERT INTO racingcoach."CollectorLaps" (
         user_id, client_lap_id, track, car, driver, iracing_session_id, iracing_subsession_id, session_num,
         session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road,
         off_track, recorded_at, csv_bytes, csv_gzip)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
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
      ]
    );
    return { id: row.id, duplicate: false };
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const [existing] = await query<{ id: number }>(
      'SELECT id FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND client_lap_id = $2',
      [userId, lap.clientLapId]
    );
    return { id: existing.id, duplicate: true };
  }
}
