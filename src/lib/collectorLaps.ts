import { gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { isUniqueViolation, query, transaction } from './db';
import { getLapObject, mapLimited, putLapObject, telemetryStorageMode, telemetryStore, type StoredLapObject } from './telemetryStorage';
import { LAP_COMPRESSION, LAP_CONTENT_TYPE, lapObjectKey, sha256Hex, STORAGE_PROVIDERS, STORAGE_STATUS } from './telemetryStorageRules';
import { PENDING_GRACE_SQL } from './telemetryStorageSchema';
import { canSeeAllLaps, ROLES } from './roles';
import { saveTrackLength } from './trackLengths';
import { lapCsvBounds, saveTrackBounds, saveTrackLocation, trackNeedsBounds } from './trackLocations';
import { lapCsvOutline, saveTrackOutline, trackNeedsOutline } from './trackOutlines';
import { ensureUserSchema } from './users';
import { lapCompletedAt } from './lapRetentionRules';
import { recordSimulatorCar, resolveSimulatorTrackKey } from './simulatorMappings';
import { DEFAULT_SIMULATOR } from './simulators';

// Laps uploaded by the telemetry collector (collector/ in this repo), stored in
// racingcoach."CollectorLaps". Each lap is one CSV as the collector writes it (iRacing variable names
// and units, one row per 60 Hz sample), kept gzip-compressed: inline in csv_gzip, or as an object in the telemetry
// store (telemetryStorage.ts, docs/telemetry-storage.md), as each row's storage_provider says. Only this module reads
// or writes the CSV bytes, so its callers never know which.

// Same limit as the lap CSVs the Racing page's tabs accept (lapData.ts)
const MAX_CSV_BYTES = 25 * 1024 * 1024;
// A compressed lap is typically a quarter of the CSV, so this leaves plenty of room
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

// Columns the lap analysis reads (readLapSamples in lapData.ts)
const REQUIRED_COLUMNS = ['Speed', 'LapDistPct', 'Brake', 'Throttle'];

// The lap's details, as the collector sends them next to the CSV: its session.json lap entry plus the
// session's track, car, driver and iRacing IDs. clientLapId is the collector's own ID for the lap.
export const collectorLapSchema = z.object({
  // Which simulator (simulators/capabilities.json) and the format of these details, with the adapter's version;
  // collectors before they sent them are iRacing's, format 1. trackKey is that simulator's own id for the track, and
  // carKey for the car (iRacing's CarPath, e.g. "mercedesw13", from collectors after 1.68.0; carPictures.ts finds the
  // car's picture by it)
  simulator: z.string().trim().toLowerCase().min(1).max(40).nullish(),
  payloadVersion: z.number().int().positive().max(1000).nullish(),
  adapterVersion: z.string().trim().min(1).max(40).nullish(),
  carKey: z.string().trim().min(1).max(200).nullish(),
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

// The lap's retention period has already ended (lapRetentionRules.ts), or the cleanup job deleted it before: it isn't
// stored, and an upload never restarts the clock. The collector stops trying to upload it.
export class LapExpiredError extends Error {
  constructor() {
    super('This lap is past its retention period and was not stored');
  }
}

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

// Where a row's CSV is. csv_gzip only for inline rows: a migrated row may still hold its old copy until the legacy
// purge, which isn't read (or even fetched from TOAST) once the row reads from the store.
const STORAGE_COLUMNS = `l.id AS storage_row_id, l.storage_provider, l.storage_bucket, l.storage_key, l.checksum_sha256,
  CASE WHEN l.storage_provider = '${STORAGE_PROVIDERS.postgres}' THEN l.csv_gzip END AS csv_gzip`;

type StorageRow = {
  storage_row_id: number;
  storage_provider: string;
  storage_bucket: string | null;
  storage_key: string | null;
  checksum_sha256: string | null;
  csv_gzip: Buffer | null;
};

// The row's compressed CSV, or null when its object is gone (e.g. a database restored from a backup brought back a
// row whose object was already deleted): the row is marked missing and the lap is treated as not there. A store that
// can't be reached throws, so the caller fails rather than coaching from fewer laps than it was given.
async function lapGzip(row: StorageRow): Promise<Buffer | null> {
  if (row.storage_provider === STORAGE_PROVIDERS.postgres) return row.csv_gzip;
  const bytes = await getLapObject(row.storage_bucket!, row.storage_key!, row.checksum_sha256);
  if (bytes) return bytes;
  console.error(`Lap object missing: lap ${row.storage_row_id}, ${row.storage_bucket}/${row.storage_key}`);
  await query(
    `UPDATE racingcoach."CollectorLaps" SET storage_status = $3 WHERE id = $1 AND storage_key = $2`,
    [row.storage_row_id, row.storage_key, STORAGE_STATUS.missing]
  ).catch(() => {});
  return null;
}

const gunzipCsv = (gzip: Buffer) => gunzipSync(gzip, { maxOutputLength: MAX_CSV_BYTES });

// How many laps' objects one reader fetches at once
const READ_CONCURRENCY = 6;

// A stored lap's details, as listed on the Racing page (the CSV itself comes from readCollectorLapCsv)
export type CollectorLapSummary = {
  id: number;
  clientLapId: string;
  track: string;
  // iRacing's track key (WeekendInfo.TrackName), which finds the Track Data track (its `name` on the Racing
  // page, see toLapTrack) when iRacing names the layout differently; null for laps from collectors before 1.29.0
  trackKey: string | null;
  // The simulator the lap is from and, for one other than iRacing, its own id for the track (trackKey is then the
  // site's track it's mapped to, simulatorMappings.ts, or null)
  simulator: string;
  nativeTrackKey: string | null;
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
  // When the lap was completed, for its retention, and when it's deleted (lapRetentionRules.ts)
  completedAt: string;
  expiresAt: string;
  // null for laps from collectors before 1.40.0
  conditions: LapConditions | null;
};

// How many of the user's most recent laps the Racing page lists
const LIST_LIMIT = 1000;

// The signed-in user looking at recorded laps. Coaches and Admins can see every driver's laps (canSeeAllLaps);
// Users their own and Coaches' laps, never another User's (or an Admin's)
export type LapViewer = { id: number; role: string | null | undefined };

// The SQL condition for the laps the viewer can see, on "CollectorLaps" l joined to the uploader's "Users" u, with
// lapViewerParam as parameter $n. ROLES.coach is a constant, not user input. Never an expired lap (lapRetentionDb.ts),
// even before the cleanup job has deleted it.
const visibleTo = (n: number) =>
  `($${n}::integer IS NULL OR l.user_id = $${n} OR u.role = '${ROLES.coach}') AND l.expires_at > now()`;

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
    simulator: string;
    native_track_key: string | null;
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
    completed_at: Date;
    expires_at: Date;
    conditions: LapConditions | null;
  }>(
    `SELECT l.id, l.client_lap_id, l.track, l.track_key, l.simulator, l.native_track_key, l.car, l.user_id, u.user_name, l.driver, l.iracing_session_id,
            l.iracing_subsession_id, l.session_num, l.session_type, l.lap_number, l.lap_time_seconds, l.sample_count,
            l.missing_samples, l.incidents, l.pit_road, l.off_track, l.recorded_at, l.completed_at, l.expires_at, l.conditions
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
    simulator: row.simulator,
    nativeTrackKey: row.native_track_key,
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
    completedAt: row.completed_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    conditions: row.conditions,
  }));
}

// The lap's CSV, or null if there's no lap with that id or the viewer can't see it (see LapViewer)
export async function readCollectorLapCsv(viewer: LapViewer, id: number): Promise<string | null> {
  await ensureUserSchema();
  const [row] = await query<StorageRow>(
    `SELECT ${STORAGE_COLUMNS} FROM racingcoach."CollectorLaps" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE l.id = $1 AND ${visibleTo(2)}`,
    [id, lapViewerParam(viewer)]
  );
  if (!row) return null;
  const gzip = await lapGzip(row);
  return gzip ? gunzipCsv(gzip).toString('utf8') : null;
}

// One of the user's own laps as its uncompressed CSV bytes, for Download My Data (personalDataExport.ts); null when
// it isn't theirs, has expired or its object is gone
export async function readOwnLapCsvBytes(userId: number, lapId: number): Promise<Buffer | null> {
  await ensureUserSchema();
  const [row] = await query<StorageRow>(
    `SELECT ${STORAGE_COLUMNS} FROM racingcoach."CollectorLaps" l WHERE l.id = $1 AND l.user_id = $2 AND l.expires_at > now()`,
    [lapId, userId]
  );
  if (!row) return null;
  const gzip = await lapGzip(row);
  return gzip ? gunzipCsv(gzip) : null;
}

// Laps by id with their car and CSV, in the order asked for (ids that don't exist, or that the viewer can't see,
// see LapViewer, are left out)
export async function readCollectorLapsById(
  viewer: LapViewer,
  ids: number[]
): Promise<{ id: number; car: string; lapNumber: number; csv: string }[]> {
  await ensureUserSchema();
  const rows = await query<StorageRow & { id: number; car: string; lap_number: number }>(
    `SELECT l.id, l.car, l.lap_number, ${STORAGE_COLUMNS}
     FROM racingcoach."CollectorLaps" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE l.id = ANY($1::integer[]) AND ${visibleTo(2)}`,
    [ids, lapViewerParam(viewer)]
  );
  const byId = new Map(rows.map((row) => [row.id, row]));
  const ordered = [...new Set(ids)].flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []));
  const csvs = await mapLimited(ordered, READ_CONCURRENCY, async (row) => {
    const gzip = await lapGzip(row);
    return gzip ? gunzipCsv(gzip).toString('utf8') : null;
  });
  const csvById = new Map(ordered.map((row, i) => [row.id, csvs[i]]));
  return ids.flatMap((id) => {
    const row = byId.get(id);
    const csv = csvById.get(id);
    return row && csv ? [{ id, car: row.car, lapNumber: row.lap_number, csv }] : [];
  });
}

// The user's laps with these collector IDs (clientLapId), with their CSVs, in the order asked for. Laps
// that aren't the user's, don't exist or have expired are left out.
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
    // When the lap was completed (ISO), for telling one stint from the next
    completedAt: string;
    csv: string;
  }[]
> {
  await ensureUserSchema();
  const rows = await query<
    StorageRow & {
      client_lap_id: string;
      track: string;
      track_key: string | null;
      car: string;
      lap_number: number;
      lap_time_seconds: number;
      incidents: number;
      off_track: boolean;
      completed_at: Date;
    }
  >(
    `SELECT l.client_lap_id, l.track, l.track_key, l.car, l.lap_number, l.lap_time_seconds, l.incidents, l.off_track,
            l.completed_at, ${STORAGE_COLUMNS}
     FROM racingcoach."CollectorLaps" l
     WHERE l.user_id = $1 AND l.client_lap_id = ANY($2::uuid[]) AND l.expires_at > now()`,
    [userId, clientLapIds]
  );
  const csvs = await mapLimited(rows, READ_CONCURRENCY, async (row) => {
    const gzip = await lapGzip(row);
    return gzip ? gunzipCsv(gzip).toString('utf8') : null;
  });
  const csvByRow = new Map(rows.map((row, i) => [row, csvs[i]]));
  return clientLapIds.flatMap((id) => {
    const row = rows.find((r) => r.client_lap_id.toLowerCase() === id.toLowerCase());
    const csv = row ? csvByRow.get(row) : null;
    if (!row || !csv) return [];
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
        completedAt: row.completed_at.toISOString(),
        csv,
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
// Either way the first copy's completion time and expiry stay. Throws LapExpiredError for a lap past its retention
// period at the user's level, or one the cleanup job already deleted.
//
// With TELEMETRY_STORAGE_MODE=r2 the CSV goes to the telemetry store first and the row is written after, so a row
// never points at an object that isn't there. Before the object is written a 'pending' cleanup entry names it, and
// the transaction that writes the row removes it: an upload that fails or dies half way leaves an entry the cleanup
// worker deletes the object for, never an orphan nobody knows about. When the store can't take it, the lap is stored
// inline instead (the backfill moves it later), so the collector's uploads keep working through a store outage.
export async function saveCollectorLap(
  userId: number,
  lap: CollectorLap,
  csvGzip: Buffer,
  csvBytes: number,
  hasPosition: boolean
): Promise<{ id: number; duplicate: boolean; replaced: boolean }> {
  await ensureUserSchema();
  const simulator = lap.simulator ?? DEFAULT_SIMULATOR;
  // The site's track: iRacing's key is one already, and another simulator's only through an explicit mapping
  const siteTrackKey = await resolveSimulatorTrackKey(simulator, lap.trackKey ?? null, lap.track);
  const nativeTrackKey = simulator === DEFAULT_SIMULATOR ? null : (lap.trackKey ?? null);
  await recordSimulatorCar(simulator, lap.carKey ?? null, lap.car);
  // The retention clock starts when the lap was completed, never later than now (lapCompletedAt)
  const completedAt = lapCompletedAt(new Date(lap.recordedAt), new Date());
  const [check] = await query<{ expired: boolean; deleted: boolean }>(
    `SELECT racingcoach.lap_expires_at($3, u.membership_level) <= now() AS expired,
            EXISTS (SELECT 1 FROM racingcoach."ExpiredLaps" e WHERE e.user_id = u.id AND e.client_lap_id = $2) AS deleted
     FROM racingcoach."Users" u WHERE u.id = $1`,
    [userId, lap.clientLapId, completedAt]
  );
  if (!check || check.expired || check.deleted) throw new LapExpiredError();

  // A retry of a lap already stored, which this copy wouldn't replace, is answered before anything is uploaded
  const existing = await existingLap(userId, lap.clientLapId);
  if (existing && !existing.live) throw new LapExpiredError();
  if (existing && (!hasPosition || existing.hasPosition)) return { id: existing.id, duplicate: true, replaced: false };

  const sha256 = sha256Hex(csvGzip);
  const object = await storeLapObject(userId, lap, simulator, csvGzip, csvBytes, sha256);
  const storage = storageValues(object, csvGzip, sha256);

  if (!existing) {
    try {
      const id = await transaction(async (client) => {
        const { rows } = await client.query<{ id: number }>(
          `INSERT INTO racingcoach."CollectorLaps" (
             user_id, client_lap_id, track, car, driver, iracing_session_id, iracing_subsession_id, session_num,
             session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road,
             off_track, recorded_at, csv_bytes, csv_gzip, has_position, track_key, conditions, completed_at, expires_at,
             simulator, native_track_key, payload_version, adapter_version, car_key,
             storage_provider, storage_status, storage_bucket, storage_key, stored_bytes, checksum_sha256, content_type,
             compression, stored_at, verified_at)
           SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23,
                  racingcoach.lap_expires_at($23, membership_level), $24, $25, $26, $27, $28,
                  $29, $30, $31, $32, $33, $34, $35, $36, $37, NULL
           FROM racingcoach."Users" WHERE id = $1
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
            storage.csvGzip,
            hasPosition,
            siteTrackKey,
            // pg would send a plain object as JSON anyway; stringified so null stays SQL NULL
            lap.conditions ? JSON.stringify(toLapConditions(lap.conditions)) : null,
            completedAt,
            simulator,
            nativeTrackKey,
            lap.payloadVersion ?? 1,
            lap.adapterVersion ?? null,
            lap.carKey ?? null,
            ...storage.params,
          ]
        );
        if (!rows[0]) throw new Error(`No user ${userId} to save a lap for`);
        await clearPendingEntry(client, object);
        return rows[0].id;
      });
      // "Tracks" holds iRacing's lengths, locations, bounds and outlines. Another simulator's are its own, even for a
      // track mapped to one of the site's, as its layout and coordinates needn't match
      if (simulator === DEFAULT_SIMULATOR) {
        await saveTrackLength(lap.trackKey ?? null, lap.trackLengthFeet ?? null);
        await saveTrackLocation(lap.trackKey ?? null, lap.trackLatitude ?? null, lap.trackLongitude ?? null);
      }
      if (simulator === DEFAULT_SIMULATOR && hasPosition) await saveTrackShapeFromLap(lap.trackKey ?? null, csvGzip, !lap.pitRoad && !lap.offTrack);
      return { id, duplicate: false, replaced: false };
    } catch (error) {
      // Another upload of the same lap got there first; carry on as a retry would
      if (!isUniqueViolation(error)) throw error;
    }
  }

  if (hasPosition) {
    // The samples and lap details are the same as the first upload's; only the CSV gains columns. Moving the row to a
    // new object (or inline) queues its old object for deletion (the collector_laps_object_replaced trigger).
    const replaced = await transaction(async (client) => {
      const { rows } = await client.query<{ id: number }>(
        `UPDATE racingcoach."CollectorLaps"
         SET csv_gzip = $3, csv_bytes = $4, has_position = true, uploaded_at = now(),
             storage_provider = $5, storage_status = $6, storage_bucket = $7, storage_key = $8, stored_bytes = $9,
             checksum_sha256 = $10, content_type = $11, compression = $12, stored_at = $13, verified_at = NULL
         WHERE user_id = $1 AND client_lap_id = $2 AND NOT has_position AND expires_at > now()
         RETURNING id`,
        [userId, lap.clientLapId, storage.csvGzip, csvBytes, ...storage.params]
      );
      if (rows[0]) await clearPendingEntry(client, object);
      return rows[0] ?? null;
    });
    if (replaced) {
      if (simulator === DEFAULT_SIMULATOR) await saveTrackShapeFromLap(lap.trackKey ?? null, csvGzip, !lap.pitRoad && !lap.offTrack);
      return { id: replaced.id, duplicate: true, replaced: true };
    }
  }
  const stored = await existingLap(userId, lap.clientLapId);
  // Expired since its first upload (e.g. the level went down) and not deleted yet
  if (!stored?.live) throw new LapExpiredError();
  return { id: stored.id, duplicate: true, replaced: false };
}

async function existingLap(userId: number, clientLapId: string) {
  const [row] = await query<{ id: number; live: boolean; has_position: boolean }>(
    'SELECT id, expires_at > now() AS live, has_position FROM racingcoach."CollectorLaps" WHERE user_id = $1 AND client_lap_id = $2',
    [userId, clientLapId]
  );
  return row ? { id: row.id, live: row.live, hasPosition: row.has_position } : null;
}

let warnedUnconfigured = false;

// Writes the lap's object when new laps go to the telemetry store; null means store it inline
async function storeLapObject(
  userId: number,
  lap: CollectorLap,
  simulator: string,
  csvGzip: Buffer,
  csvBytes: number,
  sha256: string
): Promise<StoredLapObject | null> {
  if (telemetryStorageMode() !== 'r2') return null;
  const store = telemetryStore();
  if (!store) {
    if (!warnedUnconfigured) {
      warnedUnconfigured = true;
      console.error('TELEMETRY_STORAGE_MODE is r2 but TELEMETRY_S3_* is not set: storing laps in Postgres');
    }
    return null;
  }
  const key = lapObjectKey({ simulator, userId, clientLapId: lap.clientLapId, sha256 });
  await query(
    `INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, user_id, reason, not_before)
     VALUES ($1, $2, $3, $4, 'pending', now() + ${PENDING_GRACE_SQL})
     ON CONFLICT (storage_bucket, storage_key) DO UPDATE
       SET reason = 'pending', not_before = GREATEST(racingcoach."TelemetryObjectCleanup".not_before, EXCLUDED.not_before)`,
    [store.provider, store.bucket, key, userId]
  );
  try {
    return await putLapObject(key, csvGzip, { sha256, csvBytes, userId, clientLapId: lap.clientLapId, simulator });
  } catch (error) {
    // Structured, and never the lap's contents
    console.error(
      JSON.stringify({
        event: 'telemetry_put_failed',
        userId,
        clientLapId: lap.clientLapId,
        bucket: store.bucket,
        key,
        bytes: csvGzip.length,
        error: error instanceof Error ? error.message : String(error),
        fallback: 'postgres',
      })
    );
    return null;
  }
}

// The storage columns' values, in the order the INSERT and replace UPDATE take them ($29-$37 / $5-$13), and csv_gzip.
// Inline rows clear any key: a row backfilled while still read inline gets a new CSV here, so its copy would be stale,
// and clearing the key queues that copy for deletion.
function storageValues(object: StoredLapObject | null, csvGzip: Buffer, sha256: string) {
  return {
    csvGzip: object ? null : csvGzip,
    params: [
      object ? STORAGE_PROVIDERS.r2 : STORAGE_PROVIDERS.postgres,
      object ? STORAGE_STATUS.stored : STORAGE_STATUS.inline,
      object?.bucket ?? null,
      object?.key ?? null,
      csvGzip.length,
      sha256,
      LAP_CONTENT_TYPE,
      LAP_COMPRESSION,
      object ? new Date() : null,
    ],
  };
}

// The upload's pending cleanup entry goes in the same transaction as the row that now references its object
async function clearPendingEntry(client: { query: (sql: string, params: unknown[]) => Promise<unknown> }, object: StoredLapObject | null) {
  if (!object) return;
  await client.query(
    `DELETE FROM racingcoach."TelemetryObjectCleanup" WHERE storage_bucket = $1 AND storage_key = $2 AND reason = 'pending'`,
    [object.bucket, object.key]
  );
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
    const csv = gunzipCsv(csvGzip).toString('utf8');
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
         WHERE l.has_position AND l.expires_at > now() AND l.simulator = '${DEFAULT_SIMULATOR}'
           AND (t.track_south IS NULL OR (t.track_outline IS NULL AND NOT (l.pit_road OR l.off_track)))
         ORDER BY lower(l.track_key), (l.pit_road OR l.off_track), l.recorded_at DESC`
      );
      for (const lap of laps) {
        const [row] = await query<StorageRow>(
          `SELECT ${STORAGE_COLUMNS} FROM racingcoach."CollectorLaps" l WHERE l.id = $1 AND l.expires_at > now()`,
          [lap.id]
        );
        const gzip = row ? await lapGzip(row) : null;
        if (gzip) await saveTrackShapeFromLap(lap.track_key, gzip, lap.clean);
      }
    } catch (error) {
      console.error('Backfill track shapes error:', error);
    }
  })();
  return backfill;
}
