// The My Dashboard page's rules, with no I/O so Node runs them directly in scripts/my-dashboard.test.mjs: how the name,
// email and track are shown, how a track's outline becomes its map, and which state a subscription is in.
import { ACCOUNT_STATUS, MEMBERSHIP_LEVEL } from './accountStatus.ts';
import { METERS_PER_FOOT, type Units } from './units.ts';

// A name on two lines, the last word in red: "Darin Lutz" is Darin, Lutz. A single word is all "last"
export function splitDriverName(name: string): { first: string; last: string } {
  const words = name.trim().split(/\s+/);
  const last = words.pop() ?? '';
  return { first: words.join(' '), last };
}

// The email address, partly hidden, as drivers stream and share their screens: the first letter and the domain
export function maskEmail(email: string): string {
  const at = email.lastIndexOf('@');
  if (at < 1) return '•••••';
  return `${email[0]}•••••${email.slice(at)}`;
}

// Track names are "Track (Layout)", from the collector and in "Tracks".track_name; this is the same rule as
// PHYSICAL_TRACK_SQL in dashboard.ts
export function splitTrackName(name: string): { track: string; config: string | null } {
  const match = /^(.*\S)\s*\(([^()]*)\)\s*$/.exec(name.trim());
  return match ? { track: match[1], config: match[2] } : { track: name.trim(), config: null };
}

const FEET_PER_MILE = 5280;

// Feet of track, in the driver's Preferred Units: miles or kilometers
export function longDistance(feet: number, units: Units): number {
  return units === 'metric' ? (feet * METERS_PER_FOOT) / 1000 : feet / FEET_PER_MILE;
}

const MAP_WIDTH = 100;
const MAP_HEIGHT = 62;
const MAP_MARGIN = 3;

// A track outline ("Tracks".track_outline, see trackOutlines.ts) as an SVG path in a MAP_WIDTH x MAP_HEIGHT box, north
// up; null when there's nothing to draw
export function trackMapPath(outline: { kind: 'latlon' | 'meters'; points: [number, number][] } | null | undefined): string | null {
  const points = outline?.points?.filter((point) => point.every(Number.isFinite)) ?? [];
  if (!outline || points.length < 3) return null;
  // [east, north]: a degree of longitude is shorter than one of latitude, by the cosine of the latitude
  const middle = points.reduce((sum, point) => sum + point[0], 0) / points.length;
  const stretch = Math.cos((middle * Math.PI) / 180);
  const flat = points.map(([a, b]) => (outline.kind === 'latlon' ? [b * stretch, a] : [a, b]));
  const [xs, ys] = [flat.map((point) => point[0]), flat.map((point) => point[1])];
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min((MAP_WIDTH - 2 * MAP_MARGIN) / (maxX - minX || 1), (MAP_HEIGHT - 2 * MAP_MARGIN) / (maxY - minY || 1));
  const [offsetX, offsetY] = [(MAP_WIDTH - (maxX - minX) * scale) / 2, (MAP_HEIGHT - (maxY - minY) * scale) / 2];
  const path = flat.map(
    ([x, y], i) => `${i ? 'L' : 'M'}${((x - minX) * scale + offsetX).toFixed(2)} ${(MAP_HEIGHT - ((y - minY) * scale + offsetY)).toFixed(2)}`
  );
  return `${path.join(' ')} Z`;
}

export const TRACK_MAP_VIEW_BOX = `0 0 ${MAP_WIDTH} ${MAP_HEIGHT}`;

// The account's "Users" columns and its current "StripeSubscriptions" row, which the webhook keeps as Stripe says it is
export type SubscriptionFacts = {
  membershipLevel: string;
  accountStatus: string;
  subscriptionEndDate: string | null;
  stripeSubscriptionId: string | null;
  stripe: {
    id: string;
    status: string;
    cancelAtPeriodEnd: boolean;
    cancelAt: string | null;
    currentPeriodEnd: string | null;
    nextInvoiceAt: string | null;
  } | null;
};

export type SubscriptionState =
  // Bronze, with no paid subscription
  | 'free'
  // Paying, or on a trial, and renewing
  | 'active'
  | 'trialing'
  // A payment failed, or never went through; Stripe is still trying
  | 'pastDue'
  | 'paused'
  // Still running, but set to end: nothing has ended yet
  | 'cancelScheduled'
  // Already canceled, with paid time left
  | 'canceled'
  // Over: canceled and the paid time is gone, or not renewed
  | 'ended'
  | 'expired'
  // A paid level with no subscription, set on the Admin page
  | 'complimentary';

// What date goes with the state
export type SubscriptionDateKind = 'renews' | 'nextAttempt' | 'ends' | 'accessUntil' | 'ended';

export type SubscriptionView = { state: SubscriptionState; date: string | null; dateKind: SubscriptionDateKind | null };

// Stripe still has a subscription to change or cancel
const MANAGEABLE: ReadonlySet<SubscriptionState> = new Set(['active', 'trialing', 'pastDue', 'paused', 'cancelScheduled']);

export const hasManageableSubscription = (state: SubscriptionState) => MANAGEABLE.has(state);

export function subscriptionView(facts: SubscriptionFacts, now: Date = new Date()): SubscriptionView {
  const ahead = (date: string | null | undefined) => (date && Date.parse(date) > now.getTime() ? date : null);
  const { accountStatus, membershipLevel, subscriptionEndDate: paidUntil } = facts;
  // An older subscription says nothing about the one the account has now (e.g. after buying again, or an upgrade
  // whose new subscription hasn't been synced yet)
  const stripe = facts.stripe && (!facts.stripeSubscriptionId || facts.stripe.id === facts.stripeSubscriptionId) ? facts.stripe : null;

  switch (stripe?.status) {
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return { state: 'pastDue', date: ahead(stripe.nextInvoiceAt) ?? ahead(stripe.currentPeriodEnd), dateKind: 'nextAttempt' };
    case 'paused':
      return { state: 'paused', date: null, dateKind: null };
    case 'active':
    case 'trialing': {
      if (stripe.cancelAtPeriodEnd || stripe.cancelAt) {
        return { state: 'cancelScheduled', date: ahead(stripe.cancelAt) ?? ahead(stripe.currentPeriodEnd) ?? ahead(paidUntil), dateKind: 'ends' };
      }
      return {
        state: stripe.status === 'trialing' ? 'trialing' : 'active',
        date: ahead(stripe.nextInvoiceAt) ?? ahead(stripe.currentPeriodEnd) ?? ahead(paidUntil),
        dateKind: 'renews',
      };
    }
  }

  // Stripe has ended it, whatever the account says until its webhook arrives
  const stripeEnded = stripe?.status === 'canceled' || stripe?.status === 'incomplete_expired';
  // Accounts from before "StripeSubscriptions" have only the account's own columns
  if (accountStatus === ACCOUNT_STATUS.subscribed && !stripeEnded) {
    return { state: 'active', date: ahead(paidUntil), dateKind: 'renews' };
  }
  if (accountStatus === ACCOUNT_STATUS.canceled || accountStatus === ACCOUNT_STATUS.subscribed) {
    if (ahead(paidUntil)) return { state: 'canceled', date: paidUntil, dateKind: 'accessUntil' };
    if (membershipLevel === MEMBERSHIP_LEVEL.bronze) return { state: 'ended', date: paidUntil, dateKind: 'ended' };
  }
  if (membershipLevel !== MEMBERSHIP_LEVEL.bronze) return { state: 'complimentary', date: null, dateKind: null };
  if (accountStatus === ACCOUNT_STATUS.expired) return { state: 'expired', date: paidUntil, dateKind: 'ended' };
  return { state: 'free', date: null, dateKind: null };
}
