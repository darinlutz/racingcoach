import type { ConsentCategory } from './cookieConsent.ts';

// Every cookie and browser storage item RacingCoach.app's pages set, from the audit in docs/cookie-consent.md. The
// Cookie Policy's tables (src/lib/legal.ts) and the preference center's lists are made from it, and withdrawing
// consent removes the browser storage of the categories withdrawn. Add a row here (and update the Cookie Policy's
// version) before adding anything that stores or reads information in the browser; a new optional category also
// goes in OFFERED_CATEGORIES (src/lib/cookieConsent.ts). Imports only a type, so Node runs it directly.

export type StorageKind = 'cookie' | 'localStorage' | 'sessionStorage';

export type InventoryItem = {
  name: string;
  kind: StorageKind;
  category: ConsentCategory;
  provider: string;
  firstParty: boolean;
  httpOnly?: boolean;
  duration: string;
  purpose: string;
};

export const COOKIE_INVENTORY: InventoryItem[] = [
  {
    name: 'session',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    httpOnly: true,
    duration: '7 days, or until you log out',
    purpose: 'Keeps you signed in after you log in. Holds a random token; the server stores only a hash of it.',
  },
  {
    name: 'cookie_consent',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    httpOnly: true,
    duration: '180 days',
    purpose: 'Remembers your cookie choices, so optional cookies stay off (or on) as you chose and you are not asked again on every page.',
  },
  {
    name: 'google_oauth_state',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    httpOnly: true,
    duration: '10 minutes',
    purpose: 'Set only when you choose to sign in with Google. Protects the sign-in against forgery (OAuth state and PKCE verifier).',
  },
  {
    name: 'discord_oauth_state',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    httpOnly: true,
    duration: '10 minutes',
    purpose: 'Set only when you choose to connect your Discord account. Protects the connection against forgery (OAuth state).',
  },
  {
    name: 'language',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    duration: '1 year',
    purpose: 'The site language you chose (English, Portuguese or Spanish), set when you pick it, sign up or log in, so pages stay in that language.',
  },
  {
    name: 'theme',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    duration: '1 year',
    purpose: 'The Dark Mode or Light Mode you chose with the Theme toggle.',
  },
  {
    name: 'units',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    duration: '1 year',
    purpose: 'The Standard or Metric units you chose.',
  },
  {
    name: 'nav',
    kind: 'cookie',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    duration: '1 year',
    purpose: 'Whether you collapsed the navigation sidebar, so pages open at the width you chose.',
  },
  {
    name: 'liveRacing.announceLaps, liveRacing.leadAnnouncer, liveRacing.colorAnnouncer',
    kind: 'localStorage',
    category: 'necessary',
    provider: 'RacingCoach.app',
    firstParty: true,
    duration: 'Until you clear your browser data',
    purpose: 'The Announce lap times, Lead Announcer and Color Announcer checkboxes you ticked on the Live Racing page (signed-in users only).',
  },
  {
    name: 'visitor_id',
    kind: 'cookie',
    category: 'analytics',
    provider: 'RacingCoach.app',
    firstParty: true,
    httpOnly: true,
    duration: '1 year',
    purpose: 'A random ID that recognizes your browser across visits in our own activity log of page views and clicks, including before you sign up or log in.',
  },
  {
    name: 'activitySessionId',
    kind: 'sessionStorage',
    category: 'analytics',
    provider: 'RacingCoach.app',
    firstParty: true,
    duration: 'Until the browser tab is closed',
    purpose: 'A random ID that groups the page views and clicks of one browser tab in our activity log.',
  },
];

// Browser storage keys (not cookies) of one category, for removing them when consent is withdrawn
export function storageKeysOf(category: ConsentCategory, kind: 'localStorage' | 'sessionStorage'): string[] {
  return COOKIE_INVENTORY.filter((item) => item.category === category && item.kind === kind).flatMap((item) =>
    item.name.split(',').map((name) => name.trim())
  );
}
