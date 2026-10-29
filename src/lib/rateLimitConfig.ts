// The Admin page's Rate Limiting settings: how many AI calls each membership level (and visitors who aren't
// signed in, counted by IP address) may make in a period, the options its boxes offer, and their defaults. No
// imports with server code, so the section's client components can use it; src/lib/rateLimits.ts stores the
// settings in racingcoach."SiteSettings" (key rate_limits) and enforces them.

// Every AI call a user can make: the AI features (src/lib/aiModelList.ts) except the collector log review, which
// the site runs for itself, plus the coach voice (OpenAI text to speech) and Racecar Analysis (the Python RAG script)
export const RATE_LIMITED_FEATURES = [
  'debriefCoach',
  'lapSummary',
  'multiLapSummary',
  'stintSummary',
  'raceTrends',
  'raceCoaching',
  'inCarCoachPlan',
  'inCarCoachCallouts',
  'speech',
  'racecarAnalysis',
  'raceAnnouncer',
] as const;

export type RateLimitedFeature = (typeof RATE_LIMITED_FEATURES)[number];

export const isRateLimitedFeature = (value: unknown): value is RateLimitedFeature =>
  (RATE_LIMITED_FEATURES as readonly string[]).includes(value as string);

// The membership levels plus visitors who aren't signed in, whose calls are counted by IP address
export const LIMIT_TIERS = ['Anonymous', 'Bronze', 'Silver', 'Gold'] as const;
export type LimitTier = (typeof LIMIT_TIERS)[number];

export const PERIODS = ['hour', 'day', 'week', 'month'] as const;
export type Period = (typeof PERIODS)[number];

// How long each period is for a rolling window (a month is 30 days)
export const PERIOD_SECONDS: Record<Period, number> = {
  hour: 3600,
  day: 86400,
  week: 7 * 86400,
  month: 30 * 86400,
};

// Rolling: the last hour/day/week/30 days. Calendar: since the start of the current hour, day, week (Monday)
// or month, in UTC, so everyone's count resets at the same moment
export const RESET_STYLES = ['rolling', 'calendar'] as const;
export type ResetStyle = (typeof RESET_STYLES)[number];

// Roles that are never limited: none, Admins, or Admins and Coaches
export const EXEMPT_ROLES = ['none', 'admins', 'staff'] as const;
export type ExemptRoles = (typeof EXEMPT_ROLES)[number];

// When the current window began: the last hour/day/week/30 days, or since the start of this hour, day, week
// (Monday) or month in UTC
export function windowStart(period: Period, style: ResetStyle, now = new Date()): Date {
  if (style === 'rolling') return new Date(now.getTime() - PERIOD_SECONDS[period] * 1000);
  const d = new Date(now);
  if (period === 'hour') d.setUTCMinutes(0, 0, 0);
  else {
    d.setUTCHours(0, 0, 0, 0);
    if (period === 'week') d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
    if (period === 'month') d.setUTCDate(1);
  }
  return d;
}

export function calendarWindowEnd(period: Period, start: Date): Date {
  const d = new Date(start);
  if (period === 'hour') d.setUTCHours(d.getUTCHours() + 1);
  else if (period === 'day') d.setUTCDate(d.getUTCDate() + 1);
  else if (period === 'week') d.setUTCDate(d.getUTCDate() + 7);
  else d.setUTCMonth(d.getUTCMonth() + 1);
  return d;
}

// A limit in weighted calls per period: null is unlimited, 0 is no AI at all
export type LimitRule = { limit: number | null; period: Period };

export type RateLimitSettings = {
  // Off: every call is still logged (and shows in the usage report), but nothing is limited
  enabled: boolean;
  resetStyle: ResetStyle;
  exemptRoles: ExemptRoles;
  tiers: Record<LimitTier, LimitRule>;
  // At most this many AI calls in any minute, against scripts and repeated clicks; null is off
  burst: Record<LimitTier, number | null>;
  // A cap on everyone at one IP address together, signed in or not (several accounts on one network)
  ip: LimitRule;
  // What one call of each feature counts against the limit: an agent like Debrief Coach makes several model
  // calls, so it can count more. 0 means the feature isn't limited (its calls are still logged)
  weights: Record<RateLimitedFeature, number>;
};

// The boxes' choices. Limits and bursts are in weighted calls; null is Unlimited (or Off for a burst)
export const LIMIT_OPTIONS: (number | null)[] = [0, 1, 2, 3, 5, 10, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500, 1000, 2000, null];
export const BURST_OPTIONS: (number | null)[] = [null, 1, 2, 3, 5, 10, 20, 30];
export const WEIGHT_OPTIONS = [0, 1, 2, 3, 5, 10];

// How long an override lasts; null is until it's removed
export const OVERRIDE_DURATIONS = [3600, 86400, 7 * 86400, 30 * 86400, 90 * 86400, null] as const;
export type OverrideDuration = (typeof OVERRIDE_DURATIONS)[number];

// An override for one user or one IP address: blocked from AI, unlimited, or a limit of its own in place of
// their membership level's (for an IP address, in place of the IP cap and the Anonymous limit)
export const OVERRIDE_MODES = ['custom', 'unlimited', 'blocked'] as const;
export type OverrideMode = (typeof OVERRIDE_MODES)[number];

export type RateLimitOverride = {
  id: number;
  kind: 'user' | 'ip';
  userId: number | null;
  userName: string | null;
  emailAddress: string | null;
  ipAddress: string | null;
  mode: OverrideMode;
  limit: number | null;
  period: Period;
  note: string;
  expiresAt: string | null;
  createdAt: string;
  createdBy: string | null;
};

// The usage report's time ranges
export const USAGE_RANGES = ['hour', 'day', 'week', 'month', 'all'] as const;
export type UsageRange = (typeof USAGE_RANGES)[number];

export const DEFAULT_RATE_LIMITS: RateLimitSettings = {
  enabled: false,
  resetStyle: 'rolling',
  exemptRoles: 'admins',
  tiers: {
    Anonymous: { limit: 3, period: 'day' },
    Bronze: { limit: 10, period: 'day' },
    Silver: { limit: 50, period: 'day' },
    Gold: { limit: 200, period: 'day' },
  },
  burst: { Anonymous: 2, Bronze: 3, Silver: 5, Gold: 10 },
  ip: { limit: null, period: 'day' },
  weights: {
    debriefCoach: 3,
    lapSummary: 1,
    multiLapSummary: 1,
    stintSummary: 1,
    raceTrends: 3,
    raceCoaching: 1,
    inCarCoachPlan: 0,
    inCarCoachCallouts: 1,
    speech: 0,
    racecarAnalysis: 1,
    // Live Racing's Race Announcers: a call per race event while they're on, so free by default like the coach voice
    raceAnnouncer: 0,
  },
};

const isOneOf = <T extends string>(values: readonly T[], value: unknown): value is T => values.includes(value as T);

function parseLimit(value: unknown, fallback: number | null): number | null {
  if (value === null) return null;
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 1_000_000 ? value : fallback;
}

function parseRule(value: unknown, fallback: LimitRule): LimitRule {
  const v = (value ?? {}) as Partial<LimitRule>;
  return {
    limit: 'limit' in v ? parseLimit(v.limit, fallback.limit) : fallback.limit,
    period: isOneOf(PERIODS, v.period) ? v.period : fallback.period,
  };
}

// Settings from stored or posted JSON; anything missing or invalid keeps its default (or `base`'s), so settings
// saved before a new option was added still load
export function parseRateLimitSettings(value: unknown, base: RateLimitSettings = DEFAULT_RATE_LIMITS): RateLimitSettings {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const tiers = (v.tiers ?? {}) as Record<string, unknown>;
  const burst = (v.burst ?? {}) as Record<string, unknown>;
  const weights = (v.weights ?? {}) as Record<string, unknown>;
  return {
    enabled: typeof v.enabled === 'boolean' ? v.enabled : base.enabled,
    resetStyle: isOneOf(RESET_STYLES, v.resetStyle) ? v.resetStyle : base.resetStyle,
    exemptRoles: isOneOf(EXEMPT_ROLES, v.exemptRoles) ? v.exemptRoles : base.exemptRoles,
    tiers: Object.fromEntries(LIMIT_TIERS.map((tier) => [tier, parseRule(tiers[tier], base.tiers[tier])])) as Record<LimitTier, LimitRule>,
    burst: Object.fromEntries(
      LIMIT_TIERS.map((tier) => [tier, tier in burst ? parseLimit(burst[tier], base.burst[tier]) : base.burst[tier]])
    ) as Record<LimitTier, number | null>,
    ip: parseRule(v.ip, base.ip),
    weights: Object.fromEntries(
      RATE_LIMITED_FEATURES.map((feature) => {
        const w = weights[feature];
        return [feature, typeof w === 'number' && Number.isInteger(w) && w >= 0 && w <= 100 ? w : base.weights[feature]];
      })
    ) as Record<RateLimitedFeature, number>,
  };
}

// What the 429 answer of a limited AI call carries besides its message (src/components/RateLimitDialog.tsx)
export type RateLimitInfo = {
  reason: 'limit' | 'burst' | 'ipLimit' | 'blocked';
  level: LimitTier;
  // The next membership level up, when upgrading would raise the limit and the Pricing page is shown
  upgradeTo: 'Silver' | 'Gold' | null;
  // A visitor who isn't signed in gets more by creating a free account
  signUp: boolean;
  retryAfterSeconds: number | null;
};
