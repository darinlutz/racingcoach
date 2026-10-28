// Lap retention database tests: npm run test:lap-retention
//
// Runs the site's own modules (ensureUserSchema, saveCollectorLap, the lap readers, setMembershipLevel, getUserById,
// saveDebrief and the cleanup job) against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-retention-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:16
//   LAP_RETENTION_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:lap-retention
// Skipped without LAP_RETENTION_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer. Lap ages are relative to the database's now(); the exact boundaries are in
// scripts/lap-retention.test.mjs, and the parity tests check the SQL against them with fixed UTC timestamps.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import { gzipSync } from 'node:zlib';
import pg from 'pg';

const url = process.env.LAP_RETENTION_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'LAP_RETENTION_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

const DAY = 24 * 60 * 60 * 1000;
let users, laps, debriefs, job, rules, db;
let client;

const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeUser(level, extra = {}) {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level, role, account_status, subscription_end_date)
     VALUES ($1, $2, 'x', $3, $4, $5, $6) RETURNING id`,
    [
      `driver-${randomUUID().slice(0, 8)}`,
      `${randomUUID()}@example.test`,
      level,
      extra.role ?? 'User',
      extra.accountStatus ?? 'Unsubscribed',
      extra.subscriptionEndDate ?? null,
    ]
  );
  return Number(row.id);
}

const csvGzip = gzipSync('Speed,LapDistPct,Brake,Throttle\n10,0.1,0,1\n20,0.5,0.5,0\n30,0.9,0,1\n');
const lapDetails = (daysAgo, overrides = {}) => ({
  clientLapId: randomUUID(),
  track: 'Test Track',
  car: 'Test Car',
  driver: 'Test Driver',
  sessionId: 1,
  subSessionId: 1,
  sessionNum: 0,
  sessionType: 'Practice',
  lapNumber: 1,
  lapTimeSeconds: 90,
  samples: 3,
  missingSamples: 0,
  incidents: 0,
  pitRoad: false,
  offTrack: false,
  recordedAt: new Date(Date.now() - daysAgo * DAY).toISOString(),
  ...overrides,
});

async function saveLap(userId, daysAgo, overrides) {
  const details = lapDetails(daysAgo, overrides);
  const result = await laps.saveCollectorLap(userId, details, csvGzip, 100, false);
  return { ...result, details };
}

// Deletes what earlier tests left expired, so a test can count exactly what its own run deletes
const cleanUp = () => db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false }));

const lapRow = async (id) =>
  (await q('SELECT completed_at, expires_at, expires_at > now() AS live FROM racingcoach."CollectorLaps" WHERE id = $1', [id]))[0];

// The days between a lap's completion and its expiry, rounded to the minute
const keptDays = (row) => Math.round((row.expires_at - row.completed_at) / 60000) / (24 * 60);

describe('lap retention in the database', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    laps = await import(new URL('collectorLaps.ts', src).href);
    debriefs = await import(new URL('debriefHistory.ts', src).href);
    job = await import(new URL('lapRetentionDb.ts', src).href);
    rules = await import(new URL('lapRetentionRules.ts', src).href);
    db = await import(new URL('db.ts', src).href);
    await users.ensureUserSchema();
  });

  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('SQL expiry matches lapRetentionRules.ts at fixed UTC instants, unknown levels included', async () => {
    const completed = new Date('2026-03-01T06:00:00.000Z');
    for (const level of ['Bronze', 'Silver', 'Gold', 'Platinum', null]) {
      const [row] = await q('SELECT racingcoach.lap_expires_at($1, $2) AS at', [completed, level]);
      assert.equal(row.at.toISOString(), rules.lapExpiresAt(completed, level).toISOString(), String(level));
    }
  });

  test('SQL re-stamping matches restampExpiresAt for upgrades, downgrades and the Gold grace period', async () => {
    const completed = new Date('2026-01-10T12:00:00.000Z');
    const at = (days) => new Date(completed.getTime() + days * DAY);
    const cases = [
      ['Bronze', 'Silver', at(30), at(20), null],
      ['Silver', 'Gold', at(60), at(59), null],
      ['Gold', 'Bronze', at(90), at(45), null],
      ['Gold', 'Silver', at(90), at(50), null],
      ['Gold', 'Bronze', at(90), at(40), at(47)],
      ['Gold', 'Bronze', at(90), at(88), at(95)],
      ['Gold', 'Bronze', at(90), at(1), at(8)],
      ['Bronze', 'Gold', at(47), at(42), null],
    ];
    for (const [previousLevel, level, expiresAt, now, graceUntil] of cases) {
      const expected = rules.restampExpiresAt({ completedAt: completed, expiresAt, previousLevel, level, now, graceUntil });
      const [row] = await q(
        `SELECT racingcoach.lap_restamp($1, $2, racingcoach.lap_level_rank($4) > racingcoach.lap_level_rank($3), $4, $5) AS at`,
        [completed, expiresAt, previousLevel, level, graceUntil]
      );
      assert.equal(row.at.toISOString(), expected.toISOString(), `${previousLevel} to ${level}`);
    }
  });

  test('migration: existing laps get their completion time and expiry; a PC clock ahead of the upload uses the upload time', async () => {
    const gold = await makeUser('Gold');
    const bronze = await makeUser('Bronze');
    // A database from before retention: no completion times or expiries yet
    await client.query('ALTER TABLE racingcoach."CollectorLaps" ALTER COLUMN completed_at DROP NOT NULL, ALTER COLUMN expires_at DROP NOT NULL');
    const insert = (userId, recordedAt, uploadedAt) =>
      q(
        `INSERT INTO racingcoach."CollectorLaps" (user_id, client_lap_id, track, car, driver, iracing_session_id,
           iracing_subsession_id, session_num, session_type, lap_number, lap_time_seconds, sample_count, missing_samples,
           incidents, pit_road, off_track, recorded_at, uploaded_at, csv_bytes, csv_gzip)
         VALUES ($1, $2, 't', 'c', 'd', 0, 0, 0, 'Practice', 1, 90, 3, 0, 0, false, false, $3, $4, 100, $5) RETURNING id`,
        [userId, randomUUID(), recordedAt, uploadedAt, csvGzip]
      );
    const [ok] = await insert(gold, new Date(Date.now() - 10 * DAY), new Date(Date.now() - 9 * DAY));
    const [ahead] = await insert(bronze, new Date(Date.now() + 5 * DAY), new Date(Date.now() - 2 * DAY));
    const [old] = await insert(bronze, new Date(Date.now() - 40 * DAY), new Date(Date.now() - 39 * DAY));
    for (const statement of job.LAP_RETENTION_SCHEMA) await client.query(statement);

    const [okRow, aheadRow, oldRow] = [await lapRow(ok.id), await lapRow(ahead.id), await lapRow(old.id)];
    assert.equal(keptDays(okRow), 90);
    assert.ok(Math.abs(aheadRow.completed_at - (Date.now() - 2 * DAY)) < 60_000, 'the upload time, not the future clock');
    assert.equal(keptDays(aheadRow), 30);
    assert.equal(oldRow.live, false, 'a Bronze lap 40 days old is expired at once');
    const [{ nulls }] = await q(
      'SELECT count(*)::int AS nulls FROM racingcoach."CollectorLaps" WHERE completed_at IS NULL OR expires_at IS NULL'
    );
    assert.equal(nulls, 0);
  });

  test('missing or invalid lap completion timestamps are refused before anything is stored', () => {
    const { recordedAt, ...missing } = lapDetails(0);
    void recordedAt;
    assert.equal(laps.collectorLapSchema.safeParse(missing).success, false);
    assert.equal(laps.collectorLapSchema.safeParse(lapDetails(0, { recordedAt: 'yesterday' })).success, false);
    assert.equal(laps.collectorLapSchema.safeParse(lapDetails(0, { recordedAt: '2026-13-45T99:00:00Z' })).success, false);
  });

  test('a lap is kept 30, 60 or 90 days from completion by level', async () => {
    for (const [level, days] of [
      ['Bronze', 30],
      ['Silver', 60],
      ['Gold', 90],
    ]) {
      const user = await makeUser(level);
      const { id } = await saveLap(user, 0);
      assert.equal(keptDays(await lapRow(id)), days, level);
    }
  });

  test('Bronze lap at 29 days is retained and at 30 days is refused; likewise Silver at 59/60 and Gold at 89/90', async () => {
    for (const [level, days] of [
      ['Bronze', 30],
      ['Silver', 60],
      ['Gold', 90],
    ]) {
      const user = await makeUser(level);
      const { id } = await saveLap(user, days - 1);
      assert.equal((await lapRow(id)).live, true, `${level} at ${days - 1} days`);
      await assert.rejects(saveLap(user, days), laps.LapExpiredError, `${level} at ${days} days`);
    }
  });

  test('a duplicate collector upload keeps the first completion time and expiry', async () => {
    const user = await makeUser('Silver');
    const first = await saveLap(user, 5);
    const before = await lapRow(first.id);
    const again = await laps.saveCollectorLap(user, { ...first.details, recordedAt: new Date().toISOString() }, csvGzip, 100, true);
    assert.equal(again.duplicate, true);
    const afterward = await lapRow(first.id);
    assert.equal(afterward.completed_at.toISOString(), before.completed_at.toISOString());
    assert.equal(afterward.expires_at.toISOString(), before.expires_at.toISOString());
  });

  test('cross-user: a User never reads another User\'s lap; a Coach\'s laps are visible; a Coach reads everyone\'s', async () => {
    const alice = await makeUser('Gold');
    const bob = await makeUser('Gold');
    const coach = await makeUser('Gold', { role: 'Coach' });
    const { id } = await saveLap(alice, 1);
    const coachLap = await saveLap(coach, 1);
    const asBob = { id: bob, role: 'User' };
    assert.equal(await laps.readCollectorLapCsv(asBob, id), null);
    assert.deepEqual(await laps.readCollectorLapsById(asBob, [id]), []);
    assert.equal((await laps.listCollectorLaps(asBob, [alice])).length, 0);
    assert.deepEqual(await laps.readCollectorLapsByClientId(bob, [(await saveLap(alice, 1)).details.clientLapId]), []);
    assert.notEqual(await laps.readCollectorLapCsv(asBob, coachLap.id), null);
    assert.notEqual(await laps.readCollectorLapCsv({ id: coach, role: 'Coach' }, id), null);
  });

  test('an expired lap is unavailable through every read, before the cleanup job deletes it', async () => {
    const user = await makeUser('Gold');
    const { id, details } = await saveLap(user, 50);
    const viewer = { id: user, role: 'User' };
    assert.notEqual(await laps.readCollectorLapCsv(viewer, id), null);
    await users.setMembershipLevel(user, 'Bronze');
    assert.equal(await laps.readCollectorLapCsv(viewer, id), null);
    assert.deepEqual(await laps.readCollectorLapsById(viewer, [id]), []);
    assert.deepEqual(await laps.readCollectorLapsByClientId(user, [details.clientLapId]), []);
    assert.equal((await laps.listCollectorLaps(viewer, [user])).some((lap) => lap.id === id), false);
    assert.equal((await laps.readCollectorLapCsv({ id: 1, role: 'Admin' }, id)), null, 'not even for an Admin');
    assert.equal((await laps.listLapOwners({ id: 1, role: 'Admin' })).find((o) => o.userId === user)?.lapCount ?? 0, 0);
  });

  test('upgrade Bronze to Silver, then Silver to Gold, lengthens unexpired laps', async () => {
    const user = await makeUser('Bronze');
    const { id } = await saveLap(user, 20);
    assert.equal(keptDays(await lapRow(id)), 30);
    await users.setMembershipLevel(user, 'Silver');
    assert.equal(keptDays(await lapRow(id)), 60);
    await users.setMembershipLevel(user, 'Gold');
    assert.equal(keptDays(await lapRow(id)), 90);
  });

  test('downgrade Gold to Bronze: laps older than 30 days are unavailable at once; newer ones get 30 days', async () => {
    const user = await makeUser('Gold');
    const old = await saveLap(user, 45);
    const recent = await saveLap(user, 10);
    await users.setMembershipLevel(user, 'Bronze');
    assert.equal((await lapRow(old.id)).live, false);
    assert.equal(keptDays(await lapRow(recent.id)), 30);
  });

  test('downgrade Gold to Silver: laps older than 60 days are unavailable at once; newer ones get 60 days', async () => {
    const user = await makeUser('Gold');
    const old = await saveLap(user, 70);
    const recent = await saveLap(user, 50);
    await users.setMembershipLevel(user, 'Silver');
    assert.equal((await lapRow(old.id)).live, false);
    assert.equal(keptDays(await lapRow(recent.id)), 60);
  });

  test('an expired lap is never restored by upgrading again', async () => {
    const user = await makeUser('Gold');
    const { id } = await saveLap(user, 45);
    await users.setMembershipLevel(user, 'Bronze');
    await users.setMembershipLevel(user, 'Gold');
    assert.equal((await lapRow(id)).live, false);
  });

  test('cancellation: a canceled Gold membership keeps Gold until the paid period ends, then 7 days\' grace', async () => {
    const endedTwoDaysAgo = new Date(Date.now() - 2 * DAY).toISOString();
    const user = await makeUser('Gold', { accountStatus: 'Canceled', subscriptionEndDate: endedTwoDaysAgo });
    const old = await saveLap(user, 45);
    const veryOld = await saveLap(user, 88);
    // Loading the user ends the membership (back to Bronze)
    const loaded = await users.getUserById(user);
    assert.equal(loaded.membershipLevel, 'Bronze');
    assert.equal(loaded.accountStatus, 'Canceled');
    const oldRow = await lapRow(old.id);
    assert.equal(oldRow.live, true, 'kept in the grace period');
    assert.ok(Math.abs(oldRow.expires_at - (Date.parse(endedTwoDaysAgo) + 7 * DAY)) < 1000, 'until 7 days after the period');
    assert.equal(keptDays(await lapRow(veryOld.id)), 90, 'never past 90 days');
  });

  test('cancellation before the period ends changes nothing until it ends', async () => {
    const user = await makeUser('Gold', {
      accountStatus: 'Canceled',
      subscriptionEndDate: new Date(Date.now() + 5 * DAY).toISOString(),
    });
    const { id } = await saveLap(user, 45);
    assert.equal((await users.getUserById(user)).membershipLevel, 'Gold');
    assert.equal(keptDays(await lapRow(id)), 90);
  });

  test('subscription expiration (failed renewal) of Silver: the hourly job ends it and laps drop to Bronze, no grace', async () => {
    const user = await makeUser('Silver', {
      accountStatus: 'Subscribed',
      subscriptionEndDate: new Date(Date.now() - DAY).toISOString(),
    });
    const old = await saveLap(user, 35);
    const recent = await saveLap(user, 5);
    await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: true }));
    const [row] = await q('SELECT membership_level, account_status FROM racingcoach."Users" WHERE id = $1', [user]);
    assert.deepEqual(row, { membership_level: 'Bronze', account_status: 'Expired' });
    assert.equal((await lapRow(old.id)).live, false);
    assert.equal(keptDays(await lapRow(recent.id)), 30);
  });

  test('saved Debrief Coach runs expire like laps and follow level changes', async () => {
    const user = await makeUser('Silver');
    await debriefs.saveDebrief(user, { track: 't', car: 'c', laps: [{ lapTime: 90 }] }, { headline: 'h' });
    const days = async () =>
      (await q('SELECT round(extract(epoch FROM expires_at - created_at) / 86400) AS d FROM racingcoach."DebriefSessions" WHERE user_id = $1', [user]))[0].d;
    assert.equal(Number(await days()), 60);
    await users.setMembershipLevel(user, 'Bronze');
    assert.equal(Number(await days()), 30);
  });

  test('dry run counts expired laps without deleting; delete mode deletes them and leaves tombstones', async () => {
    const user = await makeUser('Gold');
    const kept = await saveLap(user, 5);
    const doomed = await Promise.all([40, 41, 42].map((days) => saveLap(user, days)));
    await users.setMembershipLevel(user, 'Bronze');

    const dry = await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: true }));
    assert.ok(dry.lapsDue >= 3);
    assert.equal(dry.lapsDeleted, 0);
    assert.ok(await lapRow(doomed[0].id), 'still stored after a dry run');

    const real = await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false, batchSize: 2 }));
    assert.equal(real.lapsDeleted, real.lapsDue);
    for (const { id } of doomed) assert.equal(await lapRow(id), undefined);
    assert.ok(await lapRow(kept.id));
    const tombstones = await q('SELECT client_lap_id FROM racingcoach."ExpiredLaps" WHERE user_id = $1', [user]);
    assert.deepEqual(new Set(tombstones.map((t) => t.client_lap_id)), new Set(doomed.map((d) => d.details.clientLapId)));
    const [{ count }] = await q('SELECT count(*)::int AS count FROM racingcoach."CollectorLaps" WHERE expires_at <= now()');
    assert.equal(count, 0);
  });

  test('a deleted lap re-uploaded after an upgrade is refused (tombstone); an upload never restores it', async () => {
    const user = await makeUser('Gold');
    const { details } = await saveLap(user, 45);
    await users.setMembershipLevel(user, 'Bronze');
    await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false }));
    await users.setMembershipLevel(user, 'Gold');
    await assert.rejects(laps.saveCollectorLap(user, details, csvGzip, 100, true), laps.LapExpiredError);
  });

  test('a re-upload of a lap that expired but is not deleted yet is refused, not reported as stored', async () => {
    const user = await makeUser('Gold');
    const { details } = await saveLap(user, 45);
    await users.setMembershipLevel(user, 'Bronze');
    await assert.rejects(laps.saveCollectorLap(user, details, csvGzip, 100, false), laps.LapExpiredError);
    await assert.rejects(laps.saveCollectorLap(user, details, csvGzip, 100, true), laps.LapExpiredError);
  });

  test('cleanup interrupted part way: the run records its error, and the next run finishes the job', async () => {
    await cleanUp();
    const user = await makeUser('Gold');
    const doomed = await Promise.all([40, 41, 42, 43, 44].map((days) => saveLap(user, days)));
    await users.setMembershipLevel(user, 'Bronze');
    let batches = 0;
    await assert.rejects(
      db.withClient((c) =>
        job.runLapRetentionJob(
          {
            query: (sql, params) => {
              if (sql.includes('DELETE FROM racingcoach."CollectorLaps"') && ++batches === 2) {
                return Promise.reject(new Error('connection lost'));
              }
              return c.query(sql, params);
            },
          },
          { dryRun: false, batchSize: 2 }
        )
      ),
      /connection lost/
    );
    const [failed] = await q('SELECT error, finished_at FROM racingcoach."LapRetentionRuns" ORDER BY id DESC LIMIT 1');
    assert.equal(failed.error, 'connection lost');
    const left = (await Promise.all(doomed.map(({ id }) => lapRow(id)))).filter(Boolean).length;
    assert.equal(left, 3, 'the first batch was deleted, the rest kept');

    const retry = await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false, batchSize: 2 }));
    assert.equal(retry.lapsDeleted, 3);
    for (const { id } of doomed) assert.equal(await lapRow(id), undefined);
    const [{ count }] = await q('SELECT count(*)::int AS count FROM racingcoach."ExpiredLaps" WHERE user_id = $1', [user]);
    assert.equal(count, 5, 'every deleted lap has a tombstone');
  });

  test('concurrent cleanup: a run while another holds the lock does nothing; parallel runs never delete twice', async () => {
    const holder = new pg.Client({ connectionString: url });
    await holder.connect();
    try {
      await holder.query("SELECT pg_advisory_lock(hashtext('racingcoach_lap_retention'))");
      assert.equal(await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false })), null);
      await holder.query("SELECT pg_advisory_unlock(hashtext('racingcoach_lap_retention'))");
    } finally {
      await holder.end();
    }

    await cleanUp();
    const user = await makeUser('Gold');
    await Promise.all([40, 41, 42, 43].map((days) => saveLap(user, days)));
    await users.setMembershipLevel(user, 'Bronze');
    const runs = await Promise.all(
      [1, 2, 3].map(() => db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false, batchSize: 1 })))
    );
    const deleted = runs.filter(Boolean).reduce((sum, run) => sum + run.lapsDeleted, 0);
    assert.equal(deleted, 4);
    const [{ count }] = await q('SELECT count(*)::int AS count FROM racingcoach."ExpiredLaps" WHERE user_id = $1', [user]);
    assert.equal(count, 4);
  });

  test('backup restoration: laps whose expiry passed since the backup are unavailable at once and deleted by the next run', async () => {
    const user = await makeUser('Bronze');
    const { id, details } = await saveLap(user, 20);
    // A backup taken while the lap was live (expiring in 10 days)...
    const [snapshot] = await q('SELECT * FROM racingcoach."CollectorLaps" WHERE id = $1', [id]);
    // ...restored 11 days later: the lap, as in the backup, expired a day ago. The restore also brings back the
    // tombstone table as it was, without this lap.
    await q('DELETE FROM racingcoach."CollectorLaps" WHERE id = $1', [id]);
    const restored = { ...snapshot, completed_at: new Date(snapshot.completed_at - 11 * DAY), expires_at: new Date(snapshot.expires_at - 11 * DAY) };
    const columns = Object.keys(restored);
    const insertRestored = (row) =>
      q(
        `INSERT INTO racingcoach."CollectorLaps" (${columns.join(', ')}) VALUES (${columns.map((_, i) => `$${i + 1}`).join(', ')})`,
        columns.map((column) => row[column])
      );
    await insertRestored(restored);
    const viewer = { id: user, role: 'User' };
    assert.equal(await laps.readCollectorLapCsv(viewer, id), null, 'unavailable right after the restore');
    await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false }));
    assert.equal(await lapRow(id), undefined, 'deleted by the next run');
    await assert.rejects(laps.saveCollectorLap(user, details, csvGzip, 100, false), laps.LapExpiredError);

    // A restored or hand-edited row past the 90-day ceiling is clamped back to it by the next run
    const tampered = { ...snapshot, id: id + 100_000, client_lap_id: randomUUID(), completed_at: new Date(Date.now() - 95 * DAY), expires_at: new Date(Date.now() + 30 * DAY) };
    await insertRestored(tampered);
    await db.withClient((c) => job.runLapRetentionJob(c, { dryRun: false }));
    assert.equal(await lapRow(tampered.id), undefined, 'clamped to 90 days, so expired and deleted');
  });
});
