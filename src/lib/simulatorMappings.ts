import { query, transaction } from './db';
import { simulatorCatalog } from './simulatorCatalogs';
import { DEFAULT_SIMULATOR } from './simulators';

// Which of the site's tracks and cars another simulator's own ids are, in racingcoach."SimulatorTracks" and
// "SimulatorCars". iRacing's stay where they've always been ("Tracks".track_key, and car names), so nothing about its
// laps or tracks goes through here.
//
// Rows appear unmapped (track_id or car_id NULL) as laps arrive, so Coaches can see what needs mapping, and the Coach
// page's Simulator Mapping (src/components/SimulatorMappings.tsx) can also map a track or car from the simulator's
// catalog (simulatorCatalogs.ts) before any lap has. A mapping is only ever made on purpose (mapSimulatorTrack,
// mapSimulatorCar), never from similar names: two simulators' versions of a circuit can be different layouts or scans,
// and their focus areas (fractions of a lap) wouldn't line up.
//
// A mapped lap reads like an iRacing one: its track_key is the site track's (so Track Data's focus areas, length and
// Target Lap targets apply) and its track and car are the site's names, so laps of both simulators group, match and
// compare together. Its own ids stay in native_track_key and car_key. Mapping, changing or removing one re-labels the
// laps already stored, so they follow it.

export type SiteNames = { trackKey: string | null; trackName: string | null };

// Records a track a lap was driven on and says which of the site's it's mapped to, if any: its key and name. The
// caller has run ensureUserSchema.
export async function resolveSimulatorTrack(simulator: string, nativeKey: string | null, nativeName: string): Promise<SiteNames> {
  if (simulator === DEFAULT_SIMULATOR) return { trackKey: nativeKey, trackName: null };
  if (!nativeKey) return { trackKey: null, trackName: null };
  const [row] = await query<{ track_key: string | null; track_name: string | null }>(
    `WITH seen AS (
       INSERT INTO racingcoach."SimulatorTracks" (simulator, native_key, native_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (simulator, lower(native_key)) DO UPDATE SET native_name = EXCLUDED.native_name, last_seen_at = now()
       RETURNING track_id
     )
     SELECT t.track_key, t.track_name FROM seen LEFT JOIN racingcoach."Tracks" t ON t.id = seen.track_id`,
    [simulator, nativeKey, nativeName]
  );
  return { trackKey: row?.track_key ?? null, trackName: row?.track_name ?? null };
}

// The site track's key only (resolveSimulatorTrack)
export async function resolveSimulatorTrackKey(simulator: string, nativeKey: string | null, nativeName: string): Promise<string | null> {
  return (await resolveSimulatorTrack(simulator, nativeKey, nativeName)).trackKey;
}

// Records a car a lap was driven in and answers the site car's name it's mapped to, or null
export async function resolveSimulatorCar(simulator: string, nativeKey: string | null, nativeName: string): Promise<string | null> {
  if (simulator === DEFAULT_SIMULATOR || !nativeKey) return null;
  const [row] = await query<{ car_name: string | null }>(
    `WITH seen AS (
       INSERT INTO racingcoach."SimulatorCars" (simulator, native_key, native_name)
       VALUES ($1, $2, $3)
       ON CONFLICT (simulator, lower(native_key)) DO UPDATE SET native_name = EXCLUDED.native_name, last_seen_at = now()
       RETURNING car_id
     )
     SELECT c.car_name FROM seen LEFT JOIN racingcoach."Cars" c ON c.id = seen.car_id`,
    [simulator, nativeKey, nativeName]
  );
  return row?.car_name ?? null;
}

export async function recordSimulatorCar(simulator: string, nativeKey: string | null, nativeName: string): Promise<void> {
  await resolveSimulatorCar(simulator, nativeKey, nativeName);
}

// The catalog's name for a native id, for a row that hasn't been seen in a lap yet
function catalogName(simulator: string, kind: 'tracks' | 'cars', nativeKey: string): string | null {
  const needle = nativeKey.trim().toLowerCase();
  return simulatorCatalog(simulator)[kind].find((entry) => entry.key.toLowerCase() === needle)?.name ?? null;
}

// Says this simulator's track is this one of the site's (null removes the mapping), for a track seen in a lap or in
// the simulator's catalog; false for any other. Its laps already stored take the site track's key and name (or
// their own name back), and laps uploaded after this do too.
export async function mapSimulatorTrack(simulator: string, nativeKey: string, trackId: number | null): Promise<boolean> {
  if (simulator === DEFAULT_SIMULATOR) return false;
  const fromCatalog = catalogName(simulator, 'tracks', nativeKey);
  return transaction(async (client) => {
    if (fromCatalog) {
      await client.query(
        `INSERT INTO racingcoach."SimulatorTracks" (simulator, native_key, native_name) VALUES ($1, $2, $3)
         ON CONFLICT (simulator, lower(native_key)) DO NOTHING`,
        [simulator, nativeKey, fromCatalog]
      );
    }
    const { rows } = await client.query<{ native_name: string }>(
      `UPDATE racingcoach."SimulatorTracks" SET track_id = $3, mapped_at = CASE WHEN $3::integer IS NULL THEN NULL ELSE now() END
       WHERE simulator = $1 AND lower(native_key) = lower($2) RETURNING native_name`,
      [simulator, nativeKey, trackId]
    );
    if (rows.length === 0) return false;
    await client.query(
      `UPDATE racingcoach."CollectorLaps" l
       SET track_key = t.track_key, track = COALESCE(t.track_name, $3)
       FROM (SELECT $4::integer AS id) wanted LEFT JOIN racingcoach."Tracks" t ON t.id = wanted.id
       WHERE l.simulator = $1 AND lower(l.native_track_key) = lower($2)`,
      [simulator, nativeKey, rows[0].native_name, trackId]
    );
    return true;
  });
}

// mapSimulatorTrack for a car. Its laps already stored take the site car's name (or their own back).
export async function mapSimulatorCar(simulator: string, nativeKey: string, carId: number | null): Promise<boolean> {
  if (simulator === DEFAULT_SIMULATOR) return false;
  const fromCatalog = catalogName(simulator, 'cars', nativeKey);
  return transaction(async (client) => {
    if (fromCatalog) {
      await client.query(
        `INSERT INTO racingcoach."SimulatorCars" (simulator, native_key, native_name) VALUES ($1, $2, $3)
         ON CONFLICT (simulator, lower(native_key)) DO NOTHING`,
        [simulator, nativeKey, fromCatalog]
      );
    }
    const { rows } = await client.query<{ native_name: string }>(
      `UPDATE racingcoach."SimulatorCars" SET car_id = $3, mapped_at = CASE WHEN $3::integer IS NULL THEN NULL ELSE now() END
       WHERE simulator = $1 AND lower(native_key) = lower($2) RETURNING native_name`,
      [simulator, nativeKey, carId]
    );
    if (rows.length === 0) return false;
    await client.query(
      `UPDATE racingcoach."CollectorLaps" l
       SET car = COALESCE(c.car_name, $3)
       FROM (SELECT $4::integer AS id) wanted LEFT JOIN racingcoach."Cars" c ON c.id = wanted.id
       WHERE l.simulator = $1 AND lower(l.car_key) = lower($2)`,
      [simulator, nativeKey, rows[0].native_name, carId]
    );
    return true;
  });
}

// One of the simulator's tracks or cars on the Coach page: its own id and name, whether a lap has come from it, the
// site's track or car it's mapped to, and how many stored laps it has
export type SimulatorMappingRow = {
  nativeKey: string;
  nativeName: string;
  seen: boolean;
  siteId: number | null;
  laps: number;
};

export type SimulatorMappingList = {
  simulator: string;
  tracks: SimulatorMappingRow[];
  cars: SimulatorMappingRow[];
  // What can be picked: Track Data's tracks (those with focus areas first) and Car Data's cars
  siteTracks: { id: number; name: string; hasFocusAreas: boolean }[];
  siteCars: { id: number; name: string }[];
};

// The catalog's tracks and cars with any others seen in laps, each with its mapping. The caller has run ensureUserSchema.
export async function listSimulatorMappings(simulator: string): Promise<SimulatorMappingList> {
  const [trackRows, carRows, siteTracks, siteCars] = await Promise.all([
    query<{ native_key: string; native_name: string; track_id: number | null; laps: number }>(
      `SELECT s.native_key, s.native_name, s.track_id,
              (SELECT count(*)::int FROM racingcoach."CollectorLaps" l
               WHERE l.simulator = s.simulator AND lower(l.native_track_key) = lower(s.native_key) AND l.expires_at > now()) AS laps
       FROM racingcoach."SimulatorTracks" s WHERE s.simulator = $1`,
      [simulator]
    ),
    query<{ native_key: string; native_name: string; car_id: number | null; laps: number }>(
      `SELECT s.native_key, s.native_name, s.car_id,
              (SELECT count(*)::int FROM racingcoach."CollectorLaps" l
               WHERE l.simulator = s.simulator AND lower(l.car_key) = lower(s.native_key) AND l.expires_at > now()) AS laps
       FROM racingcoach."SimulatorCars" s WHERE s.simulator = $1`,
      [simulator]
    ),
    query<{ id: number; track_name: string; has_areas: boolean }>(
      `SELECT t.id, t.track_name,
              EXISTS (SELECT 1 FROM racingcoach."TrackFocusAreas" a WHERE a.track_id = t.id) AS has_areas
       FROM racingcoach."Tracks" t ORDER BY lower(t.track_name)`
    ),
    query<{ id: number; car_name: string }>(`SELECT id, car_name FROM racingcoach."Cars" ORDER BY lower(car_name)`),
  ]);
  const catalog = simulatorCatalog(simulator);
  const merge = (
    entries: { key: string; name: string }[],
    rows: { native_key: string; native_name: string; site_id: number | null; laps: number }[]
  ): SimulatorMappingRow[] => {
    const byKey = new Map(rows.map((row) => [row.native_key.toLowerCase(), row]));
    const listed = entries.map((entry): SimulatorMappingRow => {
      const row = byKey.get(entry.key.toLowerCase());
      byKey.delete(entry.key.toLowerCase());
      return { nativeKey: row?.native_key ?? entry.key, nativeName: entry.name, seen: !!row && row.laps > 0, siteId: row?.site_id ?? null, laps: row?.laps ?? 0 };
    });
    // Seen in laps but not in the catalog (e.g. a track or car newer than it)
    const others = [...byKey.values()].map((row): SimulatorMappingRow => ({
      nativeKey: row.native_key,
      nativeName: row.native_name,
      seen: row.laps > 0,
      siteId: row.site_id,
      laps: row.laps,
    }));
    return [...listed, ...others].sort((a, b) => a.nativeName.localeCompare(b.nativeName));
  };
  return {
    simulator,
    tracks: merge(catalog.tracks, trackRows.map((r) => ({ ...r, site_id: r.track_id }))),
    cars: merge(catalog.cars, carRows.map((r) => ({ ...r, site_id: r.car_id }))),
    siteTracks: siteTracks.map((t) => ({ id: t.id, name: t.track_name, hasFocusAreas: t.has_areas })),
    siteCars: siteCars.map((c) => ({ id: c.id, name: c.car_name })),
  };
}
