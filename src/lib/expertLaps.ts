import { gunzipSync, gzipSync } from 'node:zlib';
import { query } from '@/lib/db';
import { checkTargetLap, lapFileNameParts } from '@/lib/targetLap';
import { ensureUserSchema } from '@/lib/users';

// Expert Laps (racingcoach."ExpertLaps"): lap CSVs Coaches and Admins drop on the Coach page's Expert Laps
// section (src/components/ExpertLapsManager.tsx, /api/coach/expert-laps), at most one per car and track
// (matched ignoring case). Not tied to a driver: shared by every user. The car, track, driver and lap time come
// from the Garage 61 / RacingCoach file name, as lap CSVs carry no car or track. CSVs are gzip-compressed, like
// "CollectorLaps".csv_gzip, and only this file reads or writes them.

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

let schemaReady: Promise<void> | null = null;
function ensureExpertLapSchema(): Promise<void> {
  schemaReady ??= (async () => {
    await ensureUserSchema();
    await query(`
      CREATE TABLE IF NOT EXISTS racingcoach."ExpertLaps" (
        id SERIAL PRIMARY KEY,
        car TEXT NOT NULL,
        track TEXT NOT NULL,
        driver TEXT NOT NULL,
        lap_time TEXT NOT NULL,
        file_name TEXT NOT NULL,
        csv_gzip BYTEA NOT NULL,
        uploaded_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
        uploaded_at TIMESTAMPTZ NOT NULL DEFAULT now()
      )`);
    await query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "ExpertLaps_car_track" ON racingcoach."ExpertLaps" (lower(car), lower(track))'
    );
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

  const params = [parts.car, parts.track, parts.driver, parts.lapTime, fileName, gzipSync(csv), userId];
  const [row] = await query<ExpertLapRow>(
    `INSERT INTO racingcoach."ExpertLaps" (car, track, driver, lap_time, file_name, csv_gzip, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT ((lower(car)), (lower(track))) ${
       replace
         ? `DO UPDATE SET car = EXCLUDED.car, track = EXCLUDED.track, driver = EXCLUDED.driver,
              lap_time = EXCLUDED.lap_time, file_name = EXCLUDED.file_name, csv_gzip = EXCLUDED.csv_gzip,
              uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()`
         : 'DO NOTHING'
     }
     RETURNING ${INFO_COLUMNS}`,
    params
  );
  if (row) return { saved: toInfo(row) };

  const [existing] = await query<ExpertLapRow>(
    `SELECT ${INFO_COLUMNS} FROM racingcoach."ExpertLaps" WHERE lower(car) = lower($1) AND lower(track) = lower($2)`,
    [parts.car, parts.track]
  );
  return { existing: toInfo(existing) };
}

export async function readExpertLap(id: number): Promise<{ fileName: string; csv: string } | null> {
  await ensureExpertLapSchema();
  const [row] = await query<{ file_name: string; csv_gzip: Buffer }>(
    'SELECT file_name, csv_gzip FROM racingcoach."ExpertLaps" WHERE id = $1',
    [id]
  );
  if (!row) return null;
  return { fileName: row.file_name, csv: gunzipSync(row.csv_gzip).toString('utf8') };
}

export async function deleteExpertLap(id: number): Promise<boolean> {
  await ensureExpertLapSchema();
  const rows = await query('DELETE FROM racingcoach."ExpertLaps" WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}
