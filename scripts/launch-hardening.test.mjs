// Launch hardening tests without a database or any paid service: the guards that keep anyone with an account from
// running up the site's bills (docs/launch-readiness-audit-2026-11-07.md).
//   npm run test:launch-hardening

import { before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';
import { readFileSync } from 'node:fs';

register(new URL('./ts-resolve-hooks.mjs', import.meta.url));
const src = new URL('../src/lib/', import.meta.url);
let review, tiles;

before(async () => {
  review = await import(new URL('collectorLogReviewRules.ts', src).href);
  tiles = await import(new URL('mapTileBudget.ts', src).href);
});

describe('collector log review prompt (F-01)', () => {
  test('long lines are cut to 500 characters', () => {
    const [line] = review.promptLines(['x'.repeat(4000)]);
    assert.equal(line.length, 501);
    assert.ok(line.endsWith('…'));
  });

  test('the prompt keeps the newest lines within 24,000 characters', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `${String(i).padStart(3, '0')} ${'y'.repeat(3990)}`);
    const kept = review.promptLines(lines);
    const size = kept.reduce((sum, line) => sum + line.length + 1, 0);
    assert.ok(size <= 24_000, `prompt is ${size} characters`);
    assert.ok(kept.length >= 40);
    assert.ok(kept.at(-1).startsWith('199'), 'the newest line is kept');
  });

  test('short logs are passed through unchanged', () => {
    assert.deepEqual(review.promptLines(['a', 'b']), ['a', 'b']);
  });

  test('daily caps are set', () => {
    assert.equal(review.MAX_REVIEWS_PER_USER_PER_DAY, 3);
    assert.equal(review.MAX_REVIEWS_PER_DAY, 100);
  });
});

describe('map tile budget (F-06)', () => {
  beforeEach(() => {
    delete process.env.MAP_TILE_DAILY_LIMIT_PER_USER;
    delete process.env.MAP_TILE_DAILY_LIMIT;
    tiles.resetTileBudget();
  });

  test('a user gets 3,000 fetches a day, then is refused', () => {
    const now = Date.UTC(2026, 10, 7, 12);
    for (let i = 0; i < 3000; i++) assert.equal(tiles.takeTileFetch(1, now), 'ok');
    assert.equal(tiles.takeTileFetch(1, now), 'user');
    assert.equal(tiles.takeTileFetch(2, now), 'ok', 'other users are not affected');
  });

  test('the budget starts over the next UTC day', () => {
    process.env.MAP_TILE_DAILY_LIMIT_PER_USER = '1';
    assert.equal(tiles.takeTileFetch(1, Date.UTC(2026, 10, 7, 23, 59)), 'ok');
    assert.equal(tiles.takeTileFetch(1, Date.UTC(2026, 10, 7, 23, 59)), 'user');
    assert.equal(tiles.takeTileFetch(1, Date.UTC(2026, 10, 8, 0, 1)), 'ok');
  });

  test('the site-wide budget stops every user', () => {
    process.env.MAP_TILE_DAILY_LIMIT = '5';
    const now = Date.UTC(2026, 10, 7);
    for (let user = 1; user <= 5; user++) assert.equal(tiles.takeTileFetch(user, now), 'ok');
    assert.equal(tiles.takeTileFetch(6, now), 'site');
  });

  test('a failed fetch is given back', () => {
    process.env.MAP_TILE_DAILY_LIMIT_PER_USER = '1';
    const now = Date.UTC(2026, 10, 7);
    assert.equal(tiles.takeTileFetch(1, now), 'ok');
    tiles.returnTileFetch(1);
    assert.equal(tiles.takeTileFetch(1, now), 'ok');
  });

  test('cached tiles are served for 24 hours, then fetched again', () => {
    const now = Date.UTC(2026, 10, 7);
    tiles.cacheTile('17/1/2', new ArrayBuffer(10), 'image/jpeg', now);
    assert.equal(tiles.cachedTile('17/1/2', now + 60_000)?.contentType, 'image/jpeg');
    assert.equal(tiles.cachedTile('17/1/2', now + 25 * 3600_000), null);
  });

  test('the cache drops the least recently used tiles past 64 MB', () => {
    const now = Date.UTC(2026, 10, 7);
    const size = 512 * 1024;
    for (let i = 0; i < 130; i++) tiles.cacheTile(`t${i}`, new ArrayBuffer(size), 'image/jpeg', now);
    assert.equal(tiles.cachedTile('t0', now), null, 'oldest dropped');
    assert.ok(tiles.cachedTile('t129', now), 'newest kept');
  });
});

describe('Stripe subscription projection (F-02)', () => {
  let projection, rules;
  before(async () => {
    projection = await import(new URL('stripeProjection.ts', src).href);
    rules = await import(new URL('lapRetentionRules.ts', src).href);
  });
  const end = Date.UTC(2026, 11, 7, 12) / 1000;

  test('a paid renewal restores the plan level and moves the end to Stripe\'s period end', () => {
    assert.deepEqual(
      projection.accountProjection({ status: 'active', plan: 'gold_monthly', currentPeriodEnd: end, latestInvoiceStatus: 'paid' }),
      { accountStatus: 'Subscribed', membershipLevel: 'Gold', subscriptionEndDate: '2026-12-07T12:00:00.000Z' }
    );
    assert.equal(
      projection.accountProjection({ status: 'active', plan: 'silver_annual', currentPeriodEnd: end, latestInvoiceStatus: 'paid' }).membershipLevel,
      'Silver'
    );
  });

  test('a period not yet paid for keeps the account\'s end date', () => {
    const p = projection.accountProjection({ status: 'active', plan: 'silver_monthly', currentPeriodEnd: end, latestInvoiceStatus: 'draft' });
    assert.equal(p.subscriptionEndDate, null);
    assert.equal(p.membershipLevel, 'Silver');
  });

  test('past due, canceled, unpaid, incomplete and other apps\' plans leave the account alone', () => {
    for (const status of ['past_due', 'canceled', 'unpaid', 'incomplete', 'incomplete_expired', 'paused']) {
      assert.equal(projection.accountProjection({ status, plan: 'gold_monthly', currentPeriodEnd: end, latestInvoiceStatus: 'paid' }), null, status);
    }
    assert.equal(projection.accountProjection({ status: 'active', plan: 'talkninja_pro', currentPeriodEnd: end, latestInvoiceStatus: 'paid' }), null);
    assert.equal(projection.accountProjection({ status: 'active', plan: null, currentPeriodEnd: end, latestInvoiceStatus: 'paid' }), null);
  });

  test('a renewing membership gets 72 hours past its paid period; a canceled one ends on its date', () => {
    const paidUntil = new Date(Date.UTC(2026, 10, 7, 12));
    const hour = 3600_000;
    assert.equal(rules.membershipLapsed('Subscribed', paidUntil, new Date(paidUntil.getTime() + hour)), false, 'renewal charged an hour later');
    assert.equal(rules.membershipLapsed('Subscribed', paidUntil, new Date(paidUntil.getTime() + 71 * hour)), false);
    assert.equal(rules.membershipLapsed('Subscribed', paidUntil, new Date(paidUntil.getTime() + 73 * hour)), true);
    assert.equal(rules.membershipLapsed('Canceled', paidUntil, new Date(paidUntil.getTime() + hour)), true);
    assert.equal(rules.membershipLapsed('Unsubscribed', paidUntil, new Date(paidUntil.getTime() + 999 * hour)), false);
  });

  test('the lapse SQL gives Subscribed accounts the same grace', async () => {
    const db = await import(new URL('lapRetentionDb.ts', src).href);
    assert.match(db.END_LAPSED_MEMBERSHIPS_SQL, /make_interval\(hours => 72\)/);
    assert.match(db.END_LAPSED_MEMBERSHIPS_SQL, /'Canceled'.*subscription_end_date < \$1/s);
  });
});

describe('model call limits and the emergency stop (F-07, F-08, F-12, F-25, F-26)', () => {
  let limits, models, config;
  const source = (file) => readFileSync(new URL(file, src), 'utf8');
  before(async () => {
    limits = await import(new URL('aiCallLimits.ts', src).href);
    models = await import(new URL('aiModelList.ts', src).href);
    config = await import(new URL('rateLimitConfig.ts', src).href);
  });

  test('every AI feature has an output cap, a timeout and few retries', () => {
    for (const feature of models.AI_FEATURE_VALUES) {
      const limit = limits.AI_CALL_LIMITS[feature];
      assert.ok(limit, `${feature} has no limits`);
      assert.ok(limit.maxOutputTokens > 0 && limit.maxOutputTokens <= 10_000, feature);
      assert.ok(limit.timeoutMs > 0 && limit.timeoutMs <= 90_000, feature);
      assert.ok(limit.maxRetries <= 1, feature);
    }
    for (const live of ['raceAnnouncer', 'raceEngineer', 'setupEngineer', 'inCarCoachCallouts']) {
      assert.equal(limits.AI_CALL_LIMITS[live].maxRetries, 0, `${live} is live: no retry`);
    }
  });

  test('chatModel passes the limits to every provider', () => {
    const code = source('aiModels.ts');
    const body = code.slice(code.indexOf('export async function chatModel('));
    assert.match(body, /assertMeteredServicesOn\(\)/);
    assert.equal((body.match(/maxRetries/g) ?? []).length >= 4, true, 'Claude, DeepSeek, reasoning and plain OpenAI');
    assert.match(body, /new ChatOpenAI\(\{[^}]*maxTokens: maxOutputTokens[^}]*timeout/);
  });

  test('every paid call checks the emergency stop itself', () => {
    const fn = (file, name) => {
      const code = source(file);
      const at = code.search(new RegExp(`export async function ${name}[(<]`));
      assert.ok(at >= 0, `${name} in ${file}`);
      return code.slice(at, code.indexOf('\n}\n', at));
    };
    assert.match(fn('coachVoice.ts', 'synthesizeSpeech'), /assertMeteredServicesOn/);
    assert.match(fn('elevenLabs.ts', 'elevenLabsSpeech'), /assertMeteredServicesOn/);
    assert.match(fn('driverRadio.ts', 'transcribeRadio'), /assertMeteredServicesOn/);
    assert.match(fn('rateLimits.ts', 'siteAiCall'), /assertMeteredServicesOn/);
    assert.match(fn('rateLimits.ts', 'aiRateLimit'), /meteredServicesOn\(\)/);
    assert.match(readFileSync(new URL('../app/api/map-tiles/[z]/[x]/[y]/route.ts', src), 'utf8'), /meteredServicesOn\(\)/);
  });

  test('the rate limiter refuses calls when it cannot count them', () => {
    const body = source('rateLimits.ts');
    assert.doesNotMatch(body, /allowing the call/);
    assert.match(body, /refusing the call:[^\n]*\n\s*return unavailable\(user, 'unavailable'\)/);
  });

  test('a refund never gives back a call whose model calls were paid for', () => {
    assert.match(source('rateLimits.ts'), /counted = counted AND COALESCE\(model_calls, 0\) > 0/);
  });

  test('the In-Car AI Coach plan counts against the limit', () => {
    assert.equal(config.DEFAULT_RATE_LIMITS.weights.inCarCoachPlan, 1);
  });
});

describe('client IP address (F-10)', () => {
  let ip;
  before(async () => {
    ip = await import(new URL('clientIp.ts', src).href);
  });
  const headers = (h) => ({ get: (name) => h[name] ?? null });

  test('CF-Connecting-IP wins over a made-up X-Forwarded-For', () => {
    assert.equal(ip.clientIpFromHeaders(headers({ 'cf-connecting-ip': '203.0.113.9', 'x-forwarded-for': '1.2.3.4, 203.0.113.9' }), ''), '203.0.113.9');
  });

  test('without it, the first X-Forwarded-For entry, then X-Real-IP', () => {
    assert.equal(ip.clientIpFromHeaders(headers({ 'x-forwarded-for': '198.51.100.7, 10.0.0.1' }), ''), '198.51.100.7');
    assert.equal(ip.clientIpFromHeaders(headers({ 'x-real-ip': '198.51.100.8' }), ''), '198.51.100.8');
    assert.equal(ip.clientIpFromHeaders(headers({}), ''), null);
  });

  test('CLIENT_IP_HEADER takes the last entry of that header only', () => {
    const h = headers({ 'x-forwarded-for': '1.2.3.4, 198.51.100.7', 'cf-connecting-ip': '203.0.113.9' });
    assert.equal(ip.clientIpFromHeaders(h, 'x-forwarded-for'), '198.51.100.7');
    assert.equal(ip.clientIpFromHeaders(headers({}), 'true-client-ip'), null);
  });

  test('values that are not IP addresses are ignored', () => {
    assert.equal(ip.clientIpFromHeaders(headers({ 'cf-connecting-ip': 'evil', 'x-forwarded-for': 'x; DROP, 198.51.100.7' }), ''), null);
    assert.equal(ip.clientIpFromHeaders(headers({ 'x-forwarded-for': '2001:db8::1' }), ''), '2001:db8::1');
  });
});

describe('request body limits (F-13)', () => {
  let body;
  before(async () => {
    body = await import(new URL('requestBody.ts', src).href);
  });
  const streamed = (bytes) =>
    new Request('http://x/', {
      method: 'POST',
      // A chunked body: no Content-Length to check first
      body: new ReadableStream({
        start(c) {
          for (let i = 0; i < bytes; i += 1024) c.enqueue(new Uint8Array(Math.min(1024, bytes - i)));
          c.close();
        },
      }),
      duplex: 'half',
    });

  test('a chunked body past the cap is refused without reading it all', async () => {
    await assert.rejects(body.readBodyLimited(streamed(200 * 1024), 64 * 1024), body.BodyTooLargeError);
  });

  test('a declared Content-Length past the cap is refused before reading', async () => {
    const request = new Request('http://x/', { method: 'POST', body: 'x'.repeat(10), headers: { 'content-length': '999999' } });
    await assert.rejects(body.readBodyLimited(request, 1000), body.BodyTooLargeError);
  });

  test('JSON and form data under the cap read as usual', async () => {
    assert.deepEqual(await body.readJsonLimited(new Request('http://x/', { method: 'POST', body: '{"a":1}' }), 100), { a: 1 });
    const form = new FormData();
    form.set('lap', '{"x":1}');
    form.set('csv', new File([new Uint8Array(10)], 'lap.csv.gz'));
    const read = await body.readFormDataLimited(new Request('http://x/', { method: 'POST', body: form }), 64 * 1024);
    assert.equal(read.get('lap'), '{"x":1}');
    assert.equal(read.get('csv').size, 10);
  });

  test('every route a visitor or collector can reach caps its body', () => {
    const routes = ['auth/login', 'auth/signup', 'auth/forgot-password', 'auth/reset-password', 'support', 'privacy/requests',
      'consent', 'activity', 'stripe-webhook', 'collector/laps', 'collector/log', 'collector/live', 'collector/radio',
      'collector/speech', 'collector/in-car-coach', 'live/voice-message', 'debrief-coach', 'account/picture'];
    for (const route of routes) {
      const code = readFileSync(new URL(`../app/api/${route}/route.ts`, src), 'utf8');
      assert.doesNotMatch(code, /request\.(json|formData|arrayBuffer|text)\(\)/, `${route} reads its body uncapped`);
    }
  });
});

describe('shared Track Data from uploaded laps (F-11)', () => {
  let trust;
  before(async () => {
    trust = await import(new URL('trackDataTrust.ts', src).href);
  });
  // A 1 km square-ish loop near Lime Rock
  const loop = (scale = 1) => {
    const points = [];
    const [lat, lon] = [41.93, -73.38];
    const r = (0.00143 * scale);
    for (let i = 0; i < 500; i++) {
      const a = (i / 500) * 2 * Math.PI;
      points.push([lat + r * Math.sin(a), lon + (r / Math.cos((lat * Math.PI) / 180)) * Math.cos(a)]);
    }
    return points;
  };

  test('a reported length must agree with the lap\'s own within 2%', () => {
    assert.equal(trust.lengthConsistent(5000, 5050), true);
    assert.equal(trust.lengthConsistent(5000, 6000), false);
    assert.equal(trust.lengthConsistent(5000, null), false, 'nothing to check against is not trusted');
  });

  test('an outline must be about as long as the track', () => {
    const points = loop();
    const length = trust.outlineLengthFeet(points);
    assert.equal(trust.outlinePlausible(points, length * 1.1), true);
    assert.equal(trust.outlinePlausible(points, length * 2), false);
    assert.equal(trust.outlinePlausible(loop(5), length), false, 'a made-up map five times the size');
    assert.equal(trust.outlinePlausible(points, null), false, 'not before the track has a length');
    assert.equal(trust.outlinePlausible(points, length, [41.93, -73.38]), true, 'where the track is');
    assert.equal(trust.outlinePlausible(points, length, [48.85, 2.35]), false, 'the right size, somewhere else');
  });

  test('bounds must fit a lap of the track and sit near its location', () => {
    const b = { south: 41.928, west: -73.382, north: 41.932, east: -73.378 };
    assert.equal(trust.boundsPlausible(b, 5000, [41.93, -73.38]), true);
    assert.equal(trust.boundsPlausible(b, 5000, [48.85, 2.35]), false, 'the other side of the world');
    assert.equal(trust.boundsPlausible({ south: 40, west: -75, north: 43, east: -71 }, 5000, null), false, 'hundreds of miles wide');
  });

  test('an ordinary account only fills in missing values; Coaches and Admins can change them', () => {
    const code = readFileSync(new URL('trackLocations.ts', src), 'utf8');
    assert.match(code, /trusted \? '\(track_latitude IS DISTINCT FROM \$2 OR track_longitude IS DISTINCT FROM \$3\)' : 'track_latitude IS NULL'/);
    const lengths = readFileSync(new URL('trackLengths.ts', src), 'utf8');
    assert.match(lengths, /AND track_length_feet IS NULL`/);
  });
});

describe('security headers (F-24)', () => {
  let h;
  before(async () => {
    h = await import(new URL('../security-headers.mjs', import.meta.url).href);
  });
  const header = (name, dev = false) => h.securityHeaders({ dev }).find((x) => x.key === name)?.value;

  test('the site can never be framed (clickjacking)', () => {
    assert.match(header('Content-Security-Policy'), /frame-ancestors 'none'/);
    assert.equal(header('X-Frame-Options'), 'DENY');
  });

  test('checkout can still reach Stripe, and nothing else outside the site gets a form', () => {
    assert.match(header('Content-Security-Policy'), /form-action 'self' https:\/\/checkout\.stripe\.com https:\/\/billing\.stripe\.com(;|$)/);
  });

  test('HTTPS for two years, no sniffing, a careful referrer', () => {
    assert.match(header('Strict-Transport-Security'), /max-age=63072000/);
    assert.equal(header('X-Content-Type-Options'), 'nosniff');
    assert.equal(header('Referrer-Policy'), 'strict-origin-when-cross-origin');
  });

  test('the microphone is allowed for the site itself only (Hold to Talk); camera and location never', () => {
    const policy = header('Permissions-Policy');
    assert.match(policy, /microphone=\(self\)/);
    assert.match(policy, /camera=\(\)/);
    assert.match(policy, /geolocation=\(\)/);
  });

  test('the full policy is report-only, reports to the site, and allows eval only in development', () => {
    const production = header('Content-Security-Policy-Report-Only');
    assert.match(production, /default-src 'self'/);
    assert.match(production, /report-uri \/api\/csp-report/);
    assert.doesNotMatch(production, /unsafe-eval/);
    assert.match(header('Content-Security-Policy-Report-Only', true), /unsafe-eval/);
    assert.doesNotMatch(header('Content-Security-Policy'), /default-src|script-src/, 'nothing that could break a page is enforced yet');
  });

  test('next.config.js sends them on every path', () => {
    const config = readFileSync(new URL('../next.config.js', import.meta.url), 'utf8');
    assert.match(config, /source: '\/:path\*', headers: securityHeaders/);
  });
});

describe('error monitoring (F-33)', () => {
  let fp;
  before(async () => {
    fp = await import(new URL('errorFingerprint.ts', src).href);
  });

  test('email addresses, keys, tokens, query strings and database passwords are scrubbed', () => {
    const text = fp.scrub(
      'Failed for jane.doe@example.com with sk_live_abcdefghijklmnop, Bearer abc.def.ghi, ' +
        'GET /api/x?token=secret&a=1 at postgres://user:pass@host/db and ' + 'a'.repeat(40)
    );
    for (const secret of ['jane.doe', 'sk_live_abc', 'abc.def.ghi', 'secret', 'user:pass', 'a'.repeat(40)]) {
      assert.ok(!text.includes(secret), `${secret} left in: ${text}`);
    }
  });

  test('the same mistake with different IDs and numbers is one kind of error', () => {
    const a = fp.fingerprint('server', 'Lap 1234 of user 7 failed: 3f2504e0-4f89-11d3-9a0c-0305e82c3301 "Monza"');
    const b = fp.fingerprint('server', 'Lap 99 of user 12 failed: 8a2504e0-4f89-11d3-9a0c-0305e82c3302 "Spa"');
    assert.equal(a, b);
    assert.notEqual(a, fp.fingerprint('server', 'Something else failed'));
    assert.notEqual(a, fp.fingerprint('GET /api/x', 'Lap 1 of user 1 failed: x'));
  });

  test('an Error and its label become the message; its stack the detail', () => {
    const { message, detail } = fp.describeError(['Debrief error:', new TypeError('boom for a@b.co')]);
    assert.equal(message, 'Debrief error: TypeError: boom for [email]');
    assert.match(detail, /TypeError/);
  });

  test('console.error is counted, and the monitor never logs its own failures through it', () => {
    const code = readFileSync(new URL('errorMonitor.ts', src), 'utf8');
    assert.match(code, /console\.error = \(\.\.\.args: unknown\[\]\) => \{\s+original\(\.\.\.args\);\s+recordError/);
    assert.doesNotMatch(code.replace(/console\.error = /, ''), /console\.error\(/);
  });
});

describe('spend alerts and the automatic stop', () => {
  let rules;
  before(async () => {
    rules = await import(new URL('spendRules.ts', src).href);
  });

  test('AI cost from recorded tokens, cached input at its own price', () => {
    const cost = rules.aiCostUsd([
      { model: 'gpt-4o', inputTokens: 1_000_000, cachedInputTokens: 0, outputTokens: 100_000 },
      { model: 'gpt-4o-mini', inputTokens: 2_000_000, cachedInputTokens: 1_000_000, outputTokens: 0 },
    ]);
    // gpt-4o: 2.50 + 1.00; mini: 1M uncached × 0.15 + 1M cached × 0.075
    assert.ok(Math.abs(cost - (3.5 + 0.225)) < 1e-9, String(cost));
  });

  test('an unknown model counts at the dearest price, never for free', () => {
    const unknown = rules.aiCostUsd([{ model: 'some-new-model', inputTokens: 0, cachedInputTokens: 0, outputTokens: 1_000_000 }]);
    const mini = rules.aiCostUsd([{ model: 'gpt-4o-mini', inputTokens: 0, cachedInputTokens: 0, outputTokens: 1_000_000 }]);
    assert.ok(unknown > mini);
  });

  test('warn once, stop once, each once a UTC day', () => {
    const limits = { warnUsd: 25, ceilingUsd: 100 };
    const fresh = { day: '', warned: false, stopped: false };
    assert.equal(rules.spendAction(10, limits, fresh, '2026-11-08'), 'none');
    assert.equal(rules.spendAction(30, limits, fresh, '2026-11-08'), 'warn');
    assert.equal(rules.spendAction(30, limits, { day: '2026-11-08', warned: true, stopped: false }, '2026-11-08'), 'none');
    assert.equal(rules.spendAction(150, limits, { day: '2026-11-08', warned: true, stopped: false }, '2026-11-08'), 'stop');
    assert.equal(rules.spendAction(150, limits, { day: '2026-11-08', warned: true, stopped: true }, '2026-11-08'), 'none');
    assert.equal(rules.spendAction(150, limits, { day: '2026-11-07', warned: true, stopped: true }, '2026-11-08'), 'stop', 'a new day');
  });

  test('limits come from the environment, and the ceiling is never below the warning', () => {
    assert.deepEqual(rules.spendLimitsFromEnv({}), { warnUsd: 25, ceilingUsd: 100 });
    assert.deepEqual(rules.spendLimitsFromEnv({ SPEND_ALERT_DAILY_USD: '50', SPEND_CEILING_DAILY_USD: '20' }), { warnUsd: 50, ceilingUsd: 50 });
    assert.deepEqual(rules.spendLimitsFromEnv({ SPEND_ALERT_DAILY_USD: 'x', SPEND_CEILING_DAILY_USD: '-3' }), { warnUsd: 25, ceilingUsd: 100 });
  });
});

describe('development and production servers (docs/development-database.md)', () => {
  let env;
  before(async () => {
    env = await import(new URL('serverEnvironment.ts', src).href);
  });

  test('only the production build on Render is the live server', () => {
    assert.equal(env.isLiveServer({ NODE_ENV: 'production', RENDER: 'true' }), true);
    assert.equal(env.isLiveServer({ NODE_ENV: 'production' }), false, 'npm start on a Mac');
    assert.equal(env.isLiveServer({ NODE_ENV: 'development', RENDER: 'true' }), false);
    assert.equal(env.isLiveServer({ NODE_ENV: 'development', LIVE_SERVER: 'on' }), true);
    assert.equal(env.isLiveServer({ NODE_ENV: 'production', RENDER: 'true', LIVE_SERVER: 'off' }), false);
  });

  test('background jobs and monitors run on the live server only, unless turned on', () => {
    assert.equal(env.backgroundJobsEnabled({ NODE_ENV: 'development' }), false);
    assert.equal(env.backgroundJobsEnabled({ NODE_ENV: 'test', BACKGROUND_JOBS: 'on' }), true);
    assert.equal(env.backgroundJobsEnabled({ NODE_ENV: 'production', RENDER: 'true' }), true);
    assert.equal(env.backgroundJobsEnabled({ NODE_ENV: 'production', RENDER: 'true', BACKGROUND_JOBS: 'off' }), false);
    assert.equal(env.monitorsEnabled({ NODE_ENV: 'production' }), false);
    assert.equal(env.monitorsEnabled({ NODE_ENV: 'development', MONITORS: 'on' }), true);
  });

  test('a non-production server refuses the production database unless told otherwise', () => {
    const dev = { NODE_ENV: 'development' };
    assert.equal(env.databaseVerdict('production', dev).allowed, false);
    assert.deepEqual(env.databaseVerdict(null, dev), { allowed: true, mark: false });
    const allowed = env.databaseVerdict('production', { ...dev, ALLOW_PRODUCTION_DATABASE: 'yes' });
    assert.equal(allowed.allowed, true);
    assert.ok(allowed.warning);
    assert.equal(env.databaseVerdict('production', { ...dev, ALLOW_PRODUCTION_DATABASE: 'true' }).allowed, false, 'only yes');
  });

  test('the live server marks its database once', () => {
    const live = { NODE_ENV: 'production', RENDER: 'true' };
    assert.deepEqual(env.databaseVerdict(null, live), { allowed: true, mark: true });
    assert.deepEqual(env.databaseVerdict('production', live), { allowed: true, mark: false });
  });

  test('every query goes through the guard, and the jobs through the switch', () => {
    const db = readFileSync(new URL('db.ts', src), 'utf8');
    assert.equal((db.match(/getPool\(\)/g) ?? []).length, 2, 'getPool is called only by readyPool');
    const instrumentation = readFileSync(new URL('../instrumentation.ts', src), 'utf8');
    const jobs = instrumentation.indexOf('backgroundJobsEnabled()');
    assert.ok(jobs > 0);
    for (const start of ['startLapRetentionSchedule()', 'startConsentRecordPurge()', 'startVideoProcessing()', 'startPrivacyJobs()', 'startTelemetryStorageJobs()']) {
      assert.ok(instrumentation.indexOf(start) > jobs, `${start} is behind the switch`);
    }
    assert.match(readFileSync(new URL('../../playwright.config.ts', src), 'utf8'), /BACKGROUND_JOBS: 'on'/);
  });
});

describe('disputed and refunded payments (F-22)', () => {
  let rules;
  before(async () => {
    rules = await import(new URL('stripeReversalRules.ts', src).href);
  });

  test('any dispute takes the payment back', () => {
    assert.deepEqual(
      rules.paymentReversal({ type: 'charge.dispute.created', data: { object: { charge: 'ch_1', payment_intent: { id: 'pi_1' } } } }),
      { reason: 'disputed', paymentIntentId: 'pi_1', chargeId: 'ch_1' }
    );
  });

  test('only a full refund does; a partial one leaves the subscription alone', () => {
    assert.deepEqual(
      rules.paymentReversal({ type: 'charge.refunded', data: { object: { id: 'ch_2', refunded: true, payment_intent: 'pi_2' } } }),
      { reason: 'refunded', paymentIntentId: 'pi_2', chargeId: 'ch_2' }
    );
    assert.equal(rules.paymentReversal({ type: 'charge.refunded', data: { object: { id: 'ch_3', refunded: false, payment_intent: 'pi_3' } } }), null);
  });

  test('a payment that was no PaymentIntent, or another event, is none', () => {
    assert.equal(rules.paymentReversal({ type: 'charge.dispute.created', data: { object: { charge: 'ch_4', payment_intent: null } } }), null);
    assert.equal(rules.paymentReversal({ type: 'charge.dispute.closed', data: { object: {} } }), null);
  });

  test('the webhook handles both events through the revocation', () => {
    const code = readFileSync(new URL('../app/api/stripe-webhook/route.ts', src), 'utf8');
    assert.match(code, /case 'charge\.dispute\.created':\s*case 'charge\.refunded':/);
    assert.match(code, /revokeForReversedPayment\(stripe, reversal\)/);
  });
});
