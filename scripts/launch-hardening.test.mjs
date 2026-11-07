// Launch hardening tests without a database or any paid service: the guards that keep anyone with an account from
// running up the site's bills (docs/launch-readiness-audit-2026-11-07.md).
//   npm run test:launch-hardening

import { before, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { register } from 'node:module';

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
