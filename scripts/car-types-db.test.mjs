// Car Data's one-time fixes against a real database: the Car Types (recategorizeCars) and the Mazdas (fixMazdaCars),
// in src/lib/defaultCars.ts. Part of npm run test:car-views.
//
// Runs against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-car-types-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:17
//   CAR_VIEWS_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:car-views
// Skipped without CAR_VIEWS_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import pg from 'pg';

const url = process.env.CAR_VIEWS_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'CAR_VIEWS_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let cars, users, client;
const q = async (sql, params) => (await client.query(sql, params)).rows;
const discipline = async (name) => (await q('SELECT racing_discipline FROM racingcoach."Cars" WHERE car_name = $1', [name]))[0]?.racing_discipline;

describe('Car Data one-time fixes', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    cars = await import(new URL('defaultCars.ts', src).href);
    await users.ensureUserSchema();
  });
  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('the Car Types: Oval to NASCAR, Dirt Road to Rallycross or Off-Road, Euro NASCAR to NASCAR, once', async () => {
    await q(`DELETE FROM racingcoach."SiteSettings" WHERE key = 'cars_types_nascar_rallycross_offroad'`);
    await q(`INSERT INTO racingcoach."Cars" (car_name, racing_discipline) VALUES
      ('Test Late Model', 'Oval'), ('Test Ford Fiesta RS WRC', 'Dirt Road'), ('Test Lucas Oil Off Road Pro 4 Truck', 'Dirt Road'),
      ('Test Euro NASCAR V8GP', 'Sports Car'), ('Test Supercars Holden', 'Sports Car'), ('Test DIRTcar Pro Late Model', 'Dirt Oval')`);
    await cars.recategorizeCars(client);
    assert.equal(await discipline('Test Late Model'), 'NASCAR');
    assert.equal(await discipline('Test Ford Fiesta RS WRC'), 'Rallycross');
    assert.equal(await discipline('Test Lucas Oil Off Road Pro 4 Truck'), 'Off-Road');
    assert.equal(await discipline('Test Euro NASCAR V8GP'), 'NASCAR');
    assert.equal(await discipline('Test Supercars Holden'), 'Sports Car');
    assert.equal(await discipline('Test DIRTcar Pro Late Model'), 'Dirt Oval');
    const [{ count }] = await q(`SELECT count(*)::int AS count FROM racingcoach."Cars" WHERE racing_discipline IN ('Oval', 'Dirt Road')`);
    assert.equal(count, 0);
    // Once: a car a Coach moves afterwards stays where it was put
    await q(`UPDATE racingcoach."Cars" SET racing_discipline = 'Sports Car' WHERE car_name = 'Test Euro NASCAR V8GP'`);
    await cars.recategorizeCars(client);
    assert.equal(await discipline('Test Euro NASCAR V8GP'), 'Sports Car');
  });

  test('the Mazda MX-5 Cup becomes the Global Mazda MX-5 Cup with its drawings, and the 2010 MX-5s come back once', async () => {
    // As the live site has it: the seeded Global row, and the current Mazda (made from the 2010 Cup's row) with drawings
    await q(`DELETE FROM racingcoach."SiteSettings" WHERE key = 'cars_mazda_2010_restored'`);
    await q(`DELETE FROM racingcoach."Cars" WHERE car_name ILIKE '%mx-5%'`);
    const [global] = await q(`INSERT INTO racingcoach."Cars" (car_name, racing_discipline, wheelbase_in, notes) VALUES ('Global Mazda MX-5 Cup', 'Sports Car', 91, 'seeded') RETURNING id`);
    const [current] = await q(`INSERT INTO racingcoach."Cars" (car_name, racing_discipline) VALUES ('Mazda MX-5 Cup', 'Sports Car') RETURNING id`);
    const [asset] = await q(
      `INSERT INTO racingcoach."CarEngineeringAssets" (car_id, version, status, active, car_keys, views, sources, license)
       VALUES ($1, 1, 'approved', true, ARRAY['mx5 mx52016'], '{}', 's', 'l') RETURNING id`,
      [current.id]
    );
    await cars.fixMazdaCars(client);
    const mazdas = await q(`SELECT id, car_name, wheelbase_in, notes FROM racingcoach."Cars" WHERE car_name ILIKE '%mx-5%' ORDER BY car_name`);
    assert.deepEqual(
      mazdas.map((m) => m.car_name),
      ['Global Mazda MX-5 Cup', 'Mazda MX-5 Cup - 2010', 'Mazda MX-5 Roadster - 2010']
    );
    assert.equal(mazdas[0].id, current.id, 'the current Mazda keeps its row');
    assert.equal(mazdas[0].wheelbase_in, 91, 'figures it lacked come from the seeded row');
    assert.equal(mazdas[0].notes, 'seeded');
    assert.equal((await q('SELECT 1 FROM racingcoach."Cars" WHERE id = $1', [global.id])).length, 0);
    const [kept] = await q('SELECT car_id, active FROM racingcoach."CarEngineeringAssets" WHERE id = $1', [asset.id]);
    assert.deepEqual([kept.car_id, kept.active], [current.id, true], 'its drawings untouched');

    // Again: nothing changes, and a 2010 car deleted afterwards stays deleted
    await q(`DELETE FROM racingcoach."Cars" WHERE car_name = 'Mazda MX-5 Roadster - 2010'`);
    await cars.fixMazdaCars(client);
    const again = await q(`SELECT car_name FROM racingcoach."Cars" WHERE car_name ILIKE '%mx-5%' ORDER BY car_name`);
    assert.deepEqual(
      again.map((m) => m.car_name),
      ['Global Mazda MX-5 Cup', 'Mazda MX-5 Cup - 2010']
    );
  });

  test('a Global row with drawings of its own leaves both Mazdas alone', async () => {
    await q(`DELETE FROM racingcoach."Cars" WHERE car_name ILIKE '%mx-5%'`);
    const [global] = await q(`INSERT INTO racingcoach."Cars" (car_name) VALUES ('Global Mazda MX-5 Cup') RETURNING id`);
    await q(`INSERT INTO racingcoach."Cars" (car_name) VALUES ('Mazda MX-5 Cup')`);
    await q(
      `INSERT INTO racingcoach."CarEngineeringAssets" (car_id, version, car_keys, views) VALUES ($1, 1, ARRAY['mx5 mx52016'], '{}')`,
      [global.id]
    );
    const error = console.error;
    console.error = () => {};
    try {
      await cars.fixMazdaCars(client);
    } finally {
      console.error = error;
    }
    const names = (await q(`SELECT car_name FROM racingcoach."Cars" WHERE car_name ILIKE '%mx-5%' ORDER BY car_name`)).map((m) => m.car_name);
    assert.deepEqual(names, ['Global Mazda MX-5 Cup', 'Mazda MX-5 Cup']);
  });
});
