# Stripe Integration

How RacingCoach.app's Stripe setup works and what the Stripe Dashboard must have. AGENTS.md (the `STRIPE_*` and
`RACING_COACH_*_PRODUCT_ID` entries) has the full detail. Last checked against the code on 2026-11-08.

## Environment variables (Render, and `.env.local` for testing)

```
# https://dashboard.stripe.com/apikeys: sk_live_... in production, sk_test_... for testing
STRIPE_SECRET_KEY=sk_live_...
# The webhook endpoint's signing secret (see Webhook below)
STRIPE_WEBHOOK_SECRET=whsec_...
# One Stripe Product per plan; each product's default Price must be recurring (monthly or yearly)
RACING_COACH_SILVER_MONTHLY_PRODUCT_ID=prod_...
RACING_COACH_SILVER_ANNUAL_PRODUCT_ID=prod_...
RACING_COACH_GOLD_MONTHLY_PRODUCT_ID=prod_...
RACING_COACH_GOLD_ANNUAL_PRODUCT_ID=prod_...
```

Server-only: never prefix them with `NEXT_PUBLIC_`. The Pricing page sells only the Monthly plans; annual subscriptions
that already exist keep renewing. Live and test mode have different product IDs.

## Webhook (required)

In https://dashboard.stripe.com/workbench/webhooks, one live-mode endpoint at
`https://racingcoach.app/api/stripe-webhook` with **all six** of these events:

| Event | Why |
|---|---|
| `checkout.session.completed` | Links a new subscription to its account and sets the plan's level |
| `customer.subscription.created` | Keeps the Subscribers page's copy |
| `customer.subscription.updated` | Keeps the account on its plan through renewals and plan changes |
| `customer.subscription.deleted` | Marks the account Canceled (it keeps its level to the end of the paid period) |
| `invoice.paid` | A renewal or a recovered payment: brings the account back to Stripe's state |
| `invoice.payment_failed` | Records the failed payment on the Subscribers page |

Every subscription event re-reads the subscription from Stripe and applies it to the account (`accountProjection`
in `src/lib/stripeProjection.ts`), so a missing event can leave a paying member on the wrong level. The Stripe
account is shared with TalkNinja: its events reach this endpoint too and are skipped by their `metadata.app`.

For local testing: `stripe listen --forward-to localhost:3000/api/stripe-webhook`, with test keys and test products,
and the `whsec_...` it prints.

## Restricted key permissions

If `STRIPE_SECRET_KEY` is a restricted key (`rk_...`), it needs **Write** on Checkout Sessions, Subscriptions and Customer portal (the billing portal's configuration and sessions), and
**Read** on Products and Prices, Customers, Invoices, Coupons and Promotion Codes (the Subscribers page and Sync from
Stripe read them).

## Checkout

`src/app/api/create-checkout-session/route.ts` creates a hosted, subscription-mode Checkout Session:

| Parameter | Value |
|---|---|
| `line_items` | the plan product's default recurring Price |
| `allow_promotion_codes` | **true**: codes are made in the Stripe Dashboard |
| `client_reference_id`, `metadata` | the account ID, plan and `app: racingcoach`, set by the server |
| `success_url` / `cancel_url` | `SITE_URL` + `/success?session_id=...` / `/account` |

Promotion codes: the Stripe account is shared with TalkNinja, so restrict every code's coupon to the RacingCoach
products (**Applies to products**), and set a redemption limit or expiry. A code that isn't restricted works on both
sites' checkouts.

## How it works

1. A signed-in user with a confirmed email address picks a plan on the Pricing page; the route redirects to Stripe.
2. After payment Stripe sends the customer to `/success`, and calls the webhook: `checkout.session.completed` links
   the subscription and sets Subscribed at the plan's level (Silver or Gold).
3. Each renewal: `customer.subscription.updated` and `invoice.paid` move the paid period on to Stripe's period end.
   A Subscribed account drops to Bronze only 72 hours after its paid period, so the renewal (charged about an hour
   after the period ends) and Stripe's card retries have time to arrive.
4. **Cancel Subscription** on the Account page cancels at once, with no refund; the account keeps its level until the
   end of the period it paid for, then becomes Bronze.
5. A Silver subscriber buying Gold gets a new subscription; the webhook cancels the Silver one, prorated.

Test cards (test mode, any future expiry, any CVC): `4242 4242 4242 4242` succeeds, `4000 0025 0000 3155` asks for
3D Secure, `4000 0000 0000 9995` is declined. More at https://docs.stripe.com/testing.

## Billing portal

The Account page's **Manage Billing** (anyone with a Stripe customer) opens Stripe's customer portal through
`/api/billing-portal`, for the account's own customer only. The site makes its own portal configuration the first
time (named RacingCoach.app, `metadata.app: racingcoach`) and keeps its ID in `"SiteSettings"` key
`stripe_portal_configuration`, so the account's default configuration (TalkNinja's too) is never changed. It offers
updating the payment method and the invoice history only: cancelling stays on the Account page's Cancel Subscription,
which asks why, and plan changes on the Pricing page. A configuration Stripe no longer has (e.g. after switching
between test and live keys) is made again. `src/lib/billingPortal.ts`.

## Still to do

- Handle `charge.dispute.created` and refunds, so a disputed payment loses its access (audit F-22)
