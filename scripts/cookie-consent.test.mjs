// Cookie consent rules: npm run test:cookie-consent
//
// The pure parts of the consent system (src/lib/cookieConsent.ts, consentRegion.ts, cookieInventory.ts and the Cookie
// Policy in legal.ts), run straight from their .ts files, plus guards over the source that fail when something stores
// or reads information in the browser without being in the cookie inventory, or loads a third-party script. The
// browser tests are e2e/cookie-consent.spec.ts (npm run test:e2e), the database tests cookie-consent-db.test.mjs.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CONSENT_COOKIE,
  CONSENT_PURPOSES_VERSION,
  DEFAULT_CONSENT_REVIEW_DAYS,
  OFFERED_CATEGORIES,
  allChoices,
  consentAction,
  isConsentCurrent,
  isGranted,
  normalizeChoices,
  parseConsent,
  serializeConsent,
} from '../src/lib/cookieConsent.ts';
import { normalizeCountry, regionOf, requiresOptIn } from '../src/lib/consentRegion.ts';
import { COOKIE_INVENTORY, storageKeysOf } from '../src/lib/cookieInventory.ts';
import { cookiePolicy, privacyPolicy } from '../src/lib/legal.ts';

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 29, 12);
const consent = (overrides = {}) => ({
  browserId: '11111111-1111-4111-8111-111111111111',
  recordId: '22222222-2222-4222-8222-222222222222',
  purposesVersion: CONSENT_PURPOSES_VERSION,
  choices: { analytics: true },
  decidedAt: NOW,
  ...overrides,
});

describe('where opt-in consent is required', () => {
  test('EU and EEA countries are EEA', () => {
    for (const country of ['DE', 'FR', 'IE', 'PL', 'NO', 'IS', 'LI']) assert.equal(regionOf(country), 'EEA', country);
  });

  test('the UK (and Crown Dependencies) is UK, Switzerland is CH', () => {
    for (const country of ['GB', 'JE', 'GG', 'IM']) assert.equal(regionOf(country), 'UK', country);
    assert.equal(regionOf('CH'), 'CH');
  });

  test('no country, or Cloudflare unknown and Tor values, is unknown', () => {
    assert.equal(regionOf(normalizeCountry(null)), 'unknown');
    assert.equal(regionOf(normalizeCountry('')), 'unknown');
    assert.equal(regionOf(normalizeCountry('XX')), 'unknown');
    assert.equal(regionOf(normalizeCountry('T1')), 'unknown');
    assert.equal(regionOf(normalizeCountry('not-a-country')), 'unknown');
    assert.equal(normalizeCountry(' de '), 'DE');
  });

  test('global mode asks everyone, wherever they are', () => {
    for (const region of ['EEA', 'UK', 'CH', 'other', 'unknown']) assert.equal(requiresOptIn('global', region), true, region);
  });

  test('regional mode asks the EEA, UK, Switzerland and unknown locations, not elsewhere', () => {
    assert.equal(requiresOptIn('regional', 'EEA'), true);
    assert.equal(requiresOptIn('regional', 'UK'), true);
    assert.equal(requiresOptIn('regional', 'CH'), true);
    assert.equal(requiresOptIn('regional', 'unknown'), true, 'unknown must default to the stricter rule');
    assert.equal(requiresOptIn('regional', 'other'), false);
  });
});

describe('the consent cookie', () => {
  test('round-trips', () => {
    const value = consent({ choices: { analytics: false } });
    assert.deepEqual(parseConsent(serializeConsent(value)), { ...value, choices: { analytics: false } });
  });

  test('anything else is no choice at all', () => {
    for (const bad of [undefined, '', 'yes', '{}', '[]', 'null', JSON.stringify({ b: 'x', r: 'y', p: 1, c: {}, t: 1 })]) {
      assert.equal(parseConsent(bad), null, String(bad));
    }
    const valid = JSON.parse(serializeConsent(consent()));
    assert.equal(parseConsent(JSON.stringify({ ...valid, t: -5 })), null);
    assert.equal(parseConsent(JSON.stringify({ ...valid, p: 'one' })), null);
  });

  test('only the offered categories are stored, as booleans', () => {
    assert.deepEqual(normalizeChoices({ analytics: 'yes', marketing: true, junk: true }), { analytics: false });
    assert.deepEqual(allChoices(true), Object.fromEntries(OFFERED_CATEGORIES.map((c) => [c, true])));
  });
});

describe('when a choice stops counting', () => {
  const days = DEFAULT_CONSENT_REVIEW_DAYS;

  test('a choice counts within the review interval', () => {
    assert.equal(isConsentCurrent(consent({ decidedAt: NOW - (days - 1) * DAY }), NOW, days), true);
  });

  test('the review interval asks again', () => {
    assert.equal(isConsentCurrent(consent({ decidedAt: NOW - days * DAY }), NOW, days), false);
  });

  test('a material change (new purposes version) asks again', () => {
    assert.equal(isConsentCurrent(consent({ purposesVersion: CONSENT_PURPOSES_VERSION - 1 }), NOW, days), false);
    assert.equal(isConsentCurrent(consent({ purposesVersion: CONSENT_PURPOSES_VERSION + 1 }), NOW, days), false);
  });

  test('a decision dated well in the future does not count', () => {
    assert.equal(isConsentCurrent(consent({ decidedAt: NOW + 2 * DAY }), NOW, days), false);
  });
});

describe('what may run', () => {
  test('nothing optional runs without a choice where opt-in is required', () => {
    assert.equal(isGranted('analytics', null, false, true), false);
  });

  test('a current choice decides', () => {
    assert.equal(isGranted('analytics', consent(), true, true), true);
    assert.equal(isGranted('analytics', consent({ choices: { analytics: false } }), true, true), false);
    assert.equal(isGranted('analytics', consent({ choices: { analytics: false } }), true, false), false);
  });

  test('an outdated acceptance stops counting; an outdated refusal still stands', () => {
    assert.equal(isGranted('analytics', consent(), false, true), false);
    assert.equal(isGranted('analytics', consent({ choices: { analytics: false } }), false, false), false);
  });

  test('without a choice, outside opt-in regions, it runs until turned off', () => {
    assert.equal(isGranted('analytics', null, false, false), true);
  });

  test('a category never offered is never granted by a stored choice', () => {
    assert.equal(isGranted('marketing', consent({ choices: { analytics: true } }), true, true), false);
  });
});

describe('what a choice is recorded as', () => {
  const granted = consent();
  const refused = consent({ choices: { analytics: false } });

  test('first choices', () => {
    assert.equal(consentAction(null, allChoices(true), 'acceptAll'), 'accepted');
    assert.equal(consentAction(null, allChoices(false), 'rejectAll'), 'rejected');
    assert.equal(consentAction(null, { analytics: true }, 'save'), 'customized');
    assert.equal(consentAction(null, { analytics: false }, 'save'), 'customized');
  });

  test('taking back everything granted is a withdrawal, however it is done', () => {
    assert.equal(consentAction(granted, allChoices(false), 'rejectAll'), 'withdrawn');
    assert.equal(consentAction(granted, { analytics: false }, 'save'), 'withdrawn');
  });

  test('other later choices', () => {
    assert.equal(consentAction(refused, { analytics: true }, 'save'), 'updated');
    assert.equal(consentAction(refused, allChoices(true), 'acceptAll'), 'accepted');
    assert.equal(consentAction(refused, allChoices(false), 'rejectAll'), 'rejected');
  });
});

describe('the inventory and the policies', () => {
  test('every optional technology is in a category the banner offers', () => {
    for (const item of COOKIE_INVENTORY) {
      assert.ok(item.category === 'necessary' || OFFERED_CATEGORIES.includes(item.category), `${item.name} (${item.category})`);
    }
  });

  test('every offered category has a technology (no empty categories shown)', () => {
    for (const category of OFFERED_CATEGORIES) {
      assert.ok(COOKIE_INVENTORY.some((item) => item.category === category), category);
    }
  });

  test('the consent cookie and the analytics storage are listed', () => {
    assert.ok(COOKIE_INVENTORY.some((item) => item.name === CONSENT_COOKIE && item.category === 'necessary'));
    assert.ok(COOKIE_INVENTORY.some((item) => item.name === 'visitor_id' && item.category === 'analytics'));
    assert.deepEqual(storageKeysOf('analytics', 'sessionStorage'), ['activitySessionId']);
  });

  test('the Cookie Policy lists every inventory item', () => {
    const text = JSON.stringify(cookiePolicy);
    for (const item of COOKIE_INVENTORY) assert.ok(text.includes(item.name), item.name);
    assert.ok(text.includes('Clarivex, LLC'));
    assert.ok(JSON.stringify(cookiePolicy.sections).includes('cookieSettings'), 'the policy opens Cookie Settings');
  });

  test('the Privacy Policy links to the Cookie Policy and keeps Terms acceptance apart from cookie consent', () => {
    const text = JSON.stringify(privacyPolicy);
    assert.ok(text.includes('racingcoach.app/cookies'));
    assert.ok(text.includes('Cookie Settings'));
    assert.ok(text.includes('is not consent to optional cookies'));
  });
});

// Source guards: they fail when browser storage or a cookie appears that the inventory (and so the Cookie Policy and
// the banner) doesn't know about, or a third-party script is added
describe('source guards', () => {
  const root = path.resolve(import.meta.dirname, '..', 'src');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.(ts|tsx)$/.test(entry.name)) files.push(full);
    }
  };
  walk(root);
  const source = (file) => fs.readFileSync(file, 'utf8');
  const rel = (file) => path.relative(root, file).replaceAll('\\', '/');
  const inventoryNames = new Set(COOKIE_INVENTORY.flatMap((item) => item.name.split(',').map((n) => n.trim())));

  test('every cookie name constant is in the inventory', () => {
    for (const file of files) {
      for (const [, name] of source(file).matchAll(/export const \w+_COOKIE = '([^']+)'/g)) {
        assert.ok(inventoryNames.has(name), `${name} in ${rel(file)} is not in src/lib/cookieInventory.ts`);
      }
    }
  });

  test('only known files use browser storage or document.cookie', () => {
    // Each of these sets only what the inventory lists; a new one must be added to the inventory first
    const allowed = new Set([
      'components/ActivityTracker.tsx', // activitySessionId (analytics, inside ConsentGate)
      'components/LiveRacing.tsx', // liveRacing.* checkboxes
      'components/Navigation.tsx', // nav
      'components/CookieConsentProvider.tsx', // removes withdrawn storage
    ]);
    for (const file of files) {
      // Uses of the APIs, not their names in strings or types (the inventory's kinds)
      if (/\b(localStorage|sessionStorage)\s*[.)\]]|\bindexedDB\.|document\.cookie/.test(source(file))) {
        assert.ok(allowed.has(rel(file)), `${rel(file)} uses browser storage; add it to the cookie inventory and this list`);
      }
    }
  });

  test('the activity tracker is only rendered inside an analytics ConsentGate', () => {
    for (const file of files) {
      const text = source(file);
      // Rendered (a JSX line), not mentioned in a comment
      if (!/^\s*<ActivityTracker\b/m.test(text)) continue;
      assert.match(text, /<ConsentGate category="analytics">\s*<ActivityTracker \/>\s*<\/ConsentGate>/, rel(file));
    }
  });

  test('no third-party scripts, pixels or embeds', () => {
    for (const file of files) {
      const text = source(file);
      assert.doesNotMatch(text, /from ['"]next\/script['"]/, `${rel(file)} loads a script with next/script`);
      assert.doesNotMatch(text, /<(script|iframe)[^>]+src=\{?['"`]https?:/, `${rel(file)} embeds a third-party script or frame`);
      assert.doesNotMatch(text, /googletagmanager|google-analytics|connect\.facebook|hotjar|segment\.com|plausible\.io|posthog/i, rel(file));
    }
  });
});
