// Where opt-in cookie consent is required. Pure (no imports), shared by src/lib/cookieConsentServer.ts and the tests.
//
// The default, 'global', asks every visitor before any optional cookie, wherever they are: simpler and more reliable
// than geolocation, and it doesn't depend on the GDPR's reach being decided by geography alone. 'regional' asks
// visitors in the EU/EEA, the UK and Switzerland, and any visitor whose country isn't known, and lets optional
// cookies run elsewhere until the visitor turns them off in Cookie Settings.

export type ConsentMode = 'global' | 'regional';

// The region recorded with a choice: EEA (the EU and Iceland, Liechtenstein, Norway), UK, CH, other, or unknown
// (no trusted country signal)
export type ConsentRegion = 'EEA' | 'UK' | 'CH' | 'other' | 'unknown';

const EU = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT', 'NL',
  'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];
const EEA = new Set([...EU, 'IS', 'LI', 'NO']);
// The UK, and the Crown Dependencies, which have their own similar laws
const UK = new Set(['GB', 'UK', 'GG', 'JE', 'IM']);

// A two-letter country code, or null. Cloudflare sends XX for unknown and T1 for Tor, which count as unknown.
export function normalizeCountry(value: string | null | undefined): string | null {
  const code = value?.trim().toUpperCase();
  if (!code || !/^[A-Z]{2}$/.test(code) || code === 'XX' || code === 'T1') return null;
  return code;
}

export function regionOf(country: string | null): ConsentRegion {
  if (!country) return 'unknown';
  if (EEA.has(country)) return 'EEA';
  if (UK.has(country)) return 'UK';
  if (country === 'CH') return 'CH';
  return 'other';
}

// Whether this visitor must opt in before optional cookies run
export function requiresOptIn(mode: ConsentMode, region: ConsentRegion): boolean {
  return mode === 'global' || region !== 'other';
}
