// Lap telemetry storage tests without a database: the object key rules, the storage mode, retry delays, the cost
// estimate, and the storage layer (src/lib/telemetryStorage.ts) against its in-memory store, so no bucket is needed.
//   node --experimental-transform-types --no-warnings --test scripts/telemetry-storage.test.mjs

import { before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { gunzipSync, gzipSync } from 'node:zlib';

register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
const src = new URL('../src/lib/', import.meta.url);
let rules, storage;

before(async () => {
  rules = await import(new URL('telemetryStorageRules.ts', src).href);
  storage = await import(new URL('telemetryStorage.ts', src).href);
});

const LAP = '3f2504e0-4f89-11d3-9a0c-0305e82c3301';
const SHA = 'a'.repeat(64);

describe('object keys', () => {
  test('a lap key is built from stable ids only', () => {
    assert.equal(
      rules.lapObjectKey({ simulator: 'iRacing', userId: 7, clientLapId: LAP.toUpperCase(), sha256: SHA }),
      `telemetry/iracing/u7/${LAP}/${SHA}.csv.gz`
    );
    assert.equal(rules.lapObjectKey({ simulator: 'acc', userId: 1, clientLapId: LAP, sha256: SHA }).split('/')[1], 'acc');
  });

  test('an Expert Lap key is its checksum alone, outside telemetry/', () => {
    assert.equal(rules.expertLapObjectKey(SHA), `expert-laps/${SHA}.csv.gz`);
    assert.ok(!rules.expertLapObjectKey(SHA).startsWith(rules.TELEMETRY_PREFIX), 'the reconciliation never lists it');
    assert.ok(rules.isExpertLapObjectKey(rules.expertLapObjectKey(SHA)));
    assert.ok(!rules.isExpertLapObjectKey(`telemetry/iracing/u7/${LAP}/${SHA}.csv.gz`));
    assert.equal(rules.parseLapObjectKey(rules.expertLapObjectKey(SHA)), null);
    for (const bad of ['../x', SHA.toUpperCase(), `${SHA}/..`, '']) assert.throws(() => rules.expertLapObjectKey(bad));
  });

  test('a Target Lap key is the user and checksum, outside telemetry/', () => {
    assert.equal(rules.targetLapObjectKey(7, SHA), `target-laps/u7/${SHA}.csv.gz`);
    assert.ok(!rules.targetLapObjectKey(7, SHA).startsWith(rules.TELEMETRY_PREFIX));
    assert.ok(rules.isTargetLapObjectKey(rules.targetLapObjectKey(7, SHA)));
    assert.ok(!rules.isTargetLapObjectKey(rules.expertLapObjectKey(SHA)));
    assert.ok(!rules.isExpertLapObjectKey(rules.targetLapObjectKey(7, SHA)));
    for (const [user, sha] of [[0, SHA], [-1, SHA], [1.5, SHA], [7, '../x'], [7, SHA.toUpperCase()]]) {
      assert.throws(() => rules.targetLapObjectKey(user, sha));
    }
  });

  test('anything that could leave the user prefix is refused', () => {
    const bad = [
      { simulator: '../x', userId: 7, clientLapId: LAP, sha256: SHA },
      { simulator: 'iracing/u8', userId: 7, clientLapId: LAP, sha256: SHA },
      { simulator: 'iracing', userId: 0, clientLapId: LAP, sha256: SHA },
      { simulator: 'iracing', userId: 1.5, clientLapId: LAP, sha256: SHA },
      { simulator: 'iracing', userId: 7, clientLapId: '../../u8/x', sha256: SHA },
      { simulator: 'iracing', userId: 7, clientLapId: 'lap.csv', sha256: SHA },
      { simulator: 'iracing', userId: 7, clientLapId: LAP, sha256: 'abc' },
      { simulator: 'iracing', userId: 7, clientLapId: LAP, sha256: 'G'.repeat(64) },
    ];
    for (const parts of bad) assert.throws(() => rules.lapObjectKey(parts), undefined, JSON.stringify(parts));
  });

  test('keys parse back, and other keys are not lap keys', () => {
    const key = rules.lapObjectKey({ simulator: 'iracing', userId: 42, clientLapId: LAP, sha256: SHA });
    assert.deepEqual(rules.parseLapObjectKey(key), { simulator: 'iracing', userId: 42, clientLapId: LAP, sha256: SHA });
    assert.equal(rules.parseLapObjectKey('privacy-ledger/x.json'), null);
    assert.equal(rules.parseLapObjectKey(`telemetry/iracing/u42/${LAP}/${SHA}.csv`), null);
    assert.equal(rules.userObjectPrefix('iracing', 42), 'telemetry/iracing/u42/');
    assert.throws(() => rules.userObjectPrefix('iracing', -1));
  });
});

describe('settings and estimates', () => {
  test('only r2 turns object storage on', () => {
    assert.equal(rules.parseStorageMode(undefined), 'postgres');
    assert.equal(rules.parseStorageMode(' R2 '), 'r2');
    assert.equal(rules.parseStorageMode('s3'), 'postgres');
  });

  test('backoff grows, is capped and jittered', () => {
    assert.equal(rules.backoffMs(1, 200, 5000, () => 1), 200);
    assert.equal(rules.backoffMs(3, 200, 5000, () => 1), 800);
    assert.equal(rules.backoffMs(20, 200, 5000, () => 1), 5000);
    assert.equal(rules.backoffMs(3, 200, 5000, () => 0), 400);
    assert.equal(rules.cleanupRetryDelayMs(0), 60_000);
    assert.equal(rules.cleanupRetryDelayMs(100), 24 * 60 * 60 * 1000);
  });

  test('the cost estimate counts only what is past the free tier', () => {
    assert.equal(rules.estimateMonthlyR2Cost(5 * 1024 ** 3), 0);
    assert.equal(rules.estimateMonthlyR2Cost(110 * 1024 ** 3), 1.5);
    assert.equal(rules.estimateMonthlyR2Cost(0, 2_000_000, 20_000_000), 4.5 + 3.6);
  });

  test('sha256 is hex', () => {
    assert.equal(rules.sha256Hex(Buffer.from('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('storage layer on the in-memory store', () => {
  let store;
  const csv = 'Speed,LapDistPct,Brake,Throttle\n10,0.1,0,1\n20,0.5,0.5,0\n';
  const gzip = gzipSync(csv);
  const key = () => rules.lapObjectKey({ simulator: 'iracing', userId: 7, clientLapId: LAP, sha256: rules.sha256Hex(gzip) });
  const details = { csvBytes: csv.length, userId: 7, clientLapId: LAP, simulator: 'iracing' };

  beforeEach(() => {
    store = storage.memoryTelemetryStore('bucket-a');
    storage.setTelemetryStoreForTests(store);
  });

  test('unconfigured storage refuses to read or write', async () => {
    storage.setTelemetryStoreForTests(null);
    assert.equal(storage.telemetryStorageConfigured(), false);
    await assert.rejects(storage.putLapObject(key(), gzip, details), storage.TelemetryStorageNotConfiguredError);
  });

  test('put then get round-trips the gzip bytes and their metadata', async () => {
    const stored = await storage.putLapObject(key(), gzip, details);
    assert.deepEqual(stored, { provider: 'r2', bucket: 'bucket-a', key: key(), storedBytes: gzip.length, sha256: rules.sha256Hex(gzip) });
    const object = store.objects.get(key());
    assert.equal(object.contentType, 'text/csv');
    assert.equal(object.metadata.sha256, rules.sha256Hex(gzip));
    assert.equal(object.metadata['csv-bytes'], String(csv.length));
    storage.setTelemetryStoreForTests(store); // empties the cache, so the read goes to the store
    const bytes = await storage.getLapObject('bucket-a', key(), rules.sha256Hex(gzip));
    assert.equal(gunzipSync(bytes).toString('utf8'), csv);
    assert.deepEqual(await storage.lapObjectExists('bucket-a', key()), { size: gzip.length, sha256: rules.sha256Hex(gzip) });
  });

  test('a second read comes from the cache', async () => {
    await storage.putLapObject(key(), gzip, details);
    storage.setTelemetryStoreForTests(store);
    await storage.getLapObject('bucket-a', key());
    await storage.getLapObject('bucket-a', key());
    assert.equal(store.calls.get, 1);
  });

  test('bytes that do not match the checksum never reach the caller', async () => {
    store.objects.set(key(), { body: gzipSync('tampered'), contentType: 'text/csv', metadata: {} });
    await assert.rejects(storage.getLapObject('bucket-a', key(), rules.sha256Hex(gzip)), storage.ChecksumMismatchError);
  });

  test('a missing object is null, not an error', async () => {
    assert.equal(await storage.getLapObject('bucket-a', key()), null);
    assert.equal(await storage.lapObjectExists('bucket-a', key()), null);
  });

  test('another bucket than the configured one is refused', async () => {
    await assert.rejects(storage.getLapObject('bucket-b', key()), /bucket-b/);
  });

  test('objects past the size limit are refused', async () => {
    store.objects.set(key(), { body: Buffer.alloc(storage.MAX_LAP_OBJECT_BYTES + 1), contentType: 'text/csv', metadata: {} });
    await assert.rejects(storage.getLapObject('bucket-a', key()), storage.ObjectTooLargeError);
  });

  test('a failed put throws and stores nothing', async () => {
    store.failNext('put');
    await assert.rejects(storage.putLapObject(key(), gzip, details), /Injected put failure/);
    assert.equal(store.objects.size, 0);
  });

  test('a store failure on read throws (the caller must not coach from fewer laps)', async () => {
    store.failNext('get');
    await assert.rejects(storage.getLapObject('bucket-a', key()), /Injected get failure/);
  });

  test('delete removes the object and the cached copy, and deleting again succeeds', async () => {
    await storage.putLapObject(key(), gzip, details);
    await storage.deleteLapObject('bucket-a', key());
    await storage.deleteLapObject('bucket-a', key());
    assert.equal(await storage.getLapObject('bucket-a', key()), null);
  });

  test('metrics are counted and drained once', async () => {
    storage.drainStorageMetrics();
    await storage.putLapObject(key(), gzip, details);
    await storage.getLapObject('bucket-a', key());
    const drained = Object.fromEntries(storage.drainStorageMetrics().map((m) => [m.metric, m.count]));
    assert.equal(drained.put_ok, 1);
    assert.equal(drained.cache_hit, 1);
    assert.deepEqual(storage.drainStorageMetrics(), []);
  });

  test('mapLimited keeps order and never runs more than the limit at once', async () => {
    let running = 0;
    let peak = 0;
    const result = await storage.mapLimited([1, 2, 3, 4, 5, 6, 7], 3, async (n) => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((resolve) => setTimeout(resolve, 5));
      running--;
      return n * 2;
    });
    assert.deepEqual(result, [2, 4, 6, 8, 10, 12, 14]);
    assert.ok(peak <= 3);
  });
});
