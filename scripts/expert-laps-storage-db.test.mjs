// Expert Laps in the telemetry bucket (src/lib/expertLaps.ts, docs/telemetry-storage.md): new ones written to the bucket
// in r2 mode and inline otherwise, reads following each row, replacements and deletions queuing the old object for the
// cleanup worker (which keeps an object another Expert Lap still uses), and the Admin page's move to object storage and
// back.
//
// Runs the site's own modules against a disposable local Postgres and the in-memory object store, e.g.
//   docker run -d --rm --name rc-expert-laps -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55443:5432 postgres:16
//   TELEMETRY_STORAGE_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55443/rctest \
//     node --experimental-transform-types --no-warnings --test scripts/expert-laps-storage-db.test.mjs
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

let client, users, expert, storage, rules, cleanup, store, userId;
const q = async (sql, params) => (await client.query(sql, params)).rows;

const csv = (tag = '') => `LapDistPct,Speed,Brake,Throttle\n0.1,10,0,1\n0.5,20,0.5,0\n0.9,30,0,1${tag}\n`;
const fileName = (car = 'Test Car', track = 'Test Track') => `RacingCoach - Test Driver - ${car} - ${track} - 01.50.486 - S0L005.csv`;
const row = async (id) => (await q('SELECT * FROM racingcoach."ExpertLaps" WHERE id = $1', [id]))[0];
const queued = () => q('SELECT storage_key, reason FROM racingcoach."TelemetryObjectCleanup" ORDER BY id');
// Makes every queued deletion due, as if its grace and delay had passed
const dueNow = () => q('UPDATE racingcoach."TelemetryObjectCleanup" SET not_before = now() - interval \'1 second\'');

describe('Expert Laps in object storage', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    expert = await import(new URL('expertLaps.ts', src).href);
    storage = await import(new URL('telemetryStorage.ts', src).href);
    rules = await import(new URL('telemetryStorageRules.ts', src).href);
    cleanup = await import(new URL('telemetryCleanup.ts', src).href);
    await users.ensureUserSchema();
    const [user] = await q(
      `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level, role, account_status)
       VALUES ('coach', $1, 'x', 'Gold', 'Coach', 'Unsubscribed') RETURNING id`,
      [`${randomUUID()}@example.test`]
    );
    userId = Number(user.id);
  });

  beforeEach(async () => {
    process.env.TELEMETRY_STORAGE_MODE = 'r2';
    store = storage.memoryTelemetryStore('rc-expert-test');
    storage.setTelemetryStoreForTests(store);
    await expert.ensureExpertLapSchema();
    await q('DELETE FROM racingcoach."ExpertLaps"');
    await q('DELETE FROM racingcoach."TelemetryObjectCleanup"');
  });

  after(async () => {
    storage?.setTelemetryStoreForTests(undefined);
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('in r2 mode a new Expert Lap is an object, read back through its row', async () => {
    const { saved } = await expert.saveExpertLap(userId, fileName(), csv(), false);
    const stored = await row(saved.id);
    const sha = rules.sha256Hex(gzipSync(csv()));
    assert.equal(stored.storage_provider, 'r2');
    assert.equal(stored.csv_gzip, null);
    assert.equal(stored.storage_bucket, 'rc-expert-test');
    assert.equal(stored.storage_key, `expert-laps/${sha}.csv.gz`);
    assert.equal(stored.checksum_sha256, sha);
    assert.deepEqual(await queued(), [], 'the pending entry goes with the saved row');
    assert.deepEqual(await expert.readExpertLap(saved.id), { fileName: fileName(), csv: csv() });
  });

  test('in postgres mode, or when the bucket fails, it stays inline', async () => {
    process.env.TELEMETRY_STORAGE_MODE = 'postgres';
    const { saved } = await expert.saveExpertLap(userId, fileName('Car A'), csv(), false);
    assert.equal((await row(saved.id)).storage_provider, 'postgres');
    process.env.TELEMETRY_STORAGE_MODE = 'r2';
    store.failNext('put');
    const { saved: other } = await expert.saveExpertLap(userId, fileName('Car B'), csv('x'), false);
    const stored = await row(other.id);
    assert.equal(stored.storage_provider, 'postgres');
    assert.ok(stored.csv_gzip);
    assert.equal((await expert.readExpertLap(other.id)).csv, csv('x'));
  });

  test('an existing lap for the car and track is answered without writing anything', async () => {
    await expert.saveExpertLap(userId, fileName(), csv(), false);
    const result = await expert.saveExpertLap(userId, fileName(), csv('other'), false);
    assert.ok(result.existing);
    assert.equal(await store.headObject(rules.expertLapObjectKey(rules.sha256Hex(gzipSync(csv('other'))))), null);
  });

  test('replacing or deleting queues the old object, and the cleanup deletes only what nothing uses', async () => {
    const { saved } = await expert.saveExpertLap(userId, fileName(), csv(), false);
    const oldKey = (await row(saved.id)).storage_key;
    // the same bytes on another car keep the object in use
    const { saved: twin } = await expert.saveExpertLap(userId, fileName('Twin Car'), csv(), false);
    assert.equal((await row(twin.id)).storage_key, oldKey);

    await expert.saveExpertLap(userId, fileName(), csv('new'), true);
    assert.deepEqual(await queued(), [{ storage_key: oldKey, reason: 'replaced' }]);
    await dueNow();
    await cleanup.runTelemetryCleanup();
    assert.ok(await store.headObject(oldKey), 'still used by the twin');
    assert.deepEqual(await queued(), []);

    assert.equal(await expert.deleteExpertLap(twin.id), true);
    assert.deepEqual(await queued(), [{ storage_key: oldKey, reason: 'deleted' }]);
    await dueNow();
    await cleanup.runTelemetryCleanup();
    assert.equal(await store.headObject(oldKey), null);
    assert.equal((await expert.readExpertLap(saved.id)).csv, csv('new'));
  });

  test('a missing object reads as no lap; a changed one is refused', async () => {
    const { saved } = await expert.saveExpertLap(userId, fileName(), csv(), false);
    const { storage_key } = await row(saved.id);
    await store.putObject(storage_key, gzipSync('LapDistPct,Speed,Brake,Throttle\n'), { contentType: 'text/csv', metadata: {} });
    storage.setTelemetryStoreForTests(storage.memoryTelemetryStore('rc-expert-test'));
    assert.equal(await expert.readExpertLap(saved.id), null, 'gone');
    storage.setTelemetryStoreForTests(store);
    await assert.rejects(expert.readExpertLap(saved.id), storage.ChecksumMismatchError);
  });

  test('the Admin page moves inline Expert Laps to object storage and back', async () => {
    process.env.TELEMETRY_STORAGE_MODE = 'postgres';
    const a = (await expert.saveExpertLap(userId, fileName('Car A'), csv('a'), false)).saved;
    const b = (await expert.saveExpertLap(userId, fileName('Car B'), csv('b'), false)).saved;
    assert.deepEqual(await expert.readExpertLapStorage(), { inline: 2, inlineBytes: (await row(a.id)).csv_gzip.length + (await row(b.id)).csv_gzip.length, stored: 0, storedBytes: 0 });

    assert.deepEqual(await expert.moveExpertLapsToObjectStorage(), { moved: 2, failed: 0, errors: [] });
    for (const lap of [a, b]) {
      const moved = await row(lap.id);
      assert.equal(moved.storage_provider, 'r2');
      assert.equal(moved.csv_gzip, null);
      assert.ok(await store.headObject(moved.storage_key));
    }
    assert.equal((await expert.readExpertLap(a.id)).csv, csv('a'));
    assert.deepEqual(await queued(), []);
    assert.equal((await expert.readExpertLapStorage()).stored, 2);

    assert.deepEqual(await expert.moveExpertLapsToPostgres(), { moved: 2, failed: 0, errors: [] });
    const back = await row(b.id);
    assert.equal(back.storage_provider, 'postgres');
    assert.equal(back.storage_key, null);
    assert.equal((await expert.readExpertLap(b.id)).csv, csv('b'));
    assert.equal((await queued()).length, 2, 'their objects are queued for deletion');
  });

  test('without the bucket there is nothing to move to', async () => {
    storage.setTelemetryStoreForTests(null);
    assert.equal(await expert.moveExpertLapsToObjectStorage(), null);
  });
});
