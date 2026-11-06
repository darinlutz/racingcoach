// Multi-simulator database tests: npm run test:simulators
//
// Runs the site's own modules against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-simulators-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:16
//   SIMULATORS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:simulators
// Skipped without SIMULATORS_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const url = process.env.SIMULATORS_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'SIMULATORS_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let users, laps, mappings;
let client;
let userId;
const q = async (sql, params) => (await client.query(sql, params)).rows;

const IRACING_KEY = 'simtest layout'; // not one of the seeded tracks' keys
const HEADER = 'Speed,LapDistPct,Brake,Throttle,Lat,Lon';
// A lap with track positions going round in a little circle
const csv = (positions = true, center = 41.9) => {
  const rows = [HEADER];
  for (let i = 0; i < 600; i++) {
    const a = (i / 600) * 2 * Math.PI;
    rows.push(`40,${(i / 600).toFixed(4)},0,1,${positions ? center + 0.01 * Math.sin(a) : ''},${positions ? -73.3 + 0.01 * Math.cos(a) : ''}`);
  }
  return rows.join('\n') + '\n';
};

// The details an iRacing collector has always sent: no simulator, no payloadVersion
const oldPayload = (over = {}) => ({
  clientLapId: randomUUID(),
  track: 'Lime Rock Park (Grand Prix)',
  trackKey: IRACING_KEY,
  trackLengthFeet: 7939.6,
  trackLatitude: 41.928,
  trackLongitude: -73.381,
  car: 'Test Car',
  driver: 'Test Driver',
  sessionId: 111,
  subSessionId: 222,
  sessionNum: 0,
  sessionType: 'Practice',
  lapNumber: 1,
  lapTimeSeconds: 60,
  samples: 600,
  missingSamples: 0,
  incidents: 0,
  pitRoad: false,
  offTrack: false,
  recordedAt: new Date().toISOString(),
  ...over,
});

const save = (details, content = csv()) => {
  const gz = gzipSync(content);
  const parsed = laps.collectorLapSchema.parse(details);
  const { csvBytes, hasPosition } = laps.checkLapCsv(gz, parsed.samples);
  return laps.saveCollectorLap(userId, parsed, gz, csvBytes, hasPosition);
};

const trackRow = async () =>
  (await q(`SELECT track_length_feet, track_latitude, track_south, track_outline FROM racingcoach."Tracks" WHERE lower(track_key) = $1`, [IRACING_KEY]))[0];

describe('simulators in the database', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    laps = await import(new URL('collectorLaps.ts', src).href);
    mappings = await import(new URL('simulatorMappings.ts', src).href);
    await users.ensureUserSchema();
    const [user] = await q(
      `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level)
       VALUES ('Sim Tester', 'sims@example.test', 'x', 'Gold') RETURNING id`
    );
    userId = user.id;
    await q(`INSERT INTO racingcoach."Tracks" (track_name, config_name, track_key) VALUES ('Lime Rock Park', 'Grand Prix', $1)`, [IRACING_KEY]);
  });

  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('an old collector payload is saved exactly as before, as iRacing', async () => {
    const { id, duplicate } = await save(oldPayload());
    assert.equal(duplicate, false);
    const [row] = await q(`SELECT simulator, payload_version, track_key, native_track_key, adapter_version FROM racingcoach."CollectorLaps" WHERE id = $1`, [id]);
    assert.deepEqual(row, { simulator: 'iracing', payload_version: 1, track_key: IRACING_KEY, native_track_key: null, adapter_version: null });
    const track = await trackRow();
    assert.equal(track.track_length_feet, 7939.6);
    assert.equal(track.track_latitude, 41.928);
    assert.ok(track.track_south, 'the first iRacing lap with positions still gives the bounds');
    assert.ok(track.track_outline, 'and the outline');
  });

  test('a new collector payload naming iRacing is the same as an old one', async () => {
    const { id } = await save(oldPayload({ simulator: 'iracing', payloadVersion: 1, adapterVersion: null }));
    const [row] = await q(`SELECT simulator, track_key FROM racingcoach."CollectorLaps" WHERE id = $1`, [id]);
    assert.deepEqual(row, { simulator: 'iracing', track_key: IRACING_KEY });
  });

  test('a retried upload stays a duplicate, and adding positions still replaces', async () => {
    const details = oldPayload();
    const first = await save(details, csv(false));
    const retry = await save(details, csv(false));
    assert.equal(retry.id, first.id);
    assert.equal(retry.duplicate, true);
    const replaced = await save(details, csv(true));
    assert.equal(replaced.replaced, true);
  });

  test('another simulator with the same track key changes nothing of iRacing\'s track', async () => {
    const before = await trackRow();
    const { id } = await save(
      oldPayload({ simulator: 'acc', payloadVersion: 1, adapterVersion: '1', trackKey: IRACING_KEY, trackLengthFeet: 1, trackLatitude: 1, trackLongitude: 1 }),
      csv(true, 10)
    );
    assert.deepEqual(await trackRow(), before);

    // Its own id is kept, and unmapped means it finds no site track
    const [row] = await q(`SELECT simulator, track_key, native_track_key, adapter_version FROM racingcoach."CollectorLaps" WHERE id = $1`, [id]);
    assert.deepEqual(row, { simulator: 'acc', track_key: null, native_track_key: IRACING_KEY, adapter_version: '1' });
  });

  test('a native track is listed unmapped, and only an explicit mapping connects it', async () => {
    await save(oldPayload({ simulator: 'acc', trackKey: 'lime_rock', track: 'Lime Rock Park (Grand Prix)' }));
    const [seen] = await q(`SELECT track_id, native_name FROM racingcoach."SimulatorTracks" WHERE simulator = 'acc' AND native_key = 'lime_rock'`);
    assert.equal(seen.track_id, null, 'not merged because the name is the same');

    const [{ id: trackId }] = await q(`SELECT id FROM racingcoach."Tracks" WHERE lower(track_key) = $1`, [IRACING_KEY]);
    assert.equal(await mappings.mapSimulatorTrack('acc', 'lime_rock', trackId), true);
    const before = await trackRow();
    const { id } = await save(oldPayload({ simulator: 'acc', trackKey: 'LIME_ROCK', trackLengthFeet: 2 }));
    const [row] = await q(`SELECT track_key, native_track_key FROM racingcoach."CollectorLaps" WHERE id = $1`, [id]);
    assert.deepEqual(row, { track_key: IRACING_KEY, native_track_key: 'LIME_ROCK' });
    assert.deepEqual(await trackRow(), before, 'mapped or not, only iRacing laps write to the track');

    assert.equal(await mappings.mapSimulatorTrack('acc', 'no_such_track', trackId), false);
    assert.equal(await mappings.mapSimulatorTrack('acc', 'lime_rock', null), true);
  });

  test('one simulator\'s native key is not another\'s', async () => {
    await save(oldPayload({ simulator: 'acc', trackKey: 'spa' }));
    await save(oldPayload({ simulator: 'ams2', trackKey: 'spa' }));
    const rows = await q(`SELECT simulator FROM racingcoach."SimulatorTracks" WHERE native_key = 'spa' ORDER BY simulator`);
    assert.deepEqual(rows.map((r) => r.simulator), ['acc', 'ams2']);
  });

  test('cars are recorded per simulator, unmapped', async () => {
    await save(oldPayload({ simulator: 'acc', carKey: 'amr_v8_vantage_gt3', car: 'Aston Martin' }));
    const [row] = await q(`SELECT car_id, native_name FROM racingcoach."SimulatorCars" WHERE simulator = 'acc'`);
    assert.deepEqual(row, { car_id: null, native_name: 'Aston Martin' });
    await save(oldPayload({ carKey: 'should_not_be_recorded' }));
    const iracing = await q(`SELECT 1 FROM racingcoach."SimulatorCars" WHERE simulator = 'iracing'`);
    assert.equal(iracing.length, 0);
  });

  test('every lap, old or new, still reads back, and says which simulator', async () => {
    const list = await laps.listCollectorLaps({ id: userId, role: 'User' }, [userId]);
    assert.ok(list.length >= 5);
    assert.ok(list.some((lap) => lap.simulator === 'iracing'));
    assert.ok(list.some((lap) => lap.simulator === 'acc' && lap.nativeTrackKey === 'spa'));
    const [one] = list.filter((lap) => lap.simulator === 'acc');
    assert.ok(await laps.readCollectorLapCsv({ id: userId, role: 'User' }, one.id));
  });

  test('deleting a mapped site track or the user leaves the mappings consistent', async () => {
    const [{ id: trackId }] = await q(`INSERT INTO racingcoach."Tracks" (track_name, config_name, track_key) VALUES ('Gone', 'X', 'gone') RETURNING id`);
    await save(oldPayload({ simulator: 'acc', trackKey: 'gone_native' }));
    await mappings.mapSimulatorTrack('acc', 'gone_native', trackId);
    await q(`DELETE FROM racingcoach."Tracks" WHERE id = $1`, [trackId]);
    const [row] = await q(`SELECT track_id FROM racingcoach."SimulatorTracks" WHERE native_key = 'gone_native'`);
    assert.equal(row.track_id, null);
  });

  test('mapping a track and car re-labels their stored laps like iRacing laps, and unmapping gives their own names back', async () => {
    const acc = { simulator: 'acc', trackKey: 'Monza', track: 'monza', carKey: 'ferrari_488_gt3_evo', car: 'Ferrari 488 GT3 Evo 2020' };
    const { id } = await save(oldPayload(acc));
    const read = async (lapId) =>
      (await q(`SELECT track, track_key, car, car_key, native_track_key FROM racingcoach."CollectorLaps" WHERE id = $1`, [lapId]))[0];
    assert.deepEqual(await read(id), { track: 'monza', track_key: null, car: 'Ferrari 488 GT3 Evo 2020', car_key: 'ferrari_488_gt3_evo', native_track_key: 'Monza' });

    const [{ id: trackId }] = await q(`SELECT id FROM racingcoach."Tracks" WHERE lower(track_key) = $1`, [IRACING_KEY]);
    const [{ id: carId }] = await q(`INSERT INTO racingcoach."Cars" (car_name) VALUES ('Sim Test Ferrari') RETURNING id`);
    const iracingBefore = await q(`SELECT id, track, track_key, car FROM racingcoach."CollectorLaps" WHERE simulator = 'iracing' ORDER BY id`);
    assert.equal(await mappings.mapSimulatorTrack('acc', 'monza', trackId), true);
    assert.equal(await mappings.mapSimulatorCar('acc', 'FERRARI_488_GT3_EVO', carId), true);
    const mapped = { track: 'Lime Rock Park', track_key: IRACING_KEY, car: 'Sim Test Ferrari', car_key: 'ferrari_488_gt3_evo', native_track_key: 'Monza' };
    assert.deepEqual(await read(id), mapped, 'the stored lap follows the mapping');

    // A lap uploaded after the mapping is saved the same way
    const { id: later } = await save(oldPayload(acc));
    assert.deepEqual(await read(later), mapped);

    assert.equal(await mappings.mapSimulatorTrack('acc', 'Monza', null), true);
    assert.equal(await mappings.mapSimulatorCar('acc', 'ferrari_488_gt3_evo', null), true);
    assert.deepEqual(await read(id), { track: 'monza', track_key: null, car: 'Ferrari 488 GT3 Evo 2020', car_key: 'ferrari_488_gt3_evo', native_track_key: 'Monza' });
    assert.deepEqual(await q(`SELECT id, track, track_key, car FROM racingcoach."CollectorLaps" WHERE simulator = 'iracing' ORDER BY id`), iracingBefore);
  });

  test('a track or car in the simulator\'s catalog can be mapped before any lap of it arrives', async () => {
    const [{ id: trackId }] = await q(`SELECT id FROM racingcoach."Tracks" WHERE lower(track_key) = $1`, [IRACING_KEY]);
    assert.equal(await mappings.mapSimulatorTrack('acc', 'Suzuka', trackId), true);
    const list = await mappings.listSimulatorMappings('acc');
    assert.deepEqual(list.tracks.find((track) => track.nativeKey === 'Suzuka'), {
      nativeKey: 'Suzuka', nativeName: 'Suzuka Circuit', seen: false, siteId: trackId, laps: 0,
    });
    assert.ok(list.cars.some((car) => car.nativeKey === 'porsche_992_gt3_cup' && car.siteId === null));
    assert.ok(list.siteTracks.some((track) => track.id === trackId));
    // Tracks seen in laps but not in the catalog are listed too
    assert.ok(list.tracks.some((track) => track.nativeKey === 'lime_rock'));

    const { id } = await save(oldPayload({ simulator: 'acc', trackKey: 'suzuka', track: 'suzuka' }));
    const [row] = await q(`SELECT track, track_key FROM racingcoach."CollectorLaps" WHERE id = $1`, [id]);
    assert.deepEqual(row, { track: 'Lime Rock Park', track_key: IRACING_KEY });

    // iRacing's own tracks aren't mapped through here
    assert.equal(await mappings.mapSimulatorTrack('iracing', IRACING_KEY, trackId), false);
  });

  test('a lap with a required channel entirely empty is refused, and one with a cell missing is kept', () => {
    const rows = (brake) => [HEADER, ...Array.from({ length: 600 }, (_, i) => `40,${(i / 600).toFixed(4)},${brake(i)},1,,`)].join('\n') + '\n';
    assert.throws(() => laps.checkLapCsv(gzipSync(rows(() => '')), 600), laps.InvalidLapCsvError);
    assert.doesNotThrow(() => laps.checkLapCsv(gzipSync(rows((i) => (i === 5 ? '' : '0.5'))), 600));
  });

  test('the migration keeps rows written before it, and running it again changes nothing', async () => {
    // A lap as the table was before: the new columns dropped, the row inserted, the migration run again
    await client.query(`ALTER TABLE racingcoach."CollectorLaps" DROP COLUMN simulator, DROP COLUMN native_track_key, DROP COLUMN payload_version, DROP COLUMN adapter_version`);
    const before = await q(`SELECT id, track, track_key, iracing_subsession_id, expires_at FROM racingcoach."CollectorLaps" ORDER BY id`);
    const fresh = await import(new URL('../src/lib/simulatorSchema.ts', import.meta.url).href);
    for (const statement of fresh.SIMULATOR_SCHEMA) await client.query(statement);
    for (const statement of fresh.SIMULATOR_SCHEMA) await client.query(statement);
    const after = await q(`SELECT id, track, track_key, iracing_subsession_id, expires_at FROM racingcoach."CollectorLaps" ORDER BY id`);
    assert.deepEqual(after, before);
    const [{ others }] = await q(`SELECT count(*)::int AS others FROM racingcoach."CollectorLaps" WHERE simulator <> 'iracing' OR payload_version <> 1`);
    assert.equal(others, 0, 'every earlier row counts as an iRacing lap');
  });
});
