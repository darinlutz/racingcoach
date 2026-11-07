// Data subject rights database tests: npm run test:privacy-rights
//
// Runs the privacy request store, exports, erasures, Delete My Account, the job worker and the erasure ledger against
// a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-privacy-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55433:5432 postgres:16
//   PRIVACY_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55433/rctest npm run test:privacy-rights
// Skipped without PRIVACY_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any database
// that isn't on this computer. Object storage is left unconfigured, so exports are kept in Postgres.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { crc32, gzipSync, inflateRawSync } from 'node:zlib';
import pg from 'pg';

const url = process.env.PRIVACY_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'PRIVACY_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let users, laps, requests, exportsLib, erasure, jobs, db, retention, client;
const q = async (sql, params) => (await client.query(sql, params)).rows;

for (const name of Object.keys(process.env)) if (name.startsWith('BROADCAST_VIDEO_S3_')) delete process.env[name];
delete process.env.RESEND_API_KEY;

async function makeUser(level = 'Bronze') {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password, membership_level) VALUES ($1, $2, 'scrypt$aa$bb', $3) RETURNING id`,
    [`driver-${randomUUID().slice(0, 8)}`, `${randomUUID()}@example.test`, level]
  );
  return Number(row.id);
}

const csv = (marker) => `Speed,LapDistPct,Brake,Throttle,Marker\n10,0.1,0,1,${marker}\n20,0.5,0.5,0,${marker}\n`;

async function saveLap(userId, marker, daysAgo = 1) {
  const details = {
    clientLapId: randomUUID(),
    track: 'Test Track',
    car: 'Test Car',
    driver: `Driver ${marker}`,
    sessionId: 1,
    subSessionId: 1,
    sessionNum: 0,
    sessionType: 'Practice',
    lapNumber: 1,
    lapTimeSeconds: 90,
    samples: 2,
    missingSamples: 0,
    incidents: 0,
    pitRoad: false,
    offTrack: false,
    recordedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(),
  };
  const body = gzipSync(csv(marker));
  await laps.saveCollectorLap(userId, details, body, body.length, false);
  return details.clientLapId;
}

async function seed(userId, marker) {
  await saveLap(userId, marker);
  await q(
    `INSERT INTO racingcoach."DebriefSessions" (user_id, track, car, lap_count, best_lap_seconds, session, debrief, expires_at)
     VALUES ($1, 't', 'c', 1, 90, '{}', $2, now() + interval '10 days')`,
    [userId, JSON.stringify({ text: `debrief ${marker}` })]
  );
  await q(`INSERT INTO racingcoach."Friends" (id, user_id, name, country) VALUES ($1, $2, $3, 'US')`, [randomUUID(), userId, `friend ${marker}`]);
  await q(
    `INSERT INTO racingcoach."IRacePlanConnections" (user_id, api_key, iracing_customer_id, iracing_name) VALUES ($1, $2, 1, $3)`,
    [userId, `SECRET-KEY-${marker}`, `iracing ${marker}`]
  );
  await q(
    `INSERT INTO racingcoach."StripeSubscriptions" (stripe_subscription_id, user_id, stripe_customer_id, livemode, status, currency, start_date)
     VALUES ($1, $2, 'cus', false, 'active', 'usd', now())`,
    [`sub_${marker}_${randomUUID().slice(0, 6)}`, userId]
  );
}

function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let at = buffer.readUInt32LE(end + 16);
  const entries = new Map();
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(at + 10);
    const crc = buffer.readUInt32LE(at + 16);
    const compressed = buffer.readUInt32LE(at + 20);
    const nameLength = buffer.readUInt16LE(at + 28);
    const offset = buffer.readUInt32LE(at + 42);
    const name = buffer.subarray(at + 46, at + 46 + nameLength).toString('utf8');
    const localName = buffer.readUInt16LE(offset + 26);
    const data = buffer.subarray(offset + 30 + localName, offset + 30 + localName + compressed);
    const content = method === 8 ? inflateRawSync(data) : Buffer.from(data);
    assert.equal(crc32(content) >>> 0, crc, name);
    entries.set(name, content.toString('utf8'));
    at += 46 + nameLength;
  }
  return entries;
}

async function exportOf(userId, kind) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'rc-export-')), 'e.zip');
  await exportsLib.writeExportZip(userId, kind, file);
  return readZip(fs.readFileSync(file));
}

async function newRequest(userId, type, scope = {}) {
  return db.transaction((c) =>
    requests.createRequest(c, { userId, requesterName: 'n', requesterEmail: 'e@example.test', type, details: 'd', scope, verifiedBy: 'session' })
  );
}

describe('data subject rights in the database', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    laps = await import(new URL('collectorLaps.ts', src).href);
    requests = await import(new URL('privacyRequests.ts', src).href);
    exportsLib = await import(new URL('personalDataExport.ts', src).href);
    erasure = await import(new URL('dataErasure.ts', src).href);
    jobs = await import(new URL('privacyJobs.ts', src).href);
    db = await import(new URL('db.ts', src).href);
    retention = await import(new URL('activityRetention.ts', src).href);
    await users.ensureUserSchema();
  });

  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('the schema is additive and can run again', async () => {
    await q('SELECT reauthenticated_at FROM racingcoach."Sessions" LIMIT 0');
    for (const table of ['PrivacyRequests', 'PrivacyRequestEvents', 'PrivacyJobs', 'PrivacyExports', 'PrivacyVerifications', 'PrivacyReauthCodes', 'ErasureLedger']) {
      await q(`SELECT 1 FROM racingcoach."${table}" LIMIT 0`);
    }
  });

  test('an export holds only its own account’s data, never credentials, and skips expired laps', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await seed(a, 'AAA');
    await seed(b, 'BBB');
    const expired = await saveLap(a, 'OLD', 1);
    await q(`UPDATE racingcoach."CollectorLaps" SET expires_at = now() - interval '1 minute' WHERE client_lap_id = $1`, [expired]);

    const entries = await exportOf(a, 'access');
    const all = [...entries.values()].join('\n');
    assert.ok(all.includes('AAA'), 'own data');
    assert.ok(!all.includes('BBB'), 'another account’s data');
    assert.ok(!all.includes('SECRET-KEY'), 'iRacePlan API key');
    assert.ok(!all.includes('scrypt$'), 'password hash');
    assert.ok(!all.includes('OLD'), 'expired lap');
    assert.equal([...entries.keys()].filter((name) => name.startsWith('laps/files/')).length, 1);
    const profile = JSON.parse(entries.get('account/profile.json'));
    assert.equal(profile.id, a);
    assert.equal('password' in profile, false);
    assert.ok(entries.has('billing/subscriptions.csv') && entries.has('coaching/debrief_sessions.json'));
    const manifest = JSON.parse(entries.get('manifest.json'));
    assert.equal(manifest.kind, 'access');
    assert.ok(entries.get('README.txt').includes('Legal basis'));
  });

  test('a portability export leaves out billing, inferred analyses and legal records', async () => {
    const a = await makeUser();
    await seed(a, 'PORT');
    const entries = await exportOf(a, 'portability');
    assert.ok(entries.has('laps/laps.csv') && entries.has('account/profile.json') && entries.has('social/friends.csv'));
    for (const name of ['billing/subscriptions.csv', 'coaching/debrief_sessions.json', 'records/cookie_choices.csv', 'logs/ai_usage.csv']) {
      assert.ok(!entries.has(name), name);
    }
    assert.ok(JSON.parse(entries.get('manifest.json')).categoriesNotInThisExport.some((c) => c.category === 'billing'));
  });

  test('the export job stores the file for its owner only, completes the request, and expired files are deleted', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await seed(a, 'JOB');
    const request = await newRequest(a, 'access', { exportKind: 'access' });
    await db.transaction(async (c) => {
      await jobs.enqueueJob(c, request.id, 'export', { exportKind: 'access' });
      await jobs.enqueueJob(c, request.id, 'export', { exportKind: 'access' });
      await requests.transitionWith(c, request.id, { to: 'processing', actor: 'system' });
    });
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."PrivacyJobs" WHERE request_id = $1', [request.id]))[0].n, 1, 'queued once');
    await jobs.runDueJobs(10);
    const [row] = await q('SELECT status FROM racingcoach."PrivacyRequests" WHERE id = $1', [request.id]);
    assert.equal(row.status, 'completed');
    const [file] = await exportsLib.listExportsForUser(a);
    assert.ok(file, 'listed for its owner');
    assert.equal((await exportsLib.listExportsForUser(b)).length, 0);
    assert.equal(await exportsLib.openExportForUser(b, file.id), null, 'another account can’t download it');
    const opened = await exportsLib.openExportForUser(a, file.id);
    assert.ok(Buffer.isBuffer(opened.body) && opened.body.length === file.sizeBytes);
    await q(`UPDATE racingcoach."PrivacyExports" SET expires_at = now() - interval '1 second' WHERE id = $1`, [file.id]);
    assert.equal(await exportsLib.openExportForUser(a, file.id), null, 'expired');
    assert.ok((await exportsLib.expireExports()) >= 1);
    const [gone] = await q('SELECT content, deleted_at FROM racingcoach."PrivacyExports" WHERE id = $1', [file.id]);
    assert.equal(gone.content, null);
    assert.ok(gone.deleted_at);
  });

  test('selective erasure removes only the chosen categories of one account, leaves tombstones, and can run again', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await seed(a, 'ERA');
    await seed(b, 'KEEP');
    const visitor = randomUUID();
    // One browser used by both accounts, and by a's owner while signed out
    await q(
      `INSERT INTO racingcoach."ActivityLog" (occurred_at, user_id, visitor_id, session_id, event_type, path) VALUES
         (now(), $1, $3, $4, 'page_view', '/a'), (now(), NULL, $3, $4, 'page_view', '/anon'), (now(), $2, $3, $4, 'page_view', '/b')`,
      [a, b, visitor, randomUUID()]
    );
    const request = await newRequest(a, 'erasure', { categories: ['laps', 'friends', 'activityLog'] });
    const counts = await erasure.eraseCategories(a, ['laps', 'friends', 'activityLog'], request.id);
    assert.equal(counts.laps, 1);
    assert.equal(counts.activityLog, 2, 'own rows and the signed-out ones');
    const count = async (table, userId) => (await q(`SELECT count(*)::int AS n FROM racingcoach."${table}" WHERE user_id = $1`, [userId]))[0].n;
    assert.equal(await count('CollectorLaps', a), 0);
    assert.equal(await count('Friends', a), 0);
    assert.equal(await count('DebriefSessions', a), 1, 'not chosen');
    assert.equal(await count('ExpiredLaps', a), 1, 'tombstone');
    assert.equal(await count('CollectorLaps', b), 1);
    assert.equal(await count('Friends', b), 1);
    assert.equal(await count('ActivityLog', b), 1, 'another account’s row from the same browser stays');
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."ErasureLedger" WHERE request_id = $1', [request.id]))[0].n, 3);
    const again = await erasure.eraseCategories(a, ['laps', 'friends', 'activityLog'], request.id);
    assert.deepEqual(again, { laps: 0, friends: 0, activityLog: 0 });
  });

  test('a deleted lap can’t be uploaded again', async () => {
    const a = await makeUser();
    const id = await saveLap(a, 'TOMB');
    const request = await newRequest(a, 'erasure', { categories: ['laps'] });
    await erasure.eraseCategories(a, ['laps'], request.id);
    const details = (await q('SELECT 1')).length && {
      clientLapId: id, track: 'Test Track', car: 'Test Car', driver: 'x', sessionId: 1, subSessionId: 1, sessionNum: 0,
      sessionType: 'Practice', lapNumber: 1, lapTimeSeconds: 90, samples: 2, missingSamples: 0, incidents: 0,
      pitRoad: false, offTrack: false, recordedAt: new Date(Date.now() - 3600000).toISOString(),
    };
    const body = gzipSync(csv('TOMB'));
    await assert.rejects(laps.saveCollectorLap(a, details, body, body.length, false), (error) => error instanceof laps.LapExpiredError);
  });

  test('the erasure job completes automatic categories and leaves reviewed ones In Review', async () => {
    const a = await makeUser();
    await seed(a, 'MIX');
    const request = await newRequest(a, 'erasure', { categories: ['debriefs', 'aiUsage'] });
    await db.transaction(async (c) => {
      await jobs.enqueueJob(c, request.id, 'erasure', { categories: ['debriefs'] });
      await requests.transitionWith(c, request.id, { to: 'processing', actor: 'system' });
    });
    await jobs.runDueJobs(10);
    assert.equal((await q('SELECT status FROM racingcoach."PrivacyRequests" WHERE id = $1', [request.id]))[0].status, 'in_review');
    // An Admin approves the reviewed category
    await db.transaction(async (c) => {
      await jobs.enqueueJob(c, request.id, 'erasure', { categories: ['aiUsage'] });
      await requests.transitionWith(c, request.id, { to: 'processing', actor: 'admin', actorId: 1 });
    });
    await jobs.runDueJobs(10);
    assert.equal((await q('SELECT status FROM racingcoach."PrivacyRequests" WHERE id = $1', [request.id]))[0].status, 'completed');
  });

  test('a failing job is retried with backoff, then fails and puts its request In Review', async () => {
    const a = await makeUser();
    const request = await newRequest(a, 'erasure');
    await db.transaction((c) => requests.transitionWith(c, request.id, { to: 'processing', actor: 'system' }));
    // Without object storage, deleting a stored file throws
    const [{ id }] = await q(
      `INSERT INTO racingcoach."PrivacyJobs" (request_id, kind, payload, max_attempts) VALUES ($1, 'purgeObjects', '{"keys":["x"]}', 2) RETURNING id`,
      [request.id]
    );
    await jobs.runDueJobs(1);
    let [job] = await q('SELECT status, attempts, run_after > now() AS later FROM racingcoach."PrivacyJobs" WHERE id = $1', [id]);
    assert.equal(job.status, 'queued');
    assert.equal(job.attempts, 1);
    assert.ok(job.later, 'backed off');
    await q('UPDATE racingcoach."PrivacyJobs" SET run_after = now() WHERE id = $1', [id]);
    await jobs.runDueJobs(1);
    [job] = await q('SELECT status, attempts, last_error FROM racingcoach."PrivacyJobs" WHERE id = $1', [id]);
    assert.equal(job.status, 'failed');
    assert.ok(job.last_error);
    assert.equal((await q('SELECT status FROM racingcoach."PrivacyRequests" WHERE id = $1', [request.id]))[0].status, 'in_review');
    assert.ok(await jobs.retryJob(Number(id)));
    assert.equal((await q('SELECT status FROM racingcoach."PrivacyJobs" WHERE id = $1', [id]))[0].status, 'queued');
  });

  test('a job whose server stopped mid-run is claimed again once its lock lapses', async () => {
    const a = await makeUser();
    const request = await newRequest(a, 'access', { exportKind: 'access' });
    await db.transaction(async (c) => {
      await jobs.enqueueJob(c, request.id, 'export', { exportKind: 'access' });
      await requests.transitionWith(c, request.id, { to: 'processing', actor: 'system' });
    });
    await q(`UPDATE racingcoach."PrivacyJobs" SET status = 'running', attempts = 1, locked_until = now() - interval '1 second' WHERE request_id = $1`, [request.id]);
    await jobs.runDueJobs(5);
    assert.equal((await q('SELECT status FROM racingcoach."PrivacyJobs" WHERE request_id = $1', [request.id]))[0].status, 'succeeded');
  });

  test('statuses: refusing needs a reason, an extension is once, closing sets the purge date, history is kept', async () => {
    const a = await makeUser();
    const request = await newRequest(a, 'objection');
    await assert.rejects(requests.transitionRequest(request.id, { to: 'rejected', actor: 'admin', actorId: 1 }), { reason: 'reasonRequired' });
    const extended = await requests.transitionRequest(request.id, { to: 'extended', actor: 'admin', actorId: 1, resolution: 'Complex request' });
    assert.ok(extended.extendedDueAt > extended.dueAt);
    await requests.transitionRequest(request.id, { to: 'in_review', actor: 'admin', actorId: 1 });
    await assert.rejects(requests.transitionRequest(request.id, { to: 'extended', actor: 'admin', actorId: 1, resolution: 'again' }), { reason: 'cannotExtend' });
    await requests.transitionRequest(request.id, { to: 'completed', actor: 'admin', actorId: 1, resolution: 'Objection upheld', legalJustification: 'Art. 21(1)' });
    await assert.rejects(requests.transitionRequest(request.id, { to: 'in_review', actor: 'admin', actorId: 1 }), { reason: 'notAllowed' });
    const [row] = await q('SELECT purge_after, completed_at, closed_by FROM racingcoach."PrivacyRequests" WHERE id = $1', [request.id]);
    assert.ok(row.purge_after > row.completed_at);
    assert.equal(row.closed_by, 1);
    const own = await requests.getRequestForUser(a, request.id);
    assert.ok(own.events.every((e) => e.visibleToRequester));
    assert.equal(await requests.getRequestForUser(await makeUser(), request.id), null, 'another account can’t read it');
  });

  test('a request without an account is verified by its emailed link once, and an unknown link does nothing', async () => {
    const { id, token } = await db.transaction(async (c) => {
      const created = await requests.createRequest(c, {
        userId: null, requesterName: 'Former user', requesterEmail: 'former@example.test', type: 'erasure', details: 'please', verifiedBy: null,
      });
      return { id: created.id, token: await requests.createVerificationToken(c, created.id) };
    });
    assert.equal((await q('SELECT status FROM racingcoach."PrivacyRequests" WHERE id = $1', [id]))[0].status, 'pending_verification');
    assert.equal(await requests.verifyRequestByToken('x'.repeat(43)), null);
    const verified = await requests.verifyRequestByToken(token);
    assert.equal(verified.status, 'submitted');
    assert.equal(verified.verificationMethod, 'email');
    assert.equal(await requests.verifyRequestByToken(token), null, 'single use');
  });

  test('Delete My Account deletes the account and what’s tied to it, keeps billing unlinked, records it, and leaves others alone', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await seed(a, 'DEL');
    await seed(b, 'STAY');
    const earlier = await newRequest(a, 'objection');
    const visitor = randomUUID();
    await q(
      `INSERT INTO racingcoach."ActivityLog" (occurred_at, user_id, visitor_id, session_id, event_type, path, label, ip_address, user_agent, referrer, language)
       VALUES (now(), $1, $3, $4, 'click', '/del-account', 'My friend Bob', '203.0.113.9', 'Mozilla/5.0', 'https://example.test/me', 'en'),
              (now(), NULL, $3, $4, 'page_view', '/del-pricing', NULL, '203.0.113.9', 'Mozilla/5.0', NULL, 'en'),
              (now(), $2, $3, $4, 'page_view', '/del-b', NULL, '198.51.100.7', 'Mozilla/5.0', NULL, 'en')`,
      [a, b, visitor, randomUUID()]
    );
    const user = await users.getUserById(a);
    const done = await erasure.deleteAccount(user);
    assert.equal(done.status, 'completed');
    assert.ok(done.retained.length > 0);
    assert.equal(await users.getUserById(a), null);
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."CollectorLaps" WHERE user_id = $1', [a]))[0].n, 0);
    const [billing] = await q('SELECT user_id, deleted_user_id FROM racingcoach."StripeSubscriptions" WHERE deleted_user_id = $1', [a]);
    assert.equal(billing.user_id, null);
    const kept = await q('SELECT user_id, deleted_user_id, requester_email FROM racingcoach."PrivacyRequests" WHERE id = ANY($1)', [[earlier.id, done.id]]);
    for (const row of kept) {
      assert.equal(row.user_id, null);
      assert.equal(row.deleted_user_id, a);
      assert.equal(row.requester_email, null);
    }
    assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."ErasureLedger" WHERE user_id = $1 AND category = 'account'`, [a]))[0].n, 1);
    const anonymized = await q(`SELECT * FROM racingcoach."ActivityLog" WHERE path IN ('/del-account', '/del-pricing')`);
    assert.equal(anonymized.length, 2, 'activity rows are kept, anonymized');
    for (const row of anonymized) {
      assert.equal(row.user_id, null);
      assert.notEqual(row.visitor_id, visitor, 'no longer tied to the browser');
      for (const column of ['ip_address', 'user_agent', 'referrer', 'label', 'language', 'target_href']) assert.equal(row[column], null, column);
    }
    const [other] = await q(`SELECT user_id, visitor_id, ip_address FROM racingcoach."ActivityLog" WHERE path = '/del-b'`);
    assert.equal(other.user_id, b);
    assert.equal(other.visitor_id, visitor, 'another account’s row from the same browser is untouched');
    assert.equal(other.ip_address, '198.51.100.7');
    assert.ok(await users.getUserById(b));
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."CollectorLaps" WHERE user_id = $1', [b]))[0].n, 1);
  });

  test('erasures are made again on a restored copy, but never to a different account that reuses the ID', async () => {
    const a = await makeUser();
    await seed(a, 'RESTORE');
    const [{ created_at: createdAt, email_address: email }] = await q('SELECT created_at, email_address FROM racingcoach."Users" WHERE id = $1', [a]);
    const eraseRequest = await newRequest(a, 'erasure', { categories: ['friends'] });
    await erasure.eraseCategories(a, ['friends'], eraseRequest.id);
    await erasure.deleteAccount(await users.getUserById(a));
    // A backup from before brings the account and its friend back
    await q(`INSERT INTO racingcoach."Users" (id, user_name, email_address, password, created_at) VALUES ($1, 'restored', $2, 'x', $3)`, [a, email, createdAt]);
    await q(`INSERT INTO racingcoach."Friends" (id, user_id, name, country, created_at) VALUES ($1, $2, 'old friend', 'US', $3)`, [randomUUID(), a, createdAt]);
    // A different account that got the same ID later
    const other = await makeUser();
    await q('UPDATE racingcoach."Users" SET created_at = now() + interval \'1 day\' WHERE id = $1', [other]);
    await q(`INSERT INTO racingcoach."ErasureLedger" (id, user_id, account_created_at, category) VALUES ($1, $2, '2000-01-01', 'account')`, [randomUUID(), other]);
    await erasure.reapplyErasures();
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."Users" WHERE id = $1', [a]))[0].n, 0, 'restored account deleted again');
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."Users" WHERE id = $1', [other]))[0].n, 1, 'a different account stays');
  });

  test('lap retention still works alongside: a level change re-stamps laps and expired laps stay hidden', async () => {
    const a = await makeUser('Bronze');
    await saveLap(a, 'RET', 1);
    const [before] = await q('SELECT expires_at - completed_at AS kept FROM racingcoach."CollectorLaps" WHERE user_id = $1', [a]);
    await q(`UPDATE racingcoach."Users" SET membership_level = 'Gold' WHERE id = $1`, [a]);
    const [after] = await q('SELECT expires_at - completed_at AS kept FROM racingcoach."CollectorLaps" WHERE user_id = $1', [a]);
    assert.equal(before.kept.days, 30);
    assert.equal(after.kept.days, 90);
  });

  test('IP addresses and browser details go after 13 months; the rest of the row stays', async () => {
    const a = await makeUser();
    const visitor = randomUUID();
    await q(
      `INSERT INTO racingcoach."ActivityLog" (occurred_at, user_id, visitor_id, session_id, event_type, path, ip_address, user_agent, viewport_width, viewport_height, language)
       VALUES (now() - interval '14 months', $1, $2, $3, 'page_view', '/old', '203.0.113.1', 'UA', 1920, 1080, 'en'),
              (now() - interval '12 months', $1, $2, $3, 'page_view', '/recent', '203.0.113.2', 'UA', 1920, 1080, 'en')`,
      [a, visitor, randomUUID()]
    );
    await q(
      `INSERT INTO racingcoach."AiUsage" (occurred_at, user_id, ip_address, feature, tier, weight, allowed)
       VALUES (now() - interval '14 months', $1, '203.0.113.3', 'debriefCoach', 'Bronze', 1, true),
              (now() - interval '1 day', $1, '203.0.113.4', 'debriefCoach', 'Bronze', 1, true)`,
      [a]
    );
    assert.ok((await db.withClient(retention.purgeNetworkDetails)) >= 2);
    const [old] = await q(`SELECT * FROM racingcoach."ActivityLog" WHERE path = '/old'`);
    for (const column of ['ip_address', 'user_agent', 'viewport_width', 'viewport_height', 'language']) assert.equal(old[column], null, column);
    assert.equal(old.user_id, a, 'the row itself stays');
    const [recent] = await q(`SELECT ip_address FROM racingcoach."ActivityLog" WHERE path = '/recent'`);
    assert.equal(recent.ip_address, '203.0.113.2');
    const usage = await q('SELECT ip_address FROM racingcoach."AiUsage" WHERE user_id = $1 ORDER BY occurred_at', [a]);
    assert.deepEqual(usage.map((row) => row.ip_address), [null, '203.0.113.4']);
    assert.equal(await db.withClient(retention.purgeNetworkDetails), 0, 'nothing left to clear');
  });

  test('only the owner’s own accounts keep the owner’s iRacePlan connection', async () => {
    const policies = { terms: 'x', privacy: 'y' };
    const make = (emailAddress) =>
      users.createUser({ userName: 'n', emailAddress, password: null, preferredLanguage: 'en', country: null, promoCode: null, acceptedPolicies: policies });
    const owner = await make('DarinLutz@Yahoo.com');
    await q(
      `INSERT INTO racingcoach."IRacePlanConnections" (user_id, api_key, iracing_customer_id, iracing_name) VALUES ($1, 'OWNER-KEY', 4242, 'Owner')`,
      [owner.id]
    );
    const second = await make('darinlutz648@gmail.com');
    const newcomer = await make(`${randomUUID()}@example.test`);
    const connection = async (id) =>
      (await q('SELECT api_key FROM racingcoach."IRacePlanConnections" WHERE user_id = $1', [id]))[0]?.api_key ?? null;
    // Only once the address is confirmed: anyone can sign up with an address they don't own
    assert.equal(await connection(second.id), null, 'not before the address is confirmed');
    await users.markEmailVerified(second.id);
    await users.markEmailVerified(newcomer.id);
    assert.equal(await connection(second.id), 'OWNER-KEY', 'the owner’s other account gets it once confirmed');
    assert.equal(await connection(newcomer.id), null, 'nobody else does');

    // Copies made before the change, one with its synced races, and someone with their own key
    const copied = await makeUser();
    const ownKey = await makeUser();
    await q(
      `INSERT INTO racingcoach."IRacePlanConnections" (user_id, api_key, iracing_customer_id, iracing_name)
       VALUES ($1, 'OWNER-KEY', 4242, 'Owner'), ($2, 'THEIR-KEY', 77, 'Someone Else')`,
      [copied, ownKey]
    );
    await q(
      `INSERT INTO racingcoach."RaceResults" (user_id, iraceplan_planning_id, start_time, series, track, car, source, subsession_id, session_num)
       VALUES ($1, 1, now(), 's', 't', 'c', 'iraceplan', NULL, NULL), ($1, NULL, now(), 's', 't', 'c', 'collector', 99, 0),
              ($2, 2, now(), 's', 't', 'c', 'iraceplan', NULL, NULL)`,
      [copied, ownKey]
    );
    assert.deepEqual(await users.removeSharedIRacePlanConnections(client), { connections: 1, races: 1 });
    assert.equal(await connection(copied), null);
    assert.equal(await connection(ownKey), 'THEIR-KEY');
    assert.equal(await connection(owner.id), 'OWNER-KEY');
    assert.equal(await connection(second.id), 'OWNER-KEY');
    const races = await q('SELECT user_id, source FROM racingcoach."RaceResults" WHERE user_id = ANY($1) ORDER BY user_id, source', [[copied, ownKey]]);
    assert.deepEqual(races.map((r) => [r.user_id, r.source]), [[copied, 'collector'], [ownKey, 'iraceplan']]);
    assert.deepEqual(await users.removeSharedIRacePlanConnections(client), { connections: 0, races: 0 }, 'runs again harmlessly');
  });
});
