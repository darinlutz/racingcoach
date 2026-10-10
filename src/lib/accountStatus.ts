// Values of racingcoach."Users".account_status, and which accounts can buy a Stripe plan.
// Dependency-free so pages and API routes can share it.
export const ACCOUNT_STATUS = {
  // Signed up, never subscribed
  unsubscribed: 'Unsubscribed',
  // A current Monthly or Annual subscription
  subscribed: 'Subscribed',
  // Subscription canceled (here, in the Stripe Dashboard, or after failed
  // payments)
  canceled: 'Canceled',
  // Subscription that wasn't renewed by its end date
  expired: 'Expired',
} as const;

// Statuses that were merged into Subscribed; ensureUserSchema() migrates them
export const LEGACY_SUBSCRIBED_STATUSES = ['Monthly Subscription', 'Lifetime Subscription'];

export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];

export type Plan = 'monthly' | 'annual';

// Either plan can be bought by anyone without a current subscription
export function canSubscribe(accountStatus: string): boolean {
  switch (accountStatus) {
    case ACCOUNT_STATUS.unsubscribed:
    case ACCOUNT_STATUS.canceled:
    case ACCOUNT_STATUS.expired:
      return true;
    default:
      return false;
  }
}
