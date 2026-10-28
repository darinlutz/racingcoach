// Lap retention rules tests: npm run test:lap-retention
//
// The rules in src/lib/lapRetentionRules.ts, at exact UTC boundaries. scripts/lap-retention-db.test.mjs checks that
// the database (src/lib/lapRetentionDb.ts) applies the same rules.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FALLBACK_RETENTION_DAYS,
  goldGraceUntil,
  isExpired,
  lapCompletedAt,
  lapExpiresAt,
  MAX_RETENTION_DAYS,
  restampExpiresAt,
  retentionDays,
} from '../src/lib/lapRetentionRules.ts';

const DAY = 24 * 60 * 60 * 1000;
const completed = new Date('2026-01-10T12:00:00.000Z');
const at = (days, ms = 0) => new Date(completed.getTime() + days * DAY + ms);

for (const [level, days] of [
  ['Bronze', 30],
  ['Silver', 60],
  ['Gold', 90],
]) {
  test(`${level} lap at ${days - 1} days is retained, and expires at exactly ${days} days`, () => {
    const expiresAt = lapExpiresAt(completed, level);
    assert.equal(expiresAt.toISOString(), at(days).toISOString());
    assert.equal(isExpired(expiresAt, at(days - 1)), false);
    assert.equal(isExpired(expiresAt, at(days, -1)), false, 'one millisecond before');
    assert.equal(isExpired(expiresAt, at(days)), true, 'at the instant');
  });
}

test('an unknown level gets the shortest period, never more than 90 days', () => {
  assert.equal(retentionDays('Platinum'), FALLBACK_RETENTION_DAYS);
  assert.equal(retentionDays(null), FALLBACK_RETENTION_DAYS);
  assert.equal(retentionDays(undefined), FALLBACK_RETENTION_DAYS);
  assert.equal(FALLBACK_RETENTION_DAYS, 30);
  assert.ok(['Bronze', 'Silver', 'Gold', 'Other'].every((level) => retentionDays(level) <= MAX_RETENTION_DAYS));
});

test('expiry is exact across a daylight saving change (UTC, 24-hour days)', () => {
  const march = new Date('2026-03-01T06:00:00.000Z');
  assert.equal(lapExpiresAt(march, 'Bronze').toISOString(), '2026-03-31T06:00:00.000Z');
});

test('the completion time is never after the server received the lap (a fast PC clock)', () => {
  const received = new Date('2026-01-10T12:00:00.000Z');
  assert.equal(lapCompletedAt(new Date('2026-02-01T00:00:00Z'), received).toISOString(), received.toISOString());
  const recorded = new Date('2026-01-01T00:00:00.000Z');
  assert.equal(lapCompletedAt(recorded, received).toISOString(), recorded.toISOString(), 'a late upload keeps its time');
});

test('a late upload never resets the clock: a Bronze lap uploaded 31 days late is already expired', () => {
  const completedAt = lapCompletedAt(at(0), at(31));
  assert.equal(isExpired(lapExpiresAt(completedAt, 'Bronze'), at(31)), true);
});

const restamp = (expiresAt, previousLevel, level, now, graceUntil = null) =>
  restampExpiresAt({ completedAt: completed, expiresAt, previousLevel, level, now, graceUntil });

test('upgrade Bronze to Silver: an unexpired lap gets 60 days', () => {
  assert.equal(restamp(at(30), 'Bronze', 'Silver', at(20)).toISOString(), at(60).toISOString());
});

test('upgrade Silver to Gold: an unexpired lap gets 90 days', () => {
  assert.equal(restamp(at(60), 'Silver', 'Gold', at(59)).toISOString(), at(90).toISOString());
});

test('an upgrade never restores an expired lap', () => {
  const expired = at(30);
  assert.equal(restamp(expired, 'Bronze', 'Gold', at(31)).toISOString(), expired.toISOString());
  assert.equal(restamp(expired, 'Bronze', 'Gold', at(30)).toISOString(), expired.toISOString(), 'at the instant');
});

test('downgrade Gold to Bronze: a lap older than 30 days expires at once, a newer one at 30 days', () => {
  const now = at(45);
  const older = restamp(at(90), 'Gold', 'Bronze', now);
  assert.equal(older.toISOString(), at(30).toISOString());
  assert.equal(isExpired(older, now), true);
  const newer = restamp(at(90), 'Gold', 'Bronze', at(10));
  assert.equal(newer.toISOString(), at(30).toISOString());
  assert.equal(isExpired(newer, at(10)), false);
});

test('downgrade Gold to Silver: a lap older than 60 days expires at once, a newer one keeps 60 days', () => {
  assert.equal(isExpired(restamp(at(90), 'Gold', 'Silver', at(61)), at(61)), true);
  assert.equal(restamp(at(90), 'Gold', 'Silver', at(50)).toISOString(), at(60).toISOString());
});

test('a Gold membership that ends keeps Gold laps for a 7-day grace period after the paid period', () => {
  const periodEnd = at(40);
  const grace = goldGraceUntil(periodEnd);
  assert.equal(grace.toISOString(), at(47).toISOString());
  // 40 days old when the membership ends: kept until the grace period ends, not expired at once
  const kept = restamp(at(90), 'Gold', 'Bronze', at(40), grace);
  assert.equal(kept.toISOString(), at(47).toISOString());
  assert.equal(isExpired(kept, at(47, -1)), false);
  assert.equal(isExpired(kept, at(47)), true);
});

test('the grace period never keeps a lap past its Gold expiry or 90 days', () => {
  const grace = goldGraceUntil(at(88));
  assert.equal(restamp(at(90), 'Gold', 'Bronze', at(88), grace).toISOString(), at(90).toISOString());
});

test('the grace period never shortens a lap: a new lap keeps its 30 days', () => {
  const grace = goldGraceUntil(at(0));
  assert.equal(restamp(at(90), 'Gold', 'Bronze', at(0), grace).toISOString(), at(30).toISOString());
});

test('resubscribing to Gold during the grace period restores the 90 days of laps not yet expired', () => {
  const graced = restamp(at(90), 'Gold', 'Bronze', at(40), goldGraceUntil(at(40)));
  assert.equal(restamp(graced, 'Bronze', 'Gold', at(42)).toISOString(), at(90).toISOString());
});

test('subscription expiration without grace (Silver): laps drop to Bronze, older ones expire at once', () => {
  assert.equal(isExpired(restamp(at(60), 'Silver', 'Bronze', at(35)), at(35)), true);
});
