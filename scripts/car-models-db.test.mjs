// The 3D car models against a real database: npm run test:car-models (docs/car-models.md)
//
// Runs src/lib/carModels/carModelStore.ts against a disposable local Postgres with an in-memory object store, e.g.
//   docker run -d --rm --name rc-car-models-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:17
//   CAR_MODELS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:car-models
// Skipped without CAR_MODELS_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import pg from 'pg';
import { testCarGlb } from './testCarGlb.mjs';

const url = process.env.CAR_MODELS_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'CAR_MODELS_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let store, storage, glb, users, client, objects;
const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeAdmin() {
  const [row] = await q(`INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Admin', $1, 'x', 'Admin') RETURNING id`, [
    `${randomUUID()}@example.test`,
  ]);
  return Number(row.id);
}
async function makeCar() {
  const [row] = await q(`INSERT INTO racingcoach."Cars" (car_name, wheelbase_in) VALUES ($1, 104.1) RETURNING id`, [`Test car ${randomUUID()}`]);
  return Number(row.id);
}
const codeOf = async (promise) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.code;
  }
};

// The test car, with a different generator string each time so its hash (and object) differs
function upload(carId, carKeys, extra = {}, salt = randomUUID()) {
  let bytes = Buffer.from(testCarGlb());
  // Change the JSON chunk's generator in place (same length) so each upload is a distinct file
  const at = bytes.indexOf('RacingCoach test car');
  bytes = Buffer.from(bytes);
  bytes.write(salt.slice(0, 20).padEnd(20, 'x'), at);
  const check = glb.checkGlb(bytes);
  assert.ok(check.ok, JSON.stringify(check.problems));
  return { carId, carKeys, fileName: 'car.glb', bytes, info: check.info, source: 'Own work', license: 'CC-BY-4.0', attribution: 'by the tests', notes: '', ...extra };
}

describe('3D car models in the database', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    storage = await import(new URL('carModels/carModelStorage.ts', src).href);
    store = await import(new URL('carModels/carModelStore.ts', src).href);
    glb = await import(new URL('carModels/glb.ts', src).href);
    const memory = storage.memoryCarModelStore();
    objects = memory.objects;
    storage.setCarModelStoreForTests(memory);
    await users.ensureUserSchema();
  });
  after(async () => {
    storage?.setCarModelStoreForTests(null);
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('an upload stores the file content-addressed and its row as Uploaded, with estimated wheel centers', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const first = await store.createCarModel(upload(car, ['testcarone']), admin);
    assert.equal(first.version, 1);
    const [row] = await q('SELECT storage_key, status, active, wheel_anchors, sha256 FROM racingcoach."CarModelAssets" WHERE id = $1', [first.id]);
    assert.equal(row.status, 'uploaded');
    assert.equal(row.active, false);
    assert.equal(row.storage_key, `car-models/${car}/${row.sha256}.glb`);
    assert.ok(objects.has(row.storage_key));
    // Car Data's 104.1 in wheelbase (2.644 m) places the estimated axles
    assert.ok(Math.abs(row.wheel_anchors.LF.x - row.wheel_anchors.LR.x - 104.1 * 0.0254) < 0.002);
    assert.equal(row.wheel_anchors.LF.verified, false);
  });

  test('the same file twice for a car is refused as a duplicate, and leaves the first object', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const input = upload(car, ['testcartwo']);
    await store.createCarModel(input, admin);
    assert.equal(await codeOf(store.createCarModel(input, admin)), 'duplicate');
    assert.equal([...objects.keys()].filter((k) => k.startsWith(`car-models/${car}/`)).length, 1);
  });

  test('drivers see nothing until a version is approved and active; activating rolls back too', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const v1 = await store.createCarModel(upload(car, ['testcarthree']), admin);
    assert.equal(await store.readActiveCarModel('testcarthree'), null);
    const file = await store.readCarModelFile(v1.id);
    assert.equal(file.servable, false, 'an uploaded version is never served to drivers');
    for (const action of ['submit', 'approve', 'activate']) await store.applyCarModelAction(v1.id, action, admin);
    const active = await store.readActiveCarModel('testcarthree');
    assert.equal(active.id, v1.id);
    assert.match(active.url, new RegExp(`^/api/car-models/${v1.id}/file\\?v=[0-9a-f]{16}$`));
    assert.equal((await store.readCarModelFile(v1.id)).servable, true);
    assert.equal(await store.readActiveCarModel('testcarthreeevo'), null, 'never a similar car path');

    const v2 = await store.createCarModel(upload(car, ['testcarthree']), admin);
    for (const action of ['submit', 'approve', 'activate']) await store.applyCarModelAction(v2.id, action, admin);
    assert.equal((await store.readActiveCarModel('testcarthree')).id, v2.id);
    const [{ count }] = await q('SELECT count(*)::int AS count FROM racingcoach."CarModelAssets" WHERE car_id = $1 AND active', [car]);
    assert.equal(count, 1);
    await store.applyCarModelAction(v1.id, 'activate', admin);
    assert.equal((await store.readActiveCarModel('testcarthree')).id, v1.id, 'activating the older approved version is the rollback');
  });

  test('a car path belongs to one car’s active model', async () => {
    const admin = await makeAdmin();
    const [a, b] = [await makeCar(), await makeCar()];
    const first = await store.createCarModel(upload(a, ['sharedpath']), admin);
    const second = await store.createCarModel(upload(b, ['sharedpath']), admin);
    for (const id of [first.id, second.id]) for (const action of ['submit', 'approve']) await store.applyCarModelAction(id, action, admin);
    await store.applyCarModelAction(first.id, 'activate', admin);
    assert.equal(await codeOf(store.applyCarModelAction(second.id, 'activate', admin)), 'carKeyTaken');
  });

  test('activation needs the author’s credit for a CC BY licence', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const v = await store.createCarModel(upload(car, ['creditless'], { attribution: '' }), admin);
    await store.applyCarModelAction(v.id, 'submit', admin);
    await store.applyCarModelAction(v.id, 'approve', admin);
    assert.equal(await codeOf(store.applyCarModelAction(v.id, 'activate', admin)), 'needsAttribution');
  });

  test('settings change only while uploaded or rejected, and a rejected one goes back to uploaded', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const v = await store.createCarModel(upload(car, ['editable']), admin);
    const normalization = { up: '+y', forward: '-z', scale: 1, yaw: 2, offset: [0.1, 0, 0] };
    await store.updateCarModel(v.id, { normalization, defaultView: 'top' }, admin);
    const read = await store.readCarModel(v.id);
    assert.deepEqual(read.normalization, normalization);
    assert.equal(read.defaultView, 'top');
    await store.applyCarModelAction(v.id, 'submit', admin);
    assert.equal(await codeOf(store.updateCarModel(v.id, { notes: 'x' }, admin)), 'notEditable');
    await store.applyCarModelAction(v.id, 'reject', admin);
    await store.updateCarModel(v.id, { notes: 'fixed' }, admin);
    const [row] = await q('SELECT status FROM racingcoach."CarModelAssets" WHERE id = $1', [v.id]);
    assert.equal(row.status, 'uploaded');
    const events = await q('SELECT action FROM racingcoach."CarModelAssetEvents" WHERE asset_id = $1 ORDER BY id', [v.id]);
    assert.deepEqual(events.map((e) => e.action), ['upload', 'edit', 'submit', 'reject', 'edit']);
  });

  test('deleting an uploaded version removes its file; an approved one can’t be deleted', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const v = await store.createCarModel(upload(car, ['deletable']), admin);
    const [{ storage_key: key }] = await q('SELECT storage_key FROM racingcoach."CarModelAssets" WHERE id = $1', [v.id]);
    await store.deleteCarModel(v.id);
    assert.ok(!objects.has(key));
    const kept = await store.createCarModel(upload(car, ['deletable']), admin);
    await store.applyCarModelAction(kept.id, 'submit', admin);
    await store.applyCarModelAction(kept.id, 'approve', admin);
    assert.equal(await codeOf(store.deleteCarModel(kept.id)), 'notDeletable');
  });

  test('deleting the car deletes its models; deleting an Admin keeps them', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const v = await store.createCarModel(upload(car, ['cascade']), admin);
    await q('DELETE FROM racingcoach."Users" WHERE id = $1', [admin]);
    const [row] = await q('SELECT created_by FROM racingcoach."CarModelAssets" WHERE id = $1', [v.id]);
    assert.equal(row.created_by, null);
    await q('DELETE FROM racingcoach."Cars" WHERE id = $1', [car]);
    assert.equal((await q('SELECT 1 FROM racingcoach."CarModelAssets" WHERE id = $1', [v.id])).length, 0);
  });
});
