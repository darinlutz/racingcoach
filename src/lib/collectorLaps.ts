import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { isUniqueViolation, query } from './db';
import { canSeeAllLaps, ROLES } from './roles';
import { saveTrackLength } from './trackLengths';
import { lapCsvBounds, saveTrackBounds, saveTrackLocation, trackNeedsBounds } from './trackLocations';
import { lapCsvOutline, saveTrackOutline, trackNeedsOutline } from './trackOutlines';
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
  // iRacing's track key (WeekendInfo.TrackName, e.g. "twinring fullrc"); collectors before 1.29.0 don't send it
  trackKey: z.string().trim().min(1).max(200).nullish(),
  // iRacing's length of the track in feet (WeekendInfo.TrackLength); collectors before it was sent don't send it
  trackLengthFeet: z.number().positive().max(1_000_000).nullish(),
  // iRacing's location of the track in degrees (WeekendInfo.TrackLatitude/TrackLongitude); collectors before 1.39.0 don't send it
  trackLatitude: z.number().min(-90).max(90).nullish(),
  trackLongitude: z.number().min(-180).max(180).nullish(),
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
  // The weather at the end of the lap and the session's track usage; collectors before 1.40.0 don't send it
  conditions: z
    .object({
      trackTempC: z.number().min(-60).max(100).nullish(),
      airTempC: z.number().min(-60).max(70).nullish(),
      relativeHumidity: z.number().min(0).max(1).nullish(),
      windVelocity: z.number().min(0).max(150).nullish(),
      windDirection: z.number().min(-10).max(10).nullish(),
      trackUsage: z.string().trim().min(1).max(100).nullish(),
    })
    .nullish(),
});

export type CollectorLap = z.infer<typeof collectorLapSchema>;

// A lap's weather, in iRacing's units: °C, humidity 0-1, wind in m/s and radians (iRacing's WindDir). trackUsage is
// iRacing's words for the session's rubber (SessionTrackRubberState, e.g. "moderate usage")
export type LapConditions = {
  trackTempC: number | null;
  airTempC: number | null;
  relativeHumidity: number | null;
  windVelocity: number | null;
  windDirection: number | null;
  trackUsage: string | null;
};

function toLapConditions(conditions: CollectorLap['conditions']): LapConditions | null {
  if (!conditions) return null;
  return {
    trackTempC: conditions.trackTempC ?? null,
    airTempC: conditions.airTempC ?? null,
    relativeHumidity: conditions.relativeHumidity ?? null,
    windVelocity: conditions.windVelocity ?? null,
    windDirection: conditions.windDirection ?? null,
    trackUsage: conditions.trackUsage ?? null,
  };
}

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
  // iRacing's track key (WeekendInfo.TrackName), which finds the Track Data track (its `name` on the Racing
  // page, see toLapTrack) when iRacing names the layout differently; null for laps from collectors before 1.29.0
  trackKey: string | null;
  car: string;
  // The RacingCoach account that uploaded the lap, and its name. That's who drove it as far as the site is
  // concerned: iRacingDriver is the name iRacing reported, which is whoever the sim was logged in as (e.g. a
  // friend driving on someone else's iRacing account)
  userId: number;
  driver: string;
  iracingDriver: string;
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
  // null for laps from collectors before 1.40.0
  conditions: LapConditions | null;
};

// How many of the user's most recent laps the Racing page lists
const LIST_LIMIT = 1000;

// The signed-in user looking at recorded laps. Coaches and Admins can see every driver's laps (canSeeAllLaps);
// Users their own and Coaches' laps, never another User's (or an Admin's)
export type LapViewer = { id: number; role: string | null | undefined };

// The SQL condition for the laps the viewer can see, on "CollectorLaps" l joined to the uploader's "Users" u, with
// lapViewerParam as parameter $n. ROLES.coach is a constant, not user input.
const visibleTo = (n: number) => `($${n}::integer IS NULL OR l.user_id = $${n} OR u.role = '${ROLES.coach}')`;

// The visibleTo parameter: null for a viewer who can see every driver's laps
const lapViewerParam = (viewer: LapViewer) => (canSeeAllLaps(viewer.role) ? null : viewer.id);

// The laps the viewer can see, newest first: with driverIds, only those drivers' (the Racing page's Driver box);
// null for every driver the viewer can see
export async function listCollectorLaps(viewer: LapViewer, driverIds: number[] | null): Promise<CollectorLapSummary[]> {
  await ensureUserSchema();
  const rows = await query<{
    id: number;
    client_lap_id: string;
    track: string;
    track_key: string | null;
    car: string;
    user_id: number;
    user_name: string;
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
    conditions: LapConditions | null;
  }>(
    `SELECT l.id, l.client_lap_id, l.track, l.track_key, l.car, l.user_id, u.user_name, l.driver, l.iracing_session_id,
            l.iracing_subsession_id, l.session_num, l.session_type, l.lap_number, l.lap_time_seconds, l.sample_count,
            l.missing_samples, l.incidents, l.pit_road, l.off_track, l.recorded_at, l.conditions
     FROM racingcoach."CollectorLaps" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE ${visibleTo(1)} AND ($2::integer[] IS NULL OR l.user_id = ANY($2::integer[]))
     ORDER BY l.recorded_at DESC, l.id DESC LIMIT $3`,
    [lapViewerParam(viewer), driverIds, LIST_LIMIT]
  );
  return rows.map((row) => ({
    id: row.id,
    clientLapId: row.client_lap_id,
    track: row.track,
    trackKey: row.track_key,
    car: row.car,
    userId: Number(row.user_id),
    driver: row.user_name,
    iracingDriver: row.driver,
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
    conditions: row.conditions,
  }));
}

// The lap's CSV, or null if there's no lap with that id or the viewer can't see it (see LapViewer)
export async function readCollectorLapCsv(viewer: LapViewer, id: number): Promise<string | null> {
  await ensureUserSchema();
  const [row] = await query<{ csv_gzip: Buffer }>(
    `SELECT l.csv_gzip FROM racingcoach."CollectorLaps" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE l.id = $1 AND ${visibleTo(2)}`,
    [id, lapViewerParam(viewer)]
  );
  return row ? gunzipSync(row.csv_gzip).toString('utf8') : null;
}

// Laps by id with their car and CSV, in the order asked for (ids that don't exist, or that the viewer can't see,
// see LapViewer, are left out)
export async function readCollectorLapsById(
  viewer: LapViewer,
  ids: number[]
): Promise<{ id: number; car: string; lapNumber: number; csv: string }[]> {
  await ensureUserSchema();
  const rows = await query<{ id: number; car: string; lap_number: number; csv_gzip: Buffer }>(
    `SELECT l.id, l.car, l.lap_number, l.csv_gzip
     FROM racingcoach."CollectorLaps" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE l.id = ANY($1::integer[]) AND ${visibleTo(2)}`,
    [ids, lapViewerParam(viewer)]
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    return row ? [{ id, car: row.car, lapNumber: row.lap_number, csv: gunzipSync(row.csv_gzip).toString('utf8') }] : [];
  });
}

// The user's laps with these collector IDs (clientLapId), with their CSVs, in the order asked for. Laps
// that aren't the user's or don't exist are left out.
export async function readCollectorLapsByClientId(
  userId: number,
  clientLapIds: string[]
): Promise<
  {
    clientLapId: string;
    track: string;
    trackKey: string | null;
    car: string;
    lapNumber: number;
    lapTimeSeconds: number;
    incidents: number;
    offTrack: boolean;
    csv: string;
  }[]
> {
  await ensureUserSchema();
  const rows = await query<{
    client_lap_id: string;
    track: string;
    track_key: string | null;
    car: string;
    lap_number: number;
    lap_time_seconds: number;
    incidents: number;
    off_track: boolean;
    csv_gzip: Buffer;
  }>(
    `SELECT client_lap_id, track, track_key, car, lap_number, lap_time_seconds, incidents, off_track, csv_gzip FROM racingcoach."CollectorLaps"
     WHERE user_id = $1 AND client_lap_id = ANY($2::uuid[])`,
    [userId, clientLapIds]
  );
  return clientLapIds.flatMap((id) => {
    const row = rows.find((r) => r.client_lap_id.toLowerCase() === id.toLowerCase());
    if (!row) return [];
    return [
      {
        clientLapId: row.client_lap_id,
        track: row.track,
        trackKey: row.track_key,
        car: row.car,
        lapNumber: row.lap_number,
        lapTimeSeconds: Number(row.lap_time_seconds),
        incidents: row.incidents,
        offTrack: row.off_track,
        csv: gunzipSync(row.csv_gzip).toString('utf8'),
      },
    ];
  });
}

// A driver whose laps a Coach or Admin can open in Debrief Coach
export type LapOwner = { userId: number; userName: string; lapCount: number };

// Every account with recorded laps that the viewer can see (see LapViewer), by name
export async function listLapOwners(viewer: LapViewer): Promise<LapOwner[]> {
  await ensureUserSchema();
  const rows = await query<{ id: number; user_name: string; lap_count: string }>(
    `SELECT u.id, u.user_name, count(*) AS lap_count
     FROM racingcoach."CollectorLaps" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE ${visibleTo(1)}
     GROUP BY u.id, u.user_name ORDER BY lower(u.user_name), u.id`,
    [lapViewerParam(viewer)]
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
         off_track, recorded_at, csv_bytes, csv_gzip, has_position, track_key, conditions)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22)
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
        lap.trackKey ?? null,
        // pg would send a plain object as JSON anyway; stringified so null stays SQL NULL
        lap.conditions ? JSON.stringify(toLapConditions(lap.conditions)) : null,
      ]
    );
    await saveTrackLength(lap.trackKey ?? null, lap.trackLengthFeet ?? null);
    await saveTrackLocation(lap.trackKey ?? null, lap.trackLatitude ?? null, lap.trackLongitude ?? null);
    if (hasPosition) await saveTrackShapeFromLap(lap.trackKey ?? null, csvGzip, !lap.pitRoad && !lap.offTrack);
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
      if (replaced) {
        await saveTrackShapeFromLap(lap.trackKey ?? null, csvGzip, !lap.pitRoad && !lap.offTrack);
        return { id: replaced.id, duplicate: true, replaced: true };
      }
    }
    const [existing] = await query<{ id: number }>(
      'SELECT id FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND client_lap_id = $2',
      [userId, lap.clientLapId]
    );
    return { id: existing.id, duplicate: true, replaced: false };
  }
}

// Gives the lap's track its bounds (trackLocations.ts) from the lap's Lat/Lon, when it has none yet, and its outline
// for Live Racing (trackOutlines.ts) when it has none and the lap is clean (no pit road, no off-track). A failure
// is only logged: the lap is saved either way.
async function saveTrackShapeFromLap(trackKey: string | null, csvGzip: Buffer, clean: boolean): Promise<void> {
  try {
    if (!trackKey) return;
    const needsBounds = await trackNeedsBounds(trackKey);
    const needsOutline = clean && (await trackNeedsOutline(trackKey));
    if (!needsBounds && !needsOutline) return;
    const csv = gunzipSync(csvGzip, { maxOutputLength: MAX_CSV_BYTES }).toString('utf8');
    if (needsBounds) await saveTrackBounds(trackKey, lapCsvBounds(csv));
    if (needsOutline) await saveTrackOutline(trackKey, lapCsvOutline(csv));
  } catch (error) {
    console.error('Save track shape error:', error);
  }
}

// Gives tracks without bounds or an outline theirs from laps already stored with track positions: the latest lap of
// each, preferring ones without pit road or off-track (only those give an outline). Runs once per server start (Track
// Data's /api/tracks and Live Racing wait for it), so tracks driven before bounds and outlines were kept get them;
// after that each new lap with positions does.
let backfill: Promise<void> | null = null;
export function backfillTrackBounds(): Promise<void> {
  backfill ??= (async () => {
    try {
      await ensureUserSchema();
      // Ids first, so the sort doesn't carry every lap's CSV
      const laps = await query<{ id: number; track_key: string; clean: boolean }>(
        `SELECT DISTINCT ON (lower(l.track_key)) l.id, l.track_key, NOT (l.pit_road OR l.off_track) AS clean
         FROM racingcoach."CollectorLaps" l
         JOIN racingcoach."Tracks" t ON lower(t.track_key) = lower(l.track_key)
         WHERE l.has_position
           AND (t.track_south IS NULL OR (t.track_outline IS NULL AND NOT (l.pit_road OR l.off_track)))
         ORDER BY lower(l.track_key), (l.pit_road OR l.off_track), l.recorded_at DESC`
      );
      for (const lap of laps) {
        const [row] = await query<{ csv_gzip: Buffer }>('SELECT csv_gzip FROM racingcoach."CollectorLaps" WHERE id = $1', [lap.id]);
        if (row) await saveTrackShapeFromLap(lap.track_key, row.csv_gzip, lap.clean);
      }
    } catch (error) {
      console.error('Backfill track shapes error:', error);
    }
  })();
  return backfill;
}
