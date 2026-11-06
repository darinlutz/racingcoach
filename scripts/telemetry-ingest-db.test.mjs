// Lap telemetry storage ingestion and read tests: npm run test:telemetry-storage
//
// Runs the site's own modules (ensureUserSchema, saveCollectorLap and the lap readers in collectorLaps.ts) against a
// disposable local Postgres, with the telemetry store replaced by the in-memory one (memoryTelemetryStore), e.g.
//   docker run -d --rm --name rc-telemetry-ingest -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55441:5432 postgres:16
//   TELEMETRY_STORAGE_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55441/rctest node --experimental-transform-types --no-warnings --test scripts/telemetry-ingest-db.test.mjs
// Skipped without TELEMETRY_STORAGE_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const url = process.env.TELEMETRY_STORAGE_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'TELEMETRY_STORAGE_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

const DAY = 24 * 60 * 60 * 1000;
let users, laps, storage, rules, client, store;

const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeUser(level = 'Gold', role = 'User') {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level, role, account_status)
     VALUES ($1, $2, 'x', $3, $4, 'Unsubscribed') RETURNING id`,
    [`driver-${randomUUID().slice(0, 8)}`, `${randomUUID()}@example.test`, level, role]
  );
  return Number(row.id);
}

const csvText = (positions, tag = '') =>
  positions
    ? `Speed,LapDistPct,Brake,Throttle,Lat,Lon\n10,0.1,0,1,1.0,2.0\n20,0.5,0.5,0,1.1,2.1\n30,0.9,0,1,1.2,2.2${tag}\n`
    : `Speed,LapDistPct,Brake,Throttle\n10,0.1,0,1\n20,0.5,0.5,0\n30,0.9,0,1${tag}\n`;

const details = (overrides = {}) => ({
  clientLapId: randomUUID(),
  track: 'Test Track',
  car: 'Test Car',
  driver: 'Test Driver',
  sessionId: 1,
  subSessionId: 1,
  sessionNum: 0,
  sessionType: 'Practice',
  lapNumber: 1,
  lapTimeSeconds: 90,
  samples: 3,
  missingSamples: 0,
  incidents: 0,
  pitRoad: false,
  offTrack: false,
  recordedAt: new Date(Date.now() - DAY).toISOString(),
  ...overrides,
});

// Uploads like POST /api/collector/laps does: the route checks the CSV, then saves it
async function upload(userId, lap, positions = false, tag = '') {
  const csv = csvText(positions, tag);
  const gzip = gzipSync(csv);
  const { csvBytes, hasPosition } = laps.checkLapCsv(gzip, lap.samples);
  return { csv, gzip, result: await laps.saveCollectorLap(userId, lap, gzip, csvBytes, hasPosition) };
}

const row = async (id) => (await q('SELECT * FROM racingcoach."CollectorLaps" WHERE id = $1', [id]))[0];
const cleanup = () => q('SELECT storage_key, reason FROM racingcoach."TelemetryObjectCleanup" ORDER BY id');

describe('lap telemetry ingestion and reads', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    laps = await import(new URL('collectorLaps.ts', src).href);
    storage = await import(new URL('telemetryStorage.ts', src).href);
    rules = await import(new URL('telemetryStorageRules.ts', src).href);
    await users.ensureUserSchema();
  });

  beforeEach(async () => {
    process.env.TELEMETRY_STORAGE_MODE = 'r2';
    store = storage.memoryTelemetryStore('rc-telemetry-test');
    storage.setTelemetryStoreForTests(store);
    await q('DELETE FROM racingcoach."TelemetryObjectCleanup"');
  });

  after(async () => {
    storage?.setTelemetryStoreForTests(undefined);
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('an upload in r2 mode stores the object first, then a row that points at it', async () => {
    const userId = await makeUser();
    const lap = details();
    const { csv, gzip, result } = await upload(userId, lap);
    assert.equal(result.duplicate, false);
    const stored = await row(result.id);
    const sha = rules.sha256Hex(gzip);
    assert.equal(stored.storage_provider, 'r2');
    assert.equal(stored.storage_status, 'stored');
    assert.equal(stored.storage_bucket, 'rc-telemetry-test');
    assert.equal(stored.storage_key, `telemetry/iracing/u${userId}/${lap.clientLapId}/${sha}.csv.gz`);
    assert.equal(stored.checksum_sha256, sha);
    assert.equal(stored.stored_bytes, gzip.length);
    assert.equal(stored.csv_bytes, csv.length);
    assert.equal(stored.content_type, 'text/csv');
    assert.equal(stored.compression, 'gzip');
    assert.ok(stored.stored_at);
    assert.equal(stored.csv_gzip, null);
    assert.deepEqual(store.objects.get(stored.storage_key).body, gzip);
    assert.deepEqual(await cleanup(), [], 'the pending entry goes with the row');

    // Every reader gives back the original CSV, from the store (the cache is emptied first)
    storage.setTelemetryStoreForTests(store);
    const viewer = { id: userId, role: 'User' };
    assert.equal(await laps.readCollectorLapCsv(viewer, result.id), csv);
    assert.equal((await laps.readCollectorLapsById(viewer, [result.id]))[0].csv, csv);
    assert.equal((await laps.readCollectorLapsByClientId(userId, [lap.clientLapId]))[0].csv, csv);
    assert.equal((await laps.readOwnLapCsvBytes(userId, result.id)).toString('utf8'), csv);
  });

  test('a duplicate upload is answered without uploading anything', async () => {
    const userId = await makeUser();
    const lap = details();
    const first = await upload(userId, lap);
    const puts = store.calls.put;
    const again = await upload(userId, lap);
    assert.deepEqual(again.result, { id: first.result.id, duplicate: true, replaced: false });
    assert.equal(store.calls.put, puts);
  });

  test('a re-upload with track positions moves the row to a new object and queues the old one', async () => {
    const userId = await makeUser();
    const lap = details();
    const first = await upload(userId, lap);
    const oldKey = (await row(first.result.id)).storage_key;
    const second = await upload(userId, lap, true);
    assert.deepEqual(second.result, { id: first.result.id, duplicate: true, replaced: true });
    const stored = await row(first.result.id);
    assert.notEqual(stored.storage_key, oldKey);
    assert.equal(stored.has_position, true);
    assert.equal(stored.checksum_sha256, rules.sha256Hex(second.gzip));
    assert.deepEqual(await cleanup(), [{ storage_key: oldKey, reason: 'replaced' }]);
    assert.equal(await laps.readCollectorLapCsv({ id: userId, role: 'User' }, first.result.id), second.csv);
    // A third upload with positions is a plain duplicate, with no put
    const puts = store.calls.put;
    assert.equal((await upload(userId, lap, true)).result.replaced, false);
    assert.equal(store.calls.put, puts);
  });

  test('when the store refuses the object, the lap is stored inline and stays readable', async () => {
    const userId = await makeUser();
    store.failNext('put');
    const { csv, gzip, result } = await upload(userId, details());
    const stored = await row(result.id);
    assert.equal(stored.storage_provider, 'postgres');
    assert.equal(stored.storage_status, 'inline');
    assert.equal(stored.storage_key, null);
    assert.deepEqual(stored.csv_gzip, gzip);
    assert.equal(stored.checksum_sha256, rules.sha256Hex(gzip));
    assert.equal(await laps.readCollectorLapCsv({ id: userId, role: 'User' }, result.id), csv);
    // Its pending entry stays, for an object that may have been written before the failure
    assert.equal((await cleanup())[0]?.reason, 'pending');
  });

  test('with r2 mode but no store configured, laps are stored inline', async () => {
    storage.setTelemetryStoreForTests(null);
    const userId = await makeUser();
    const { result } = await upload(userId, details());
    assert.equal((await row(result.id)).storage_provider, 'postgres');
  });

  test('a database failure after the object is written leaves a pending entry for it, and no row', async () => {
    const userId = await makeUser();
    const lap = details();
    await q(`CREATE FUNCTION racingcoach.fail_lap_insert() RETURNS trigger LANGUAGE plpgsql AS $$
             BEGIN RAISE EXCEPTION 'injected insert failure'; END $$`);
    await q(`CREATE TRIGGER fail_lap_insert BEFORE INSERT ON racingcoach."CollectorLaps"
             FOR EACH ROW EXECUTE FUNCTION racingcoach.fail_lap_insert()`);
    try {
      await assert.rejects(upload(userId, lap), /injected insert failure/);
    } finally {
      await q('DROP TRIGGER fail_lap_insert ON racingcoach."CollectorLaps"');
      await q('DROP FUNCTION racingcoach.fail_lap_insert()');
    }
    const [entry] = await q('SELECT storage_key, reason, not_before > now() AS waiting FROM racingcoach."TelemetryObjectCleanup"');
    assert.equal(entry.reason, 'pending');
    assert.equal(entry.waiting, true, 'not deleted while the upload could still be in flight');
    assert.ok(store.objects.has(entry.storage_key));
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."CollectorLaps" WHERE client_lap_id = $1', [lap.clientLapId]))[0].n, 0);
    // The collector retries, and the retry succeeds with the same object
    const retry = await upload(userId, lap);
    assert.equal(retry.result.duplicate, false);
    assert.equal((await row(retry.result.id)).storage_key, entry.storage_key);
    assert.deepEqual(await cleanup(), []);
  });

  test('postgres mode stores inline, and a lap stored by the old code reads alongside stored objects', async () => {
    const userId = await makeUser();
    process.env.TELEMETRY_STORAGE_MODE = 'postgres';
    const inline = await upload(userId, details({ lapNumber: 1 }), false, '1');
    assert.equal((await row(inline.result.id)).storage_provider, 'postgres');
    assert.equal(store.calls.put, 0);

    // As the code before this change wrote it: csv_gzip and none of the storage columns
    const legacyCsv = csvText(false, '2');
    const [legacy] = await q(
      `INSERT INTO racingcoach."CollectorLaps" (user_id, client_lap_id, track, car, driver, iracing_session_id, iracing_subsession_id,
         session_num, session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road, off_track,
         recorded_at, csv_bytes, csv_gzip, completed_at, expires_at)
       VALUES ($1, $2, 'Test Track', 'Test Car', 'Test Driver', 1, 1, 0, 'Practice', 2, 90, 3, 0, 0, false, false,
         now(), $3, $4, now(), now() + interval '30 days') RETURNING id`,
      [userId, randomUUID(), legacyCsv.length, gzipSync(legacyCsv)]
    );

    process.env.TELEMETRY_STORAGE_MODE = 'r2';
    const object = await upload(userId, details({ lapNumber: 3 }), false, '3');
    assert.equal((await row(object.result.id)).storage_provider, 'r2');

    const read = await laps.readCollectorLapsById({ id: userId, role: 'User' }, [object.result.id, legacy.id, inline.result.id]);
    assert.deepEqual(read.map((lap) => lap.csv), [object.csv, legacyCsv, inline.csv]);
  });

  test('an inline re-upload clears a backfilled copy and queues it, so it never goes stale', async () => {
    const userId = await makeUser();
    process.env.TELEMETRY_STORAGE_MODE = 'postgres';
    const lap = details();
    const first = await upload(userId, lap);
    // As the backfill leaves a row before reads switch to the store: copied, still read inline
    await q(`UPDATE racingcoach."CollectorLaps" SET storage_bucket = 'rc-telemetry-test', storage_key = 'telemetry/old-copy' WHERE id = $1`, [first.result.id]);
    const second = await upload(userId, lap, true);
    assert.equal(second.result.replaced, true);
    const stored = await row(first.result.id);
    assert.equal(stored.storage_key, null);
    assert.equal(stored.storage_provider, 'postgres');
    assert.deepEqual(await cleanup(), [{ storage_key: 'telemetry/old-copy', reason: 'replaced' }]);
  });

  test('another User cannot read a lap, whatever its storage', async () => {
    const owner = await makeUser();
    const other = await makeUser();
    const { result } = await upload(owner, details());
    assert.equal(await laps.readCollectorLapCsv({ id: other, role: 'User' }, result.id), null);
    assert.deepEqual(await laps.readCollectorLapsById({ id: other, role: 'User' }, [result.id]), []);
    assert.deepEqual(await laps.readCollectorLapsByClientId(other, [(await row(result.id)).client_lap_id]), []);
    assert.equal(await laps.readOwnLapCsvBytes(other, result.id), null);
    // A Coach can
    assert.ok(await laps.readCollectorLapCsv({ id: other, role: 'Coach' }, result.id));
  });

  test('a lap whose object is gone is left out and marked missing', async () => {
    const userId = await makeUser();
    const kept = await upload(userId, details({ lapNumber: 1 }), false, '1');
    const lost = await upload(userId, details({ lapNumber: 2 }), false, '2');
    store.objects.delete((await row(lost.result.id)).storage_key);
    storage.setTelemetryStoreForTests(store);
    const viewer = { id: userId, role: 'User' };
    assert.equal(await laps.readCollectorLapCsv(viewer, lost.result.id), null);
    assert.deepEqual((await laps.readCollectorLapsById(viewer, [kept.result.id, lost.result.id])).map((l) => l.id), [kept.result.id]);
    assert.equal((await row(lost.result.id)).storage_status, 'missing');
  });

  test('a store that cannot be reached fails the read instead of leaving laps out', async () => {
    const userId = await makeUser();
    const { result } = await upload(userId, details());
    storage.setTelemetryStoreForTests(store);
    store.failNext('get');
    await assert.rejects(laps.readCollectorLapsById({ id: userId, role: 'User' }, [result.id]), /Injected get failure/);
  });

  test("another simulator's lap gets its own key prefix", async () => {
    const userId = await makeUser();
    const lap = details({ simulator: 'acc', trackKey: 'spa', payloadVersion: 1 });
    const { result } = await upload(userId, lap);
    assert.match((await row(result.id)).storage_key, new RegExp(`^telemetry/acc/u${userId}/${lap.clientLapId}/`));
  });

  test('an expired lap is refused before anything is uploaded', async () => {
    const userId = await makeUser('Bronze');
    await assert.rejects(upload(userId, details({ recordedAt: new Date(Date.now() - 31 * DAY).toISOString() })), laps.LapExpiredError);
    assert.equal(store.calls.put, 0);
    assert.deepEqual(await cleanup(), []);
  });

  test('a lap the cleanup deleted (tombstoned) is refused before anything is uploaded', async () => {
    const userId = await makeUser();
    const lap = details();
    await q(`INSERT INTO racingcoach."ExpiredLaps" (user_id, client_lap_id, completed_at) VALUES ($1, $2, now())`, [userId, lap.clientLapId]);
    await assert.rejects(upload(userId, lap), laps.LapExpiredError);
    assert.equal(store.calls.put, 0);
  });

  test('deleting the row (retention, erasure, account deletion) queues its object', async () => {
    const userId = await makeUser();
    const { result } = await upload(userId, details());
    const key = (await row(result.id)).storage_key;
    await q('DELETE FROM racingcoach."Users" WHERE id = $1', [userId]);
    assert.deepEqual(await cleanup(), [{ storage_key: key, reason: 'deleted' }]);
  });
});
