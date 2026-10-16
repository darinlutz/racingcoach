// Imports a Track_Area_Information.txt file into Track Data: racingcoach."Tracks" and "TrackFocusAreas",
// which every user shares.
//
//   node scripts/importTracks.mjs <path/to/Track_Area_Information.txt>
//
// The site must have run once (it creates the tables). Re-running is safe: each track is matched on its
// key, its details are updated and its focus areas are replaced with the file's. Targets of 0 (the file's
// placeholder for "not set") and missing targets are stored as NULL.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const [filePath] = process.argv.slice(2);
if (!filePath) {
  console.error('Usage: node scripts/importTracks.mjs <path/to/Track_Area_Information.txt>');
  process.exit(1);
}

// DATABASE_URL from the environment, or from .env.local like `next dev` does
function databaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const line = readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith('DATABASE_URL='));
  if (!line) throw new Error('DATABASE_URL is not set');
  return line.slice('DATABASE_URL='.length).trim().replace(/^["']|["']$/g, '');
}

// The file is a JavaScript object literal (`const TrackConfig = { ... };`) with comments
function readTrackConfig(path) {
  return new Function(`${readFileSync(path, 'utf8')}\nreturn TrackConfig;`)();
}

const text = (value) => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);

function toRows(config) {
  return Object.entries(config).map(([key, track]) => {
    const areas = track.areas ?? [];
    return {
      key,
      name: text(track.TrackFileName) ?? key,
      notes: text(track.Notes),
      areas: areas.map((area, i) => ({
        position: i + 1,
        name: text(area.name) ?? `Area ${i + 1}`,
        start: area.start,
        end: area.end,
        // The file's BrakepointTarget, MaxBrakeTarget and ThrottlePickupTarget aren't imported: targets come only
        // from each driver's Target Lap
        notes: text(area.Notes),
      })),
    };
  });
}

const tracks = toRows(readTrackConfig(filePath));
const client = new pg.Client({ connectionString: databaseUrl(), options: '-c search_path=racingcoach' });
await client.connect();

try {
  await client.query('BEGIN');
  for (const track of tracks) {
    const {
      rows: [{ id: trackId }],
    } = await client.query(
      `INSERT INTO racingcoach."Tracks" (track_key, track_name, notes)
       VALUES ($1, $2, $3)
       ON CONFLICT (lower(track_key)) DO UPDATE
         SET track_name = EXCLUDED.track_name, notes = EXCLUDED.notes, updated_at = now()
       RETURNING id`,
      [track.key, track.name, track.notes]
    );
    await client.query('DELETE FROM racingcoach."TrackFocusAreas" WHERE track_id = $1', [trackId]);
    for (const area of track.areas) {
      await client.query(
        `INSERT INTO racingcoach."TrackFocusAreas"
           (track_id, position, name, start_point, end_point, notes)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [trackId, area.position, area.name, area.start, area.end, area.notes]
      );
    }
    console.log(`${track.name}: ${track.areas.length} focus areas`);
  }

  await client.query('COMMIT');
  console.log(`Imported ${tracks.length} tracks.`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(`Import failed, nothing was saved: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
