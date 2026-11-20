// The iRacing Setups library against a real database: npm run test:car-setup-library
//
// Runs src/lib/carSetupLibrary.ts (planning, storing, re-importing, changed and missing files, refusals, downloads and
// the cleanup queue) against a disposable local Postgres and an in-memory object store, e.g.
//   docker run -d --rm --name rc-car-setups-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:17
//   CAR_SETUPS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:car-setup-library
// Skipped without CAR_SETUPS_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import { register } from 'node:module';
import pg from 'pg';

const url = process.env.CAR_SETUPS_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'CAR_SETUPS_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const htmFixture = fs.readFileSync(new URL('./fixtures/setups/htm/baseline.htm', import.meta.url));

// A file in iRacing's .sto layout (scripts/setups.test.mjs builds the same)
function sto(seed = 0xab) {
  const text = Buffer.from('Notes\u0000', 'utf16le');
  const header = Buffer.alloc(16);
  header.writeUInt32LE(3, 0);
  header.writeUInt32LE(8 + 32 + 32 + text.length, 4);
  header.writeUInt32LE(32, 8);
  header.writeUInt32LE(text.length, 12);
  return Buffer.concat([header, Buffer.alloc(32, seed), Buffer.alloc(32, 0xcd), text, Buffer.alloc(8)]);
}

const listing = (name, stoBytes, htmBytes) => ({
  path: name,
  stoFileName: `${name}.sto`,
  stoSha256: sha(stoBytes),
  stoBytes: stoBytes.length,
  htmFileName: htmBytes ? `${name}.htm` : null,
  htmSha256: htmBytes ? sha(htmBytes) : null,
  htmBytes: htmBytes ? htmBytes.length : null,
});

let lib, users, storage, cleanup, client, store;
const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeAdmin() {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Test Admin', $1, 'x', 'Admin') RETURNING id`,
    [`${randomUUID()}@example.test`]
  );
  return Number(row.id);
}

// The collector's whole Get Car Setups: plan, send what's new or changed, finish
async function runImport(admin, files) {
  const setups = files.map(([name, s, h]) => listing(name, s, h));
  const plan = await lib.planImport(admin, { collectorVersion: 'test', cars: [{ folder: 'ferrari296gt3', setups }], unreadable: [] });
  const results = [];
  for (const [name, s, h] of files) {
    const planned = plan.setups.find((x) => x.path === name);
    if (planned.decision !== 'new' && planned.decision !== 'changed') continue;
    results.push(await lib.storeSetup(admin, plan.importId, { folder: 'ferrari296gt3', ...listing(name, s, h) }, s, h));
  }
  const finished = await lib.finishImport(admin, plan.importId, []);
  return { plan, results, finished };
}

describe('iRacing Setups library', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    storage = await import(new URL('telemetryStorage.ts', src).href);
    lib = await import(new URL('carSetupLibrary.ts', src).href);
    cleanup = await import(new URL('telemetryCleanup.ts', src).href);
    store = storage.memoryTelemetryStore('test-telemetry');
    storage.setTelemetryStoreForTests(store);
    lib.setCarSetupStoreForTests(undefined);
    await users.ensureUserSchema();
  });
  after(async () => {
    storage?.setTelemetryStoreForTests(undefined);
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('the Ferrari folder is the existing Car Data car; unknown folders stay unresolved', async () => {
    const [ferrari] = await q(`SELECT id FROM racingcoach."Cars" WHERE car_name = 'Ferrari 296 GT3'`);
    const [resolved, unknown] = await lib.resolveCarFolders(['ferrari296gt3', 'notacar123']);
    assert.deepEqual(resolved, { folder: 'ferrari296gt3', resolved: true, carId: ferrari.id, carName: 'Ferrari 296 GT3' });
    assert.equal(unknown.resolved, false);
    assert.equal(unknown.reason, 'unknownCarPath');
  });

  test('first import stores four setups byte for byte; a second stores nothing; a changed one is a new version', async () => {
    const admin = await makeAdmin();
    const files = [
      ['baseline', sto(1), htmFixture],
      ['fixed', sto(2), Buffer.from(htmFixture.toString('latin1').replace('baseline', 'fixed'), 'latin1')],
      ['setup3', sto(3), Buffer.from(htmFixture.toString('latin1').replace('20.5 psi', '21.0 psi'), 'latin1')],
      ['setup4', sto(4), null],
    ];
    const first = await runImport(admin, files);
    assert.deepEqual(first.plan.setups.map((s) => s.decision), ['new', 'new', 'new', 'new']);
    assert.equal(first.finished.newCount, 4);
    assert.equal(first.finished.status, 'complete');
    const rows = await q(`SELECT * FROM racingcoach."CarSetups" ORDER BY setup_path`);
    assert.equal(rows.length, 4);
    assert.equal(rows[0].car_name, 'Ferrari 296 GT3');
    assert.equal(rows[0].htm_parse_status, 'parsed');
    assert.ok(rows[0].htm_parsed.parameters.length > 50);
    // A missing .htm is recorded, and the .sto is still kept and downloadable
    const four = rows.find((r) => r.setup_path === 'setup4');
    assert.equal(four.htm_parse_status, 'missing');
    assert.equal(four.htm_key, null);
    const putsAfterFirst = store.calls.put;
    assert.equal(putsAfterFirst, 7);

    // The download is the original file
    for (const [name, s] of files) {
      const row = rows.find((r) => r.setup_path === name);
      const file = await lib.readCarSetupFile(row.id, 'sto');
      assert.equal(sha(file.bytes), sha(s));
      assert.equal(file.fileName, `${name}.sto`);
    }
    assert.equal(sha((await lib.readCarSetupFile(rows[0].id, 'htm')).bytes), sha(htmFixture));
    assert.equal(await lib.readCarSetupFile(four.id, 'htm'), null);
    // Nothing pending is left behind for committed setups
    assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."TelemetryObjectCleanup"`))[0].n, 0);

    // Again: every setup unchanged, nothing sent or stored
    const second = await runImport(admin, files);
    assert.deepEqual(second.plan.setups.map((s) => s.decision), ['unchanged', 'unchanged', 'unchanged', 'unchanged']);
    assert.equal(second.results.length, 0);
    assert.equal(second.finished.unchangedCount, 4);
    assert.equal(store.calls.put, putsAfterFirst);
    assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."CarSetups"`))[0].n, 4);

    // One re-saved: only it changes, as version 2 at the same row; its old .sto object is queued for cleanup
    files[1] = ['fixed', sto(22), files[1][2]];
    const third = await runImport(admin, files);
    assert.deepEqual(third.plan.setups.map((s) => s.decision), ['unchanged', 'changed', 'unchanged', 'unchanged']);
    assert.equal(third.results[0].version, 2);
    assert.deepEqual(third.results[0].written, { sto: true, htm: false });
    const fixed = (await q(`SELECT * FROM racingcoach."CarSetups" WHERE setup_path = 'fixed'`))[0];
    assert.equal(fixed.sto_sha256, sha(sto(22)));
    assert.equal(fixed.id, rows.find((r) => r.setup_path === 'fixed').id);
    const queued = await q(`SELECT storage_key, reason FROM racingcoach."TelemetryObjectCleanup"`);
    assert.deepEqual(queued.map((r) => r.reason), ['replaced']);
    // The cleanup worker deletes the old object, never one a setup references
    await cleanup.runTelemetryCleanup();
    assert.equal(store.objects.has(queued[0].storage_key), false);
    assert.equal(store.objects.has(fixed.sto_key), true);
  });

  test('refusals: hashes that don’t match, a file that isn’t a .sto, an unresolved car, a closed import', async () => {
    const admin = await makeAdmin();
    const s = sto(9);
    const plan = await lib.planImport(admin, { collectorVersion: 'test', cars: [{ folder: 'ferrari296gt3', setups: [listing('r1', s, null)] }], unreadable: [] });
    const wrong = { folder: 'ferrari296gt3', ...listing('r1', s, null) };
    await assert.rejects(lib.storeSetup(admin, plan.importId, wrong, sto(10), null), { code: 'hashMismatch' });
    const junk = Buffer.from('not a setup file at all, just some text that is long enough to be read');
    await assert.rejects(lib.storeSetup(admin, plan.importId, { folder: 'ferrari296gt3', ...listing('r1', junk, null) }, junk, null), { code: 'notSto' });
    await assert.rejects(lib.storeSetup(admin, plan.importId, { folder: 'notacar123', ...listing('r1', s, null) }, s, null), { code: 'unresolvedCar' });
    // Another Admin can't add to this import
    await assert.rejects(lib.storeSetup(await makeAdmin(), plan.importId, wrong, s, null), { code: 'importNotFound' });
    await lib.finishImport(admin, plan.importId, [{ path: 'r1', error: 'test' }]);
    await assert.rejects(lib.storeSetup(admin, plan.importId, wrong, s, null), { code: 'importClosed' });
    assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."CarSetups" WHERE setup_path = 'r1'`))[0].n, 0);
  });

  test('a storage failure leaves no catalog entry, and a retry stores it', async () => {
    const admin = await makeAdmin();
    const s = sto(30);
    const plan = await lib.planImport(admin, { collectorVersion: 'test', cars: [{ folder: 'ferrari296gt3', setups: [listing('flaky', s, null)] }], unreadable: [] });
    store.failNext('put');
    const listed = { folder: 'ferrari296gt3', ...listing('flaky', s, null) };
    await assert.rejects(lib.storeSetup(admin, plan.importId, listed, s, null), { code: 'storageFailed' });
    assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."CarSetups" WHERE setup_path = 'flaky'`))[0].n, 0);
    const result = await lib.storeSetup(admin, plan.importId, listed, s, null);
    assert.equal(result.decision, 'new');
  });

  test('the page’s reads: cars, a car’s setups, details, provenance and imports', async () => {
    const cars = await lib.listLibraryCars();
    assert.equal(cars[0].carName, 'Ferrari 296 GT3');
    const setups = await lib.listCarSetups('ferrari296gt3');
    assert.ok(setups.some((x) => x.setupPath === 'baseline'));
    assert.ok(setups.every((x) => x.provenance === 'unknown'));
    const detail = await lib.readCarSetup(setups.find((x) => x.setupPath === 'baseline').id);
    assert.equal(detail.parsed.carPath, 'porsche911rgt3');
    assert.equal(await lib.setCarSetupProvenance(detail.id, 'official'), true);
    assert.equal(await lib.setCarSetupProvenance(detail.id, 'mine'), false);
    assert.equal((await lib.readCarSetup(detail.id)).provenance, 'official');
    const imports = await lib.listImports(20);
    assert.ok(imports.some((i) => i.status === 'completeWithErrors' && i.errors.length === 1));
  });
});
