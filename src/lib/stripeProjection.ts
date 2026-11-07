// What a Stripe subscription, as Stripe says it is now, makes the account it's tied to (its Users row's
// account_status, membership_level and subscription_end_date). syncSubscription (src/lib/stripeBilling.ts) applies it
// under the subscription's lock on every webhook event about it, so renewals, late or repeated events and
// recovered payments all end up where Stripe is, and the Admin page's Sync from Stripe repairs accounts that drifted.
// No imports but accountStatus.ts, so tests run it directly.
import { ACCOUNT_STATUS, isPlan, PLANS, type MembershipLevel } from './accountStatus.ts';

export type StripeSubscriptionState = {
  status: string;
  plan: string | null;
  // The end of the period Stripe is in now (unix seconds)
  currentPeriodEnd: number | null;
  // The latest invoice's status: 'paid' once the current period is paid for
  latestInvoiceStatus: string | null;
};

export type AccountProjection = {
  accountStatus: string;
  membershipLevel: MembershipLevel;
  // The paid period's end, or null to keep the account's own
  subscriptionEndDate: string | null;
};

// null leaves the account as it is: a subscription past due (Stripe is retrying the card; the renewal grace in
// lapRetentionRules.ts covers it and the account lapses after it), ended (customer.subscription.deleted marks it
// Canceled, keeping its paid period), incomplete or paused, or not one of this app's plans
export function accountProjection(state: StripeSubscriptionState): AccountProjection | null {
  if (!isPlan(state.plan)) return null;
  if (state.status !== 'active' && state.status !== 'trialing') return null;
  // The current period only counts once it's paid for: Stripe moves a subscription into its next period an hour or
  // so before it charges the renewal, and a renewal that then fails mustn't have given the month away
  const paid = state.latestInvoiceStatus === 'paid' && state.currentPeriodEnd;
  return {
    accountStatus: ACCOUNT_STATUS.subscribed,
    membershipLevel: PLANS[state.plan].level,
    subscriptionEndDate: paid ? new Date(state.currentPeriodEnd! * 1000).toISOString() : null,
  };
}
