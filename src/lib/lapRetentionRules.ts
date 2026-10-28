// Lap telemetry retention rules: how long a lap (or a saved Debrief Coach run) is kept, by membership level. Only
// imports accountStatus.ts (dependency-free) so Node can run it in scripts/lap-retention.test.mjs, and pages can
// show the periods. The database applies the same rules in SQL (lapRetentionDb.ts: lap_expires_at and the
// membership trigger); the tests check that the two agree. Times are UTC instants (Date), compared exactly.
//
// The periods are the business's choice of how much history each level includes, not durations set by the GDPR:
// Bronze 30 days, Silver 60, Gold 90, never more than 90, counted from when the lap was completed. A level this file
// doesn't know (e.g. one added later) gets Bronze's, the shortest, until it's added here and in lapRetentionDb.ts.
import { MEMBERSHIP_LEVEL, levelRank } from './accountStatus.ts';

export const RETENTION_DAYS: Record<string, number> = {
  [MEMBERSHIP_LEVEL.bronze]: 30,
  [MEMBERSHIP_LEVEL.silver]: 60,
  [MEMBERSHIP_LEVEL.gold]: 90,
};

// No lap is kept longer than this after completion, whatever the level
export const MAX_RETENTION_DAYS = 90;

// For an unknown level: the shortest period
export const FALLBACK_RETENTION_DAYS = 30;

// When a Gold membership ends (canceled, or a renewal that failed), its laps keep Gold's period for this many days
// after the paid period ends, as a grace period and a measure of goodwill (never past MAX_RETENTION_DAYS)
export const GOLD_GRACE_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

const addDays = (time: Date, days: number) => new Date(time.getTime() + days * DAY_MS);
const earliest = (a: Date, b: Date) => (a.getTime() <= b.getTime() ? a : b);
const latest = (a: Date, b: Date) => (a.getTime() >= b.getTime() ? a : b);

export function retentionDays(membershipLevel: string | null | undefined): number {
  const days = membershipLevel ? RETENTION_DAYS[membershipLevel] : undefined;
  return Math.min(days ?? FALLBACK_RETENTION_DAYS, MAX_RETENTION_DAYS);
}

// When a lap was completed, for its retention clock: the time the collector recorded, but never after the server
// received it, so a wrong clock on the PC can't lengthen it
export function lapCompletedAt(recordedAt: Date, receivedAt: Date): Date {
  return earliest(recordedAt, receivedAt);
}

// When a lap completed at completedAt expires for a member of this level: the first instant it's no longer
// available. Expired means expiresAt <= now.
export function lapExpiresAt(completedAt: Date, membershipLevel: string | null | undefined): Date {
  return addDays(completedAt, retentionDays(membershipLevel));
}

export const isExpired = (expiresAt: Date, now: Date) => expiresAt.getTime() <= now.getTime();

// The Gold grace period's end for a membership that has ended: GOLD_GRACE_DAYS after the paid period's end
export function goldGraceUntil(subscriptionEndDate: Date): Date {
  return addDays(subscriptionEndDate, GOLD_GRACE_DAYS);
}

// A lap's new expiry when its owner's level changes from previousLevel to level. An expired lap stays expired (an
// upgrade never restores one). Moving up gives the lap the new level's period when that's longer; moving down
// shortens it to the new level's, so laps past it expire at once, except that graceUntil (a Gold membership that
// ended, goldGraceUntil) keeps them until then. Never past MAX_RETENTION_DAYS.
export function restampExpiresAt(lap: {
  completedAt: Date;
  expiresAt: Date;
  previousLevel: string;
  level: string;
  now: Date;
  graceUntil?: Date | null;
}): Date {
  const { completedAt, expiresAt, now } = lap;
  if (isExpired(expiresAt, now)) return expiresAt;
  const atLevel = lapExpiresAt(completedAt, lap.level);
  if (levelRank(lap.level) > levelRank(lap.previousLevel)) return latest(expiresAt, atLevel);
  const ceiling = addDays(completedAt, MAX_RETENTION_DAYS);
  const kept = lap.graceUntil ? latest(atLevel, earliest(lap.graceUntil, ceiling)) : atLevel;
  return earliest(expiresAt, kept);
}
