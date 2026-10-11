import Link from 'next/link';
import { Check } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import type Stripe from 'stripe';
import type { Plan } from '@/lib/accountStatus';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { annualDiscountPercent, formatPrice, getPlanPrice, getStripeConfig } from '@/lib/stripePlans';
import { canBuy, type User } from '@/lib/users';

// The two plans' text, in the user's language
function plans(t: Dictionary['pricing']): { plan: Plan; name: string; period: string; blurb: string; subscription: string; features: string[] }[] {
  return [
    { plan: 'monthly', ...t.monthly, features: [...t.features, t.cancelAnytime] },
    { plan: 'annual', ...t.annual, features: [...t.annual.features, t.cancelAnytime] },
  ];
}

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

function PlanAction({ plan, subscription, user, t }: { plan: Plan; subscription: string; user: User | null; t: Dictionary['pricing'] }) {
  if (!user) {
    return <Link href="/signup" className={buttonClass}>{t.getStarted}</Link>;
  }
  if (canBuy(user)) {
    return (
      <form action="/api/create-checkout-session" method="POST">
        <button type="submit" name="plan" value={plan} className={buttonClass}>
          {subscription}
        </button>
      </form>
    );
  }
  // Already Subscribed (Monthly or Annual)
  return (
    <button type="button" disabled className={buttonClass}>
      {t.subscribed}
    </button>
  );
}

export default async function PricingPage() {
  const [user, monthlyPrice, annualPrice] = await Promise.all([
    getCurrentUser(),
    loadPrice('monthly'),
    loadPrice('annual'),
  ]);
  const t = getDictionary(await getLanguage(user)).pricing;
  const prices: Record<Plan, Stripe.Price | null> = { monthly: monthlyPrice, annual: annualPrice };
  // Annual price compared with 12 months of Monthly
  const discount = monthlyPrice && annualPrice ? annualDiscountPercent(monthlyPrice, annualPrice) : null;

  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-4xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.title}
          </h1>
          <p className="text-lg text-muted-foreground">
            {discount ? fmt(t.introDiscount, { discount }) : t.intro}
          </p>
        </div>
      </section>

      <section className="py-16 px-6 sm:px-10 lg:px-16 bg-card flex flex-col items-center">
        <div className="w-full max-w-4xl grid gap-6 md:grid-cols-2">
          {plans(t).map(({ plan, name, period, blurb, subscription, features }) => {
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
                      {fmt(t.save, { discount: discount ?? '' })}
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
                    {fmt(t.lessThanMonthly, { discount: discount ?? '' })}
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
                <PlanAction plan={plan} subscription={subscription} user={user} t={t} />
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
