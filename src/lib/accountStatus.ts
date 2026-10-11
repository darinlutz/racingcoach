// Values of racingcoach."Users".account_status and membership_level, and which accounts can buy a Stripe plan.
// Dependency-free so pages and API routes can share it.
export const ACCOUNT_STATUS = {
  // Signed up, never subscribed
  unsubscribed: 'Unsubscribed',
  // A current Silver or Gold subscription (monthly or annual)
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

// Values of racingcoach."Users".membership_level. Every account starts at Bronze (free); a Silver or
// Gold subscription raises it, and it drops back to Bronze once the paid period is over.
export const MEMBERSHIP_LEVEL = {
  bronze: 'Bronze',
  silver: 'Silver',
  gold: 'Gold',
} as const;

export type MembershipLevel = (typeof MEMBERSHIP_LEVEL)[keyof typeof MEMBERSHIP_LEVEL];

const LEVEL_RANK: Record<string, number> = {
  [MEMBERSHIP_LEVEL.bronze]: 0,
  [MEMBERSHIP_LEVEL.silver]: 1,
  [MEMBERSHIP_LEVEL.gold]: 2,
};

export function levelRank(membershipLevel: string): number {
  return LEVEL_RANK[membershipLevel] ?? 0;
}

export type BillingPeriod = 'monthly' | 'annual';

// The plans sold through Stripe, each its own Product (see src/lib/stripePlans.ts)
export const PLANS = {
  silver_monthly: { level: MEMBERSHIP_LEVEL.silver, period: 'monthly' },
  silver_annual: { level: MEMBERSHIP_LEVEL.silver, period: 'annual' },
  gold_monthly: { level: MEMBERSHIP_LEVEL.gold, period: 'monthly' },
  gold_annual: { level: MEMBERSHIP_LEVEL.gold, period: 'annual' },
} as const satisfies Record<string, { level: MembershipLevel; period: BillingPeriod }>;

export type Plan = keyof typeof PLANS;

export function isPlan(value: unknown): value is Plan {
  return typeof value === 'string' && Object.hasOwn(PLANS, value);
}

// Checkout Sessions started before the Silver and Gold levels say plan "monthly" or "annual",
// which bought what is now Silver
export function parsePlan(value: unknown): Plan | null {
  if (value === 'monthly') return 'silver_monthly';
  if (value === 'annual') return 'silver_annual';
  return isPlan(value) ? value : null;
}

// Anyone without a current subscription can buy any plan; a current subscriber can only
// upgrade to a higher level (Silver to Gold), which replaces their subscription
export function canBuyPlan(accountStatus: string, membershipLevel: string, plan: Plan): boolean {
  if (canSubscribe(accountStatus)) return true;
  return accountStatus === ACCOUNT_STATUS.subscribed && levelRank(PLANS[plan].level) > levelRank(membershipLevel);
}

// False only for a current Gold subscriber, who has nothing left to buy
export function canUpgrade(accountStatus: string, membershipLevel: string): boolean {
  return (Object.keys(PLANS) as Plan[]).some((plan) => canBuyPlan(accountStatus, membershipLevel, plan));
}

// Any plan can be bought by anyone without a current subscription
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
