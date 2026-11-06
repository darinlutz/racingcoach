// Telemetry object storage: the backfill, verification, read switch and rollback, legacy purge, the cleanup worker and
// the reconciliation, and that the lap retention job, privacy erasure and Delete Account delete lap objects through the
// cleanup queue (docs/telemetry-storage.md).
//
// Runs the site's own modules against a disposable local Postgres and an in-memory object store
// (memoryTelemetryStore, swapped in with setTelemetryStoreForTests), e.g.
//   docker run -d --rm --name rc-telemetry-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55442:5432 postgres:16
//   TELEMETRY_STORAGE_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55442/rctest \
//     node --experimental-transform-types --no-warnings --test scripts/telemetry-cleanup-db.test.mjs
// Skipped without TELEMETRY_STORAGE_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const url = process.env.TELEMETRY_STORAGE_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'TELEMETRY_STORAGE_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let client, users, laps, storage, migration, cleanup, retention, erasure, db, store;
const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeUser(level = 'Gold') {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level, role, account_status)
     VALUES ($1, $2, 'x', $3, 'User', 'Unsubscribed') RETURNING id`,
    [`driver-${randomUUID().slice(0, 8)}`, `${randomUUID()}@example.test`, level]
  );
  return Number(row.id);
}

const csvFor = (n) => `Speed,LapDistPct,Brake,Throttle\n${n},0.1,0,1\n${n + 1},0.5,0.5,0\n${n + 2},0.9,0,1\n`;

// A lap stored the old way: csv_gzip only, none of the storage columns set
async function legacyLap(userId, n = Math.floor(Math.random() * 1000)) {
  const csv = csvFor(n);
  const [row] = await q(
    `INSERT INTO racingcoach."CollectorLaps" (user_id, client_lap_id, track, car, driver, iracing_session_id, iracing_subsession_id,
       session_num, session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road, off_track,
       recorded_at, csv_bytes, csv_gzip, completed_at, expires_at)
     VALUES ($1, $2, 'Test Track', 'Test Car', 'Test Driver', 1, 1, 0, 'Practice', 1, 90, 3, 0, 0, false, false,
       now(), $3, $4, now(), now() + interval '30 days') RETURNING id`,
    [userId, randomUUID(), Buffer.byteLength(csv), gzipSync(csv)]
  );
  return { id: Number(row.id), csv };
}

const lapRow = async (id) => (await q('SELECT * FROM racingcoach."CollectorLaps" WHERE id = $1', [id]))[0];
const queued = async (key) => (await q('SELECT * FROM racingcoach."TelemetryObjectCleanup" WHERE storage_key = $1', [key]))[0];
const dueNow = (key) => q(`UPDATE racingcoach."TelemetryObjectCleanup" SET not_before = now() - interval '1 second' WHERE storage_key = $1`, [key]);
// Copies, verifies and switches every inline lap, so the test has laps read from objects
async function toObjects() {
  await migration.backfillTelemetry({ batchSize: 50 });
  await migration.verifyTelemetryObjects({ batchSize: 50 });
  await migration.switchReadsToObjectStorage();
}

describe('telemetry object storage in the database', { skip }, () => {
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
    migration = await import(new URL('telemetryMigration.ts', src).href);
    cleanup = await import(new URL('telemetryCleanup.ts', src).href);
    retention = await import(new URL('lapRetentionDb.ts', src).href);
    erasure = await import(new URL('dataErasure.ts', src).href);
    db = await import(new URL('db.ts', src).href);
    store = storage.memoryTelemetryStore('rc-telemetry-test');
    storage.setTelemetryStoreForTests(store);
    await users.ensureUserSchema();
  });

  after(async () => {
    storage?.setTelemetryStoreForTests(undefined);
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('backfill copies legacy laps, leaves them read from Postgres, and a re-run copies nothing twice', async () => {
    const userId = await makeUser();
    const a = await legacyLap(userId);
    const b = await legacyLap(userId);
    const c = await legacyLap(userId);
    const result = await migration.backfillTelemetry({ batchSize: 2, concurrency: 2 });
    assert.equal(result.succeeded, 3);
    assert.equal(result.failed, 0);
    for (const lap of [a, b, c]) {
      const row = await lapRow(lap.id);
      assert.equal(row.storage_provider, 'postgres', 'reads stay on Postgres until switched');
      assert.match(row.storage_key, new RegExp(`^telemetry/iracing/u${userId}/[0-9a-f-]{36}/[0-9a-f]{64}\\.csv\\.gz$`));
      assert.equal(row.storage_bucket, 'rc-telemetry-test');
      assert.equal(row.stored_bytes, row.csv_gzip.length);
      assert.ok(store.objects.has(row.storage_key));
      assert.equal(await queued(row.storage_key), undefined, 'the pending entry is removed once the row has its key');
      assert.equal(await laps.readCollectorLapCsv({ id: userId, role: 'User' }, lap.id), lap.csv);
    }
    const puts = store.calls.put;
    const again = await migration.backfillTelemetry({ batchSize: 2 });
    assert.equal(again.processed, 0);
    assert.equal(store.calls.put, puts, 'no object is written twice');
  });

  test('a failed upload is recorded, backed off and retried; its pending entry covers the half-written object', async () => {
    const userId = await makeUser();
    const lap = await legacyLap(userId);
    store.failNext('put');
    const result = await migration.backfillTelemetry({ batchSize: 50 });
    assert.equal(result.failed, 1);
    let row = await lapRow(lap.id);
    assert.equal(row.storage_key, null);
    assert.equal(row.migration_attempts, 1);
    assert.match(row.migration_error, /Injected put failure/);
    assert.ok(row.migration_next_attempt_at > new Date(), 'retried after a backoff');
    const [pending] = await q(`SELECT count(*)::int AS n FROM racingcoach."TelemetryObjectCleanup" WHERE reason = 'pending' AND user_id = $1`, [userId]);
    assert.equal(pending.n, 1);

    assert.equal((await migration.backfillTelemetry({ batchSize: 50 })).processed, 0, 'not before its next attempt');
    await q('UPDATE racingcoach."CollectorLaps" SET migration_next_attempt_at = now() - interval \'1 second\' WHERE id = $1', [lap.id]);
    assert.equal((await migration.backfillTelemetry({ batchSize: 50 })).succeeded, 1);
    row = await lapRow(lap.id);
    assert.ok(row.storage_key);
    assert.equal(row.migration_error, null);
    assert.equal(await queued(row.storage_key), undefined);
  });

  test('a lap re-uploaded while it was being copied keeps its new CSV, and the stale object is cleaned up', async () => {
    const userId = await makeUser();
    const lap = await legacyLap(userId);
    const put = store.putObject;
    store.putObject = async (key, body, options) => {
      await put(key, body, options);
      await q('UPDATE racingcoach."CollectorLaps" SET csv_gzip = $2 WHERE id = $1', [lap.id, gzipSync(csvFor(5000))]);
    };
    try {
      const result = await migration.backfillTelemetry({ batchSize: 50 });
      assert.equal(result.succeeded, 0);
      assert.equal(result.details.changed, 1);
    } finally {
      store.putObject = put;
    }
    const row = await lapRow(lap.id);
    assert.equal(row.storage_key, null, 'not pointed at an object of the old CSV');
    const [stale] = await q(`SELECT storage_key FROM racingcoach."TelemetryObjectCleanup" WHERE reason = 'pending' AND user_id = $1`, [userId]);
    assert.ok(stale && store.objects.has(stale.storage_key));
    await dueNow(stale.storage_key);
    await cleanup.runTelemetryCleanup();
    assert.ok(!store.objects.has(stale.storage_key));
    assert.equal(await queued(stale.storage_key), undefined);
  });

  test('verification checks every copy, and a corrupted one is forgotten so the backfill makes it again', async () => {
    const userId = await makeUser();
    const good = await legacyLap(userId);
    const bad = await legacyLap(userId);
    await migration.backfillTelemetry({ batchSize: 50 });
    const badKey = (await lapRow(bad.id)).storage_key;
    store.objects.get(badKey).body = gzipSync('corrupted');
    storage.setTelemetryStoreForTests(store); // empties the cache, so the corrupted bytes are what's read
    const result = await migration.verifyTelemetryObjects({ batchSize: 50 });
    assert.ok(result.failed >= 1);
    assert.ok((await lapRow(good.id)).verified_at);
    const row = await lapRow(bad.id);
    assert.equal(row.storage_key, null);
    assert.equal(row.verified_at, null);
    assert.match(row.migration_error, /checksum mismatch/);
    assert.equal((await queued(badKey))?.reason, 'replaced', 'the bad object is queued for deletion');
    assert.equal((await migration.backfillTelemetry({ batchSize: 50 })).succeeded, 1);
    assert.equal((await migration.verifyTelemetryObjects({ batchSize: 50 })).failed, 0);
  });

  test('switching reads serves the same CSV from the object; rolling back reads Postgres again and deletes nothing', async () => {
    const userId = await makeUser();
    const lap = await legacyLap(userId);
    await migration.backfillTelemetry({ batchSize: 50 });
    await migration.verifyTelemetryObjects({ batchSize: 50 });
    assert.ok((await migration.switchReadsToObjectStorage()) >= 1);
    const row = await lapRow(lap.id);
    assert.equal(row.storage_provider, 'r2');
    assert.equal(row.storage_status, 'stored');
    storage.setTelemetryStoreForTests(store);
    const gets = store.calls.get;
    assert.equal(await laps.readCollectorLapCsv({ id: userId, role: 'User' }, lap.id), lap.csv);
    assert.equal(store.calls.get, gets + 1, 'read from the object store');
    assert.equal(await laps.readCollectorLapCsv({ id: await makeUser(), role: 'User' }, lap.id), null, "another User can't read it");

    const queuedBefore = (await q('SELECT count(*)::int AS n FROM racingcoach."TelemetryObjectCleanup"'))[0].n;
    assert.ok((await migration.rollbackReadsToPostgres()) >= 1);
    const back = await lapRow(lap.id);
    assert.equal(back.storage_provider, 'postgres');
    assert.equal(back.storage_key, row.storage_key, 'the key stays, so switching again needs no copy');
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."TelemetryObjectCleanup"'))[0].n, queuedBefore);
    const gets2 = store.calls.get;
    assert.equal(await laps.readCollectorLapCsv({ id: userId, role: 'User' }, lap.id), lap.csv);
    assert.equal(store.calls.get, gets2, 'read from Postgres');
  });

  test('purging legacy copies needs the typed word and a backup, and only clears verified object rows', async () => {
    const userId = await makeUser();
    const lap = await legacyLap(userId);
    await toObjects();
    const inline = await legacyLap(userId); // not copied yet
    await assert.rejects(() => migration.purgeLegacyTelemetry({ confirm: 'purge', backupTaken: true, startedBy: userId }), migration.PurgeNotConfirmedError);
    await assert.rejects(() => migration.purgeLegacyTelemetry({ confirm: 'PURGE', backupTaken: false, startedBy: userId }), migration.PurgeNotConfirmedError);
    assert.ok((await lapRow(lap.id)).csv_gzip, 'nothing cleared without confirmation');

    const result = await migration.purgeLegacyTelemetry({ confirm: 'PURGE', backupTaken: true, startedBy: userId });
    assert.ok(result.succeeded >= 1);
    assert.ok(result.bytes > 0);
    assert.equal((await lapRow(lap.id)).csv_gzip, null);
    assert.ok((await lapRow(inline.id)).csv_gzip, 'an inline lap keeps its only copy');
    const [run] = await q(`SELECT details, started_by FROM racingcoach."TelemetryStorageRuns" WHERE kind = 'purgeLegacy' ORDER BY id DESC LIMIT 1`);
    assert.equal(run.details.backupTaken, true);
    assert.equal(run.started_by, userId);
    assert.equal(await laps.readCollectorLapCsv({ id: userId, role: 'User' }, lap.id), lap.csv, 'still readable from its object');
    const [{ n }] = await q(`SELECT count(*)::int AS n FROM racingcoach."CollectorLaps" WHERE id = $1 AND storage_provider = 'r2'`, [lap.id]);
    await migration.rollbackReadsToPostgres();
    assert.equal(n, 1);
    assert.equal((await lapRow(lap.id)).storage_provider, 'r2', 'a purged row cannot roll back');
    await assert.rejects(() => q('UPDATE racingcoach."CollectorLaps" SET storage_provider = \'postgres\' WHERE id = $1', [lap.id]), /collector_laps_storage_check/);
  });

  test('the retention job deletes an expired lap, and the cleanup worker then deletes its object', async () => {
    const userId = await makeUser();
    const lap = await legacyLap(userId);
    await toObjects();
    const key = (await lapRow(lap.id)).storage_key;
    await q(`UPDATE racingcoach."CollectorLaps" SET expires_at = now() - interval '1 minute' WHERE id = $1`, [lap.id]);
    await db.withClient((c) => retention.runLapRetentionJob(c, { dryRun: false }));
    assert.equal(await lapRow(lap.id), undefined);
    assert.equal((await queued(key))?.reason, 'deleted');
    assert.ok(store.objects.has(key));
    await cleanup.runTelemetryCleanup();
    assert.ok(!store.objects.has(key));
    assert.equal(await queued(key), undefined);
  });

  test('a privacy erasure of laps and Delete Account both delete the objects', async () => {
    const erased = await makeUser();
    const deleted = await makeUser();
    const a = await legacyLap(erased);
    const b = await legacyLap(deleted);
    await toObjects();
    const keyA = (await lapRow(a.id)).storage_key;
    const keyB = (await lapRow(b.id)).storage_key;
    await db.transaction((c) => erasure.eraseCategory(c, erased, 'laps'));
    await users.deleteUser(deleted);
    assert.equal((await queued(keyA))?.reason, 'deleted');
    const entryB = await queued(keyB);
    assert.equal(entryB?.reason, 'deleted');
    assert.equal(entryB.user_id, deleted, "kept after the account is gone, with only its internal ID");
    await cleanup.runTelemetryCleanup();
    assert.ok(!store.objects.has(keyA));
    assert.ok(!store.objects.has(keyB));
  });

  test('a failed deletion is retried with backoff; an object a lap still references is never deleted', async () => {
    const userId = await makeUser();
    const gone = await legacyLap(userId);
    const kept = await legacyLap(userId);
    await toObjects();
    const goneKey = (await lapRow(gone.id)).storage_key;
    const keptKey = (await lapRow(kept.id)).storage_key;
    await q('DELETE FROM racingcoach."CollectorLaps" WHERE id = $1', [gone.id]);
    // A stray entry for a key a lap uses (e.g. an upload whose row did commit)
    await q(
      `INSERT INTO racingcoach."TelemetryObjectCleanup" (storage_provider, storage_bucket, storage_key, reason) VALUES ('r2', $1, $2, 'orphan')`,
      [store.bucket, keptKey]
    );
    store.failNext('delete');
    const first = await cleanup.runTelemetryCleanup();
    assert.ok(first.failed >= 1);
    const entry = await queued(goneKey);
    assert.equal(entry.attempts, 1);
    assert.match(entry.last_error, /Injected delete failure/);
    assert.ok(entry.not_before > new Date());
    assert.ok(store.objects.has(keptKey), 'a referenced object stays');
    assert.equal(await queued(keptKey), undefined, 'and its entry goes');
    await dueNow(goneKey);
    await cleanup.runTelemetryCleanup();
    assert.ok(!store.objects.has(goneKey));
    assert.equal(await queued(goneKey), undefined);
  });

  test('reconciliation queues orphaned objects and marks rows whose object is gone', async () => {
    const userId = await makeUser();
    const lap = await legacyLap(userId);
    await toObjects();
    const row = await lapRow(lap.id);
    const orphanKey = `telemetry/iracing/u${userId}/${randomUUID()}/${'b'.repeat(64)}.csv.gz`;
    await store.putObject(orphanKey, gzipSync('x'), { contentType: 'text/csv', metadata: {} });
    store.objects.delete(row.storage_key);
    await q(`UPDATE racingcoach."CollectorLaps" SET stored_at = now() - interval '1 hour' WHERE id = $1`, [lap.id]);
    const result = await cleanup.reconcileTelemetryStorage();
    assert.ok(result.orphans >= 1);
    assert.ok(result.missing >= 1);
    const orphan = await queued(orphanKey);
    assert.equal(orphan.reason, 'orphan');
    assert.ok(orphan.not_before > new Date(), 'after the pending-upload grace');
    assert.equal((await lapRow(lap.id)).storage_status, 'missing');
    // A second run doesn't queue it twice
    await cleanup.reconcileTelemetryStorage();
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."TelemetryObjectCleanup" WHERE storage_key = $1', [orphanKey]))[0].n, 1);
  });

  test('without a configured store the jobs do nothing', async () => {
    storage.setTelemetryStoreForTests(null);
    try {
      assert.equal(await cleanup.runTelemetryCleanup(), null);
      assert.equal(await cleanup.reconcileTelemetryStorage(), null);
      assert.equal(await migration.backfillTelemetry(), null);
    } finally {
      storage.setTelemetryStoreForTests(store);
    }
  });

  test('the report and the counters', async () => {
    const metrics = await import(new URL('../src/lib/telemetryStorageMetrics.ts', import.meta.url).href);
    const report = await import(new URL('../src/lib/telemetryStorageReport.ts', import.meta.url).href);
    assert.ok((await metrics.flushStorageMetrics()) > 0);
    const r = await report.readTelemetryStorageReport();
    assert.ok(r.objects.count > 0);
    assert.ok(r.objects.bytes > 0);
    assert.equal(r.configured, true);
    assert.ok(r.migration.switched > 0);
    assert.ok(r.counters.some((c) => c.metric === 'put_ok' && c.count > 0));
    assert.ok(r.runs.some((run) => run.kind === 'backfill'));
    assert.ok(r.postgres.databaseBytes > 0);
    assert.equal(typeof r.estimatedMonthlyCost, 'number');
  });
});
