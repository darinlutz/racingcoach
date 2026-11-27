// The lighting configuration and devices against a real database: npm run test:lighting-db (docs/lighting/README.md)
//
// Runs src/lib/lighting/lightingConfig.ts and devices.ts against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-lighting-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:17
//   LIGHTING_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:lighting-db
// Skipped without LIGHTING_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import pg from 'pg';

const url = process.env.LIGHTING_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'LIGHTING_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let store, model, devices, users, client;
const q = async (sql, params) => (await client.query(sql, params)).rows;
async function makeUser(role = 'Admin') {
  const [row] = await q(`INSERT INTO racingcoach."Users" (user_name, email_address, password, role) VALUES ('Owner', $1, 'x', $2) RETURNING id`, [
    `${randomUUID()}@example.test`,
    role,
  ]);
  return Number(row.id);
}

describe('lighting in the database', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    store = await import(new URL('lighting/lightingConfig.ts', src).href);
    model = await import(new URL('lighting/model.ts', src).href);
    devices = await import(new URL('lighting/devices.ts', src).href);
    await users.ensureUserSchema();
  });
  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('none until saved; a save reads back exactly, and the version goes up', async () => {
    const owner = await makeUser();
    assert.equal(await store.readLightingConfig(owner), null);
    assert.equal(await store.lightingConfigVersion(owner), 0);
    const config = model.defaultConfig();
    config.controllers[0].host = '192.168.1.50';
    config.scenes.push({ id: 'mine', name: 'Mine', zones: { cockpit: { on: true, color: [10, 20, 30, 40], brightness: 99 } } });
    config.rules[0].zones = ['cockpit', 'pedals'];
    const parsed = model.parseLightingConfig(config);
    assert.ok(parsed.ok, JSON.stringify(parsed.problems));
    assert.equal(await store.saveLightingConfig(owner, parsed.config, 0), 1);
    const read = await store.readLightingConfig(owner);
    assert.deepEqual(read, { ...parsed.config, version: 1 });
    assert.equal(model.parseLightingConfig(read).ok, true);
    assert.equal(await store.saveLightingConfig(owner, read, 1), 2);
    assert.equal(await store.lightingConfigVersion(owner), 2);
  });

  test('a save from an older copy is refused', async () => {
    const owner = await makeUser();
    const config = model.defaultConfig();
    await store.saveLightingConfig(owner, config, 0);
    await store.saveLightingConfig(owner, config, 1);
    await assert.rejects(store.saveLightingConfig(owner, config, 1), (e) => e instanceof store.LightingConfigConflict && e.currentVersion === 2);
    // The agent's one-time upload is refused once there's a configuration
    await assert.rejects(store.saveLightingConfig(owner, config, 0), store.LightingConfigConflict);
  });

  test('each owner has their own; nothing crosses', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const ca = model.defaultConfig();
    ca.controllers[0].host = '10.0.0.5';
    await store.saveLightingConfig(a, ca, 0);
    await store.saveLightingConfig(b, model.defaultConfig(), 0);
    assert.equal((await store.readLightingConfig(a)).controllers[0].host, '10.0.0.5');
    assert.equal((await store.readLightingConfig(b)).controllers[0].host, '');
  });

  test('deleting the account deletes its configuration and devices', async () => {
    const owner = await makeUser();
    await store.saveLightingConfig(owner, model.defaultConfig(), 0);
    const pairing = await devices.startDevicePairing('Test Mac');
    assert.ok(await devices.approveDevicePairing(pairing.code, owner));
    const claim = await devices.claimDevicePairing(pairing.pairingSecret);
    assert.equal(claim.status, 'paired');
    await q('DELETE FROM racingcoach."Users" WHERE id = $1', [owner]);
    for (const table of ['LightingInstallations', 'LightingControllers', 'LightingZones', 'LightingScenes', 'LightingEventRules', 'LightingDevices']) {
      const [{ n }] = await q(`SELECT count(*)::int AS n FROM racingcoach."${table}" WHERE user_id = $1`, [owner]);
      assert.equal(n, 0, table);
    }
  });

  test('pairing: one claim per code, tokens work only for Admins, revoking ends them', async () => {
    const owner = await makeUser();
    const pairing = await devices.startDevicePairing('Mac');
    assert.equal((await devices.claimDevicePairing(pairing.pairingSecret)).status, 'pending');
    assert.equal(await devices.approveDevicePairing('ZZZZ-ZZZZ', owner), null);
    await devices.approveDevicePairing(pairing.code, owner);
    const claim = await devices.claimDevicePairing(pairing.pairingSecret);
    assert.equal(claim.status, 'paired');
    assert.equal((await devices.claimDevicePairing(pairing.pairingSecret)).status, 'expired', 'claimed once');
    const access = await devices.issueAccessToken(claim.deviceToken);
    assert.ok(access);
    const request = (token) => new Request('http://x/api/lighting/state', { headers: { Authorization: `Bearer ${token}` } });
    assert.deepEqual(await devices.authenticateLightingDevice(request(access.accessToken)), { deviceId: claim.deviceId, userId: owner });
    assert.equal(await devices.authenticateLightingDevice(request('rcla_' + 'x'.repeat(43))), null);
    // No longer an Admin: no token
    await q(`UPDATE racingcoach."Users" SET role = 'User' WHERE id = $1`, [owner]);
    assert.equal(await devices.authenticateLightingDevice(request(access.accessToken)), null);
    assert.equal(await devices.issueAccessToken(claim.deviceToken), null);
    await q(`UPDATE racingcoach."Users" SET role = 'Admin' WHERE id = $1`, [owner]);
    assert.ok(await devices.revokeLightingDevice(claim.deviceId, owner));
    assert.equal(await devices.authenticateLightingDevice(request(access.accessToken)), null);
    assert.equal(await devices.issueAccessToken(claim.deviceToken), null);
  });
});
