import { gunzipSync } from 'node:zlib';
import type { PoolClient } from 'pg';
import { query } from './db';

// iRacing's track lengths, in racingcoach."TrackLengths": one row per track name as iRacing reports it (the
// collector's "CollectorLaps".track), worked out from the first lap of the track the collector uploads. A
// track's length doesn't change, so it's worked out once; readTracks (tracks.ts) reads them for Track Data.

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

// Every known track length, by iRacing's track name. The caller has run ensureUserSchema.
export async function readTrackLengths(): Promise<{ track: string; lengthFeet: number }[]> {
  const rows = await query<{ track: string; length_feet: number }>(
    'SELECT track, length_feet FROM racingcoach."TrackLengths"'
  );
  return rows.map((row) => ({ track: row.track, lengthFeet: Number(row.length_feet) }));
}

// Saves the track's length from an uploaded lap's CSV, unless the track already has one (then the CSV
// isn't even unzipped). The caller has run ensureUserSchema.
export async function saveTrackLength(track: string, csvGzip: Buffer): Promise<void> {
  const [known] = await query('SELECT 1 FROM racingcoach."TrackLengths" WHERE track = $1', [track]);
  if (known) return;
  const lengthFeet = lapCsvTrackLengthFeet(gunzipSync(csvGzip).toString('utf8'));
  if (lengthFeet === null) return;
  await query(
    'INSERT INTO racingcoach."TrackLengths" (track, length_feet) VALUES ($1, $2) ON CONFLICT (track) DO NOTHING',
    [track, lengthFeet]
  );
}

// Fills "TrackLengths" from laps uploaded before it existed: the latest lap of each track, or an earlier
// one when that lap's CSV can't tell. Runs once, on the caller's transaction, when the table is created.
export async function backfillTrackLengths(client: PoolClient): Promise<void> {
  const { rows: tracks } = await client.query<{ track: string }>(
    'SELECT DISTINCT track FROM racingcoach."CollectorLaps"'
  );
  for (const { track } of tracks) {
    const { rows: laps } = await client.query<{ id: number }>(
      'SELECT id FROM racingcoach."CollectorLaps" WHERE track = $1 ORDER BY id DESC LIMIT 5',
      [track]
    );
    for (const { id } of laps) {
      const { rows } = await client.query<{ csv_gzip: Buffer }>(
        'SELECT csv_gzip FROM racingcoach."CollectorLaps" WHERE id = $1',
        [id]
      );
      const lengthFeet = lapCsvTrackLengthFeet(gunzipSync(rows[0].csv_gzip).toString('utf8'));
      if (lengthFeet === null) continue;
      await client.query('INSERT INTO racingcoach."TrackLengths" (track, length_feet) VALUES ($1, $2)', [
        track,
        lengthFeet,
      ]);
      break;
    }
  }
}
