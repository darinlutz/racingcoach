// Launch hardening against a disposable local Postgres: email address confirmation (src/lib/emailVerification.ts, markEmailVerified and
// claimUnverifiedAccount in src/lib/users.ts), e.g.
//   LAUNCH_HARDENING_TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/rc_test npm run test:launch-hardening
// Skipped without LAUNCH_HARDENING_TEST_DATABASE_URL. It drops and recreates the racingcoach schema, so it refuses any
// database that isn't on this computer.

import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { register } from 'node:module';
import pg from 'pg';
import { readFileSync } from 'node:fs';

const url = process.env.LAUNCH_HARDENING_TEST_DATABASE_URL;
const local = url && ['localhost', '127.0.0.1', '::1', '[::1]'].includes(new URL(url).hostname);
const skip = !url ? 'LAUNCH_HARDENING_TEST_DATABASE_URL is not set' : !local ? 'refusing a database that is not local' : false;

let users, verification, client;
const q = async (sql, params) => (await client.query(sql, params)).rows;
const policies = { terms: 'x', privacy: 'y' };
const signUp = (emailAddress, extra = {}) =>
  users.createUser({ userName: 'n', emailAddress, password: 'secret-password', preferredLanguage: 'en', country: null, promoCode: null, acceptedPolicies: policies, ...extra });

describe('email address confirmation (F-05)', { skip }, () => {
  before(async () => {
    process.env.DATABASE_URL = url;
    client = new pg.Client({ connectionString: url });
    await client.connect();
    await client.query('DROP SCHEMA IF EXISTS racingcoach CASCADE');
    register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
    const src = new URL('../src/lib/', import.meta.url);
    users = await import(new URL('users.ts', src).href);
    verification = await import(new URL('emailVerification.ts', src).href);
    await users.ensureUserSchema();
  });


  test('accounts from before verification count as confirmed; new signups start unconfirmed', async () => {
    // A database from before the column: drop it, add an account, and let the schema add it back
    await q('ALTER TABLE racingcoach."Users" DROP COLUMN email_verified_at');
    const [old] = await q(
      `INSERT INTO racingcoach."Users" (user_name, email_address, password) VALUES ('old', $1, 'x') RETURNING id`,
      [`${randomUUID()}@example.test`]
    );
    // ensureUserSchema runs once per process, so add the column back the way it does (users.ts)
    await q('ALTER TABLE racingcoach."Users" ADD COLUMN email_verified_at TIMESTAMPTZ DEFAULT now()');
    await q('ALTER TABLE racingcoach."Users" ALTER COLUMN email_verified_at DROP DEFAULT');
    assert.equal((await users.getUserById(Number(old.id))).emailVerified, true);
    const fresh = await signUp(`${randomUUID()}@example.test`);
    assert.equal(fresh.emailVerified, false);
    assert.equal(fresh.role, 'User');
  });

  test('a Google signup is confirmed at once', async () => {
    const user = await signUp(`${randomUUID()}@example.test`, { password: null, emailVerified: true });
    assert.equal(user.emailVerified, true);
  });

  test('signing up with the owner address gives no Admin role until it is confirmed', async () => {
    const owner = await signUp('DarinLutz@yahoo.com');
    assert.equal(owner.role, 'User');
    const token = await verification.createEmailVerificationToken(owner.id);
    const confirmed = await verification.verifyEmailToken(token);
    assert.equal(confirmed.emailVerified, true);
    assert.equal(confirmed.role, 'Admin');
  });

  test('a link works once, and only the newest one works', async () => {
    const user = await signUp(`${randomUUID()}@example.test`);
    const first = await verification.createEmailVerificationToken(user.id);
    const second = await verification.createEmailVerificationToken(user.id);
    assert.equal(await verification.verifyEmailToken(first), null, 'an older link stops working');
    assert.equal((await verification.verifyEmailToken(second)).id, user.id);
    assert.equal(await verification.verifyEmailToken(second), null, 'used once');
    assert.equal(await verification.verifyEmailToken('not-a-token'), null);
  });

  test('an expired link does nothing', async () => {
    const user = await signUp(`${randomUUID()}@example.test`);
    const token = await verification.createEmailVerificationToken(user.id);
    await q(`UPDATE racingcoach."EmailVerifications" SET expires_at = now() - interval '1 minute' WHERE user_id = $1`, [user.id]);
    assert.equal(await verification.verifyEmailToken(token), null);
    assert.equal((await users.getUserById(user.id)).emailVerified, false);
  });

  test('a Google sign-in for an unconfirmed account takes it from whoever made it', async () => {
    const email = `${randomUUID()}@example.test`;
    const squatter = await signUp(email);
    await q(
      `INSERT INTO racingcoach."Sessions" (token_hash, user_id, expires_at) VALUES ($1, $2, $3)`,
      [randomUUID(), squatter.id, Date.now() + 86400000]
    ).catch(async () => {
      // Sessions.expires_at may be a timestamp
      await q(`INSERT INTO racingcoach."Sessions" (token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '1 day')`, [randomUUID(), squatter.id]);
    });
    assert.ok(await users.authenticateUser(email, 'secret-password'), 'the password works before');
    const claimed = await users.claimUnverifiedAccount(squatter.id);
    assert.equal(claimed.emailVerified, true);
    assert.equal(claimed.hasPassword, false);
    assert.equal(await users.authenticateUser(email, 'secret-password'), null, 'the old password no longer works');
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."Sessions" WHERE user_id = $1', [squatter.id]))[0].n, 0);
  });

  test('claiming a confirmed account changes nothing about its password', async () => {
    const email = `${randomUUID()}@example.test`;
    const user = await signUp(email, { emailVerified: true });
    await users.claimUnverifiedAccount(user.id);
    assert.ok(await users.authenticateUser(email, 'secret-password'));
  });
});

describe('shared Track Data from uploaded laps (F-11)', { skip }, () => {
  let laps;
  const KEY = 'trusttest layout';
  const METERS = 2420;
  const lapCsv = (center = 41.928) => {
    const rows = ['Speed,LapDistPct,LapDist,Brake,Throttle,Lat,Lon'];
    const latR = METERS / (2 * Math.PI) / 111_320;
    const lonR = latR / Math.cos((center * Math.PI) / 180);
    for (let i = 0; i < 600; i++) {
      const a = (i / 600) * 2 * Math.PI;
      rows.push(`40,${(i / 600).toFixed(4)},${((i / 600) * METERS).toFixed(2)},0,1,${center + latR * Math.sin(a)},${-73.381 + lonR * Math.cos(a)}`);
    }
    return rows.join('\n') + '\n';
  };
  const details = (over = {}) => ({
    clientLapId: randomUUID(), track: 'Trust Test', car: 'Car', driver: 'D', sessionId: 1, subSessionId: 1, sessionNum: 0,
    sessionType: 'Practice', lapNumber: 1, lapTimeSeconds: 90, samples: 600, missingSamples: 0, incidents: 0, pitRoad: false,
    offTrack: false, recordedAt: new Date().toISOString(), trackKey: KEY, trackLengthFeet: 7939.6, trackLatitude: 41.928,
    trackLongitude: -73.381, ...over,
  });
  const upload = async (userId, over, content = lapCsv()) => {
    const { gzipSync } = await import('node:zlib');
    const parsed = laps.collectorLapSchema.parse(details(over));
    const gz = gzipSync(content);
    const { csvBytes, hasPosition } = laps.checkLapCsv(gz, parsed.samples);
    return laps.saveCollectorLap(userId, parsed, gz, csvBytes, hasPosition);
  };
  const track = async () => (await q('SELECT * FROM racingcoach."Tracks" WHERE track_key = $1', [KEY]))[0];
  const account = async (role) => {
    const user = await signUp(`${randomUUID()}@example.test`, { emailVerified: true });
    await q('UPDATE racingcoach."Users" SET role = $2 WHERE id = $1', [user.id, role]);
    return user.id;
  };

  before(async () => {
    laps = await import(new URL('../src/lib/collectorLaps.ts', import.meta.url).href);
    await q(`INSERT INTO racingcoach."Tracks" (track_key, track_name) VALUES ($1, 'Trust Test')`, [KEY]).catch(async () => {
      const cols = await q(`SELECT column_name FROM information_schema.columns WHERE table_schema = 'racingcoach' AND table_name = 'Tracks' AND is_nullable = 'NO' AND column_default IS NULL`);
      throw new Error(`Tracks needs: ${cols.map((c) => c.column_name).join(', ')}`);
    });
  });

  test('the first ordinary lap teaches a missing length, location, bounds and outline', async () => {
    await upload(await account('User'));
    const row = await track();
    assert.equal(Number(row.track_length_feet), 7939.6);
    assert.equal(Number(row.track_latitude), 41.928);
    assert.ok(row.track_south != null, 'bounds');
    assert.ok(row.track_outline, 'outline');
  });

  test('an ordinary account cannot change what is there', async () => {
    await upload(await account('User'), { trackLengthFeet: 99_999, trackLatitude: 10, trackLongitude: 10 });
    const row = await track();
    assert.equal(Number(row.track_length_feet), 7939.6);
    assert.equal(Number(row.track_latitude), 41.928);
  });

  test('a length that disagrees with the lap\'s own LapDist is never learned', async () => {
    await q('UPDATE racingcoach."Tracks" SET track_length_feet = NULL WHERE track_key = $1', [KEY]);
    await upload(await account('User'), { trackLengthFeet: 20_000 });
    assert.equal((await track()).track_length_feet, null);
  });

  test('a Coach\'s lap puts it right', async () => {
    await upload(await account('Coach'), { trackLengthFeet: 7940.1, trackLatitude: 41.929, trackLongitude: -73.38 });
    const row = await track();
    assert.equal(Number(row.track_length_feet), 7940.1);
    assert.equal(Number(row.track_latitude), 41.929);
  });

  test('a made-up map is not learned', async () => {
    await q('UPDATE racingcoach."Tracks" SET track_outline = NULL, track_south = NULL, track_west = NULL, track_north = NULL, track_east = NULL WHERE track_key = $1', [KEY]);
    // The right size, but on the other side of the world from the track's location
    const big = lapCsv(48.85);
    await upload(await account('User'), {}, big);
    const row = await track();
    assert.equal(row.track_outline, null);
    assert.equal(row.track_south, null);
  });
});

describe('collector logs keep no radio text, and nothing past 90 days (F-20)', { skip }, () => {
  let logs, user;
  before(async () => {
    logs = await import(new URL('../src/lib/collectorLogs.ts', import.meta.url).href);
    user = await signUp(`${randomUUID()}@example.test`, { emailVerified: true });
  });

  test('radio text, engineer answers and watchers\' names and words never reach the database', async () => {
    assert.equal(logs.redactLogMessage('Driver Radio: “box this lap” (sent to Live Racing)'), 'Driver Radio: message sent (12 characters; sent to Live Racing)');
    assert.equal(logs.redactLogMessage('Race Engineer: “Box, box.”'), 'Race Engineer: answered (9 characters)');
    assert.equal(logs.redactLogMessage('Live Racing: voice message from Jane Doe: you are fast'), 'Live Racing: a voice message from a watcher');
    assert.equal(logs.redactLogMessage('Live Racing: message from Jane Doe: hello'), 'Live Racing: a message from a watcher');
    assert.equal(logs.redactLogMessage('Uploaded lap 5'), 'Uploaded lap 5');
    const runId = randomUUID();
    await logs.saveCollectorLog(user.id, {
      runId, version: '1.81.0',
      lines: [{ seq: 1, at: new Date().toISOString(), isError: false, message: 'Live Racing: message from Jane Doe: my secret' }],
    });
    const [row] = await q('SELECT message FROM racingcoach."CollectorLogs" WHERE run_id = $1', [runId]);
    assert.equal(row.message, 'Live Racing: a message from a watcher');
  });

  test('lines stored before are cleared once', async () => {
    await q(
      `INSERT INTO racingcoach."CollectorLogs" (user_id, run_id, seq, logged_at, is_error, message) VALUES ($1, $2, 1, now(), false, $3)`,
      [user.id, randomUUID(), 'Driver Radio: “my private words” (sent to Live Racing)']
    );
    assert.ok((await logs.redactStoredRadioText()) >= 1);
    assert.equal((await q(`SELECT count(*)::int AS n FROM racingcoach."CollectorLogs" WHERE message LIKE '%private words%'`))[0].n, 0);
  });

  test('every user\'s lines past 90 days are deleted, not only the uploader\'s', async () => {
    const quiet = await signUp(`${randomUUID()}@example.test`, { emailVerified: true });
    await q(
      `INSERT INTO racingcoach."CollectorLogs" (user_id, run_id, seq, logged_at, is_error, message) VALUES ($1, $2, 1, now() - interval '91 days', false, 'old')`,
      [quiet.id, randomUUID()]
    );
    assert.ok((await logs.purgeOldCollectorLogs()) >= 1);
    assert.equal((await q('SELECT count(*)::int AS n FROM racingcoach."CollectorLogs" WHERE user_id = $1', [quiet.id]))[0].n, 0);
  });
});

describe('error and spend monitoring (F-33, F-07)', { skip }, () => {
  let monitor, spend, metered;
  before(async () => {
    delete process.env.RESEND_API_KEY;
    monitor = await import(new URL('../src/lib/errorMonitor.ts', import.meta.url).href);
    spend = await import(new URL('../src/lib/spendMonitor.ts', import.meta.url).href);
    metered = await import(new URL('../src/lib/meteredServices.ts', import.meta.url).href);
    await monitor.ensureErrorTable();
  });

  test('errors are grouped and counted; a kind is new once, not every minute', async () => {
    monitor.recordError('server', ['Save lap error:', new Error('lap 12 failed')]);
    monitor.recordError('server', ['Save lap error:', new Error('lap 13 failed')]);
    await monitor.flushErrors();
    monitor.recordError('server', ['Save lap error:', new Error('lap 14 failed')]);
    await monitor.flushErrors();
    const rows = await q(`SELECT message, count FROM racingcoach."ServerErrors" WHERE message LIKE 'Save lap error:%'`);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].count), 3);
    const recent = await monitor.readRecentErrors();
    assert.ok(recent.some((e) => e.message.startsWith('Save lap error:') && e.count === 3));
  });

  test('errors not seen for 30 days are deleted', async () => {
    await q(`INSERT INTO racingcoach."ServerErrors" (fingerprint, source, message, last_seen) VALUES ('old', 'server', 'old', now() - interval '31 days')`);
    assert.ok((await monitor.purgeOldErrors()) >= 1);
    assert.equal((await q(`SELECT 1 FROM racingcoach."ServerErrors" WHERE fingerprint = 'old'`)).length, 0);
  });

  test('today\'s AI spend warns past the warning level, and switches paid services off past the ceiling', async () => {
    process.env.SPEND_ALERT_DAILY_USD = '1';
    process.env.SPEND_CEILING_DAILY_USD = '5';
    await metered.setMeteredServices(true, null);
    await q(`DELETE FROM racingcoach."SiteSettings" WHERE key = 'spend_monitor_state'`);
    await q(`DELETE FROM racingcoach."AiUsage"`);
    // $2.50 of gpt-4o input: past the warning, under the ceiling
    await q(`INSERT INTO racingcoach."AiUsage" (feature, tier, weight, allowed, model, input_tokens) VALUES ('debriefCoach', 'Gold', 1, true, 'gpt-4o', 1000000)`);
    let result = await spend.checkSpend();
    assert.equal(result.action, 'warn');
    assert.ok(Math.abs(result.spend.aiUsd - 2.5) < 1e-6);
    assert.equal(await metered.meteredServicesOn(), true);
    assert.equal((await spend.checkSpend()).action, 'none', 'warned once');
    // Another $7.50: past the ceiling
    await q(`INSERT INTO racingcoach."AiUsage" (feature, tier, weight, allowed, model, input_tokens) VALUES ('debriefCoach', 'Gold', 1, true, 'gpt-4o', 3000000)`);
    result = await spend.checkSpend();
    assert.equal(result.action, 'stop');
    assert.equal(await metered.meteredServicesOn(), false, 'paid services switched off');
    // The owner switches them back on; not switched off again the same day
    await metered.setMeteredServices(true, null);
    assert.equal((await spend.checkSpend()).action, 'none');
    assert.equal(await metered.meteredServicesOn(), true);
    delete process.env.SPEND_ALERT_DAILY_USD;
    delete process.env.SPEND_CEILING_DAILY_USD;
  });
});

describe('Stripe billing portal (F-34)', { skip }, () => {
  let portal;
  const fakeStripe = () => {
    const calls = { created: [], retrieved: [], sessions: [] };
    const configs = new Map();
    return {
      calls,
      configs,
      billingPortal: {
        configurations: {
          async create(params) {
            const id = `bpc_${calls.created.length + 1}`;
            configs.set(id, { id, active: true, ...params });
            calls.created.push(params);
            return configs.get(id);
          },
          async retrieve(id) {
            calls.retrieved.push(id);
            if (!configs.has(id)) throw Object.assign(new Error('No such configuration'), { statusCode: 404 });
            return configs.get(id);
          },
        },
        sessions: {
          async create(params) {
            calls.sessions.push(params);
            return { url: `https://billing.stripe.com/p/session/${params.customer}` };
          },
        },
      },
    };
  };
  before(async () => {
    portal = await import(new URL('../src/lib/billingPortal.ts', import.meta.url).href);
    await q(`DELETE FROM racingcoach."SiteSettings" WHERE key = 'stripe_portal_configuration'`);
  });

  test('its own configuration: card and invoices only, never cancelling or changing plans', async () => {
    const stripe = fakeStripe();
    const url = await portal.billingPortalUrl(stripe, 'cus_123', 'https://racingcoach.app', 'en');
    assert.equal(url, 'https://billing.stripe.com/p/session/cus_123');
    const [config] = stripe.calls.created;
    assert.equal(config.features.payment_method_update.enabled, true);
    assert.equal(config.features.invoice_history.enabled, true);
    assert.equal(config.features.subscription_cancel.enabled, false);
    assert.equal(config.features.subscription_update.enabled, false);
    assert.equal(config.features.customer_update.enabled, false);
    assert.equal(config.metadata.app, 'racingcoach');
    assert.equal(stripe.calls.sessions[0].configuration, 'bpc_1');
    assert.equal(stripe.calls.sessions[0].return_url, 'https://racingcoach.app/account#subscription');
  });

  test('the saved configuration is reused, and a new one made when Stripe no longer has it', async () => {
    const stripe = fakeStripe();
    stripe.configs.set('bpc_1', { id: 'bpc_1', active: true });
    await portal.billingPortalUrl(stripe, 'cus_1', 'https://racingcoach.app', 'en');
    assert.equal(stripe.calls.created.length, 0, 'reused');
    const other = fakeStripe(); // test mode keys: the live configuration isn't there
    await portal.billingPortalUrl(other, 'cus_1', 'https://racingcoach.app', 'en');
    assert.equal(other.calls.created.length, 1, 'made again');
  });

  test('the route opens the signed-in account\'s own customer, never one from the request', () => {
    const code = readFileSync(new URL('../src/app/api/billing-portal/route.ts', import.meta.url), 'utf8');
    assert.match(code, /billingPortalUrl\(stripe, user\.stripeCustomerId,/);
    assert.doesNotMatch(code, /request\.(json|formData)|readJsonLimited|readFormDataLimited|searchParams/);
  });
});

// After every group: they share the connection and the pool
after(async () => {
  await client?.end();
  await globalThis.pgPool?.end();
});

describe('the production database guard (src/lib/db.ts)', { skip }, () => {
  let db;
  const saved = { LIVE_SERVER: process.env.LIVE_SERVER, ALLOW_PRODUCTION_DATABASE: process.env.ALLOW_PRODUCTION_DATABASE };
  const fresh = () => { globalThis.dbGuard = undefined; };
  before(async () => {
    // The first group connected `client` and set DATABASE_URL
    db = await import(new URL('../src/lib/db.ts', import.meta.url).href);
    await client.query('DROP TABLE IF EXISTS racingcoach."DatabaseEnvironment"');
  });
  after(async () => {
    await client.query('DROP TABLE IF EXISTS racingcoach."DatabaseEnvironment"');
    Object.assign(process.env, saved);
    for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k];
    fresh();
  });

  test('an unmarked database is used by any server, and the live server marks it', async () => {
    process.env.LIVE_SERVER = 'off';
    fresh();
    assert.deepEqual(await db.query('SELECT 1 AS one'), [{ one: 1 }]);
    assert.equal((await q(`SELECT to_regclass('racingcoach."DatabaseEnvironment"') AS t`))[0].t, null, 'not marked by a dev server');
    process.env.LIVE_SERVER = 'on';
    fresh();
    await db.query('SELECT 1');
    assert.deepEqual((await q('SELECT environment FROM racingcoach."DatabaseEnvironment"')).map((r) => r.environment), ['production']);
  });

  test('a non-production server then refuses every query, transactions too', async () => {
    process.env.LIVE_SERVER = 'off';
    fresh();
    await assert.rejects(db.query('SELECT 1'), db.ProductionDatabaseError);
    await assert.rejects(db.transaction(async () => 1), db.ProductionDatabaseError);
    await assert.rejects(db.withClient(async () => 1), db.ProductionDatabaseError);
  });

  test('ALLOW_PRODUCTION_DATABASE=yes lets it through', async () => {
    process.env.LIVE_SERVER = 'off';
    process.env.ALLOW_PRODUCTION_DATABASE = 'yes';
    fresh();
    assert.deepEqual(await db.query('SELECT 2 AS two'), [{ two: 2 }]);
  });
});

describe('a disputed or refunded payment ends its paid access (F-22)', { skip }, () => {
  let billing;
  before(async () => {
    billing = await import(new URL('../src/lib/stripeBilling.ts', import.meta.url).href);
  });

  // Stripe as far as the revocation asks it: the payment's invoice, its subscription, and cancel
  function reversalStripe(subscription) {
    const cancels = [];
    return {
      cancels,
      invoicePayments: { list: async () => ({ data: [{ invoice: 'in_1' }] }) },
      invoices: { retrieve: async () => ({ id: 'in_1', parent: { subscription_details: { subscription: subscription.id } } }) },
      subscriptions: {
        retrieve: async () => subscription,
        cancel: async (id, params) => {
          cancels.push({ id, params });
          subscription.status = 'canceled';
        },
      },
    };
  }
  const goldAccount = async (subscriptionId) => {
    const user = await signUp(`${randomUUID()}@example.test`);
    await q(
      `UPDATE racingcoach."Users" SET account_status = 'Subscribed', membership_level = 'Gold', stripe_customer_id = 'cus_r',
         stripe_subscription_id = $2, subscription_end_date = to_char((now() + interval '20 days') AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') WHERE id = $1`,
      [user.id, subscriptionId]
    );
    return user.id;
  };
  const account = async (id) => (await q('SELECT account_status, membership_level, subscription_end_date FROM racingcoach."Users" WHERE id = $1', [id]))[0];

  test('the subscription is canceled without a refund and the account is Bronze at once', async () => {
    process.env.LIVE_SERVER = 'off';
    globalThis.dbGuard = undefined;
    const id = await goldAccount('sub_disputed');
    const stripe = reversalStripe({ id: 'sub_disputed', status: 'active', customer: 'cus_r', metadata: { app: 'racingcoach', user_id: String(id) } });
    const result = await billing.revokeForReversedPayment(stripe, { reason: 'disputed', paymentIntentId: 'pi_1' });
    assert.deepEqual(result, { status: 'revoked', subscriptionId: 'sub_disputed', userId: id });
    assert.equal(stripe.cancels.length, 1);
    assert.equal(stripe.cancels[0].params.prorate, false);
    const after1 = await account(id);
    assert.equal(after1.account_status, 'Canceled');
    assert.equal(after1.membership_level, 'Bronze');
    assert.ok(after1.subscription_end_date <= new Date().toISOString());

    // Stripe delivers it again: nothing more is canceled and the end doesn't move later
    const again = await billing.revokeForReversedPayment(stripe, { reason: 'disputed', paymentIntentId: 'pi_1' });
    assert.equal(again.status, 'revoked');
    assert.equal(stripe.cancels.length, 1);
    assert.ok((await account(id)).subscription_end_date <= after1.subscription_end_date);
  });

  test('another app\'s subscription on the shared Stripe account is left alone', async () => {
    const stripe = reversalStripe({ id: 'sub_talkninja', status: 'active', customer: 'cus_other', metadata: { app: 'talkninja' } });
    const result = await billing.revokeForReversedPayment(stripe, { reason: 'refunded', paymentIntentId: 'pi_2' });
    assert.equal(result.status, 'ignored');
    assert.equal(stripe.cancels.length, 0);
  });

  test('an old subscription\'s payment cancels it but leaves the account\'s current one', async () => {
    const id = await goldAccount('sub_current');
    const stripe = reversalStripe({ id: 'sub_old', status: 'active', customer: 'cus_r', metadata: { app: 'racingcoach', user_id: String(id) } });
    const result = await billing.revokeForReversedPayment(stripe, { reason: 'refunded', paymentIntentId: 'pi_3' });
    assert.deepEqual(result, { status: 'notCurrent', subscriptionId: 'sub_old', userId: id });
    assert.equal(stripe.cancels.length, 1);
    assert.equal((await account(id)).membership_level, 'Gold');
  });
});
