import type Stripe from 'stripe';
import type { PoolClient } from 'pg';
import { query, transaction } from './db';
import { ensureUserSchema } from './users';
import { planForProduct, STRIPE_APP } from './stripePlans';

// Keeps racingcoach."StripeSubscriptions" and "StripeDiscounts" (see ensureUserSchema) in step with Stripe, for the
// Admin page's Subscribers page. Stripe is the source of truth: every webhook event about a subscription, whatever
// its type or order, re-reads the subscription from Stripe and saves what it says now, so duplicate and
// out-of-order deliveries can't leave stale data. Discounts are only ever added or annotated, never deleted, so the
// code a subscriber signed up with stays on record after it expires, the subscription ends or the code is deleted in
// Stripe. Users' own billing columns (account_status, membership_level...) are still set by the webhook as before.

// Everything a subscription's discounts and pricing need, in one request. In this API version a Discount's coupon
// is under source.coupon and a promotion code's under promotion.coupon.
const SUBSCRIPTION_EXPAND = [
  'discounts.promotion_code',
  'discounts.source.coupon',
  'items.data.discounts',
  'latest_invoice.discounts',
];

// Statuses whose subscription is still running (the Subscribers page's "active")
export const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];
// Of those, the ones that have paid (a trial hasn't)
export const PAID_STATUSES = ['active', 'past_due'];

// A discount applied within this long of the subscription's creation came with the checkout that created it
const SIGNUP_WINDOW_SECONDS = 600;

type AnyDiscount = Stripe.Discount | Stripe.DeletedDiscount;

export type SyncHints = {
  // The account a Checkout Session says subscribed (its client_reference_id)
  userId?: number;
  // The Checkout Session that started the subscription, whose discounts were applied at signup
  checkoutSession?: Stripe.Checkout.Session;
  // Invoices of the subscription whose discounts should be recorded too (the webhook's invoice)
  invoiceIds?: string[];
  // When a payment of it failed (invoice.payment_failed)
  paymentFailedAt?: Date;
  // The Admin page's import: also reads every invoice of the subscription (to find discounts that already ran out),
  // and matches a customer to an account by email address when nothing else ties them
  importing?: boolean;
};

export type SyncResult = { status: 'synced' | 'ignored'; discounts: number };

const toDate = (seconds: number | null | undefined) => (seconds ? new Date(seconds * 1000).toISOString() : null);
const idOf = (value: string | { id: string } | null | undefined) => (value == null ? null : typeof value === 'string' ? value : value.id);
const isNotFound = (error: unknown) => (error as { statusCode?: number } | null)?.statusCode === 404;

// Looks up promotion codes and coupons that weren't expanded, once each per sync. A code or coupon deleted in Stripe
// is null (the discount then keeps what was recorded before, or is marked unknown).
class StripeLookups {
  private promotionCodes = new Map<string, Promise<Stripe.PromotionCode | null>>();
  private coupons = new Map<string, Promise<Stripe.Coupon | null>>();

  constructor(readonly stripe: Stripe) {}

  promotionCode(value: string | Stripe.PromotionCode | null): Promise<Stripe.PromotionCode | null> {
    if (value == null || typeof value !== 'string') return Promise.resolve(value);
    if (!this.promotionCodes.has(value)) {
      this.promotionCodes.set(value, this.stripe.promotionCodes.retrieve(value).catch(notFoundAsNull));
    }
    return this.promotionCodes.get(value)!;
  }

  coupon(value: string | Stripe.Coupon | null): Promise<Stripe.Coupon | null> {
    if (value == null || typeof value !== 'string') return Promise.resolve(value);
    if (!this.coupons.has(value)) {
      this.coupons.set(value, this.stripe.coupons.retrieve(value).catch(notFoundAsNull));
    }
    return this.coupons.get(value)!;
  }
}

function notFoundAsNull(error: unknown): null {
  if (isNotFound(error)) return null;
  throw error;
}

type DiscountDetails = {
  couponId: string | null;
  promotionCodeId: string | null;
  code: string | null;
  codeStatus: 'known' | 'coupon' | 'unknown';
  couponName: string | null;
  percentOff: number | null;
  amountOff: number | null;
  amountOffCurrency: string | null;
  duration: string | null;
  durationInMonths: number | null;
};

// The human-readable code and the coupon's terms behind a discount (or a Checkout Session's discount)
async function describe(
  lookups: StripeLookups,
  couponRef: string | Stripe.Coupon | null,
  promotionCodeRef: string | Stripe.PromotionCode | null
): Promise<DiscountDetails> {
  const promotionCode = await lookups.promotionCode(promotionCodeRef);
  const coupon = await lookups.coupon(couponRef ?? promotionCode?.promotion.coupon ?? null);
  const promotionCodeId = idOf(promotionCodeRef);
  return {
    couponId: idOf(couponRef) ?? idOf(promotionCode?.promotion.coupon),
    promotionCodeId,
    code: promotionCode?.code ?? null,
    // A discount with a promotion code Stripe can no longer show us, or with neither a code nor a coupon, is unknown
    codeStatus: promotionCode ? 'known' : promotionCodeId || !couponRef ? 'unknown' : 'coupon',
    couponName: coupon?.name ?? null,
    percentOff: coupon?.percent_off ?? null,
    amountOff: coupon?.amount_off ?? null,
    amountOffCurrency: coupon?.amount_off != null ? coupon.currency : null,
    duration: coupon?.duration ?? null,
    durationInMonths: coupon?.duration_in_months ?? null,
  };
}

// Whether a subscription belongs to this app. The Stripe account is shared with TalkNinja, whose subscription and
// invoice events reach this webhook too. Subscriptions from this app's checkouts say so in their metadata; older ones
// are recognised by their plan product or by the account they're tied to.
async function isOurs(client: PoolClient, subscription: Stripe.Subscription, plan: string | null, customerId: string) {
  const app = subscription.metadata?.app;
  if (app) return app === STRIPE_APP;
  if (plan) return true;
  const { rows } = await client.query(
    `SELECT 1 FROM racingcoach."StripeSubscriptions" WHERE stripe_subscription_id = $1
     UNION ALL SELECT 1 FROM racingcoach."Users" WHERE stripe_subscription_id = $1 OR stripe_customer_id = $2
     LIMIT 1`,
    [subscription.id, customerId]
  );
  return rows.length > 0;
}

// The account a subscription belongs to: the one its metadata or checkout names, the one it was tied to before,
// or the one holding its subscription or customer ID. When importing, a customer whose email address is an
// account's (the checkout used it) is matched too, for plan subscriptions only.
async function resolveUserId(
  client: PoolClient,
  subscription: Stripe.Subscription,
  customerId: string,
  plan: string | null,
  hints: SyncHints
): Promise<number | null> {
  const named = [Number(subscription.metadata?.user_id), hints.userId].filter((id): id is number => Number.isInteger(id));
  for (const id of named) {
    const { rows } = await client.query('SELECT id FROM racingcoach."Users" WHERE id = $1', [id]);
    if (rows.length) return id;
  }
  const { rows } = await client.query(
    `SELECT user_id AS id FROM (
       SELECT user_id, 1 AS rank FROM racingcoach."StripeSubscriptions" WHERE stripe_subscription_id = $1 AND user_id IS NOT NULL
       UNION ALL SELECT id, 2 FROM racingcoach."Users" WHERE stripe_subscription_id = $1
       UNION ALL SELECT id, 3 FROM racingcoach."Users" WHERE stripe_customer_id = $2
     ) matches ORDER BY rank, user_id LIMIT 1`,
    [subscription.id, customerId]
  );
  if (rows.length) return Number(rows[0].id);
  const customer = subscription.customer;
  if (hints.importing && plan && typeof customer !== 'string' && !customer.deleted && customer.email) {
    const byEmail = await client.query('SELECT id FROM racingcoach."Users" WHERE lower(email_address) = lower($1)', [
      customer.email,
    ]);
    if (byEmail.rows.length) return Number(byEmail.rows[0].id);
  }
  return null;
}

// Stripe's own preview of the subscription's next invoice, which takes every current discount, proration and credit
// into account. undefined when Stripe couldn't make one (the stored amount is then kept); null when there's no next
// invoice (the subscription is ending).
async function previewNextInvoice(
  stripe: Stripe,
  subscription: Stripe.Subscription
): Promise<{ amount: number | null; at: string | null } | undefined> {
  if (!ACTIVE_STATUSES.includes(subscription.status) || subscription.cancel_at_period_end) return { amount: null, at: null };
  try {
    const preview = await stripe.invoices.createPreview({ subscription: subscription.id });
    return { amount: preview.total, at: toDate(preview.next_payment_attempt ?? preview.period_end) };
  } catch (error) {
    console.error(`Stripe invoice preview failed for ${subscription.id}:`, error);
    return undefined;
  }
}

// Saves a subscription read from Stripe (with SUBSCRIPTION_EXPAND) and every discount on it, its items and the
// given invoices. Must run inside syncSubscription's lock.
async function saveSubscription(
  client: PoolClient,
  lookups: StripeLookups,
  subscription: Stripe.Subscription,
  hints: SyncHints
): Promise<SyncResult> {
  const { stripe } = lookups;
  const items = subscription.items.data;
  const item = items[0];
  const productId = item ? idOf(item.price.product) : null;
  const plan = planForProduct(productId) ?? (typeof subscription.metadata?.plan === 'string' ? subscription.metadata.plan : null);
  const customerId = idOf(subscription.customer)!;
  if (!(await isOurs(client, subscription, plan, customerId))) return { status: 'ignored', discounts: 0 };

  const userId = await resolveUserId(client, subscription, customerId, plan, hints);
  // The list price per billing period before any discount; null for prices without a unit amount (tiered)
  const originalAmount = items.every((i) => i.price.unit_amount != null)
    ? items.reduce((sum, i) => sum + (i.price.unit_amount ?? 0) * (i.quantity ?? 1), 0)
    : null;
  const next = await previewNextInvoice(stripe, subscription);
  const latestInvoice = typeof subscription.latest_invoice === 'object' ? subscription.latest_invoice : null;

  // Every invoice whose discounts to record: the latest, the webhook's, and when importing all of them
  const invoices = new Map<string, Stripe.Invoice>();
  if (latestInvoice) invoices.set(latestInvoice.id, latestInvoice);
  for (const id of hints.invoiceIds ?? []) {
    if (!invoices.has(id)) invoices.set(id, await stripe.invoices.retrieve(id, { expand: ['discounts'] }));
  }
  if (hints.importing) {
    for await (const invoice of stripe.invoices.list({ subscription: subscription.id, limit: 100, expand: ['data.discounts'] })) {
      invoices.set(invoice.id, invoice);
    }
  }
  const lastPaidAt = Math.max(0, ...[...invoices.values()].map((invoice) => invoice.status_transitions?.paid_at ?? 0));

  await client.query(
    `INSERT INTO racingcoach."StripeSubscriptions" AS s (
       stripe_subscription_id, user_id, stripe_customer_id, livemode, plan, stripe_product_id, stripe_price_id, status,
       currency, original_amount, billing_interval, billing_interval_count, current_amount, next_invoice_at, start_date,
       current_period_start, current_period_end, cancel_at_period_end, cancel_at, canceled_at, ended_at,
       latest_invoice_id, latest_invoice_status, latest_invoice_total, last_payment_at, last_payment_failed_at, imported
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22,
       $23, $24, $25, $26, $27)
     ON CONFLICT (stripe_subscription_id) DO UPDATE SET
       user_id = COALESCE(EXCLUDED.user_id, s.user_id),
       stripe_customer_id = EXCLUDED.stripe_customer_id,
       plan = COALESCE(EXCLUDED.plan, s.plan),
       stripe_product_id = EXCLUDED.stripe_product_id,
       stripe_price_id = EXCLUDED.stripe_price_id,
       status = EXCLUDED.status,
       currency = EXCLUDED.currency,
       original_amount = EXCLUDED.original_amount,
       billing_interval = EXCLUDED.billing_interval,
       billing_interval_count = EXCLUDED.billing_interval_count,
       current_amount = CASE WHEN $28 THEN EXCLUDED.current_amount ELSE s.current_amount END,
       next_invoice_at = CASE WHEN $28 THEN EXCLUDED.next_invoice_at ELSE s.next_invoice_at END,
       start_date = EXCLUDED.start_date,
       current_period_start = EXCLUDED.current_period_start,
       current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end,
       cancel_at = EXCLUDED.cancel_at,
       canceled_at = EXCLUDED.canceled_at,
       ended_at = EXCLUDED.ended_at,
       latest_invoice_id = COALESCE(EXCLUDED.latest_invoice_id, s.latest_invoice_id),
       latest_invoice_status = COALESCE(EXCLUDED.latest_invoice_status, s.latest_invoice_status),
       latest_invoice_total = COALESCE(EXCLUDED.latest_invoice_total, s.latest_invoice_total),
       last_payment_at = GREATEST(EXCLUDED.last_payment_at, s.last_payment_at),
       last_payment_failed_at = GREATEST(EXCLUDED.last_payment_failed_at, s.last_payment_failed_at),
       synced_at = now()`,
    [
      subscription.id,
      userId,
      customerId,
      subscription.livemode,
      plan,
      productId,
      item?.price.id ?? null,
      subscription.status,
      subscription.currency,
      originalAmount,
      item?.price.recurring?.interval ?? null,
      item?.price.recurring?.interval_count ?? null,
      next?.amount ?? null,
      next?.at ?? null,
      toDate(subscription.start_date),
      toDate(item?.current_period_start),
      toDate(item?.current_period_end),
      subscription.cancel_at_period_end,
      toDate(subscription.cancel_at),
      toDate(subscription.canceled_at),
      toDate(subscription.ended_at),
      latestInvoice?.id ?? null,
      latestInvoice?.status ?? null,
      latestInvoice?.total ?? null,
      toDate(lastPaidAt),
      hints.paymentFailedAt?.toISOString() ?? null,
      hints.importing ?? false,
      next !== undefined,
    ]
  );

  // The discounts on the subscription and its items now, then those on its invoices (which include ones that
  // already ran out, such as a first-invoice-only discount)
  const current = [
    ...subscription.discounts,
    ...items.flatMap((i) => i.discounts),
  ].filter((d): d is Stripe.Discount => typeof d !== 'string');
  const seen = new Map<string, AnyDiscount>(current.map((d) => [d.id, d]));
  for (const invoice of invoices.values()) {
    for (const d of invoice.discounts) if (typeof d !== 'string' && !seen.has(d.id)) seen.set(d.id, d);
  }
  const currentIds = new Set(current.map((d) => d.id));
  const checkoutSession = hints.checkoutSession;
  const checkoutCoupons = new Set(
    (checkoutSession?.discounts ?? []).map((d) => idOf(d.coupon)).filter((id): id is string => !!id)
  );

  let saved = 0;
  const savedCoupons = new Set<string>();
  for (const discount of seen.values()) {
    const details = await describe(lookups, discount.source.coupon, discount.promotion_code);
    const atSignup =
      (details.couponId != null && checkoutCoupons.has(details.couponId)) ||
      discount.checkout_session != null ||
      Math.abs(discount.start - subscription.created) <= SIGNUP_WINDOW_SECONDS;
    await saveDiscount(client, discount.id, subscription, customerId, userId, details, {
      atSignup,
      checkoutSessionId: discount.checkout_session ?? (atSignup ? checkoutSession?.id ?? null : null),
      appliedAt: toDate(discount.start)!,
      // A deleted discount (on an old invoice) no longer says when it ended; a repeating one ran its months
      expiresAt: 'end' in discount ? toDate(discount.end) : repeatingEnd(discount.start, details),
      onSubscription: currentIds.has(discount.id),
    });
    if (details.couponId && atSignup) savedCoupons.add(details.couponId);
    saved++;
  }

  // A checkout discount Stripe didn't show as a discount object (rare): recorded from the Checkout Session itself
  for (const d of checkoutSession?.discounts ?? []) {
    const details = await describe(lookups, d.coupon, d.promotion_code);
    if (details.couponId && savedCoupons.has(details.couponId)) {
      // The discount object recorded it; a stand-in from an earlier delivery isn't needed any more
      await client.query('DELETE FROM racingcoach."StripeDiscounts" WHERE discount_key = $1', [
        `checkout:${checkoutSession!.id}:${details.couponId}`,
      ]);
      continue;
    }
    await saveDiscount(client, `checkout:${checkoutSession!.id}:${details.couponId ?? details.promotionCodeId}`, subscription, customerId, userId, details, {
      atSignup: true,
      checkoutSessionId: checkoutSession!.id,
      appliedAt: toDate(checkoutSession!.created)!,
      expiresAt: null,
      onSubscription: true,
    });
    saved++;
  }

  // Discounts no longer on the subscription were removed or ran out; they stay on record
  await client.query(
    `UPDATE racingcoach."StripeDiscounts" SET removed_at = now()
     WHERE stripe_subscription_id = $1 AND removed_at IS NULL AND discount_key LIKE 'di\\_%' AND NOT (discount_key = ANY($2))`,
    [subscription.id, [...currentIds]]
  );
  if (userId !== null) {
    await client.query(
      'UPDATE racingcoach."StripeDiscounts" SET user_id = $2 WHERE stripe_subscription_id = $1 AND user_id IS NULL',
      [subscription.id, userId]
    );
  }
  // The account was deleted (deleteUser); a discount first seen since (e.g. from the cancellation Delete Account makes)
  // belongs to the same former account
  await client.query(
    `UPDATE racingcoach."StripeDiscounts" d SET deleted_user_id = s.deleted_user_id, account_deleted_at = s.account_deleted_at
     FROM racingcoach."StripeSubscriptions" s
     WHERE s.stripe_subscription_id = $1 AND d.stripe_subscription_id = s.stripe_subscription_id
       AND s.user_id IS NULL AND s.deleted_user_id IS NOT NULL AND d.user_id IS NULL AND d.deleted_user_id IS NULL`,
    [subscription.id]
  );
  return { status: 'synced', discounts: saved };
}

function repeatingEnd(start: number, details: DiscountDetails): string | null {
  if (details.duration !== 'repeating' || !details.durationInMonths) return null;
  const end = new Date(start * 1000);
  end.setUTCMonth(end.getUTCMonth() + details.durationInMonths);
  return end.toISOString();
}

// Adds a discount, or adds what's newly known about one already recorded. What was recorded first wins for the code
// and the coupon's terms (a deleted coupon or code can't wipe them), and a known code is never replaced.
async function saveDiscount(
  client: PoolClient,
  key: string,
  subscription: Stripe.Subscription,
  customerId: string,
  userId: number | null,
  d: DiscountDetails,
  extra: { atSignup: boolean; checkoutSessionId: string | null; appliedAt: string; expiresAt: string | null; onSubscription: boolean }
) {
  await client.query(
    `INSERT INTO racingcoach."StripeDiscounts" AS d (
       discount_key, stripe_subscription_id, user_id, stripe_customer_id, stripe_checkout_session_id, at_signup,
       stripe_coupon_id, stripe_promotion_code_id, promotion_code, code_status, coupon_name, percent_off, amount_off,
       amount_off_currency, duration, duration_in_months, applied_at, expires_at, removed_at
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18,
       CASE WHEN $19 THEN NULL ELSE now() END)
     ON CONFLICT (discount_key) DO UPDATE SET
       user_id = COALESCE(d.user_id, EXCLUDED.user_id),
       stripe_checkout_session_id = COALESCE(d.stripe_checkout_session_id, EXCLUDED.stripe_checkout_session_id),
       at_signup = d.at_signup OR EXCLUDED.at_signup,
       stripe_coupon_id = COALESCE(d.stripe_coupon_id, EXCLUDED.stripe_coupon_id),
       stripe_promotion_code_id = COALESCE(d.stripe_promotion_code_id, EXCLUDED.stripe_promotion_code_id),
       promotion_code = CASE WHEN d.code_status = 'known' THEN d.promotion_code ELSE EXCLUDED.promotion_code END,
       code_status = CASE WHEN d.code_status = 'known' THEN d.code_status ELSE EXCLUDED.code_status END,
       coupon_name = COALESCE(d.coupon_name, EXCLUDED.coupon_name),
       percent_off = COALESCE(d.percent_off, EXCLUDED.percent_off),
       amount_off = COALESCE(d.amount_off, EXCLUDED.amount_off),
       amount_off_currency = COALESCE(d.amount_off_currency, EXCLUDED.amount_off_currency),
       duration = COALESCE(d.duration, EXCLUDED.duration),
       duration_in_months = COALESCE(d.duration_in_months, EXCLUDED.duration_in_months),
       expires_at = COALESCE(EXCLUDED.expires_at, d.expires_at),
       removed_at = CASE WHEN $19 THEN NULL ELSE d.removed_at END,
       last_seen_at = now()`,
    [
      key,
      subscription.id,
      userId,
      customerId,
      extra.checkoutSessionId,
      extra.atSignup,
      d.couponId,
      d.promotionCodeId,
      d.code,
      d.codeStatus,
      d.couponName,
      d.percentOff,
      d.amountOff,
      d.amountOffCurrency,
      d.duration,
      d.durationInMonths,
      extra.appliedAt,
      extra.expiresAt,
      extra.onSubscription,
    ]
  );
}

// Reads the subscription from Stripe and saves it with its discounts. A lock per subscription makes concurrent
// events for it take turns, and each reads Stripe after the one before it finished, so the last to save has the
// latest state. Throws on Stripe or database errors (the webhook then fails and Stripe retries).
export async function syncSubscription(stripe: Stripe, subscriptionId: string, hints: SyncHints = {}): Promise<SyncResult> {
  await ensureUserSchema();
  return transaction(async (client) => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stripe_subscription:${subscriptionId}`]);
    let subscription: Stripe.Subscription;
    try {
      subscription = await stripe.subscriptions.retrieve(subscriptionId, { expand: SUBSCRIPTION_EXPAND });
    } catch (error) {
      // Another Stripe account's, or deleted in test mode
      if (isNotFound(error)) return { status: 'ignored', discounts: 0 };
      throw error;
    }
    return saveSubscription(client, new StripeLookups(stripe), subscription, hints);
  });
}

export type ImportResult = { scanned: number; synced: number; ignored: number; discounts: number; failed: number };

// The Admin page's Sync from Stripe: every subscription in the Stripe account (any status), 100 per page, saved like a
// webhook event would save it, plus the discounts on all its invoices. Safe to run again: everything is keyed by
// Stripe's IDs, so it only adds what's missing and refreshes the rest; nothing is deleted. Other apps' subscriptions
// are skipped. The client retries rate-limited requests (stripeClient).
export async function importStripeSubscriptions(stripe: Stripe): Promise<ImportResult> {
  await ensureUserSchema();
  const result: ImportResult = { scanned: 0, synced: 0, ignored: 0, discounts: 0, failed: 0 };
  const lookups = new StripeLookups(stripe);
  const list = stripe.subscriptions.list({
    status: 'all',
    limit: 100,
    expand: SUBSCRIPTION_EXPAND.map((path) => `data.${path}`).concat('data.customer'),
  });
  for await (const subscription of list) {
    result.scanned++;
    try {
      const saved = await transaction(async (client) => {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`stripe_subscription:${subscription.id}`]);
        return saveSubscription(client, lookups, subscription, { importing: true });
      });
      result[saved.status]++;
      result.discounts += saved.discounts;
    } catch (error) {
      // One bad subscription shouldn't stop the rest; running the sync again retries it
      console.error(`Stripe import failed for ${subscription.id}:`, error);
      result.failed++;
    }
  }
  return result;
}

// Webhook idempotency: 'new' when this delivery should handle the event, 'done' when it was already handled, and
// 'busy' while another delivery is handling it (answered with an error, so Stripe tries again later). A claim left
// by a delivery that crashed is taken over after 10 minutes.
export async function claimWebhookEvent(event: Stripe.Event): Promise<'new' | 'done' | 'busy'> {
  await ensureUserSchema();
  const claimed = await query(
    `INSERT INTO racingcoach."StripeWebhookEvents" AS e (event_id, event_type, event_created) VALUES ($1, $2, $3)
     ON CONFLICT (event_id) DO UPDATE SET received_at = now()
       WHERE e.processed_at IS NULL AND e.received_at < now() - interval '10 minutes'
     RETURNING event_id`,
    [event.id, event.type, toDate(event.created)]
  );
  if (claimed.length) return 'new';
  const [row] = await query('SELECT processed_at FROM racingcoach."StripeWebhookEvents" WHERE event_id = $1', [event.id]);
  return row?.processed_at ? 'done' : 'busy';
}

export async function finishWebhookEvent(eventId: string): Promise<void> {
  await query('UPDATE racingcoach."StripeWebhookEvents" SET processed_at = now() WHERE event_id = $1', [eventId]);
  await query(`DELETE FROM racingcoach."StripeWebhookEvents" WHERE received_at < now() - interval '90 days'`);
}

// Handling failed: lets Stripe's retry handle it again
export async function releaseWebhookEvent(eventId: string): Promise<void> {
  await query('DELETE FROM racingcoach."StripeWebhookEvents" WHERE event_id = $1 AND processed_at IS NULL', [eventId]);
}
