import type Stripe from 'stripe';
import { query } from './db';
import { STRIPE_APP } from './stripePlans';
import { ensureUserSchema } from './users';

// The Account page's Manage Billing: Stripe's hosted customer portal, where a subscriber updates their card and
// downloads invoices and receipts (docs/launch-readiness-audit-2026-11-07.md, F-34). It has its own portal
// configuration, made by the site the first time and kept in "SiteSettings" (key stripe_portal_configuration), so the
// Stripe account's default (shared with TalkNinja) is never touched. Cancelling stays on the Account page's own Cancel
// Subscription (which asks why) and plan changes on the Pricing page, so the portal offers neither, nor changing the
// email address (the account's is the one that matters).

const SETTING_KEY = 'stripe_portal_configuration';

export const PORTAL_FEATURES: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
  payment_method_update: { enabled: true },
  invoice_history: { enabled: true },
  customer_update: { enabled: false },
  subscription_cancel: { enabled: false },
  subscription_update: { enabled: false },
};

async function savedConfigurationId(): Promise<string | null> {
  const [row] = await query<{ value: string }>('SELECT value FROM racingcoach."SiteSettings" WHERE key = $1', [SETTING_KEY]);
  return row?.value ?? null;
}

async function saveConfigurationId(id: string): Promise<void> {
  await query(
    `INSERT INTO racingcoach."SiteSettings" (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [SETTING_KEY, id]
  );
}

// The RacingCoach portal configuration's ID: the saved one while Stripe still has it active (a key switched between
// test and live mode doesn't), else a new one
export async function portalConfigurationId(stripe: Stripe, siteUrl: string): Promise<string> {
  await ensureUserSchema();
  const saved = await savedConfigurationId();
  if (saved) {
    try {
      const existing = await stripe.billingPortal.configurations.retrieve(saved);
      if (existing.active) return existing.id;
    } catch (error) {
      if ((error as { statusCode?: number }).statusCode !== 404) throw error;
    }
  }
  const created = await stripe.billingPortal.configurations.create({
    name: 'RacingCoach.app',
    metadata: { app: STRIPE_APP },
    business_profile: {
      headline: 'RacingCoach.app billing',
      privacy_policy_url: `${siteUrl}/privacy`,
      terms_of_service_url: `${siteUrl}/terms`,
    },
    default_return_url: `${siteUrl}/account#subscription`,
    features: PORTAL_FEATURES,
  });
  await saveConfigurationId(created.id);
  console.log(`Stripe billing portal configuration ${created.id} created`);
  return created.id;
}

// A portal session for the customer, opened in their language; its URL is used once and expires
export async function billingPortalUrl(
  stripe: Stripe,
  customerId: string,
  siteUrl: string,
  locale: Stripe.BillingPortal.SessionCreateParams.Locale
): Promise<string> {
  const configuration = await portalConfigurationId(stripe, siteUrl);
  const session = await stripe.billingPortal.sessions.create({
    customer: customerId,
    configuration,
    return_url: `${siteUrl}/account#subscription`,
    locale,
  });
  return session.url;
}
