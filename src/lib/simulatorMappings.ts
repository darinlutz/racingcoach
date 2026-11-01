import { query } from './db';
import { DEFAULT_SIMULATOR } from './simulators';

// Which of the site's tracks and cars another simulator's own ids are, in racingcoach."SimulatorTracks" and
// "SimulatorCars". iRacing's stay where they've always been ("Tracks".track_key, and car names), so nothing about its
// laps or tracks goes through here.
//
// Rows appear unmapped (track_id or car_id NULL) as laps arrive, so Coaches can see what needs mapping. A mapping is only
// ever made on purpose (mapSimulatorTrack, mapSimulatorCar), never from similar names: two simulators' versions of a
// circuit can be different layouts or scans, and their focus areas (fractions of a lap) wouldn't line up.

// Records a track or car a lap was driven on and says which of the site's it's mapped to, if any. The caller has run
// ensureUserSchema.
export async function resolveSimulatorTrackKey(
  simulator: string,
  nativeKey: string | null,
  nativeName: string
): Promise<string | null> {
  if (simulator === DEFAULT_SIMULATOR) return nativeKey;
  if (!nativeKey) return null;
  const [row] = await query<{ track_key: string | null }>(
    `WITH seen AS (
       INSERT INTO racingcoach."SimulatorTracks" (simulator, native_key, native_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (simulator, lower(native_key)) DO UPDATE SET native_name = EXCLUDED.native_name, last_seen_at = now()
       RETURNING track_id
     )
     SELECT t.track_key FROM seen LEFT JOIN racingcoach."Tracks" t ON t.id = seen.track_id`,
    [simulator, nativeKey, nativeName]
  );
  return row?.track_key ?? null;
}

export async function recordSimulatorCar(simulator: string, nativeKey: string | null, nativeName: string): Promise<void> {
  if (simulator === DEFAULT_SIMULATOR || !nativeKey) return;
  await query(
    `INSERT INTO racingcoach."SimulatorCars" (simulator, native_key, native_name)
     VALUES ($1, $2, $3)
     ON CONFLICT (simulator, lower(native_key)) DO UPDATE SET native_name = EXCLUDED.native_name, last_seen_at = now()`,
    [simulator, nativeKey, nativeName]
  );
}

// Says this simulator's track is this one of the site's. Laps uploaded after this use its focus areas.
export async function mapSimulatorTrack(simulator: string, nativeKey: string, trackId: number | null): Promise<boolean> {
  const rows = await query(
    `UPDATE racingcoach."SimulatorTracks" SET track_id = $3, mapped_at = CASE WHEN $3::integer IS NULL THEN NULL ELSE now() END
     WHERE simulator = $1 AND lower(native_key) = lower($2) RETURNING id`,
    [simulator, nativeKey, trackId]
  );
  return rows.length > 0;
}

export async function mapSimulatorCar(simulator: string, nativeKey: string, carId: number | null): Promise<boolean> {
  const rows = await query(
    `UPDATE racingcoach."SimulatorCars" SET car_id = $3, mapped_at = CASE WHEN $3::integer IS NULL THEN NULL ELSE now() END
     WHERE simulator = $1 AND lower(native_key) = lower($2) RETURNING id`,
    [simulator, nativeKey, carId]
  );
  return rows.length > 0;
}
