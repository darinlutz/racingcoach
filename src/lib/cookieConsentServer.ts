import { cookies, headers } from 'next/headers';
import {
  CONSENT_COOKIE,
  DEFAULT_CONSENT_REVIEW_DAYS,
  isConsentCurrent,
  isGranted,
  OFFERED_CATEGORIES,
  parseConsent,
  serializeConsent,
  type ConsentChoices,
  type OptionalCategory,
  type StoredConsent,
} from './cookieConsent';
import { normalizeCountry, regionOf, requiresOptIn, type ConsentMode, type ConsentRegion } from './consentRegion';
import { COOKIE_INVENTORY } from './cookieInventory';

// The server's view of the visitor's cookie consent (src/lib/cookieConsent.ts), read from the consent cookie and,
// in 'regional' mode, a trusted country header. The root layout passes it to CookieConsentProvider, and
// /api/activity refuses events without analytics consent, so tracking is enforced on the server too.
//
// Settings (environment variables, all optional):
//   CONSENT_MODE            'global' (default): opt-in for everyone. 'regional': opt-in in the EU/EEA, UK and
//                           Switzerland and wherever the country isn't known (src/lib/consentRegion.ts).
//   CONSENT_COUNTRY_HEADER  The request header holding the visitor's two-letter country, e.g. cf-ipcountry. Only
//                           name a header the hosting infrastructure sets and overwrites on every request; a header
//                           a browser could send itself must never decide consent. Unset: the country is unknown.
//   CONSENT_REVIEW_DAYS     Days a choice lasts before the banner asks again (default 180).

export function consentMode(): ConsentMode {
  return process.env.CONSENT_MODE === 'regional' ? 'regional' : 'global';
}

export function consentReviewDays(): number {
  const days = Number(process.env.CONSENT_REVIEW_DAYS);
  return Number.isInteger(days) && days >= 1 && days <= 395 ? days : DEFAULT_CONSENT_REVIEW_DAYS;
}

async function trustedCountry(): Promise<string | null> {
  const header = process.env.CONSENT_COUNTRY_HEADER?.trim().toLowerCase();
  if (!header) return null;
  return normalizeCountry((await headers()).get(header));
}

export type ConsentState = {
  // The stored choice (current or not), or null
  stored: StoredConsent | null;
  // Whether the stored choice still counts (current purposes, within the review interval)
  current: boolean;
  optIn: boolean;
  region: ConsentRegion;
  country: string | null;
  // Whether the banner must ask: opt-in is required and there's no current choice
  needsChoice: boolean;
  // A choice was made before but no longer counts (a material change or the review interval), so the banner says so
  reconsent: boolean;
  // What may run now, per offered category
  granted: ConsentChoices;
};

export async function getConsentState(): Promise<ConsentState> {
  const stored = parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);
  const current = isConsentCurrent(stored, Date.now(), consentReviewDays());
  const country = await trustedCountry();
  const region = regionOf(country);
  const optIn = requiresOptIn(consentMode(), region);
  const granted = Object.fromEntries(
    OFFERED_CATEGORIES.map((category) => [category, isGranted(category, stored, current, optIn)])
  ) as ConsentChoices;
  return {
    stored,
    current,
    optIn,
    region,
    country,
    needsChoice: optIn && !current,
    reconsent: optIn && !current && stored !== null,
    granted,
  };
}

export async function isCategoryGranted(category: OptionalCategory): Promise<boolean> {
  return (await getConsentState()).granted[category] === true;
}

export async function setConsentCookie(consent: StoredConsent): Promise<void> {
  (await cookies()).set(CONSENT_COOKIE, serializeConsent(consent), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: consentReviewDays() * 24 * 60 * 60,
  });
}

// Deletes the first-party cookies of the categories not granted. Always sent, even when this request didn't carry the
// cookie: one set by a response that was still on its way is then deleted too. The page removes their browser storage
// itself (it can't be reached from the server); see CookieConsentProvider.
export async function deleteRefusedCookies(granted: ConsentChoices): Promise<void> {
  const store = await cookies();
  for (const item of COOKIE_INVENTORY) {
    if (item.kind !== 'cookie' || item.category === 'necessary' || granted[item.category] === true) continue;
    store.delete(item.name);
  }
}
