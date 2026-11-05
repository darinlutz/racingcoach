// My Dashboard's rules and guards: npm run test:my-dashboard
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { cleanCountry, COUNTRY_CODES, countryFlagClass, countryName, countryOptions, countrySearchText } from '../src/lib/countryCodes.ts';
import { clampPan, cropSquare, looksLikeJpeg, panAfterZoom, pictureBox } from '../src/lib/profilePictureRules.ts';
import {
  hasManageableSubscription,
  longDistance,
  maskEmail,
  splitDriverName,
  splitTrackName,
  subscriptionView,
  trackMapPath,
} from '../src/lib/dashboardRules.ts';
import { carPictureUrl, IRACING_CARS } from '../src/lib/carPictures.ts';

test('every country has a flag and a name, in every language', () => {
  assert.equal(new Set(COUNTRY_CODES).size, COUNTRY_CODES.length);
  assert.ok(COUNTRY_CODES.length >= 249);
  for (const code of COUNTRY_CODES) {
    assert.ok(existsSync(`node_modules/flag-icons/flags/4x3/${code.toLowerCase()}.svg`), `${code} has no flag`);
  }
  for (const locale of ['en-US', 'pt-BR', 'es-419', 'de-DE']) {
    const options = countryOptions(locale);
    assert.equal(options.length, COUNTRY_CODES.length);
    for (const { code, name } of options) assert.notEqual(name, code, `${code} has no name in ${locale}`);
  }
  assert.equal(countryName('BR', 'en-US'), 'Brazil');
  assert.equal(countryName('DE', 'pt-BR'), 'Alemanha');
  assert.equal(countryFlagClass('BR'), 'fi fi-br');
});

test('only a listed country is kept; anything else is Not Specified', () => {
  assert.equal(cleanCountry('BR'), 'BR');
  for (const value of [null, undefined, '', 'br', 'Brazil', 'ZZ', '__proto__', 5, {}]) {
    assert.equal(cleanCountry(value), null);
  }
});

test('a country search ignores case and accents', () => {
  assert.equal(countrySearchText('  Côte d’Ivoire'), 'cote d’ivoire');
  assert.equal(countrySearchText('TÜRKIYE'), 'turkiye');
});

test('a picture always fills the frame, however it is dragged or scaled', () => {
  const size = { width: 2000, height: 1000 };
  // At zoom 1 the shorter side fits exactly: it moves sideways only, half the 300 pixels too wide
  assert.deepEqual(clampPan({ x: 999, y: 999 }, size, 1, 300), { x: 150, y: 0 });
  assert.deepEqual(clampPan({ x: -999, y: -999 }, size, 1, 300), { x: -150, y: -0 });
  assert.deepEqual(clampPan({ x: 999, y: 999 }, size, 2, 300), { x: 450, y: 150 });
  for (const [pan, zoom] of [[{ x: 999, y: -999 }, 1], [{ x: -999, y: 999 }, 2.5], [{ x: 3, y: 7 }, 4]]) {
    const crop = cropSquare(clampPan(pan, size, zoom, 300), size, zoom, 300);
    assert.ok(crop.x >= -1e-9 && crop.y >= -1e-9, 'starts inside the picture');
    assert.ok(crop.x + crop.side <= size.width + 1e-9 && crop.y + crop.side <= size.height + 1e-9, 'ends inside the picture');
  }
});

test('the square saved is the part showing in the frame', () => {
  const size = { width: 2000, height: 1000 };
  assert.deepEqual(cropSquare({ x: 0, y: 0 }, size, 1, 300), { x: 500, y: 0, side: 1000 });
  // Dragged all the way right, the picture's left end shows
  assert.deepEqual(cropSquare({ x: 150, y: 0 }, size, 1, 300), { x: 0, y: 0, side: 1000 });
  assert.deepEqual(cropSquare({ x: 0, y: 0 }, size, 2, 300), { x: 750, y: 250, side: 500 });
  const box = pictureBox({ x: 150, y: 0 }, size, 1, 300);
  assert.deepEqual(box, { width: 600, height: 300, left: 0, top: 0 });
});

test('scaling keeps the same spot at the center of the frame', () => {
  const size = { width: 2000, height: 1000 };
  const before = cropSquare({ x: 60, y: 0 }, size, 1, 300);
  const pan = panAfterZoom({ x: 60, y: 0 }, size, 1, 2, 300);
  const after = cropSquare(pan, size, 2, 300);
  assert.equal(before.x + before.side / 2, after.x + after.side / 2);
  // Scaling back down can't leave a gap
  assert.deepEqual(panAfterZoom({ x: 450, y: 150 }, size, 2, 1, 300), { x: 150, y: 0 });
});

test('only a JPEG is accepted as an upload', () => {
  assert.ok(looksLikeJpeg(new Uint8Array([0xff, 0xd8, 0xff, 0xe0])));
  assert.ok(!looksLikeJpeg(new TextEncoder().encode('<svg onload="alert(1)">')));
  assert.ok(!looksLikeJpeg(new Uint8Array([0x89, 0x50, 0x4e, 0x47])));
  assert.ok(!looksLikeJpeg(new Uint8Array()));
});

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

test("every iRacing car finds its picture by CarPath, and the picture's file exists", () => {
  const paths = new Set();
  for (const [carPath, picture] of IRACING_CARS) {
    assert.ok(!paths.has(carPath), `${carPath} is listed twice`);
    paths.add(carPath);
    assert.equal(carPictureUrl('Some Other Name', carPath), `/assets/carPics/${picture}.jpg`, `${carPath} has no picture`);
    assert.ok(existsSync(`public${carPictureUrl('', carPath)}`), `${picture}.jpg is missing`);
  }
  // Session info's spaces, the support page's backslashes, any case
  assert.equal(carPictureUrl('Street Stock', 'dirtsprint winged 410'), '/assets/carPics/world-of-outlaws-410-sprint-car.jpg');
  assert.equal(carPictureUrl('Street Stock', '\\dirtsprint\\nonwinged\\360'), '/assets/carPics/usac-360-sprint-car.jpg');
  assert.equal(carPictureUrl('Street Stock', 'StreetStock StreetStock2'), '/assets/carPics/street-stock-casino.jpg');
});

test('laps without a CarPath find the picture by official name or the screen names seen in laps', () => {
  for (const [, picture, ...names] of IRACING_CARS) {
    for (const name of names) assert.equal(carPictureUrl(name), `/assets/carPics/${picture}.jpg`, name);
  }
  for (const [name, picture] of [
    ['Mercedes-AMG W13 E Performance', 'mercedes-amg-f1-w13-e-performance'],
    ['Audi 90 Quattro GTO', 'audi-90-gto'],
    ['Mazda MX-5 Cup', 'global-mazda-mx-5-cup'],
    ['Lamborghini Huracan GT3 EVO', 'lamborghini-huracan-gt3-evo'],
    // A Car Data name that is a picture's keeps it
    ['Porsche 911 GT3 R (992)', 'porsche-911-gt3-r-992'],
    ['Mclaren 570s GT4', 'mclaren-570s-gt4'],
  ]) {
    assert.equal(carPictureUrl(name), `/assets/carPics/${picture}.jpg`, name);
  }
  assert.equal(carPictureUrl('A Car Someone Added'), null);
  assert.equal(carPictureUrl('A Car Someone Added', 'notacar'), null);
});
