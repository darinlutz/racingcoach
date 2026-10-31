// My Dashboard's queries against a real database: npm run test:my-dashboard
//
// Runs src/lib/dashboard.ts against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-dashboard-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:16
//   MY_DASHBOARD_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:my-dashboard
// Skipped without MY_DASHBOARD_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const url = process.env.MY_DASHBOARD_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'MY_DASHBOARD_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
let dashboard, users, laps, client;

const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeUser(level = 'Gold') {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level)
     VALUES ('Test Driver', $1, 'x', $2) RETURNING id`,
    [`${randomUUID()}@example.test`, level]
  );
  return Number(row.id);
}

const csvGzip = gzipSync('Speed,LapDistPct,Brake,Throttle\n10,0.1,0,1\n20,0.5,0.5,0\n30,0.9,0,1\n');
const saveLap = (userId, hoursAgo, overrides = {}) =>
  laps.saveCollectorLap(
    userId,
    {
      clientLapId: randomUUID(),
      track: 'Testville Park (Grand Prix)',
      trackKey: 'testville gp',
      car: 'Porsche 911 GT3 R (992)',
      driver: 'iRacing Name',
      sessionId: 10,
      subSessionId: 20,
      sessionNum: 0,
      sessionType: 'Practice',
      lapNumber: 1,
      lapTimeSeconds: 60,
      samples: 3,
      missingSamples: 0,
      incidents: 0,
      pitRoad: false,
      offTrack: false,
      recordedAt: new Date(Date.now() - hoursAgo * HOUR).toISOString(),
      ...overrides,
    },
    csvGzip,
    100,
    false
  );

describe('My Dashboard queries', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    laps = await import(new URL('collectorLaps.ts', src).href);
    dashboard = await import(new URL('dashboard.ts', src).href);
    await users.ensureUserSchema();
    await q(`INSERT INTO racingcoach."Tracks" (track_key, track_name, track_length_feet) VALUES ('test oval', 'Test Oval', 5280)
             ON CONFLICT DO NOTHING`);
    await q(`INSERT INTO racingcoach."Tracks" (track_key, track_name, config_name, track_length_feet) VALUES ('testville gp', 'Testville Park (Grand Prix)', 'Grand Prix', 10000)`);
  });

  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('a driver with no laps has zeros and no recent session', async () => {
    const id = await makeUser();
    const stats = await dashboard.readCareerStats(id);
    assert.deepEqual(stats, { laps: 0, sessions: 0, lapsThisWeek: 0, distanceFeet: null, lapsWithoutLength: 0, cars: 0, tracks: 0, lastActive: null });
    assert.equal(await dashboard.readRecentSession(id), null);
  });

  test("one driver's laps never count for another", async () => {
    const [a, b] = [await makeUser(), await makeUser()];
    await saveLap(a, 1, { car: "A's Car" });
    await saveLap(a, 1, { lapNumber: 2, car: "A's Car" });
    await saveLap(b, 2, { car: "B's Car", subSessionId: 21 });
    assert.equal((await dashboard.readCareerStats(a)).laps, 2);
    assert.equal((await dashboard.readCareerStats(b)).laps, 1);
    assert.equal((await dashboard.readRecentSession(a)).car, "A's Car");
    assert.equal((await dashboard.readRecentSession(b)).car, "B's Car");
  });

  test('duplicate uploads of a lap count once: the same clientLapId, or the same lap under a new one', async () => {
    const id = await makeUser();
    const clientLapId = randomUUID();
    await saveLap(id, 1, { clientLapId });
    await saveLap(id, 1, { clientLapId });
    await saveLap(id, 0.5); // The same subsession, session and lap number, played back from an .ibt
    const stats = await dashboard.readCareerStats(id);
    assert.equal(stats.laps, 1);
    assert.equal(stats.sessions, 1);
    assert.equal(stats.distanceFeet, 10000);
  });

  test('offline sessions, which have no iRacing IDs: separated by the gap, and duplicates found by lap number and time', async () => {
    const id = await makeUser();
    const offline = { subSessionId: 0, sessionId: 0 };
    await saveLap(id, 50, { ...offline, lapNumber: 1, lapTimeSeconds: 60.1 });
    await saveLap(id, 49.9, { ...offline, lapNumber: 2, lapTimeSeconds: 60.2 });
    await saveLap(id, 49, { ...offline, lapNumber: 2, lapTimeSeconds: 60.2 }); // The same lap again
    await saveLap(id, 2, { ...offline, lapNumber: 1, lapTimeSeconds: 59.9 }); // Another day: a new session
    const stats = await dashboard.readCareerStats(id);
    assert.equal(stats.laps, 3);
    assert.equal(stats.sessions, 2);
  });

  test('each session of a subsession counts, and cars and physical tracks count once however they are spelled', async () => {
    const id = await makeUser();
    await saveLap(id, 5, { sessionNum: 0, sessionType: 'Practice' });
    await saveLap(id, 4, { sessionNum: 1, sessionType: 'Qualify' });
    await saveLap(id, 3, { sessionNum: 2, sessionType: 'Race' });
    // Another layout of the same track, and the same car in other letters
    await saveLap(id, 2, { subSessionId: 30, track: 'Testville Park (Chicanes)', trackKey: null, car: 'PORSCHE 911 GT3 R (992)' });
    await saveLap(id, 1, { subSessionId: 31, track: 'Test Oval', trackKey: 'test oval', car: 'Other Car' });
    const stats = await dashboard.readCareerStats(id);
    assert.equal(stats.sessions, 5);
    assert.equal(stats.cars, 2);
    assert.equal(stats.tracks, 2);
    // The lap with no key has no known length, and says so
    assert.equal(stats.lapsWithoutLength, 1);
    assert.equal(stats.distanceFeet, 3 * 10000 + 5280);
    assert.equal(stats.lapsThisWeek, 5);
  });

  test('distance is unavailable when no lap has a known length', async () => {
    const id = await makeUser();
    await saveLap(id, 1, { trackKey: null, track: 'Nowhere' });
    const stats = await dashboard.readCareerStats(id);
    assert.equal(stats.distanceFeet, null);
    assert.equal(stats.lapsWithoutLength, 1);
  });

  test('the latest session goes by when it was driven, not uploaded, of any session type', async () => {
    const id = await makeUser();
    await saveLap(id, 3, { car: 'Driven Last', subSessionId: 40, sessionType: 'Race' });
    // Uploaded after it, but driven before it
    await saveLap(id, 24, { car: 'Uploaded Last', subSessionId: 41, sessionType: 'Practice' });
    const recent = await dashboard.readRecentSession(id);
    assert.equal(recent.car, 'Driven Last');
    assert.equal(recent.sessionType, 'Race');
    assert.ok(Math.abs(Date.parse(recent.at) - (Date.now() - 3 * HOUR)) < 60_000);
    assert.equal((await dashboard.readCareerStats(id)).lastActive, recent.at);
  });

  test('the track comes from Track Data by its key, with its layout and map', async () => {
    const id = await makeUser();
    await q(
      `UPDATE racingcoach."Tracks" SET track_outline = $1 WHERE lower(track_key) = 'testville gp'`,
      [JSON.stringify({ kind: 'latlon', points: [[41, -73], [41, -73.01], [41.01, -73.01]] })]
    );
    // iRacing's own name of the layout differs from Track Data's
    await saveLap(id, 1, { track: "iRacing's Name (Full Course)" });
    const recent = await dashboard.readRecentSession(id);
    const [row] = await q(`SELECT track_name, config_name FROM racingcoach."Tracks" WHERE lower(track_key) = 'testville gp'`);
    assert.ok(row.track_name.startsWith(recent.track));
    assert.notEqual(recent.track, "iRacing's Name");
    assert.equal(recent.config, row.config_name === 'Default' ? null : row.config_name);
    assert.match(recent.mapPath, /^M.* Z$/);
  });

  test('expired laps are gone from every number', async () => {
    const id = await makeUser('Bronze');
    await saveLap(id, 1, { lapNumber: 1 });
    await saveLap(id, 2, { lapNumber: 2, car: 'Old Car' });
    // Past Bronze's period; the cleanup job just hasn't deleted it yet
    await q(`UPDATE racingcoach."CollectorLaps" SET expires_at = now() - interval '1 minute' WHERE user_id = $1 AND car = 'Old Car'`, [id]);
    const stats = await dashboard.readCareerStats(id);
    assert.equal(stats.laps, 1);
    assert.equal(stats.cars, 1);
    assert.notEqual((await dashboard.readRecentSession(id)).car, 'Old Car');
  });

  test('a driver with many sessions: right totals, and quick without reading the CSVs', async () => {
    const id = await makeUser();
    await q(
      `INSERT INTO racingcoach."CollectorLaps" (user_id, client_lap_id, track, track_key, car, driver, iracing_session_id, iracing_subsession_id,
         session_num, session_type, lap_number, lap_time_seconds, sample_count, missing_samples, incidents, pit_road, off_track,
         recorded_at, completed_at, expires_at, csv_bytes, csv_gzip)
       SELECT $1, gen_random_uuid(), 'Testville Park (Grand Prix)', 'testville gp', 'Car ' || (i % 7), 'x', 1000 + i / 30, 1000 + i / 30, 0, 'Race', i % 30,
         60, 3, 0, 0, false, false, now() - i * interval '10 seconds', now() - i * interval '10 seconds', now() + interval '1 day', 100, $2
       FROM generate_series(0, 14999) AS i`,
      [id, csvGzip]
    );
    const started = Date.now();
    const stats = await dashboard.readCareerStats(id);
    const elapsed = Date.now() - started;
    assert.equal(stats.laps, 15000);
    assert.equal(stats.sessions, 500);
    assert.equal(stats.cars, 7);
    assert.equal(stats.distanceFeet, 15000 * 10000);
    assert.ok(elapsed < 2000, `took ${elapsed} ms`);
  });

  test('the subscription comes from the row the account points at, and falls back on the account', async () => {
    const id = await makeUser();
    const paid = new Date(Date.now() + 10 * DAY).toISOString();
    await q(
      `UPDATE racingcoach."Users" SET account_status = 'Subscribed', subscription_end_date = $2, stripe_subscription_id = 'sub_gold', stripe_customer_id = 'cus_1' WHERE id = $1`,
      [id, paid]
    );
    let user = await users.getUserById(id);
    assert.deepEqual((await dashboard.readDashboard(user)).subscription, { state: 'active', date: paid, dateKind: 'renews' });

    const insert = (subscription, status, startDaysAgo, extra = '') =>
      q(
        `INSERT INTO racingcoach."StripeSubscriptions" (stripe_subscription_id, user_id, stripe_customer_id, livemode, plan, status, currency, start_date, current_period_end, cancel_at_period_end)
         VALUES ($1, $2, 'cus_1', false, 'gold_monthly', $3, 'usd', now() - $4 * interval '1 day', now() + interval '20 days', ${extra || 'false'})`,
        [subscription, id, status, startDaysAgo]
      );
    // The Silver one that's newer in the table's order is not the one the account points at
    await insert('sub_silver', 'active', 0, 'true');
    await insert('sub_gold', 'past_due', 5);
    user = await users.getUserById(id);
    assert.equal((await dashboard.readDashboard(user)).subscription.state, 'pastDue');
  });
});
