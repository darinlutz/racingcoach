// Target Laps in the telemetry bucket (src/lib/targetLap.ts, docs/telemetry-storage.md): set in r2 mode as an object
// and inline otherwise, reads and Download My Data following the row, a new Target Lap, Remove, a privacy erasure and
// Delete Account queuing the object for the cleanup worker, and the Admin page's move to object storage and back.
//
// Runs the site's own modules against a disposable local Postgres and the in-memory object store, e.g.
//   docker run -d --rm --name rc-target-laps -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55444:5432 postgres:16
//   TELEMETRY_STORAGE_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55444/rctest \
//     node --experimental-transform-types --no-warnings --test scripts/target-laps-storage-db.test.mjs
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

let client, users, target, storage, rules, cleanup, erasure, store;
const q = async (sql, params) => (await client.query(sql, params)).rows;

const csv = (tag = '') => `LapDistPct,Speed,Brake,Throttle\n0.1,10,0,1\n0.5,20,0.5,0\n0.9,30,0,1${tag}\n`;
const FILE = 'RacingCoach - Test Driver - Test Car - Test Track - 01.50.486 - S0L005.csv';
const columns = async (id) =>
  (
    await q(
      `SELECT "TargetLap" AS inline, "TargetLapFileName" AS file_name, "TargetLapStorageProvider" AS provider,
              "TargetLapStorageBucket" AS bucket, "TargetLapStorageKey" AS key, "TargetLapChecksum" AS checksum
       FROM racingcoach."Users" WHERE id = $1`,
      [id]
    )
  )[0];
const queued = () => q('SELECT storage_key, reason, user_id FROM racingcoach."TelemetryObjectCleanup" ORDER BY id');
const dueNow = () => q('UPDATE racingcoach."TelemetryObjectCleanup" SET not_before = now() - interval \'1 second\'');

async function makeUser() {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level, role, account_status)
     VALUES ($1, $2, 'x', 'Gold', 'User', 'Unsubscribed') RETURNING id`,
    [`driver-${randomUUID().slice(0, 8)}`, `${randomUUID()}@example.test`]
  );
  return Number(row.id);
}

describe('Target Laps in object storage', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    target = await import(new URL('targetLap.ts', src).href);
    storage = await import(new URL('telemetryStorage.ts', src).href);
    rules = await import(new URL('telemetryStorageRules.ts', src).href);
    cleanup = await import(new URL('telemetryCleanup.ts', src).href);
    erasure = await import(new URL('dataErasure.ts', src).href);
    await users.ensureUserSchema();
    await target.ensureTargetLapSchema();
  });

  beforeEach(async () => {
    process.env.TELEMETRY_STORAGE_MODE = 'r2';
    store = storage.memoryTelemetryStore('rc-target-test');
    storage.setTelemetryStoreForTests(store);
    await q('DELETE FROM racingcoach."TelemetryObjectCleanup"');
  });

  after(async () => {
    storage?.setTelemetryStoreForTests(undefined);
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('in r2 mode a Target Lap is an object under the user, read back through the row', async () => {
    const id = await makeUser();
    await target.setTargetLap(id, FILE, csv());
    const row = await columns(id);
    const sha = rules.sha256Hex(gzipSync(csv()));
    assert.equal(row.provider, 'r2');
    assert.equal(row.inline, null);
    assert.equal(row.key, `target-laps/u${id}/${sha}.csv.gz`);
    assert.equal(row.checksum, sha);
    assert.deepEqual(await queued(), [], 'the pending entry goes with the saved row');
    assert.deepEqual(await target.readTargetLap(id), { fileName: FILE, csv: csv() });
    assert.equal((await target.getTargetLapInfo(id)).fileName, FILE);
    const exported = await target.readTargetLapForExport(id);
    assert.equal(exported.csv.toString('utf8'), csv());
  });

  test('in postgres mode, or when the bucket fails, it stays inline', async () => {
    const id = await makeUser();
    process.env.TELEMETRY_STORAGE_MODE = 'postgres';
    await target.setTargetLap(id, FILE, csv('a'));
    assert.equal((await columns(id)).provider, 'postgres');
    process.env.TELEMETRY_STORAGE_MODE = 'r2';
    store.failNext('put');
    await target.setTargetLap(id, FILE, csv('b'));
    const row = await columns(id);
    assert.equal(row.provider, 'postgres');
    assert.ok(row.inline);
    assert.equal((await target.readTargetLap(id)).csv, csv('b'));
  });

  test('a new Target Lap queues the old object; the same bytes again don’t', async () => {
    const id = await makeUser();
    await target.setTargetLap(id, FILE, csv('one'));
    const oldKey = (await columns(id)).key;
    await target.setTargetLap(id, FILE, csv('one'));
    assert.deepEqual(await queued(), []);
    await target.setTargetLap(id, FILE, csv('two'));
    assert.deepEqual(await queued(), [{ storage_key: oldKey, reason: 'replaced', user_id: id }]);
    await dueNow();
    await cleanup.runTelemetryCleanup();
    assert.equal(await store.headObject(oldKey), null);
    assert.equal((await target.readTargetLap(id)).csv, csv('two'));
  });

  test('Remove, a privacy erasure and Delete Account each queue the object', async () => {
    const removed = await makeUser();
    await target.setTargetLap(removed, FILE, csv('r'));
    const removedKey = (await columns(removed)).key;
    await target.clearTargetLap(removed);
    assert.equal(await target.readTargetLap(removed), null);
    assert.equal(await target.getTargetLapInfo(removed), null);

    const erased = await makeUser();
    await target.setTargetLap(erased, FILE, csv('e'));
    const erasedKey = (await columns(erased)).key;
    assert.equal(await erasure.eraseCategory(client, erased, 'targetLap'), 1);
    const row = await columns(erased);
    assert.deepEqual([row.provider, row.key, row.file_name], ['postgres', null, null]);

    const deleted = await makeUser();
    await target.setTargetLap(deleted, FILE, csv('d'));
    const deletedKey = (await columns(deleted)).key;
    await q('DELETE FROM racingcoach."Users" WHERE id = $1', [deleted]);

    assert.deepEqual(await queued(), [
      { storage_key: removedKey, reason: 'replaced', user_id: removed },
      { storage_key: erasedKey, reason: 'replaced', user_id: erased },
      { storage_key: deletedKey, reason: 'deleted', user_id: deleted },
    ]);
    await dueNow();
    await cleanup.runTelemetryCleanup();
    for (const key of [removedKey, erasedKey, deletedKey]) assert.equal(await store.headObject(key), null, key);
  });

  test('a missing object reads as no Target Lap; a changed one is refused', async () => {
    const id = await makeUser();
    await target.setTargetLap(id, FILE, csv('m'));
    const { key } = await columns(id);
    await store.putObject(key, gzipSync('LapDistPct,Speed,Brake,Throttle\n'), { contentType: 'text/csv', metadata: {} });
    storage.setTelemetryStoreForTests(storage.memoryTelemetryStore('rc-target-test'));
    assert.equal(await target.readTargetLap(id), null);
    storage.setTelemetryStoreForTests(store);
    await assert.rejects(target.readTargetLap(id), storage.ChecksumMismatchError);
    await target.clearTargetLap(id);
  });

  test('the Admin page moves inline Target Laps to object storage and back', async () => {
    // Only this test's Target Laps
    await q(`UPDATE racingcoach."Users" SET ${target.CLEAR_TARGET_LAP_SQL}`);
    await q('DELETE FROM racingcoach."TelemetryObjectCleanup"');
    process.env.TELEMETRY_STORAGE_MODE = 'postgres';
    const a = await makeUser();
    const b = await makeUser();
    await target.setTargetLap(a, FILE, csv('a'));
    await target.setTargetLap(b, FILE, csv('b'));
    assert.equal((await target.readTargetLapStorage()).inline, 2);

    assert.deepEqual(await target.moveTargetLapsToObjectStorage(), { moved: 2, failed: 0, errors: [] });
    for (const id of [a, b]) {
      const row = await columns(id);
      assert.equal(row.provider, 'r2');
      assert.equal(row.inline, null);
      assert.ok(await store.headObject(row.key));
    }
    assert.equal((await target.readTargetLap(a)).csv, csv('a'));
    assert.deepEqual(await queued(), []);
    assert.deepEqual(await target.readTargetLapStorage(), { inline: 0, inlineBytes: 0, stored: 2, storedBytes: (await target.readTargetLapStorage()).storedBytes });

    assert.deepEqual(await target.moveTargetLapsToPostgres(), { moved: 2, failed: 0, errors: [] });
    const back = await columns(b);
    assert.deepEqual([back.provider, back.key], ['postgres', null]);
    assert.equal((await target.readTargetLap(b)).csv, csv('b'));
    assert.equal((await queued()).length, 2, 'their objects are queued for deletion');

    storage.setTelemetryStoreForTests(null);
    assert.equal(await target.moveTargetLapsToObjectStorage(), null);
  });
});
