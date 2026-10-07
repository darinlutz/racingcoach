// Imports a Track_Area_Information.txt file into one user's racingcoach."Tracks" and "FocusAreas".
//
//   node scripts/importTracks.mjs <email> [path/to/Track_Area_Information.txt]
//
// The user must already have an account (signing up also creates the tables). Re-running is safe: each
// track is matched on its key, its details are updated and its focus areas are replaced with the file's.
// Targets of 0 (the file's placeholder for "not set") and missing targets are stored as NULL.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const MAX_FOCUS_AREAS = 8;

const [email, filePath = 'data/Track_Area_Information.txt'] = process.argv.slice(2);
if (!email) {
  console.error('Usage: node scripts/importTracks.mjs <email> [path/to/Track_Area_Information.txt]');
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
const target = (value) => (typeof value === 'number' && value > 0 ? Math.round(value) : null);

function toRows(config) {
  return Object.entries(config).map(([key, track]) => {
    const areas = track.areas ?? [];
    if (areas.length > MAX_FOCUS_AREAS) {
      throw new Error(`${key} has ${areas.length} focus areas; the maximum is ${MAX_FOCUS_AREAS}`);
    }
    return {
      key,
      name: text(track.TrackFileName) ?? key,
      lengthFeet: target(track.TrackLengthInFeet),
      notes: text(track.Notes),
      areas: areas.map((area, i) => ({
        position: i + 1,
        name: text(area.name) ?? `Area ${i + 1}`,
        start: area.start,
        end: area.end,
        notes: text(area.Notes),
        brakeFeet: target(area.BrakepointTarget),
        maxBrakePct: target(area.MaxBrakeTarget),
        throttleFeet: target(area.ThrottlePickupTarget),
      })),
    };
  });
}

const tracks = toRows(readTrackConfig(filePath));
const client = new pg.Client({ connectionString: databaseUrl(), options: '-c search_path=racingcoach' });
await client.connect();

try {
  await client.query('BEGIN');
  const { rows: users } = await client.query(
    'SELECT id FROM racingcoach."Users" WHERE lower(email_address) = lower($1)',
    [email]
  );
  if (users.length === 0) throw new Error(`No account with email ${email}; sign up first`);
  const userId = users[0].id;

  for (const track of tracks) {
    const {
      rows: [{ id: trackId }],
    } = await client.query(
      `INSERT INTO racingcoach."Tracks" (user_id, track_key, track_name, track_length_feet, notes)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (user_id, lower(track_key)) DO UPDATE
         SET track_name = EXCLUDED.track_name, track_length_feet = EXCLUDED.track_length_feet,
             notes = EXCLUDED.notes, updated_at = now()
       RETURNING id`,
      [userId, track.key, track.name, track.lengthFeet, track.notes]
    );
    await client.query('DELETE FROM racingcoach."FocusAreas" WHERE track_id = $1', [trackId]);
    for (const area of track.areas) {
      await client.query(
        `INSERT INTO racingcoach."FocusAreas"
           (track_id, position, name, start_point, end_point, notes, brake_point_feet, max_brake_pct, throttle_point_feet)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [trackId, area.position, area.name, area.start, area.end, area.notes, area.brakeFeet, area.maxBrakePct, area.throttleFeet]
      );
    }
    console.log(`${track.name}: ${track.areas.length} focus areas`);
  }

  await client.query('COMMIT');
  console.log(`Imported ${tracks.length} tracks for ${email}.`);
} catch (error) {
  await client.query('ROLLBACK');
  console.error(`Import failed, nothing was saved: ${error.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
