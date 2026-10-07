// Values of racingcoach."Users".account_status, and which Stripe plans each can buy.
// Dependency-free so pages and API routes can share it.
export const ACCOUNT_STATUS = {
  // Signed up, never subscribed
  unsubscribed: 'Unsubscribed',
  monthly: 'Monthly Subscription',
  lifetime: 'Lifetime Subscription',
  // Monthly subscription canceled (here, in the Stripe Dashboard, or after
  // failed payments)
  canceled: 'Canceled',
  // Monthly subscription that wasn't renewed by its end date
  expired: 'Expired',
} as const;

export type AccountStatus = (typeof ACCOUNT_STATUS)[keyof typeof ACCOUNT_STATUS];

export type Plan = 'monthly' | 'lifetime';

// Monthly can be bought by anyone without a current subscription; Lifetime
// also by monthly subscribers (their monthly subscription is then canceled).
// Lifetime subscribers can't buy either.
export function canBuyPlan(accountStatus: string, plan: Plan): boolean {
  switch (accountStatus) {
    case ACCOUNT_STATUS.unsubscribed:
    case ACCOUNT_STATUS.canceled:
    case ACCOUNT_STATUS.expired:
      return true;
    case ACCOUNT_STATUS.monthly:
      return plan === 'lifetime';
    default:
      return false;
  }
}
