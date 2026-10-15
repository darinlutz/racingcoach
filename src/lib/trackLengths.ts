import { gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { query } from './db';

// iRacing's track lengths, in racingcoach."TrackLengths": one row per track layout, by iRacing's track key
// (WeekendInfo.TrackName, e.g. "twinring fullrc"; "CollectorLaps".track_key), worked out from the first lap of the
// layout the collector uploads with its key. A layout's length doesn't change, so it's worked out once;
// readTracks (tracks.ts) reads them for Track Data by "Tracks".track_key. Laps without a key (collectors before
// 1.29.0) don't give a length, as nothing could find it.

const FEET_PER_METER = 3.280839895;

// iRacing's length of the track in feet, from a lap CSV's LapDist (meters from the start/finish line) and
// LapDistPct: the median of LapDist / LapDistPct over the samples well away from the line. null if the CSV
// has no LapDist column (collectors that didn't write one).
export function lapCsvTrackLengthFeet(csv: string): number | null {
  const lines = csv.split(/\r?\n/);
  const header = lines[0].split(',').map((column) => column.trim());
  const distColumn = header.indexOf('LapDist');
  const pctColumn = header.indexOf('LapDistPct');
  if (distColumn < 0 || pctColumn < 0) return null;
  const lengths: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',');
    const pct = parseFloat(cells[pctColumn]);
    const dist = parseFloat(cells[distColumn]);
    if (pct > 0.1 && pct < 0.9 && dist > 0) lengths.push(dist / pct);
  }
  if (lengths.length === 0) return null;
  lengths.sort((a, b) => a - b);
  return lengths[Math.floor(lengths.length / 2)] * FEET_PER_METER;
}

// Every known track length, by iRacing's track key. The caller has run ensureUserSchema.
export async function readTrackLengths(): Promise<{ trackKey: string; lengthFeet: number }[]> {
  const rows = await query<{ track_key: string; length_feet: number }>(
    'SELECT track_key, length_feet FROM racingcoach."TrackLengths"'
  );
  return rows.map((row) => ({ trackKey: row.track_key, lengthFeet: Number(row.length_feet) }));
}

// Saves the track's length from an uploaded lap's CSV, unless the track already has one (then the CSV
// isn't even unzipped). Nothing without a track key. The caller has run ensureUserSchema.
export async function saveTrackLength(trackKey: string | null, track: string, csvGzip: Buffer): Promise<void> {
  if (!trackKey) return;
  const [known] = await query('SELECT 1 FROM racingcoach."TrackLengths" WHERE track_key = $1', [trackKey]);
  if (known) return;
  const lengthFeet = lapCsvTrackLengthFeet(gunzipSync(csvGzip).toString('utf8'));
  if (lengthFeet === null) return;
  await query(
    'INSERT INTO racingcoach."TrackLengths" (track_key, track, length_feet) VALUES ($1, $2, $3) ON CONFLICT (track_key) DO NOTHING',
    [trackKey, track, lengthFeet]
  );
}

// Moves a "TrackLengths" from before track keys (keyed by iRacing's track name) to keying by track_key, on the
// caller's transaction. Each row gets the key of the Track Data track with the same name; rows with no such track
// are deleted (the next lap there with a key works the length out again), and of two names for one key the older
// is kept. Does nothing once the table is keyed by track_key.
export async function migrateTrackLengthsToKey(client: PoolClient): Promise<void> {
  const { rows } = await client.query<{ column: string; constraint: string }>(
    `SELECT a.attname AS column, c.conname AS constraint
     FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
     WHERE c.conrelid = 'racingcoach."TrackLengths"'::regclass AND c.contype = 'p'`
  );
  if (rows[0]?.column !== 'track') return;

  await client.query('ALTER TABLE racingcoach."TrackLengths" ADD COLUMN IF NOT EXISTS track_key TEXT');
  await client.query(
    `UPDATE racingcoach."TrackLengths" l SET track_key = t.track_key
     FROM racingcoach."Tracks" t
     WHERE l.track_key IS NULL AND lower(t.track_name) = lower(l.track)`
  );
  await client.query('DELETE FROM racingcoach."TrackLengths" WHERE track_key IS NULL');
  await client.query(
    `DELETE FROM racingcoach."TrackLengths" l USING racingcoach."TrackLengths" older
     WHERE l.track_key = older.track_key AND (older.created_at, older.track) < (l.created_at, l.track)`
  );
  await client.query(`ALTER TABLE racingcoach."TrackLengths" DROP CONSTRAINT "${rows[0].constraint}"`);
  await client.query('ALTER TABLE racingcoach."TrackLengths" ALTER COLUMN track DROP NOT NULL');
  await client.query('ALTER TABLE racingcoach."TrackLengths" ADD PRIMARY KEY (track_key)');
}
