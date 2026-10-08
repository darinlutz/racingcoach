import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import { ACCOUNT_STATUS, type Plan } from '@/lib/accountStatus';
import { getCurrentUser } from '@/lib/session';
import { formatPrice, getPlanPrice, getStripeConfig } from '@/lib/stripePlans';
import { canBuy, type User } from '@/lib/users';

const PLANS: { plan: Plan; name: string; period: string; blurb: string; features: string[] }[] = [
  {
    plan: 'monthly',
    name: 'Monthly',
    period: '/ month',
    blurb: 'Full access, billed monthly.',
    features: [
      'Debrief Coach: AI review of every lap in your session',
      'Multi-Lap, Stint and Lap Compare analysis',
      'Reference points for every focus area',
      'Track Management with up to 8 focus areas per track',
      'Racecar Analysis Q&A',
      'My Race Trends: iRating and incidents synced from iRacePlan',
      'Cancel anytime',
    ],
  },
  {
    plan: 'lifetime',
    name: 'Lifetime',
    period: 'one time',
    blurb: 'Pay once, keep access for good.',
    features: [
      'Everything in Monthly',
      'One payment, no renewals',
      'All future tools and updates included',
      'Upgrading from Monthly cancels your monthly subscription',
    ],
  },
];

// The plan's Stripe price, or null if Stripe isn't configured or can't be reached
async function loadPrice(plan: Plan): Promise<string | null> {
  const config = getStripeConfig(plan);
  if (!config) return null;
  try {
    const price = await getPlanPrice(config.stripe, config.productId);
    return price ? formatPrice(price) : null;
  } catch (error) {
    console.error(`Failed to load Stripe price for ${plan}:`, error);
    return null;
  }
}

const OWNED_STATUS: Record<Plan, string> = {
  monthly: ACCOUNT_STATUS.monthly,
  lifetime: ACCOUNT_STATUS.lifetime,
};

const buttonClass = buttonVariants({ variant: 'racing', className: 'w-full' });

function PlanAction({ plan, name, user }: { plan: Plan; name: string; user: User | null }) {
  if (!user) {
    return <Link href="/signup" className={buttonClass}>Get Started</Link>;
  }
  // Lifetime subscribers have nothing left to buy
  if (user.accountStatus === ACCOUNT_STATUS.lifetime) return null;
  if (canBuy(user, plan)) {
    return (
      <form action="/api/create-checkout-session" method="POST">
        <button type="submit" name="plan" value={plan} className={buttonClass}>
          {plan === 'lifetime' && user.accountStatus === ACCOUNT_STATUS.monthly ? 'Upgrade to ' : ''}
          {name} Subscription
        </button>
      </form>
    );
  }
  return (
    <button type="button" disabled className={buttonClass}>
      {user.accountStatus === OWNED_STATUS[plan] ? 'Current Plan' : 'Included'}
    </button>
  );
}

export default async function PricingPage() {
  const [user, ...prices] = await Promise.all([getCurrentUser(), ...PLANS.map((p) => loadPrice(p.plan))]);

  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            Pricing
          </h1>
          <p className="text-lg text-muted-foreground">
            Every tool, either way. Pick how you want to pay.
          </p>
        </div>
      </section>

      <section className="py-16 px-6 sm:px-10 lg:px-16 bg-card flex flex-col items-center">
        <div className="w-full max-w-4xl grid gap-6 md:grid-cols-2">
          {PLANS.map(({ plan, name, period, blurb, features }, i) => (
            <div key={plan} className="flex flex-col bg-secondary rounded-xl border border-border p-8">
              <h2 className="text-2xl font-bold text-foreground mb-2">{name}</h2>
              <p className="text-muted-foreground mb-6">{blurb}</p>
              <div className="mb-6 flex items-baseline gap-2">
                <span className="text-4xl font-bold text-foreground">{prices[i] ?? '—'}</span>
                <span className="text-muted-foreground">{period}</span>
              </div>
              <ul className="space-y-3 mb-8 flex-1">
                {features.map((feature) => (
                  <li key={feature} className="flex gap-3 text-foreground">
                    <Check className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>
              <PlanAction plan={plan} name={name} user={user} />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
