import type { PoolClient } from 'pg';
import { query } from './db';

// iRacing's track lengths, in racingcoach."Tracks".track_length_feet: iRacing's session info length
// (WeekendInfo.TrackLength, e.g. "5.79 km"), which the collector sends with each lap it uploads along with the
// track key. readTracks (tracks.ts) reads it for Track Data. Laps without a key (collectors before 1.29.0) or
// without a length (before the collector sent it) don't give a length.

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

// Saves iRacing's length of the track an uploaded lap was driven on, on its "Tracks" row (by track key), when it
// differs from the one there. Nothing without a key or length. The caller has run ensureUserSchema.
export async function saveTrackLength(trackKey: string | null, lengthFeet: number | null): Promise<void> {
  if (!trackKey || !lengthFeet) return;
  await query(
    `UPDATE racingcoach."Tracks" SET track_length_feet = $2, updated_at = now()
     WHERE lower(track_key) = lower($1) AND track_length_feet IS DISTINCT FROM $2`,
    [trackKey, lengthFeet]
  );
}

// Drops the old racingcoach."TrackLengths" table, whose lengths were worked out from laps' LapDist / LapDistPct
// and aren't kept: each track gets iRacing's own with its next uploaded lap. On the caller's transaction.
export async function dropTrackLengthsTable(client: PoolClient): Promise<void> {
  await client.query('DROP TABLE IF EXISTS racingcoach."TrackLengths"');
}
