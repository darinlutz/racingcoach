import { query } from './db';
import { ensureUserSchema } from './users';
import { isTimeZone } from './activityReport';
import { PLANS } from './accountStatus';
import { ACTIVE_STATUSES, PAID_STATUSES } from './stripeBilling';

// The Admin Subscribers page (src/app/admin/subscribers/) and its CSV export: every account with its current
// subscription from racingcoach."StripeSubscriptions" and the discount code it signed up with from "StripeDiscounts"
// (src/lib/stripeBilling.ts). Filters, sorting and pages come from the URL and are applied in SQL.

export const SUBSCRIBERS_PAGE_SIZE = 50;
export const MAX_SUBSCRIBER_EXPORT_ROWS = 10000;

// The page's Status filter: Stripe's subscription statuses, plus 'none' (never subscribed) and 'unsynced' (Users
// has a subscription the Subscribers tables don't have yet: run Sync from Stripe)
export const SUBSCRIBER_STATUSES = [
  'none',
  'active',
  'trialing',
  'past_due',
  'canceled',
  'unpaid',
  'incomplete',
  'incomplete_expired',
  'paused',
  'unsynced',
] as const;

const SORTS = ['signup', 'name', 'plan', 'discount'] as const;
export type SubscriberSort = (typeof SORTS)[number];

export type SubscriberFilters = {
  timeZone: string;
  search: string | null;
  status: string | null;
  // A PLANS key, or 'none'
  plan: string | null;
  // A code (any case), 'any' (used one) or 'none' (didn't)
  code: string | null;
  // Signup dates, YYYY-MM-DD in timeZone, both inclusive
  from: string | null;
  to: string | null;
  sort: SubscriberSort;
  dir: 'asc' | 'desc';
  page: number;
};

export type SubscriberRow = {
  // For a deleted account, the ID it had
  userId: number;
  // Deleted accounts keep their billing history but not their name, email or signup date
  accountDeleted: boolean;
  userName: string | null;
  emailAddress: string | null;
  signedUpAt: string | null;
  // Stripe's status of the account's current subscription, 'none' or 'unsynced'
  status: string;
  plan: string | null;
  stripeSubscriptionId: string | null;
  stripeCustomerId: string | null;
  currency: string | null;
  originalAmount: number | null;
  currentAmount: number | null;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  subscriptionStartedAt: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  canceledAt: string | null;
  endedAt: string | null;
  // The account's original discount: the first one applied at signup (or, failing that, the first one at all)
  promotionCode: string | null;
  codeStatus: string | null;
  couponName: string | null;
  percentOff: number | null;
  amountOff: number | null;
  duration: string | null;
  durationInMonths: number | null;
};

type Params = Record<string, string | string[] | undefined>;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function one(params: Params, key: string): string | null {
  const value = params[key];
  const text = (Array.isArray(value) ? value[0] : value)?.trim();
  return text ? text.slice(0, 200) : null;
}

export function parseSubscriberFilters(params: Params): SubscriberFilters {
  const zone = one(params, 'tz');
  const status = one(params, 'status');
  const plan = one(params, 'plan');
  const from = one(params, 'from');
  const to = one(params, 'to');
  const sort = one(params, 'sort');
  const page = Number(one(params, 'page'));
  return {
    timeZone: zone && isTimeZone(zone) ? zone : 'UTC',
    search: one(params, 'q'),
    status: status && (SUBSCRIBER_STATUSES as readonly string[]).includes(status) ? status : null,
    plan: plan === 'none' || (plan && Object.hasOwn(PLANS, plan)) ? plan : null,
    code: one(params, 'code'),
    from: from && DATE_RE.test(from) ? from : null,
    to: to && DATE_RE.test(to) ? to : null,
    sort: SORTS.includes(sort as SubscriberSort) ? (sort as SubscriberSort) : 'signup',
    dir: one(params, 'dir') === 'asc' ? 'asc' : 'desc',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

// The filters as URL parameters, leaving out empty ones
export function subscriberFilterParams(filters: SubscriberFilters, changes: Partial<SubscriberFilters> = {}): URLSearchParams {
  const f = { ...filters, page: 1, ...changes };
  const params = new URLSearchParams();
  params.set('tz', f.timeZone);
  if (f.search) params.set('q', f.search);
  if (f.status) params.set('status', f.status);
  if (f.plan) params.set('plan', f.plan);
  if (f.code) params.set('code', f.code);
  if (f.from) params.set('from', f.from);
  if (f.to) params.set('to', f.to);
  if (f.sort !== 'signup') params.set('sort', f.sort);
  if (f.dir !== 'desc') params.set('dir', f.dir);
  if (f.page > 1) params.set('page', String(f.page));
  return params;
}

// The account a billing row belongs to: its user, or the deleted account it belonged to (account IDs are never
// reused, so the two can't collide)
const ACCOUNT = (alias: string) => `COALESCE(${alias}.user_id, ${alias}.deleted_user_id)`;

const SUBSCRIPTION_COLUMNS = `s.plan, s.currency, s.original_amount, s.current_amount, s.billing_interval, s.billing_interval_count,
    s.start_date, s.current_period_end, s.cancel_at_period_end, s.canceled_at, s.ended_at,
    od.promotion_code, od.code_status, od.coupon_name, od.percent_off, od.amount_off, od.duration, od.duration_in_months`;
const ORIGINAL_DISCOUNT = (account: string) => `LEFT JOIN LATERAL (
    SELECT * FROM racingcoach."StripeDiscounts" d WHERE ${ACCOUNT('d')} = ${account}
    ORDER BY d.at_signup DESC, d.applied_at
    LIMIT 1
  ) od ON true`;

// Every account, with its current subscription (the one Users points at, else its latest) and original discount; then
// every deleted account that had a subscription (Delete Account keeps the billing history, without name or email)
const BASE = `
  SELECT u.id, false AS account_deleted, u.user_name, u.email_address,
    CASE WHEN u.signup_date ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN u.signup_date::timestamptz ELSE u.created_at END AS signed_up_at,
    COALESCE(s.status, CASE WHEN u.stripe_subscription_id IS NOT NULL THEN 'unsynced' ELSE 'none' END) AS status,
    COALESCE(s.stripe_subscription_id, u.stripe_subscription_id) AS stripe_subscription_id,
    COALESCE(s.stripe_customer_id, u.stripe_customer_id) AS stripe_customer_id,
    ${SUBSCRIPTION_COLUMNS}
  FROM racingcoach."Users" u
  LEFT JOIN LATERAL (
    SELECT * FROM racingcoach."StripeSubscriptions" s WHERE s.user_id = u.id
    ORDER BY (s.stripe_subscription_id = u.stripe_subscription_id) IS TRUE DESC, s.start_date DESC
    LIMIT 1
  ) s ON true
  ${ORIGINAL_DISCOUNT('u.id')}
  UNION ALL
  SELECT gone.id, true, NULL, NULL, NULL::timestamptz, s.status, s.stripe_subscription_id, s.stripe_customer_id,
    ${SUBSCRIPTION_COLUMNS}
  FROM (SELECT DISTINCT deleted_user_id AS id FROM racingcoach."StripeSubscriptions"
        WHERE user_id IS NULL AND deleted_user_id IS NOT NULL) gone
  CROSS JOIN LATERAL (
    SELECT * FROM racingcoach."StripeSubscriptions" s WHERE s.user_id IS NULL AND s.deleted_user_id = gone.id
    ORDER BY s.start_date DESC
    LIMIT 1
  ) s
  ${ORIGINAL_DISCOUNT('gone.id')}`;

// Plans in PLANS' order (Silver before Gold, monthly before annual) rather than alphabetically
const PLAN_ORDER = `CASE b.plan ${Object.keys(PLANS)
  .map((plan, i) => `WHEN '${plan}' THEN ${i}`)
  .join(' ')} END`;

function where(filters: SubscriberFilters): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };
  const conditions: string[] = [];
  const usedCode = (condition: string) =>
    `EXISTS (SELECT 1 FROM racingcoach."StripeDiscounts" d WHERE ${ACCOUNT('d')} = b.id AND ${condition})`;
  if (filters.search) {
    const like = add(`%${filters.search.replace(/[\\%_]/g, '\\$&')}%`);
    conditions.push(`(b.user_name ILIKE ${like} OR b.email_address ILIKE ${like} OR ${usedCode(`d.promotion_code ILIKE ${like}`)})`);
  }
  if (filters.status) conditions.push(`b.status = ${add(filters.status)}`);
  if (filters.plan === 'none') conditions.push('b.plan IS NULL');
  else if (filters.plan) conditions.push(`b.plan = ${add(filters.plan)}`);
  if (filters.code === 'any') conditions.push(usedCode(`d.code_status <> 'coupon'`));
  else if (filters.code === 'none') conditions.push(`NOT ${usedCode(`d.code_status <> 'coupon'`)}`);
  else if (filters.code) conditions.push(usedCode(`upper(d.promotion_code) = upper(${add(filters.code)})`));
  if (filters.from) {
    conditions.push(`b.signed_up_at >= (${add(filters.from)}::date)::timestamp AT TIME ZONE ${add(filters.timeZone)}`);
  }
  if (filters.to) {
    conditions.push(`b.signed_up_at < (${add(filters.to)}::date + 1)::timestamp AT TIME ZONE ${add(filters.timeZone)}`);
  }
  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

function orderBy(filters: SubscriberFilters): string {
  const dir = filters.dir === 'asc' ? 'ASC' : 'DESC';
  const column = {
    signup: 'b.signed_up_at',
    name: 'lower(b.user_name)',
    plan: PLAN_ORDER,
    discount: 'b.percent_off',
  }[filters.sort];
  return `ORDER BY ${column} ${dir} NULLS LAST, b.id ${dir}`;
}

function rowToSubscriber(row: Record<string, unknown>): SubscriberRow {
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);
  const num = (value: unknown) => (value == null ? null : Number(value));
  return {
    userId: Number(row.id),
    accountDeleted: row.account_deleted === true,
    userName: (row.user_name as string | null) ?? null,
    emailAddress: (row.email_address as string | null) ?? null,
    signedUpAt: iso(row.signed_up_at),
    status: row.status as string,
    plan: (row.plan as string | null) ?? null,
    stripeSubscriptionId: (row.stripe_subscription_id as string | null) ?? null,
    stripeCustomerId: (row.stripe_customer_id as string | null) ?? null,
    currency: (row.currency as string | null) ?? null,
    originalAmount: num(row.original_amount),
    currentAmount: num(row.current_amount),
    billingInterval: (row.billing_interval as string | null) ?? null,
    billingIntervalCount: num(row.billing_interval_count),
    subscriptionStartedAt: iso(row.start_date),
    currentPeriodEnd: iso(row.current_period_end),
    cancelAtPeriodEnd: row.cancel_at_period_end === true,
    canceledAt: iso(row.canceled_at),
    endedAt: iso(row.ended_at),
    promotionCode: (row.promotion_code as string | null) ?? null,
    codeStatus: (row.code_status as string | null) ?? null,
    couponName: (row.coupon_name as string | null) ?? null,
    percentOff: num(row.percent_off),
    amountOff: num(row.amount_off),
    duration: (row.duration as string | null) ?? null,
    durationInMonths: num(row.duration_in_months),
  };
}

export async function readSubscribers(filters: SubscriberFilters): Promise<{ rows: SubscriberRow[]; total: number }> {
  await ensureUserSchema();
  const { sql, params } = where(filters);
  const offset = (filters.page - 1) * SUBSCRIBERS_PAGE_SIZE;
  const [rows, [count]] = await Promise.all([
    query(`SELECT * FROM (${BASE}) b ${sql} ${orderBy(filters)} LIMIT ${SUBSCRIBERS_PAGE_SIZE} OFFSET ${offset}`, params),
    query(`SELECT count(*)::int AS total FROM (${BASE}) b ${sql}`, params),
  ]);
  return { rows: rows.map(rowToSubscriber), total: Number(count.total) };
}

export async function readSubscriberExport(filters: SubscriberFilters): Promise<SubscriberRow[]> {
  await ensureUserSchema();
  const { sql, params } = where(filters);
  const rows = await query(`SELECT * FROM (${BASE}) b ${sql} ${orderBy(filters)} LIMIT ${MAX_SUBSCRIBER_EXPORT_ROWS}`, params);
  return rows.map(rowToSubscriber);
}

// Every code anyone has used, for the Discount code filter
export async function listDiscountCodes(): Promise<string[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT DISTINCT ON (upper(promotion_code)) promotion_code FROM racingcoach."StripeDiscounts"
     WHERE code_status = 'known' ORDER BY upper(promotion_code)`
  );
  return rows.map((row) => row.promotion_code as string);
}

export type CodeUsage = {
  // 'known' (code is set), 'coupon' (a coupon applied without a code: couponName) or 'unknown'
  codeStatus: string;
  code: string | null;
  couponName: string | null;
  // Unique accounts that used it, and how many of them have a running subscription now
  subscribers: number;
  activeSubscribers: number;
  // Times it was applied (an account can redeem a code on more than one subscription)
  redemptions: number;
  percents: number[];
  amountOff: number | null;
  amountOffCurrency: string | null;
};

export type CodeUsageReport = {
  totalUsers: number;
  totalSubscribers: number;
  activePaidSubscribers: number;
  withCode: number;
  withoutCode: number;
  // Subscribers who never used a promotion code (the report's NONE row)
  noCode: { subscribers: number; activeSubscribers: number };
  codes: CodeUsage[];
};

// The Discount Code Usage section. Counts unique accounts, not redemptions (shown separately). Every number comes
// from the stored history, so a code disabled or deleted in Stripe, or used by an account since deleted, still counts.
export async function readCodeUsage(): Promise<CodeUsageReport> {
  await ensureUserSchema();
  // Accounts, including deleted ones (their billing history is kept), by ACCOUNT()
  const subscribers = `(SELECT ${ACCOUNT('x')} AS user_id FROM racingcoach."StripeSubscriptions" x WHERE ${ACCOUNT('x')} IS NOT NULL
     UNION SELECT id FROM racingcoach."Users" WHERE stripe_subscription_id IS NOT NULL)`;
  const active = `(SELECT ${ACCOUNT('x')} FROM racingcoach."StripeSubscriptions" x
     WHERE ${ACCOUNT('x')} IS NOT NULL AND x.status = ANY($1))`;
  const withCode = `(SELECT ${ACCOUNT('x')} FROM racingcoach."StripeDiscounts" x
     WHERE ${ACCOUNT('x')} IS NOT NULL AND x.code_status <> 'coupon')`;
  const [[totals], codes] = await Promise.all([
    query(
      `SELECT
         (SELECT count(*) FROM racingcoach."Users")::int AS total_users,
         (SELECT count(*) FROM ${subscribers} s)::int AS total_subscribers,
         (SELECT count(DISTINCT ${ACCOUNT('x')}) FROM racingcoach."StripeSubscriptions" x WHERE x.status = ANY($2))::int
           AS active_paid,
         (SELECT count(*) FROM ${subscribers} s WHERE user_id IN ${withCode})::int AS with_code,
         (SELECT count(*) FROM ${subscribers} s WHERE user_id NOT IN ${withCode})::int AS without_code,
         (SELECT count(*) FROM ${subscribers} s WHERE user_id NOT IN ${withCode} AND user_id IN ${active})::int AS without_code_active`,
      [ACTIVE_STATUSES, PAID_STATUSES]
    ),
    query(
      `SELECT d.code_status, min(d.promotion_code) AS code, min(COALESCE(d.coupon_name, d.stripe_coupon_id)) AS coupon_name,
         count(DISTINCT ${ACCOUNT('d')})::int AS subscribers,
         count(DISTINCT ${ACCOUNT('d')}) FILTER (WHERE ${ACCOUNT('d')} IN ${active})::int AS active_subscribers,
         count(DISTINCT d.discount_key)::int AS redemptions,
         COALESCE(array_agg(DISTINCT d.percent_off) FILTER (WHERE d.percent_off IS NOT NULL), '{}') AS percents,
         min(d.amount_off) AS amount_off, min(d.amount_off_currency) AS amount_off_currency
       FROM racingcoach."StripeDiscounts" d
       WHERE ${ACCOUNT('d')} IS NOT NULL
       GROUP BY d.code_status, CASE d.code_status
         WHEN 'known' THEN upper(d.promotion_code)
         WHEN 'coupon' THEN COALESCE(d.coupon_name, d.stripe_coupon_id)
         ELSE '' END
       ORDER BY subscribers DESC, code`,
      [ACTIVE_STATUSES]
    ),
  ]);
  return {
    totalUsers: totals.total_users,
    totalSubscribers: totals.total_subscribers,
    activePaidSubscribers: totals.active_paid,
    withCode: totals.with_code,
    withoutCode: totals.without_code,
    noCode: { subscribers: totals.without_code, activeSubscribers: totals.without_code_active },
    codes: codes.map((row) => ({
      codeStatus: row.code_status as string,
      code: (row.code as string | null) ?? null,
      couponName: (row.coupon_name as string | null) ?? null,
      subscribers: row.subscribers as number,
      activeSubscribers: row.active_subscribers as number,
      redemptions: row.redemptions as number,
      percents: (row.percents as string[]).map(Number).sort((a, b) => a - b),
      amountOff: row.amount_off == null ? null : Number(row.amount_off),
      amountOffCurrency: (row.amount_off_currency as string | null) ?? null,
    })),
  };
}

export type SubscriptionHistoryRow = {
  stripeSubscriptionId: string;
  stripeCustomerId: string;
  livemode: boolean;
  plan: string | null;
  status: string;
  currency: string;
  originalAmount: number | null;
  currentAmount: number | null;
  billingInterval: string | null;
  billingIntervalCount: number | null;
  startedAt: string;
  currentPeriodEnd: string | null;
  nextInvoiceAt: string | null;
  cancelAtPeriodEnd: boolean;
  cancelAt: string | null;
  canceledAt: string | null;
  endedAt: string | null;
  latestInvoiceId: string | null;
  latestInvoiceStatus: string | null;
  latestInvoiceTotal: number | null;
  lastPaymentAt: string | null;
  lastPaymentFailedAt: string | null;
  syncedAt: string;
};

export type DiscountHistoryRow = {
  discountKey: string;
  stripeSubscriptionId: string;
  atSignup: boolean;
  promotionCode: string | null;
  codeStatus: string;
  stripePromotionCodeId: string | null;
  stripeCouponId: string | null;
  couponName: string | null;
  percentOff: number | null;
  amountOff: number | null;
  amountOffCurrency: string | null;
  duration: string | null;
  durationInMonths: number | null;
  appliedAt: string;
  expiresAt: string | null;
  removedAt: string | null;
};

export type SubscriberDetails = {
  user: {
    id: number;
    userName: string;
    emailAddress: string;
    role: string;
    accountStatus: string;
    membershipLevel: string;
    signedUpAt: string;
    subscriptionEndDate: string | null;
    stripeCustomerId: string | null;
    stripeSubscriptionId: string | null;
  };
  subscriptions: SubscriptionHistoryRow[];
  discounts: DiscountHistoryRow[];
  cancellations: { canceledAt: string; reason: string; notes: string | null; stripeSubscriptionId: string }[];
};

export async function readSubscriberDetails(userId: number): Promise<SubscriberDetails | null> {
  await ensureUserSchema();
  const [[user], subscriptions, discounts, cancellations] = await Promise.all([
    query(
      `SELECT id, user_name, email_address, role, account_status, membership_level, subscription_end_date,
         stripe_customer_id, stripe_subscription_id,
         CASE WHEN signup_date ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN signup_date::timestamptz ELSE created_at END AS signed_up_at
       FROM racingcoach."Users" WHERE id = $1`,
      [userId]
    ),
    query('SELECT * FROM racingcoach."StripeSubscriptions" WHERE user_id = $1 ORDER BY start_date DESC', [userId]),
    query('SELECT * FROM racingcoach."StripeDiscounts" WHERE user_id = $1 ORDER BY applied_at, id', [userId]),
    query(
      `SELECT canceled_at, reason, notes, stripe_subscription_id FROM racingcoach."CancellationReason"
       WHERE user_id = $1 ORDER BY canceled_at DESC`,
      [userId]
    ),
  ]);
  if (!user) return null;
  const iso = (value: unknown) => (value instanceof Date ? value.toISOString() : null);
  const num = (value: unknown) => (value == null ? null : Number(value));
  return {
    user: {
      id: Number(user.id),
      userName: user.user_name,
      emailAddress: user.email_address,
      role: user.role,
      accountStatus: user.account_status,
      membershipLevel: user.membership_level,
      signedUpAt: iso(user.signed_up_at) ?? '',
      subscriptionEndDate: user.subscription_end_date ?? null,
      stripeCustomerId: user.stripe_customer_id ?? null,
      stripeSubscriptionId: user.stripe_subscription_id ?? null,
    },
    subscriptions: subscriptions.map((s) => ({
      stripeSubscriptionId: s.stripe_subscription_id,
      stripeCustomerId: s.stripe_customer_id,
      livemode: s.livemode,
      plan: s.plan,
      status: s.status,
      currency: s.currency,
      originalAmount: num(s.original_amount),
      currentAmount: num(s.current_amount),
      billingInterval: s.billing_interval,
      billingIntervalCount: num(s.billing_interval_count),
      startedAt: iso(s.start_date) ?? '',
      currentPeriodEnd: iso(s.current_period_end),
      nextInvoiceAt: iso(s.next_invoice_at),
      cancelAtPeriodEnd: s.cancel_at_period_end,
      cancelAt: iso(s.cancel_at),
      canceledAt: iso(s.canceled_at),
      endedAt: iso(s.ended_at),
      latestInvoiceId: s.latest_invoice_id,
      latestInvoiceStatus: s.latest_invoice_status,
      latestInvoiceTotal: num(s.latest_invoice_total),
      lastPaymentAt: iso(s.last_payment_at),
      lastPaymentFailedAt: iso(s.last_payment_failed_at),
      syncedAt: iso(s.synced_at) ?? '',
    })),
    discounts: discounts.map((d) => ({
      discountKey: d.discount_key,
      stripeSubscriptionId: d.stripe_subscription_id,
      atSignup: d.at_signup,
      promotionCode: d.promotion_code,
      codeStatus: d.code_status,
      stripePromotionCodeId: d.stripe_promotion_code_id,
      stripeCouponId: d.stripe_coupon_id,
      couponName: d.coupon_name,
      percentOff: num(d.percent_off),
      amountOff: num(d.amount_off),
      amountOffCurrency: d.amount_off_currency,
      duration: d.duration,
      durationInMonths: num(d.duration_in_months),
      appliedAt: iso(d.applied_at) ?? '',
      expiresAt: iso(d.expires_at),
      removedAt: iso(d.removed_at),
    })),
    cancellations: cancellations.map((c) => ({
      canceledAt: iso(c.canceled_at) ?? '',
      reason: c.reason,
      notes: c.notes,
      stripeSubscriptionId: c.stripe_subscription_id,
    })),
  };
}

// Whether a discount still applies: on the subscription, not past its end, and the subscription still running
export function isCurrentDiscount(discount: DiscountHistoryRow, subscription: SubscriptionHistoryRow | undefined): boolean {
  if (discount.removedAt || !subscription || !ACTIVE_STATUSES.includes(subscription.status)) return false;
  return !discount.expiresAt || new Date(discount.expiresAt) > new Date();
}

// Zero-decimal currencies are charged in whole units (Stripe's list)
const ZERO_DECIMAL = new Set(['bif', 'clp', 'djf', 'gnf', 'jpy', 'kmf', 'krw', 'mga', 'pyg', 'rwf', 'ugx', 'vnd', 'vuv', 'xaf', 'xof', 'xpf']);

// An amount in a currency's minor units (cents), e.g. 1999 usd → "$19.99"
export function formatMinorAmount(amount: number, currency: string, locale: string): string {
  const divisor = ZERO_DECIMAL.has(currency.toLowerCase()) ? 1 : 100;
  return new Intl.NumberFormat(locale, { style: 'currency', currency: currency.toUpperCase() }).format(amount / divisor);
}

// The Stripe Dashboard page of a customer or subscription
export function stripeDashboardUrl(kind: 'customers' | 'subscriptions', id: string, livemode: boolean): string {
  return `https://dashboard.stripe.com/${livemode ? '' : 'test/'}${kind}/${encodeURIComponent(id)}`;
}
