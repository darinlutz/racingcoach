import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import type Stripe from 'stripe';
import type { Plan } from '@/lib/accountStatus';
import { getCurrentUser } from '@/lib/session';
import { annualDiscountPercent, formatPrice, getPlanPrice, getStripeConfig } from '@/lib/stripePlans';
import { canBuy, type User } from '@/lib/users';

const FEATURES = [
  'Debrief Coach: AI review of every lap in your session',
  'Multi-Lap, Stint and Lap Compare analysis',
  'Reference points for every focus area',
  'Track Data with up to 8 focus areas per track',
  'Racecar Analysis Q&A',
  'My Race Trends: iRating and incidents synced from iRacePlan',
];

const PLANS: { plan: Plan; name: string; period: string; blurb: string; features: string[] }[] = [
  {
    plan: 'monthly',
    name: 'Monthly',
    period: '/ month',
    blurb: 'Full access, billed every month.',
    features: [...FEATURES, 'Cancel anytime'],
  },
  {
    plan: 'annual',
    name: 'Annual',
    period: '/ year',
    blurb: 'Full access, billed once a year.',
    features: ['Everything in Monthly', 'One payment covers the whole year', 'Cancel anytime'],
  },
];

// The plan's Stripe price, or null if Stripe isn't configured or can't be reached
async function loadPrice(plan: Plan): Promise<Stripe.Price | null> {
  const config = getStripeConfig(plan);
  if (!config) return null;
  try {
    return await getPlanPrice(config.stripe, config.productId);
  } catch (error) {
    console.error(`Failed to load Stripe price for ${plan}:`, error);
    return null;
  }
}

const buttonClass = buttonVariants({ variant: 'racing', className: 'w-full' });

function PlanAction({ plan, name, user }: { plan: Plan; name: string; user: User | null }) {
  if (!user) {
    return <Link href="/signup" className={buttonClass}>Get Started</Link>;
  }
  if (canBuy(user)) {
    return (
      <form action="/api/create-checkout-session" method="POST">
        <button type="submit" name="plan" value={plan} className={buttonClass}>
          {name} Subscription
        </button>
      </form>
    );
  }
  // Already Subscribed (Monthly or Annual)
  return (
    <button type="button" disabled className={buttonClass}>
      Subscribed
    </button>
  );
}

export default async function PricingPage() {
  const [user, monthlyPrice, annualPrice] = await Promise.all([
    getCurrentUser(),
    loadPrice('monthly'),
    loadPrice('annual'),
  ]);
  const prices: Record<Plan, Stripe.Price | null> = { monthly: monthlyPrice, annual: annualPrice };
  // Annual price compared with 12 months of Monthly
  const discount = monthlyPrice && annualPrice ? annualDiscountPercent(monthlyPrice, annualPrice) : null;

  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            Pricing
          </h1>
          <p className="text-lg text-muted-foreground">
            Every tool, either way. Pay monthly, or pay yearly{discount ? ` and save ${discount}%` : ''}.
          </p>
        </div>
      </section>

      <section className="py-16 px-6 sm:px-10 lg:px-16 bg-card flex flex-col items-center">
        <div className="w-full max-w-4xl grid gap-6 md:grid-cols-2">
          {PLANS.map(({ plan, name, period, blurb, features }) => {
            const price = prices[plan];
            const showDiscount = plan === 'annual' && discount !== null;
            return (
              <div
                key={plan}
                className={`flex flex-col bg-secondary rounded-xl border p-8 ${showDiscount ? 'border-primary' : 'border-border'}`}
              >
                <div className="flex items-center justify-between gap-3 mb-2">
                  <h2 className="text-2xl font-bold text-foreground">{name}</h2>
                  {showDiscount && (
                    <span className="px-3 py-1 rounded-full text-sm font-semibold bg-primary/15 text-primary">
                      Save {discount}%
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mb-6">{blurb}</p>
                <div className={`flex items-baseline gap-2 ${showDiscount ? 'mb-2' : 'mb-6'}`}>
                  <span className="text-4xl font-bold text-foreground">{(price && formatPrice(price)) ?? '—'}</span>
                  <span className="text-muted-foreground">{period}</span>
                </div>
                {showDiscount && (
                  <p className="text-sm text-muted-foreground mb-6">
                    {discount}% less than 12 months of Monthly
                  </p>
                )}
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
            );
          })}
        </div>
      </section>
    </div>
  );
}
