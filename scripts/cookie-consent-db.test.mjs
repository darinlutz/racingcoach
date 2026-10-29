// Cookie consent records database tests: npm run test:cookie-consent
//
// Runs src/lib/cookieConsentRecords.ts and ensureUserSchema against a disposable local Postgres, e.g.
//   docker run -d --rm --name rc-consent-test -e POSTGRES_PASSWORD=test -e POSTGRES_DB=rctest -p 127.0.0.1:55432:5432 postgres:16
//   COOKIE_CONSENT_TEST_DATABASE_URL=postgres://postgres:test@127.0.0.1:55432/rctest npm run test:cookie-consent
// Skipped without COOKIE_CONSENT_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import pg from 'pg';

const url = process.env.COOKIE_CONSENT_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'COOKIE_CONSENT_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let users, records, client;
const q = async (sql, params) => (await client.query(sql, params)).rows;

async function makeUser() {
  const [row] = await q(
    `INSERT INTO racingcoach."Users" (user_name, email_address, password) VALUES ($1, $2, 'x') RETURNING id`,
    [`driver-${randomUUID().slice(0, 8)}`, `${randomUUID()}@example.test`]
  );
  return Number(row.id);
}

const record = (overrides = {}) => ({
  id: randomUUID(),
  browserId: randomUUID(),
  userId: null,
  action: 'accepted',
  choices: { analytics: true },
  cookiePolicyVersion: '2026-10-29',
  bannerVersion: '2026-10-29',
  purposesVersion: 1,
  language: 'en',
  region: 'EEA',
  country: 'DE',
  method: 'banner',
  ...overrides,
});

describe('cookie consent records in the database', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    records = await import(new URL('cookieConsentRecords.ts', src).href);
    await users.ensureUserSchema();
  });

  after(async () => {
    await client?.end();
    await globalThis.pgPool?.end();
  });

  test('a choice is stored with what was shown, and no IP address or user agent column exists', async () => {
    const r = record();
    await records.recordCookieConsent(r);
    const [row] = await q('SELECT * FROM racingcoach."CookieConsents" WHERE id = $1', [r.id]);
    assert.equal(row.browser_id, r.browserId);
    assert.equal(row.action, 'accepted');
    assert.deepEqual(row.categories, { necessary: true, analytics: true });
    assert.equal(row.cookie_policy_version, '2026-10-29');
    assert.equal(row.banner_version, '2026-10-29');
    assert.equal(row.purposes_version, 1);
    assert.equal(row.notice_language, 'en');
    assert.equal(row.region, 'EEA');
    assert.equal(row.country, 'DE');
    assert.equal(row.method, 'banner');
    assert.ok(row.recorded_at instanceof Date);
    const columns = (await q(`SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'racingcoach' AND table_name = 'CookieConsents'`)).map((c) => c.column_name);
    for (const unwanted of ['ip_address', 'user_agent', 'latitude', 'longitude']) assert.ok(!columns.includes(unwanted), unwanted);
  });

  test('later choices add rows; earlier evidence is kept', async () => {
    const browserId = randomUUID();
    await records.recordCookieConsent(record({ browserId, action: 'accepted' }));
    await records.recordCookieConsent(record({ browserId, action: 'withdrawn', choices: { analytics: false }, method: 'preferenceCenter' }));
    const rows = await q('SELECT action FROM racingcoach."CookieConsents" WHERE browser_id = $1 ORDER BY recorded_at, action', [browserId]);
    assert.deepEqual(rows.map((r) => r.action).sort(), ['accepted', 'withdrawn']);
  });

  test('unknown actions and methods are refused by the database', async () => {
    await assert.rejects(records.recordCookieConsent(record({ action: 'implied' })));
    await assert.rejects(records.recordCookieConsent(record({ method: 'scroll' })));
  });

  test('signing in ties only that browser’s anonymous rows to the account', async () => {
    const userId = await makeUser();
    const mine = randomUUID();
    const other = randomUUID();
    await records.recordCookieConsent(record({ browserId: mine }));
    await records.recordCookieConsent(record({ browserId: other }));
    await records.linkConsentToUser(mine, userId);
    const [linked] = await q('SELECT user_id, user_linked_at FROM racingcoach."CookieConsents" WHERE browser_id = $1', [mine]);
    const [untouched] = await q('SELECT user_id FROM racingcoach."CookieConsents" WHERE browser_id = $1', [other]);
    assert.equal(Number(linked.user_id), userId);
    assert.ok(linked.user_linked_at);
    assert.equal(untouched.user_id, null);
  });

  test('deleting the account keeps the evidence without the account', async () => {
    const userId = await makeUser();
    const r = record({ userId });
    await records.recordCookieConsent(r);
    await users.deleteUser(userId);
    const [row] = await q('SELECT user_id FROM racingcoach."CookieConsents" WHERE id = $1', [r.id]);
    assert.ok(row, 'the record is kept');
    assert.equal(row.user_id, null);
  });

  test('records older than the retention period are purged; newer ones are kept', async () => {
    const old = record();
    const recent = record();
    await records.recordCookieConsent(old);
    await records.recordCookieConsent(recent);
    await q(`UPDATE racingcoach."CookieConsents" SET recorded_at = now() - interval '1096 days' WHERE id = $1`, [old.id]);
    await q(`UPDATE racingcoach."CookieConsents" SET recorded_at = now() - interval '1094 days' WHERE id = $1`, [recent.id]);
    assert.ok((await records.purgeOldConsentRecords()) >= 1);
    assert.equal((await q('SELECT 1 FROM racingcoach."CookieConsents" WHERE id = $1', [old.id])).length, 0);
    assert.equal((await q('SELECT 1 FROM racingcoach."CookieConsents" WHERE id = $1', [recent.id])).length, 1);
  });
});
