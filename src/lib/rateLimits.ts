import { isIP } from 'node:net';
import { NextResponse } from 'next/server';
import type { PoolClient } from 'pg';
import { aiModelCategoryOf } from './aiModelList';
import { withAiUsage } from './aiTokenUsage';
import { query, transaction } from './db';
import { getDictionary, getLanguage } from './i18n/server';
import { fmt, LANGUAGE_LOCALES, type Language } from './i18n/languages';
import {
  DEFAULT_RATE_LIMITS,
  LIMIT_TIERS,
  type LimitRule,
  type LimitTier,
  type OverrideMode,
  parseRateLimitSettings,
  PERIOD_SECONDS,
  type Period,
  type RateLimitedFeature,
  type RateLimitInfo,
  type RateLimitOverride,
  type RateLimitSettings,
  type ResetStyle,
  type UsageRange,
  calendarWindowEnd,
  windowStart,
} from './rateLimitConfig';
import { ROLES } from './roles';
import { getShowPricing } from './siteSettings';
import { ensureUserSchema, type User } from './users';

export * from './rateLimitConfig';

// The Admin page's Rate Limiting section (src/components/RateLimitManager.tsx). Every AI route calls aiRateLimit
// before its AI call: the call is logged in racingcoach."AiUsage" and, while limits are on, refused with a 429
// when the user (or a visitor's IP address) has used up their membership level's limit, called too often in the
// last minute, is over the IP address cap, or is blocked by an override. The settings are JSON in
// racingcoach."SiteSettings" (key rate_limits), the overrides in racingcoach."RateLimitOverrides".

const SETTINGS_KEY = 'rate_limits';

// Read at most every 15 s per server, as every AI call needs them; saving clears it at once on this server
const SETTINGS_CACHE_MS = 15_000;
let cachedSettings: { at: number; settings: RateLimitSettings } | null = null;

export async function getRateLimitSettings(): Promise<RateLimitSettings> {
  if (cachedSettings && Date.now() - cachedSettings.at < SETTINGS_CACHE_MS) return cachedSettings.settings;
  await ensureUserSchema();
  const rows = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [SETTINGS_KEY]);
  let stored: unknown = null;
  try {
    stored = rows[0] ? JSON.parse(rows[0].value) : null;
  } catch {
    console.error('Rate limit settings are not valid JSON; using the defaults');
  }
  const settings = parseRateLimitSettings(stored, DEFAULT_RATE_LIMITS);
  cachedSettings = { at: Date.now(), settings };
  return settings;
}

export async function setRateLimitSettings(settings: RateLimitSettings, userId: number): Promise<void> {
  await ensureUserSchema();
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value, updated_by) VALUES ($1, $2, $3)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now(), updated_by = EXCLUDED.updated_by`,
    [SETTINGS_KEY, JSON.stringify(settings), userId]
  );
  cachedSettings = { at: Date.now(), settings };
}

// The caller's IP address: Render (and most hosts) put it first in X-Forwarded-For. Null locally
export function clientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for')?.split(',')[0].trim();
  return forwarded || request.headers.get('x-real-ip') || null;
}

export function tierOf(membershipLevel: string): LimitTier {
  return (LIMIT_TIERS as readonly string[]).includes(membershipLevel) && membershipLevel !== 'Anonymous'
    ? (membershipLevel as LimitTier)
    : 'Bronze';
}

function isExempt(settings: RateLimitSettings, user: User | null): boolean {
  if (!user) return false;
  if (settings.exemptRoles === 'admins') return user.role === ROLES.admin;
  if (settings.exemptRoles === 'staff') return user.role === ROLES.admin || user.role === ROLES.coach;
  return false;
}

// Whose calls a limit counts: one user's, one anonymous visitor's (no account, by IP address), or everyone's at
// an IP address
type Scope = { kind: 'user'; userId: number } | { kind: 'anonymous'; ip: string | null } | { kind: 'ip'; ip: string };

function scopeWhere(scope: Scope): { sql: string; param: unknown } {
  if (scope.kind === 'user') return { sql: 'user_id = $1', param: scope.userId };
  if (scope.kind === 'anonymous') return { sql: 'user_id IS NULL AND ip_address IS NOT DISTINCT FROM $1', param: scope.ip };
  return { sql: 'ip_address = $1', param: scope.ip };
}

async function usedSince(client: PoolClient, scope: Scope, since: Date): Promise<number> {
  const where = scopeWhere(scope);
  const { rows } = await client.query(
    `SELECT coalesce(sum(weight), 0) AS used FROM racingcoach."AiUsage"
     WHERE ${where.sql} AND allowed AND counted AND occurred_at >= $2`,
    [where.param, since]
  );
  return Number(rows[0].used);
}

// Seconds until enough of the window's calls have aged out (rolling) or the window ends (calendar) for one more
// call of this weight; null when it never will (a limit of 0, or a weight above the limit)
async function secondsUntilFree(client: PoolClient, scope: Scope, rule: LimitRule, style: ResetStyle, weight: number): Promise<number | null> {
  if (rule.limit === null || rule.limit < weight || rule.limit === 0) return null;
  const now = new Date();
  const start = windowStart(rule.period, style, now);
  if (style === 'calendar') return Math.max(1, Math.ceil((calendarWindowEnd(rule.period, start).getTime() - now.getTime()) / 1000));
  const where = scopeWhere(scope);
  const { rows } = await client.query(
    `SELECT occurred_at, weight FROM racingcoach."AiUsage"
     WHERE ${where.sql} AND allowed AND counted AND occurred_at >= $2 ORDER BY occurred_at`,
    [where.param, start]
  );
  let excess = rows.reduce((sum, row) => sum + Number(row.weight), 0) + weight - rule.limit;
  for (const row of rows) {
    excess -= Number(row.weight);
    if (excess <= 0) {
      const freeAt = new Date(row.occurred_at).getTime() + PERIOD_SECONDS[rule.period] * 1000;
      return Math.max(1, Math.ceil((freeAt - now.getTime()) / 1000));
    }
  }
  return null;
}

type ActiveOverride = { mode: OverrideMode; limit: number | null; period: Period };

async function activeOverrides(client: PoolClient, userId: number | null, ip: string | null) {
  const { rows } = await client.query(
    `SELECT user_id, ip_address, mode, limit_count, period FROM racingcoach."RateLimitOverrides"
     WHERE (user_id = $1 OR ip_address = $2) AND (expires_at IS NULL OR expires_at > now())`,
    [userId, ip]
  );
  const toOverride = (row: Record<string, unknown>): ActiveOverride => ({
    mode: row.mode as OverrideMode,
    limit: row.limit_count === null ? null : Number(row.limit_count),
    period: row.period as Period,
  });
  const userRow = rows.find((row) => row.user_id !== null);
  const ipRow = rows.find((row) => row.ip_address !== null);
  return { user: userRow ? toOverride(userRow) : null, ip: ipRow ? toOverride(ipRow) : null };
}

// An override's limit in place of the usual one: null for unlimited
const overrideRule = (override: ActiveOverride): LimitRule | null =>
  override.mode === 'unlimited' ? null : { limit: override.limit, period: override.period };

type Refusal = {
  reason: RateLimitInfo['reason'];
  rule: LimitRule | null;
  // The limit is an override's, which upgrading wouldn't change
  custom: boolean;
  retryAfterSeconds: number | null;
};

// Why this call is refused, or null when it's allowed
async function refusal(
  client: PoolClient,
  settings: RateLimitSettings,
  weight: number,
  tier: LimitTier,
  user: User | null,
  ip: string | null
): Promise<Refusal | null> {
  const overrides = await activeOverrides(client, user?.id ?? null, ip);
  if (overrides.user?.mode === 'blocked' || overrides.ip?.mode === 'blocked') {
    return { reason: 'blocked', rule: null, custom: true, retryAfterSeconds: null };
  }
  if (weight === 0) return null;

  // The caller's own limit: their override's, else their membership level's (a visitor's IP address override
  // takes the place of the Anonymous limit)
  const scope: Scope = user ? { kind: 'user', userId: user.id } : { kind: 'anonymous', ip };
  const ownOverride = user ? overrides.user : overrides.ip;
  const own = ownOverride ? overrideRule(ownOverride) : settings.tiers[tier];
  if (own && own.limit !== null) {
    const used = await usedSince(client, scope, windowStart(own.period, settings.resetStyle));
    if (used + weight > own.limit) {
      return {
        reason: 'limit',
        rule: own,
        custom: !!ownOverride,
        retryAfterSeconds: await secondsUntilFree(client, scope, own, settings.resetStyle, weight),
      };
    }
  }

  // Calls in the last minute, unless an override made them unlimited
  const burst = settings.burst[tier];
  if (burst !== null && ownOverride?.mode !== 'unlimited') {
    const where = scopeWhere(scope);
    const { rows } = await client.query(
      `SELECT count(*) AS calls, min(occurred_at) AS oldest FROM racingcoach."AiUsage"
       WHERE ${where.sql} AND allowed AND weight > 0 AND occurred_at >= now() - interval '1 minute'`,
      [where.param]
    );
    if (Number(rows[0].calls) >= burst) {
      const freeAt = new Date(rows[0].oldest).getTime() + 60_000;
      return { reason: 'burst', rule: null, custom: false, retryAfterSeconds: Math.max(1, Math.ceil((freeAt - Date.now()) / 1000)) };
    }
  }

  // Everyone at the IP address together (a visitor's own limit is already by IP address)
  if (user && ip && overrides.user?.mode !== 'unlimited') {
    const ipRule = overrides.ip ? overrideRule(overrides.ip) : settings.ip;
    if (ipRule && ipRule.limit !== null) {
      const ipScope: Scope = { kind: 'ip', ip };
      const used = await usedSince(client, ipScope, windowStart(ipRule.period, settings.resetStyle));
      if (used + weight > ipRule.limit) {
        return {
          reason: 'ipLimit',
          rule: ipRule,
          custom: true,
          retryAfterSeconds: await secondsUntilFree(client, ipScope, ipRule, settings.resetStyle, weight),
        };
      }
    }
  }
  return null;
}

// Old rows are deleted once a day per server
const KEEP_DAYS = 400;
let lastPrune = 0;
function pruneOldUsage() {
  if (Date.now() - lastPrune < 86_400_000) return;
  lastPrune = Date.now();
  query(`DELETE FROM racingcoach."AiUsage" WHERE occurred_at < now() - make_interval(days => $1)`, [KEEP_DAYS]).catch((error) =>
    console.error('Failed to prune old AI usage:', error)
  );
}

export type AiRateLimit = {
  // The 429 to answer instead of making the AI call, or null to go ahead
  response: NextResponse | null;
  // Call when the AI call failed, so it doesn't count against the limit
  refund: () => Promise<void>;
  // Runs the AI work so its tokens are recorded on this call's AiUsage row (src/lib/aiTokenUsage.ts)
  track: <T>(work: () => Promise<T>) => Promise<T>;
};

const noRefund = async () => {};

// The gate before every AI call: logs it, and refuses it while limits are on and the caller has used theirs up.
// user is the signed-in (or collector or Discord) user, null for a visitor; request is null where the caller's
// IP address means nothing (the Discord bot calls from its own server). A failure here never costs the user the
// AI call: it's logged and the call goes ahead.
export async function aiRateLimit(request: Request | null, feature: RateLimitedFeature, user: User | null): Promise<AiRateLimit> {
  const ip = request ? clientIp(request) : null;
  // Even an unlogged call runs with the caller's AI model category, so it uses their models
  const category = aiModelCategoryOf(user);
  const untracked = <T>(work: () => Promise<T>) => withAiUsage(null, category, work);
  let decision: { id: number; refusal: Refusal | null; tier: LimitTier; settings: RateLimitSettings };
  try {
    const settings = await getRateLimitSettings();
    const tier: LimitTier = user ? tierOf(user.membershipLevel) : 'Anonymous';
    const weight = settings.weights[feature];
    decision = await transaction(async (client) => {
      // One decision at a time per caller, so calls made together can't all slip under the limit
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user ? `ai-user:${user.id}` : `ai-ip:${ip ?? ''}`]);
      const refused = settings.enabled && !isExempt(settings, user) ? await refusal(client, settings, weight, tier, user, ip) : null;
      const { rows } = await client.query(
        `INSERT INTO racingcoach."AiUsage" (user_id, ip_address, feature, tier, weight, allowed, reason)
         VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
        [user?.id ?? null, ip, feature, tier, refused ? 0 : weight, !refused, refused?.reason ?? null]
      );
      return { id: Number(rows[0].id), refusal: refused, tier, settings };
    });
    pruneOldUsage();
  } catch (error) {
    console.error(`AI rate limit check failed for ${feature}; allowing the call:`, error);
    return { response: null, refund: noRefund, track: untracked };
  }

  if (!decision.refusal) {
    const id = decision.id;
    return {
      response: null,
      refund: async () => {
        try {
          await query('UPDATE racingcoach."AiUsage" SET counted = false, failed = true WHERE id = $1', [id]);
        } catch (error) {
          console.error('Failed to refund an AI call:', error);
        }
      },
      track: (work) => withAiUsage(id, category, work),
    };
  }

  const { refusal: refused, tier, settings } = decision;
  console.log(`AI rate limit: ${feature} refused (${refused.reason}) for ${user ? `user ${user.id}` : `IP ${ip ?? 'unknown'}`}`);
  const language = await getLanguage(user).catch(() => 'en' as Language);
  const { error, info } = await refusalMessage(refused, tier, settings, language);
  return {
    response: NextResponse.json(
      { error, rateLimit: info },
      {
        status: 429,
        headers: refused.retryAfterSeconds !== null ? { 'Retry-After': String(refused.retryAfterSeconds) } : undefined,
      }
    ),
    refund: noRefund,
    track: untracked,
  };
}

// "in 3 hours", "tomorrow", "em 20 minutos"...
function relativeTime(seconds: number, language: Language): string {
  const format = new Intl.RelativeTimeFormat(LANGUAGE_LOCALES[language], { numeric: 'auto' });
  if (seconds < 90) return format.format(Math.max(1, Math.round(seconds)), 'second');
  if (seconds < 90 * 60) return format.format(Math.round(seconds / 60), 'minute');
  if (seconds < 36 * 3600) return format.format(Math.round(seconds / 3600), 'hour');
  return format.format(Math.round(seconds / 86400), 'day');
}

const NEXT_LEVEL: Partial<Record<LimitTier, 'Silver' | 'Gold'>> = { Bronze: 'Silver', Silver: 'Gold' };

// The message a refused call answers, in the user's language, and what the page's dialog offers: upgrading to the
// next membership level (when its limit is higher and the Pricing page is shown), or a free account for a visitor
async function refusalMessage(refused: Refusal, tier: LimitTier, settings: RateLimitSettings, language: Language) {
  const dictionary = getDictionary(language);
  const t = dictionary.rateLimit;
  const when = refused.retryAfterSeconds !== null ? relativeTime(refused.retryAfterSeconds, language) : null;
  const level = dictionary.pricing.levelNames[tier] ?? tier;

  let upgradeTo: RateLimitInfo['upgradeTo'] = null;
  const signUp = refused.reason === 'limit' && tier === 'Anonymous' && !refused.custom;
  if (refused.reason === 'limit' && !refused.custom) {
    const next = NEXT_LEVEL[tier];
    const current = settings.tiers[tier].limit ?? Infinity;
    const higher = next ? (settings.tiers[next].limit ?? Infinity) > current : false;
    if (next && higher && (await getShowPricing().catch(() => false))) upgradeTo = next;
  }

  const parts: string[] = [];
  if (refused.reason === 'blocked') parts.push(t.blocked);
  else if (refused.reason === 'burst') parts.push(fmt(t.burst, { when: when ?? '' }));
  else if (refused.reason === 'ipLimit') parts.push(t.ipLimit);
  else if (refused.rule?.limit === 0) parts.push(tier === 'Anonymous' && !refused.custom ? t.anonymousNoAccess : refused.custom ? t.customNoAccess : fmt(t.noAccess, { level }));
  else {
    const period = t.periods[refused.rule?.period ?? 'day'];
    parts.push(tier === 'Anonymous' && !refused.custom ? fmt(t.anonymousUsedUp, { period }) : refused.custom ? fmt(t.customUsedUp, { period }) : fmt(t.usedUp, { level, period }));
  }

  if (refused.reason === 'limit' || refused.reason === 'ipLimit') {
    if (upgradeTo && when) parts.push(fmt(t.upgradeOrWait, { level: dictionary.pricing.levelNames[upgradeTo] ?? upgradeTo, when }));
    else if (upgradeTo) parts.push(fmt(t.upgrade, { level: dictionary.pricing.levelNames[upgradeTo] ?? upgradeTo }));
    else if (signUp) parts.push(when ? fmt(t.signUpOrWait, { when }) : t.signUp);
    else if (when) parts.push(fmt(t.tryAgain, { when }));
  }

  const info: RateLimitInfo = { reason: refused.reason, level: tier, upgradeTo, signUp, retryAfterSeconds: refused.retryAfterSeconds };
  return { error: parts.join(' '), info };
}

// ---- Overrides ----

export class RateLimitInputError extends Error {}

export async function listOverrides(): Promise<RateLimitOverride[]> {
  await ensureUserSchema();
  await query('DELETE FROM racingcoach."RateLimitOverrides" WHERE expires_at IS NOT NULL AND expires_at <= now()');
  const rows = await query(
    `SELECT o.id, o.user_id, u.user_name, u.email_address, o.ip_address, o.mode, o.limit_count, o.period, o.note,
            o.expires_at, o.created_at, c.user_name AS created_by
     FROM racingcoach."RateLimitOverrides" o
     LEFT JOIN racingcoach."Users" u ON u.id = o.user_id
     LEFT JOIN racingcoach."Users" c ON c.id = o.created_by
     ORDER BY o.created_at DESC`
  );
  return rows.map((row) => ({
    id: Number(row.id),
    kind: row.user_id !== null ? 'user' : 'ip',
    userId: row.user_id === null ? null : Number(row.user_id),
    userName: row.user_name ?? null,
    emailAddress: row.email_address ?? null,
    ipAddress: row.ip_address ?? null,
    mode: row.mode,
    limit: row.limit_count === null ? null : Number(row.limit_count),
    period: row.period,
    note: row.note ?? '',
    expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
    createdAt: new Date(row.created_at).toISOString(),
    createdBy: row.created_by ?? null,
  }));
}

export const isIpAddress = (value: unknown): value is string => typeof value === 'string' && isIP(value.trim()) !== 0;

// Sets the one override a user or IP address can have, replacing any earlier one
export async function saveOverride(
  input: {
    userId: number | null;
    ipAddress: string | null;
    mode: OverrideMode;
    limit: number | null;
    period: Period;
    note: string;
    durationSeconds: number | null;
  },
  adminId: number
): Promise<void> {
  await ensureUserSchema();
  const expiresAt = input.durationSeconds === null ? null : new Date(Date.now() + input.durationSeconds * 1000);
  const values = [input.mode, input.mode === 'custom' ? input.limit : null, input.period, input.note, expiresAt, adminId];
  if (input.userId !== null) {
    const [user] = await query('SELECT id FROM racingcoach."Users" WHERE id = $1', [input.userId]);
    if (!user) throw new RateLimitInputError('user');
    await query(
      `INSERT INTO racingcoach."RateLimitOverrides" (user_id, mode, limit_count, period, note, expires_at, created_by)
       VALUES ($7, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id) WHERE user_id IS NOT NULL DO UPDATE SET mode = EXCLUDED.mode, limit_count = EXCLUDED.limit_count,
         period = EXCLUDED.period, note = EXCLUDED.note, expires_at = EXCLUDED.expires_at, created_at = now(),
         created_by = EXCLUDED.created_by`,
      [...values, input.userId]
    );
  } else {
    await query(
      `INSERT INTO racingcoach."RateLimitOverrides" (ip_address, mode, limit_count, period, note, expires_at, created_by)
       VALUES ($7, $1, $2, $3, $4, $5, $6)
       ON CONFLICT (ip_address) WHERE ip_address IS NOT NULL DO UPDATE SET mode = EXCLUDED.mode, limit_count = EXCLUDED.limit_count,
         period = EXCLUDED.period, note = EXCLUDED.note, expires_at = EXCLUDED.expires_at, created_at = now(),
         created_by = EXCLUDED.created_by`,
      [...values, input.ipAddress]
    );
  }
}

export async function deleteOverride(id: number): Promise<boolean> {
  await ensureUserSchema();
  const rows = await query('DELETE FROM racingcoach."RateLimitOverrides" WHERE id = $1 RETURNING id', [id]);
  return rows.length > 0;
}

// Starts a user's (or everyone at an IP address's) count over: their calls so far stop counting against the
// limits but stay in the report
export async function resetUsage(target: { userId: number } | { ipAddress: string }): Promise<number> {
  await ensureUserSchema();
  const rows =
    'userId' in target
      ? await query('UPDATE racingcoach."AiUsage" SET counted = false WHERE user_id = $1 AND counted RETURNING id', [target.userId])
      : await query('UPDATE racingcoach."AiUsage" SET counted = false WHERE ip_address = $1 AND counted RETURNING id', [target.ipAddress]);
  return rows.length;
}

// ---- A user's own usage (the Account page's My AI Usage) ----

export type OwnAiUsage = { calls: number; weighted: number; inputTokens: number; outputTokens: number; blocked: number };

// The user's AI calls in the last 24 hours and the last 7 days, counted like the usage report's
export async function readOwnAiUsage(userId: number): Promise<{ day: OwnAiUsage; week: OwnAiUsage }> {
  await ensureUserSchema();
  const measures = (prefix: string, since: string) => `
    count(*) FILTER (WHERE allowed AND occurred_at >= ${since}) AS ${prefix}_calls,
    coalesce(sum(weight) FILTER (WHERE allowed AND NOT failed AND occurred_at >= ${since}), 0) AS ${prefix}_weighted,
    coalesce(sum(input_tokens) FILTER (WHERE occurred_at >= ${since}), 0) AS ${prefix}_input_tokens,
    coalesce(sum(output_tokens) FILTER (WHERE occurred_at >= ${since}), 0) AS ${prefix}_output_tokens,
    count(*) FILTER (WHERE NOT allowed AND occurred_at >= ${since}) AS ${prefix}_blocked`;
  const rows = await query(
    `SELECT ${measures('day', `now() - interval '1 day'`)}, ${measures('week', `now() - interval '7 days'`)}
     FROM racingcoach."AiUsage" WHERE user_id = $1 AND occurred_at >= now() - interval '7 days'`,
    [userId]
  );
  const toUsage = (prefix: string): OwnAiUsage => ({
    calls: Number(rows[0][`${prefix}_calls`]),
    weighted: Number(rows[0][`${prefix}_weighted`]),
    inputTokens: Number(rows[0][`${prefix}_input_tokens`]),
    outputTokens: Number(rows[0][`${prefix}_output_tokens`]),
    blocked: Number(rows[0][`${prefix}_blocked`]),
  });
  return { day: toUsage('day'), week: toUsage('week') };
}

// ---- Usage report ----

export type UsageCurrent = { used: number; limit: number | null; period: Period; unlimited: boolean; exempt: boolean };

export type UsageRow = {
  key: string;
  userId: number | null;
  userName: string | null;
  emailAddress: string | null;
  role: string | null;
  tier: LimitTier | null;
  // The IP address of an anonymous visitor (users view) or of the row (IP addresses view)
  ipAddress: string | null;
  calls: number;
  weighted: number;
  blocked: number;
  failed: number;
  // OpenAI tokens, added up over the calls' model calls (0 for calls from before tokens were recorded)
  inputTokens: number;
  outputTokens: number;
  // Users view: how many IP addresses the user called from. IP addresses view: how many accounts called from it
  distinct: number;
  names: string | null;
  lastAt: string;
  features: Partial<Record<string, number>>;
  current: UsageCurrent | null;
  override: OverrideMode | null;
};

export type UsageFeature = {
  feature: string;
  calls: number;
  blocked: number;
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  // Calls with tokens recorded and their model calls, for the averages per call
  trackedCalls: number;
  modelCalls: number;
  // The models the calls used, e.g. "gpt-5-mini, gpt-5.5"
  models: string | null;
};

export type UsageReport = {
  totals: {
    calls: number;
    weighted: number;
    blocked: number;
    failed: number;
    users: number;
    ips: number;
    inputTokens: number;
    cachedInputTokens: number;
    outputTokens: number;
  };
  features: UsageFeature[];
  rows: UsageRow[];
};

const REPORT_ROWS = 200;

function rangeStart(range: UsageRange): Date | null {
  return range === 'all' ? null : new Date(Date.now() - PERIOD_SECONDS[range] * 1000);
}

// AI calls in the range, by user (each anonymous visitor's IP address as its own row) or by IP address, most used
// first, with each row's usage of its current limit. search matches a name, email address or IP address
export async function readUsageReport(range: UsageRange, by: 'user' | 'ip', search: string): Promise<UsageReport> {
  await ensureUserSchema();
  const since = rangeStart(range);
  const needle = search.trim() ? `%${search.trim().replace(/[\\%_]/g, (c) => `\\${c}`)}%` : '';
  const filter = `($1::timestamptz IS NULL OR a.occurred_at >= $1)
    AND ($2 = '' OR u.user_name ILIKE $2 OR u.email_address ILIKE $2 OR a.ip_address ILIKE $2)`;
  const params = [since, needle];
  const from = 'racingcoach."AiUsage" a LEFT JOIN racingcoach."Users" u ON u.id = a.user_id';
  const measures = `count(*) FILTER (WHERE a.allowed) AS calls,
    coalesce(sum(a.weight) FILTER (WHERE a.allowed AND NOT a.failed), 0) AS weighted,
    count(*) FILTER (WHERE NOT a.allowed) AS blocked,
    count(*) FILTER (WHERE a.failed) AS failed,
    coalesce(sum(a.input_tokens), 0) AS input_tokens,
    coalesce(sum(a.cached_input_tokens), 0) AS cached_input_tokens,
    coalesce(sum(a.output_tokens), 0) AS output_tokens,
    max(a.occurred_at) AS last_at`;

  const [settings, overrides, totalsRows, featureRows] = await Promise.all([
    getRateLimitSettings(),
    listOverrides(),
    query(
      `SELECT ${measures}, count(DISTINCT a.user_id) AS users, count(DISTINCT a.ip_address) AS ips FROM ${from} WHERE ${filter}`,
      params
    ),
    query(
      `SELECT a.feature, count(*) FILTER (WHERE a.allowed) AS calls, count(*) FILTER (WHERE NOT a.allowed) AS blocked,
              coalesce(sum(a.input_tokens), 0) AS input_tokens, coalesce(sum(a.cached_input_tokens), 0) AS cached_input_tokens,
              coalesce(sum(a.output_tokens), 0) AS output_tokens, count(*) FILTER (WHERE a.model_calls > 0) AS tracked_calls,
              coalesce(sum(a.model_calls), 0) AS model_calls, string_agg(DISTINCT a.model, ', ') AS models
       FROM ${from} WHERE ${filter} GROUP BY a.feature
       ORDER BY coalesce(sum(a.input_tokens), 0) + coalesce(sum(a.output_tokens), 0) DESC, calls DESC`,
      params
    ),
  ]);

  const groupKey = by === 'user' ? `a.user_id, CASE WHEN a.user_id IS NULL THEN a.ip_address END` : 'a.ip_address';
  const groupRows = await query(
    by === 'user'
      ? `SELECT a.user_id, CASE WHEN a.user_id IS NULL THEN a.ip_address END AS anon_ip,
                max(u.user_name) AS user_name, max(u.email_address) AS email_address, max(u.role) AS role,
                max(u.membership_level) AS membership_level, ${measures}, count(DISTINCT a.ip_address) AS distinct_count
         FROM ${from} WHERE ${filter} GROUP BY ${groupKey} ORDER BY weighted DESC, calls DESC, last_at DESC LIMIT ${REPORT_ROWS}`
      : `SELECT a.ip_address, ${measures}, count(DISTINCT a.user_id) AS distinct_count,
                string_agg(DISTINCT u.user_name, ', ') AS names, bool_or(a.user_id IS NULL) AS has_anonymous
         FROM ${from} WHERE ${filter} GROUP BY ${groupKey} ORDER BY weighted DESC, calls DESC, last_at DESC LIMIT ${REPORT_ROWS}`,
    params
  );
  const featureByRow = await query(
    `SELECT ${by === 'user' ? `a.user_id, CASE WHEN a.user_id IS NULL THEN a.ip_address END AS anon_ip` : 'a.ip_address'},
            a.feature, count(*) AS calls
     FROM ${from} WHERE ${filter} AND a.allowed GROUP BY ${groupKey}, a.feature`,
    params
  );

  const keyOf = (row: Record<string, unknown>) =>
    by === 'user' ? (row.user_id !== null ? `u${row.user_id}` : `a${row.anon_ip ?? ''}`) : `i${row.ip_address ?? ''}`;
  const features = new Map<string, Partial<Record<string, number>>>();
  for (const row of featureByRow) {
    const key = keyOf(row);
    features.set(key, { ...features.get(key), [row.feature]: Number(row.calls) });
  }

  const userOverrides = new Map(overrides.filter((o) => o.userId !== null).map((o) => [o.userId, o]));
  const ipOverrides = new Map(overrides.filter((o) => o.ipAddress !== null).map((o) => [o.ipAddress, o]));

  const rows: UsageRow[] = groupRows.map((row) => {
    const isUser = by === 'user' && row.user_id !== null;
    const ipAddress = by === 'user' ? (row.anon_ip ?? null) : (row.ip_address ?? null);
    const override = isUser ? userOverrides.get(Number(row.user_id)) : ipAddress ? ipOverrides.get(ipAddress) : undefined;
    return {
      key: keyOf(row),
      userId: isUser ? Number(row.user_id) : null,
      userName: row.user_name ?? null,
      emailAddress: row.email_address ?? null,
      role: row.role ?? null,
      tier: by === 'user' ? (isUser ? tierOf(row.membership_level ?? 'Bronze') : 'Anonymous') : null,
      ipAddress,
      calls: Number(row.calls),
      weighted: Number(row.weighted),
      blocked: Number(row.blocked),
      failed: Number(row.failed),
      inputTokens: Number(row.input_tokens),
      outputTokens: Number(row.output_tokens),
      distinct: Number(row.distinct_count),
      names: row.names ?? null,
      lastAt: new Date(row.last_at).toISOString(),
      features: features.get(keyOf(row)) ?? {},
      current: null,
      override: override?.mode ?? null,
    };
  });

  await addCurrentUsage(rows, by, settings, userOverrides, ipOverrides);

  const totals = totalsRows[0];
  return {
    totals: {
      calls: Number(totals.calls),
      weighted: Number(totals.weighted),
      blocked: Number(totals.blocked),
      failed: Number(totals.failed),
      users: Number(totals.users),
      ips: Number(totals.ips),
      inputTokens: Number(totals.input_tokens),
      cachedInputTokens: Number(totals.cached_input_tokens),
      outputTokens: Number(totals.output_tokens),
    },
    features: featureRows.map((row) => ({
      feature: row.feature,
      calls: Number(row.calls),
      blocked: Number(row.blocked),
      inputTokens: Number(row.input_tokens),
      cachedInputTokens: Number(row.cached_input_tokens),
      outputTokens: Number(row.output_tokens),
      trackedCalls: Number(row.tracked_calls),
      modelCalls: Number(row.model_calls),
      models: row.models ?? null,
    })),
    rows,
  };
}

// Each row's usage of the limit that applies to it now: its override's, else its membership level's (users), the
// Anonymous limit (visitors) or the IP address cap (IP addresses)
async function addCurrentUsage(
  rows: UsageRow[],
  by: 'user' | 'ip',
  settings: RateLimitSettings,
  userOverrides: Map<number | null, RateLimitOverride>,
  ipOverrides: Map<string | null, RateLimitOverride>
) {
  type Need = { row: UsageRow; rule: LimitRule };
  const needs: Need[] = [];
  for (const row of rows) {
    const override = row.userId !== null ? userOverrides.get(row.userId) : row.ipAddress ? ipOverrides.get(row.ipAddress) : undefined;
    const exempt =
      row.userId !== null &&
      ((settings.exemptRoles === 'admins' && row.role === ROLES.admin) ||
        (settings.exemptRoles === 'staff' && (row.role === ROLES.admin || row.role === ROLES.coach)));
    const rule: LimitRule | null = override
      ? override.mode === 'custom'
        ? { limit: override.limit, period: override.period }
        : null
      : by === 'ip'
        ? settings.ip
        : settings.tiers[row.tier ?? 'Bronze'];
    if (exempt || !rule || rule.limit === null || override?.mode === 'blocked') {
      row.current = {
        used: 0,
        limit: override?.mode === 'blocked' ? 0 : null,
        period: rule?.period ?? 'day',
        unlimited: !exempt && override?.mode !== 'blocked',
        exempt,
      };
      continue;
    }
    needs.push({ row, rule });
  }

  // One query per period and kind of row
  const groups = new Map<string, Need[]>();
  for (const need of needs) {
    const kind = by === 'ip' ? 'ip' : need.row.userId !== null ? 'user' : 'anonymous';
    const key = `${kind}:${need.rule.period}`;
    groups.set(key, [...(groups.get(key) ?? []), need]);
  }
  await Promise.all(
    [...groups].map(async ([key, group]) => {
      const [kind, period] = key.split(':') as ['user' | 'anonymous' | 'ip', Period];
      const since = windowStart(period, settings.resetStyle);
      const ids = group.map((need) => (kind === 'user' ? need.row.userId : need.row.ipAddress));
      const column = kind === 'user' ? 'user_id' : 'ip_address';
      const used = await query(
        `SELECT ${column} AS id, coalesce(sum(weight), 0) AS used FROM racingcoach."AiUsage"
         WHERE ${column} = ANY($1) ${kind === 'anonymous' ? 'AND user_id IS NULL' : ''} AND allowed AND counted AND occurred_at >= $2
         GROUP BY ${column}`,
        [ids, since]
      );
      const byId = new Map(used.map((row) => [String(row.id), Number(row.used)]));
      for (const need of group) {
        const id = String(kind === 'user' ? need.row.userId : need.row.ipAddress);
        need.row.current = { used: byId.get(id) ?? 0, limit: need.rule.limit, period: need.rule.period, unlimited: false, exempt: false };
      }
    })
  );
}
