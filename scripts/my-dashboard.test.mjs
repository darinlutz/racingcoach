// My Dashboard's rules and guards: npm run test:my-dashboard
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  hasManageableSubscription,
  longDistance,
  maskEmail,
  splitDriverName,
  splitTrackName,
  subscriptionView,
  trackMapPath,
} from '../src/lib/dashboardRules.ts';

const NOW = new Date('2026-10-31T12:00:00.000Z');
const FUTURE = '2026-11-30T12:00:00.000Z';
const LATER = '2026-12-15T12:00:00.000Z';
const PAST = '2026-09-30T12:00:00.000Z';

const facts = (overrides = {}) => ({
  membershipLevel: 'Gold',
  accountStatus: 'Subscribed',
  subscriptionEndDate: FUTURE,
  stripeSubscriptionId: 'sub_1',
  stripe: null,
  ...overrides,
});
const stripe = (overrides = {}) => ({
  id: 'sub_1',
  status: 'active',
  cancelAtPeriodEnd: false,
  cancelAt: null,
  currentPeriodEnd: FUTURE,
  nextInvoiceAt: LATER,
  ...overrides,
});
const view = (overrides) => subscriptionView(facts(overrides), NOW);

test('an active subscription renews on its next invoice, else the end of its period', () => {
  assert.deepEqual(view({ stripe: stripe() }), { state: 'active', date: LATER, dateKind: 'renews' });
  assert.equal(view({ stripe: stripe({ nextInvoiceAt: null }) }).date, FUTURE);
  // A next invoice already past isn't a renewal date
  assert.equal(view({ stripe: stripe({ nextInvoiceAt: PAST }) }).date, FUTURE);
});

test('a trial is its own state', () => {
  assert.equal(view({ stripe: stripe({ status: 'trialing' }) }).state, 'trialing');
});

test('past due and unpaid are told apart from active, with the next attempt', () => {
  for (const status of ['past_due', 'unpaid', 'incomplete']) {
    assert.deepEqual(view({ stripe: stripe({ status }) }), { state: 'pastDue', date: LATER, dateKind: 'nextAttempt' });
  }
});

test('a subscription set to cancel is not one that has ended', () => {
  assert.deepEqual(view({ stripe: stripe({ cancelAtPeriodEnd: true, nextInvoiceAt: null }) }), { state: 'cancelScheduled', date: FUTURE, dateKind: 'ends' });
  assert.deepEqual(view({ stripe: stripe({ cancelAt: LATER }) }), { state: 'cancelScheduled', date: LATER, dateKind: 'ends' });
  assert.ok(hasManageableSubscription('cancelScheduled'));

  const canceled = view({ accountStatus: 'Canceled', stripe: stripe({ status: 'canceled' }) });
  assert.deepEqual(canceled, { state: 'canceled', date: FUTURE, dateKind: 'accessUntil' });
  assert.ok(!hasManageableSubscription(canceled.state));
});

test('ended: canceled with the paid time gone, or not renewed', () => {
  assert.deepEqual(view({ membershipLevel: 'Bronze', accountStatus: 'Canceled', subscriptionEndDate: PAST }), { state: 'ended', date: PAST, dateKind: 'ended' });
  assert.deepEqual(view({ membershipLevel: 'Bronze', accountStatus: 'Expired', subscriptionEndDate: PAST }), { state: 'expired', date: PAST, dateKind: 'ended' });
});

test("Stripe's ended subscription wins over an account the webhook hasn't reached yet", () => {
  assert.equal(view({ stripe: stripe({ status: 'canceled' }) }).state, 'canceled');
});

test('the account is what counts when its subscription was replaced: an older row is ignored', () => {
  // Bought again after canceling, before the new subscription's row exists
  assert.deepEqual(view({ stripeSubscriptionId: 'sub_new', stripe: stripe({ id: 'sub_old', status: 'canceled' }) }), { state: 'active', date: FUTURE, dateKind: 'renews' });
  // Upgraded to Gold while the Silver one still waits to be canceled
  assert.equal(view({ stripeSubscriptionId: 'sub_gold', stripe: stripe({ id: 'sub_silver', cancelAtPeriodEnd: true }) }).state, 'active');
});

test('accounts with no Stripe row, free accounts and levels set on the Admin page', () => {
  assert.deepEqual(view({}), { state: 'active', date: FUTURE, dateKind: 'renews' });
  assert.deepEqual(view({ membershipLevel: 'Bronze', accountStatus: 'Unsubscribed', subscriptionEndDate: null, stripeSubscriptionId: null }), { state: 'free', date: null, dateKind: null });
  assert.deepEqual(view({ accountStatus: 'Unsubscribed', subscriptionEndDate: null, stripeSubscriptionId: null }), { state: 'complimentary', date: null, dateKind: null });
});

test('names, email addresses and tracks', () => {
  assert.deepEqual(splitDriverName('Darin Lutz'), { first: 'Darin', last: 'Lutz' });
  assert.deepEqual(splitDriverName(' Ana  Maria de Souza '), { first: 'Ana Maria de', last: 'Souza' });
  assert.deepEqual(splitDriverName('Prince'), { first: '', last: 'Prince' });
  assert.equal(maskEmail('driver@example.com'), 'd•••••@example.com');
  assert.equal(maskEmail('nonsense'), '•••••');
  assert.deepEqual(splitTrackName('Sebring International Raceway (International)'), { track: 'Sebring International Raceway', config: 'International' });
  assert.deepEqual(splitTrackName('Lime Rock Park'), { track: 'Lime Rock Park', config: null });
});

test('distance is in the driver\'s units', () => {
  assert.equal(longDistance(5280, 'standard'), 1);
  assert.ok(Math.abs(longDistance(5280, 'metric') - 1.609344) < 1e-9);
});

test('a track map fits its box, north up, and needs an outline', () => {
  assert.equal(trackMapPath(null), null);
  assert.equal(trackMapPath({ kind: 'latlon', points: [[1, 2]] }), null);
  const path = trackMapPath({ kind: 'latlon', points: [[10, 10], [10, 10.01], [10.01, 10.01], [10.01, 10]] });
  const numbers = path.match(/[\d.]+/g).map(Number);
  assert.ok(numbers.every((n) => n >= 0 && n <= 100), path);
  assert.ok(path.endsWith('Z'));
  // [10, 10] is south, so low on the map (a larger y) than [10.01, 10]
  const [, y1] = numbers;
  const y4 = numbers[7];
  assert.ok(y1 > y4, path);
});

test('the page and its data can only be about the signed-in user', () => {
  const page = readFileSync(new URL('../src/app/my-dashboard/page.tsx', import.meta.url), 'utf8');
  assert.match(page, /getCurrentUser\(\)/);
  assert.match(page, /redirect\(withReturnTo\('\/login', '\/my-dashboard'\)\)/);
  assert.doesNotMatch(page, /searchParams|params\b/);
  assert.doesNotMatch(page, /revalidate|force-static|'use cache'/);

  // Every read of laps leaves out expired ones and is limited to the user (see Lap Telemetry Retention in AGENTS.md)
  const data = readFileSync(new URL('../src/lib/dashboard.ts', import.meta.url), 'utf8');
  const reads = data.match(/FROM racingcoach\."CollectorLaps" l/g);
  assert.ok(reads.length >= 2);
  assert.equal(data.match(/WHERE l\.user_id = \$1 AND l\.expires_at > now\(\)/g).length, reads.length);
  assert.doesNotMatch(data, /csv_gzip\s*(,|FROM)/);
});
