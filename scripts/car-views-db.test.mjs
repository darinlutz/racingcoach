// The engineering car drawings against a real database: npm run test:car-views (docs/car-views.md)
//
// Runs src/lib/carViews/carViewStore.ts against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-car-views-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:17
//   CAR_VIEWS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:car-views
// Skipped without CAR_VIEWS_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import pg from 'pg';

const url = process.env.CAR_VIEWS_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'CAR_VIEWS_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let store, rules, generic, users, client;
const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeAdmin() {
  const [row] = await q(`INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Admin', $1, 'x', 'Admin') RETURNING id`, [
    `${randomUUID()}@example.test`,
  ]);
  return Number(row.id);
}

async function makeCar() {
  const [row] = await q(`INSERT INTO racingcoach."Cars" (car_name) VALUES ($1) RETURNING id`, [`Test car ${randomUUID()}`]);
  return Number(row.id);
}

// A valid draft: the generic car's front view as the "car's own" drawing
function draft(carId, carKeys, extra = {}) {
  const { source, anchors } = generic.genericSources().front;
  const result = rules.validateDraft({ carId, carKeys, views: { front: { svg: source, anchors } }, sources: 'Own work', license: 'Own work', notes: '', ...extra });
  assert.ok(result.ok, JSON.stringify(result.problems));
  return result.draft;
}

const codeOf = async (promise) => {
  try {
    await promise;
    return null;
  } catch (error) {
    return error.code;
  }
};

describe('engineering car drawings in the database', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    store = await import(new URL('carViews/carViewStore.ts', src).href);
    rules = await import(new URL('carViews/assetRules.ts', src).href);
    generic = await import(new URL('carViews/genericVehicle.ts', src).href);
    await users.ensureUserSchema();
  });
  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('a draft is numbered per car and drivers see nothing until a version is active', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const first = await store.createCarAssetDraft(draft(car, ['testcar1']), admin);
    const second = await store.createCarAssetDraft(draft(car, ['testcar1']), admin);
    assert.equal(first.version, 1);
    assert.equal(second.version, 2);
    assert.equal(await store.readActiveCarAsset('testcar1'), null);
    const listed = (await store.listCarAssets()).filter((a) => a.carId === car);
    assert.deepEqual(
      listed.map((a) => [a.version, a.status, a.active, a.views]),
      [
        [2, 'draft', false, ['front']],
        [1, 'draft', false, ['front']],
      ]
    );
    assert.equal(listed[1].history[0].action, 'create');
  });

  test('the review workflow, then activation by the exact car path, and rolling back', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const v1 = await store.createCarAssetDraft(draft(car, ['testcar2']), admin);
    assert.equal(await codeOf(store.applyCarAssetAction(v1.id, 'approve', admin)), 'wrongStatus');
    await store.applyCarAssetAction(v1.id, 'submit', admin);
    await store.applyCarAssetAction(v1.id, 'approve', admin);
    await store.applyCarAssetAction(v1.id, 'activate', admin);
    const active = await store.readActiveCarAsset('TestCar2');
    assert.equal(active.version, 1);
    assert.equal(active.active, true);
    assert.deepEqual(Object.keys(active.views), ['front']);
    assert.equal(await store.readActiveCarAsset('testcar'), null, 'never a similar car path');

    const v2 = await store.createCarAssetDraft(draft(car, ['testcar2']), admin);
    await store.applyCarAssetAction(v2.id, 'submit', admin);
    await store.applyCarAssetAction(v2.id, 'approve', admin);
    await store.applyCarAssetAction(v2.id, 'activate', admin);
    assert.equal((await store.readActiveCarAsset('testcar2')).version, 2);
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM racingcoach."CarEngineeringAssets" WHERE car_id = $1 AND active`, [car]);
    assert.equal(count, 1, 'one active version per car');

    // Rolling back is activating the older approved version again
    await store.applyCarAssetAction(v1.id, 'activate', admin);
    assert.equal((await store.readActiveCarAsset('testcar2')).version, 1);
    await store.applyCarAssetAction(v1.id, 'deactivate', admin);
    assert.equal(await store.readActiveCarAsset('testcar2'), null);
    const events = await q(`SELECT action FROM racingcoach."CarEngineeringAssetEvents" WHERE asset_id = $1 ORDER BY id`, [v1.id]);
    assert.deepEqual(
      events.map((e) => e.action),
      ['create', 'submit', 'approve', 'activate', 'activate', 'deactivate']
    );
  });

  test('activation needs sources and a licence, and a car path belongs to one car', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const other = await makeCar();
    const bare = await store.createCarAssetDraft(draft(car, ['testcar3'], { license: '' }), admin);
    await store.applyCarAssetAction(bare.id, 'submit', admin);
    await store.applyCarAssetAction(bare.id, 'approve', admin);
    assert.equal(await codeOf(store.applyCarAssetAction(bare.id, 'activate', admin)), 'needsProvenance');

    const mine = await store.createCarAssetDraft(draft(car, ['testcar3']), admin);
    for (const action of ['submit', 'approve', 'activate']) await store.applyCarAssetAction(mine.id, action, admin);
    const theirs = await store.createCarAssetDraft(draft(other, ['testcar3', 'othercar']), admin);
    await store.applyCarAssetAction(theirs.id, 'submit', admin);
    await store.applyCarAssetAction(theirs.id, 'approve', admin);
    assert.equal(await codeOf(store.applyCarAssetAction(theirs.id, 'activate', admin)), 'carKeyTaken');
  });

  test('one version shared by several cars: each car path finds it, and activating it replaces the shared cars\' own', async () => {
    const admin = await makeAdmin();
    const [a, b, c] = [await makeCar(), await makeCar(), await makeCar()];
    // b has drawings of its own, active
    const own = await store.createCarAssetDraft(draft(b, ['sharecarb']), admin);
    for (const action of ['submit', 'approve', 'activate']) await store.applyCarAssetAction(own.id, action, admin);
    // a's drawings, shared with b, for both cars' paths
    const shared = await store.createCarAssetDraft(draft(a, ['sharecara', 'sharecarb'], { sharedCarIds: [b] }), admin);
    for (const action of ['submit', 'approve', 'activate']) await store.applyCarAssetAction(shared.id, action, admin);
    assert.equal((await store.readActiveCarAsset('sharecara')).id, shared.id);
    assert.equal((await store.readActiveCarAsset('sharecarb')).id, shared.id, 'b now uses the shared drawings');
    const [{ active }] = await q('SELECT active FROM racingcoach."CarEngineeringAssets" WHERE id = $1', [own.id]);
    assert.equal(active, false, 'b\'s own version was replaced');
    const listed = (await store.listCarAssets()).find((x) => x.id === shared.id);
    assert.deepEqual(listed.sharedCars.map((x) => x.id), [b]);

    // Sharing an active version with c, at any status, adds c's path; another car's active claim on it refuses
    const theirs = await store.createCarAssetDraft(draft(await makeCar(), ['sharecarc']), admin);
    for (const action of ['submit', 'approve', 'activate']) await store.applyCarAssetAction(theirs.id, action, admin);
    assert.equal(await codeOf(store.updateCarAssetSharing(shared.id, { sharedCarIds: [b, c], carKeys: ['sharecara', 'sharecarb', 'sharecarc'] }, admin)), 'carKeyTaken');
    assert.equal((await store.readActiveCarAsset('sharecarc')).id, theirs.id, 'a refused change changes nothing');
    await store.applyCarAssetAction(theirs.id, 'deactivate', admin);
    await store.updateCarAssetSharing(shared.id, { sharedCarIds: [b, c], carKeys: ['sharecara', 'sharecarb', 'sharecarc'] }, admin);
    assert.equal((await store.readActiveCarAsset('sharecarc')).id, shared.id);
    assert.equal(await codeOf(store.updateCarAssetSharing(shared.id, { sharedCarIds: [999999], carKeys: ['sharecara'] }, admin)), 'unknownCar');
    assert.equal(await codeOf(store.createCarAssetDraft(draft(a, ['sharecara'], { sharedCarIds: [999999] }), admin)), 'unknownCar');

    // A shared car that's deleted is simply left out
    await q('DELETE FROM racingcoach."Cars" WHERE id = $1', [c]);
    assert.deepEqual((await store.listCarAssets()).find((x) => x.id === shared.id).sharedCars.map((x) => x.id), [b]);
  });

  test('a stored drawing changed by hand is sanitized again on reading, and left out when it fails', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const v = await store.createCarAssetDraft(draft(car, ['testcar4']), admin);
    for (const action of ['submit', 'approve', 'activate']) await store.applyCarAssetAction(v.id, action, admin);
    await q(
      `UPDATE racingcoach."CarEngineeringAssets" SET views = jsonb_set(views, '{front,inner}', to_jsonb((views->'front'->>'inner') || '<script>alert(1)</script>')) WHERE id = $1`,
      [v.id]
    );
    // A new version clears the server's cache, as any Admin change does
    await store.createCarAssetDraft(draft(car, ['testcar4']), admin);
    const asset = await store.readActiveCarAsset('testcar4');
    assert.deepEqual(Object.keys(asset.views), [], 'the tampered view is dropped, so the page shows the generic car');
    assert.equal(rules.resolveView(asset, 'front').source, 'generic');
    const preview = await store.readCarAsset(v.id);
    assert.equal(preview.views.front, undefined);
  });

  test('deleting: any version but the active one; the car takes its drawings, an account leaves them', async () => {
    const admin = await makeAdmin();
    const car = await makeCar();
    const kept = await store.createCarAssetDraft(draft(car, ['testcar5']), admin);
    await store.applyCarAssetAction(kept.id, 'submit', admin);
    await store.applyCarAssetAction(kept.id, 'approve', admin);
    await store.applyCarAssetAction(kept.id, 'activate', admin);
    assert.equal(await codeOf(store.deleteCarAsset(kept.id)), 'notDeletable');
    const gone = await store.createCarAssetDraft(draft(car, ['testcar5']), admin);
    await store.deleteCarAsset(gone.id);
    assert.equal(await store.readCarAsset(gone.id), null);
    const oldApproved = await store.createCarAssetDraft(draft(car, ['testcar5']), admin);
    await store.applyCarAssetAction(oldApproved.id, 'submit', admin);
    await store.applyCarAssetAction(oldApproved.id, 'approve', admin);
    await store.deleteCarAsset(oldApproved.id);
    assert.equal(await store.readCarAsset(oldApproved.id), null);
    const [{ n }] = await q('SELECT count(*)::int AS n FROM racingcoach."CarEngineeringAssetEvents" WHERE asset_id = $1', [oldApproved.id]);
    assert.equal(n, 0);

    await q('DELETE FROM racingcoach."Users" WHERE id = $1', [admin]);
    const [row] = await q('SELECT created_by, reviewed_by FROM racingcoach."CarEngineeringAssets" WHERE id = $1', [kept.id]);
    assert.deepEqual(row, { created_by: null, reviewed_by: null });
    await q('DELETE FROM racingcoach."Cars" WHERE id = $1', [car]);
    assert.equal(await store.readCarAsset(kept.id), null);
  });
});
