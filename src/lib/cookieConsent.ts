// Cookie consent: what a visitor's choice is, how it's kept in their browser and when it must be asked again.
// Pure (no imports), so the client, the server and Node tests (scripts/cookie-consent.test.mjs) share it.
// The server side is src/lib/cookieConsentServer.ts, the records src/lib/cookieConsentRecords.ts, the banner and
// preference center src/components/CookieConsentProvider.tsx. See docs/cookie-consent.md.

// The Cookie Policy (/cookies, src/lib/legal.ts) version and the banner/preference center wording version, both
// stored with every consent record as evidence of what was shown. Change COOKIE_POLICY_VERSION with the policy's
// effective date, and CONSENT_BANNER_VERSION whenever the banner or preference center text changes.
export const COOKIE_POLICY_VERSION = '2026-10-30';
export const CONSENT_BANNER_VERSION = '2026-10-30';

// Bump this when a material change is made to what optional cookies do (a new technology, category or purpose):
// every earlier choice stops counting and the banner asks again. Wording fixes don't need it.
export const CONSENT_PURPOSES_VERSION = 1;

// How long a choice lasts before the banner asks again (CONSENT_REVIEW_DAYS overrides it on the server). No law sets
// one period; 180 days follows the CNIL's recommendation to keep both acceptances and refusals for about 6 months,
// so a refusal isn't asked about again too soon and an acceptance doesn't last indefinitely.
export const DEFAULT_CONSENT_REVIEW_DAYS = 180;

// The cookie that holds the choice (HttpOnly, set only by POST /api/consent). Strictly necessary: it only remembers
// the choice itself.
export const CONSENT_COOKIE = 'cookie_consent';

// Every category the site knows about. Strictly necessary is always on and isn't stored.
export const OPTIONAL_CATEGORIES = ['functional', 'analytics', 'marketing'] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];
export type ConsentCategory = 'necessary' | OptionalCategory;

// The optional categories RacingCoach.app actually uses (src/lib/cookieInventory.ts); only these are shown and
// recorded. Add one here when a technology in it is added to the inventory.
export const OFFERED_CATEGORIES: readonly OptionalCategory[] = ['analytics'];

export type ConsentChoices = Partial<Record<OptionalCategory, boolean>>;

// How the choice was made: the banner's or preference center's Accept All, Reject All, or Save Preferences
export const CONSENT_VIAS = ['acceptAll', 'rejectAll', 'save'] as const;
export type ConsentVia = (typeof CONSENT_VIAS)[number];

export const CONSENT_METHODS = ['banner', 'preferenceCenter'] as const;
export type ConsentMethod = (typeof CONSENT_METHODS)[number];

export const CONSENT_ACTIONS = ['accepted', 'rejected', 'customized', 'withdrawn', 'updated'] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

// What the consent cookie holds: the browser's pseudonymous ID (the same in every record from this browser, so a
// chain of choices can be shown), the latest record's ID, the purposes version it was given for, the choices and
// when (ms since 1970, UTC).
export type StoredConsent = {
  browserId: string;
  recordId: string;
  purposesVersion: number;
  choices: ConsentChoices;
  decidedAt: number;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

// Only the offered categories, each true or false (anything missing is false)
export function normalizeChoices(choices: unknown): ConsentChoices {
  const source = choices && typeof choices === 'object' ? (choices as Record<string, unknown>) : {};
  return Object.fromEntries(OFFERED_CATEGORIES.map((category) => [category, source[category] === true]));
}

export function allChoices(granted: boolean): ConsentChoices {
  return Object.fromEntries(OFFERED_CATEGORIES.map((category) => [category, granted]));
}

export function grantsAny(choices: ConsentChoices): boolean {
  return OFFERED_CATEGORIES.some((category) => choices[category] === true);
}

export function serializeConsent(consent: StoredConsent): string {
  return JSON.stringify({
    b: consent.browserId,
    r: consent.recordId,
    p: consent.purposesVersion,
    c: normalizeChoices(consent.choices),
    t: consent.decidedAt,
  });
}

// The cookie's value, or null when it's missing or not one of ours
export function parseConsent(value: string | undefined | null): StoredConsent | null {
  if (!value) return null;
  try {
    const raw = JSON.parse(value) as Record<string, unknown>;
    if (!raw || typeof raw !== 'object') return null;
    if (!isUuid(raw.b) || !isUuid(raw.r)) return null;
    if (typeof raw.p !== 'number' || !Number.isInteger(raw.p)) return null;
    if (typeof raw.t !== 'number' || !Number.isFinite(raw.t) || raw.t <= 0) return null;
    if (!raw.c || typeof raw.c !== 'object') return null;
    const choices: ConsentChoices = {};
    for (const category of OPTIONAL_CATEGORIES) {
      const value = (raw.c as Record<string, unknown>)[category];
      if (typeof value === 'boolean') choices[category] = value;
    }
    return { browserId: raw.b, recordId: raw.r, purposesVersion: raw.p, choices, decidedAt: raw.t };
  } catch {
    return null;
  }
}

// Whether a stored choice still counts: given for the current purposes, not older than the review interval, and not
// from the future (a clock more than a day ahead)
export function isConsentCurrent(consent: StoredConsent | null, now: number, reviewDays: number): consent is StoredConsent {
  if (!consent) return false;
  if (consent.purposesVersion !== CONSENT_PURPOSES_VERSION) return false;
  const age = now - consent.decidedAt;
  return age >= -24 * 60 * 60 * 1000 && age < reviewDays * 24 * 60 * 60 * 1000;
}

// Whether a category may run. A current choice decides. Without one, an earlier refusal still stands (a refusal is
// never turned into consent by time or a policy change), and otherwise it's off where opt-in consent is required
// and on where it isn't.
export function isGranted(
  category: OptionalCategory,
  consent: StoredConsent | null,
  current: boolean,
  optIn: boolean
): boolean {
  if (consent && current) return consent.choices[category] === true;
  if (consent && consent.choices[category] !== true) return false;
  return !optIn;
}

// What a new choice is, for the record: taking back everything that was granted is a withdrawal; otherwise Accept All
// and Reject All are accepted and rejected, and Save Preferences is customized the first time and updated after.
export function consentAction(previous: StoredConsent | null, choices: ConsentChoices, via: ConsentVia): ConsentAction {
  if (previous && grantsAny(previous.choices) && !grantsAny(choices)) return 'withdrawn';
  if (via === 'acceptAll') return 'accepted';
  if (via === 'rejectAll') return 'rejected';
  return previous ? 'updated' : 'customized';
}
