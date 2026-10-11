import Link from 'next/link';
import { Check, Info, Medal } from 'lucide-react';
import { buttonVariants } from '@/components/Button';
import type Stripe from 'stripe';
import {
  ACCOUNT_STATUS,
  levelRank,
  MEMBERSHIP_LEVEL,
  type MembershipLevel,
  type Plan,
} from '@/lib/accountStatus';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { getCurrentUser } from '@/lib/session';
import { annualDiscountPercent, formatPrice, getPlanPrice, getStripeConfig } from '@/lib/stripePlans';
import { canBuy, type User } from '@/lib/users';

type PaidLevel = typeof MEMBERSHIP_LEVEL.silver | typeof MEMBERSHIP_LEVEL.gold;

// Each paid level's Monthly and Annual plans
const LEVEL_PLANS: Record<PaidLevel, { monthly: Plan; annual: Plan }> = {
  Silver: { monthly: 'silver_monthly', annual: 'silver_annual' },
  Gold: { monthly: 'gold_monthly', annual: 'gold_annual' },
};

const MEDAL_COLOR: Record<MembershipLevel, string> = {
  Bronze: 'text-[#cd7f32]',
  Silver: 'text-slate-300',
  Gold: 'text-amber-400',
};

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

function DisabledButton({ label }: { label: string }) {
  return (
    <button type="button" disabled className={buttonClass}>
      {label}
    </button>
  );
}

function BronzeAction({ user, t }: { user: User | null; t: Dictionary['pricing'] }) {
  if (!user) {
    return <Link href="/signup" className={buttonClass}>{t.getStarted}</Link>;
  }
  return <DisabledButton label={user.membershipLevel === MEMBERSHIP_LEVEL.bronze ? t.currentPlan : t.included} />;
}

// Monthly and Annual buttons, or why there's nothing to buy at this level
function PaidActions({ level, user, t }: { level: PaidLevel; user: User | null; t: Dictionary['pricing'] }) {
  const plans = LEVEL_PLANS[level];
  if (user && user.accountStatus === ACCOUNT_STATUS.subscribed && levelRank(user.membershipLevel) >= levelRank(level)) {
    return <DisabledButton label={user.membershipLevel === level ? t.currentPlan : t.included} />;
  }
  if (!user) {
    return (
      <div className="grid grid-cols-2 gap-3">
        <Link href="/signup" className={buttonClass}>{t.monthly}</Link>
        <Link href="/signup" className={buttonClass}>{t.annual}</Link>
      </div>
    );
  }
  return (
    <form action="/api/create-checkout-session" method="POST" className="grid grid-cols-2 gap-3">
      {(['monthly', 'annual'] as const).map((period) => (
        <button
          key={period}
          type="submit"
          name="plan"
          value={plans[period]}
          disabled={!canBuy(user, plans[period])}
          className={buttonClass}
        >
          {t[period]}
        </button>
      ))}
    </form>
  );
}

export default async function PricingPage() {
  const [user, silverMonthly, silverAnnual, goldMonthly, goldAnnual] = await Promise.all([
    getCurrentUser(),
    loadPrice('silver_monthly'),
    loadPrice('silver_annual'),
    loadPrice('gold_monthly'),
    loadPrice('gold_annual'),
  ]);
  const t = getDictionary(await getLanguage(user)).pricing;
  const prices: Record<PaidLevel, { monthly: Stripe.Price | null; annual: Stripe.Price | null }> = {
    Silver: { monthly: silverMonthly, annual: silverAnnual },
    Gold: { monthly: goldMonthly, annual: goldAnnual },
  };
  // Each level's Annual price compared with 12 months of its Monthly price
  const discounts: Record<PaidLevel, number | null> = {
    Silver: silverMonthly && silverAnnual ? annualDiscountPercent(silverMonthly, silverAnnual) : null,
    Gold: goldMonthly && goldAnnual ? annualDiscountPercent(goldMonthly, goldAnnual) : null,
  };
  const bestDiscount = Math.max(0, ...Object.values(discounts).map((d) => d ?? 0));
  // Bronze, or the level of a current (or canceled but still paid for) subscription
  const level = user?.membershipLevel ?? null;
  // A Silver subscriber buying Gold replaces their Silver subscription
  const upgradingFromSilver =
    user?.accountStatus === ACCOUNT_STATUS.subscribed && user.membershipLevel === MEMBERSHIP_LEVEL.silver;

  const levels: MembershipLevel[] = [MEMBERSHIP_LEVEL.bronze, MEMBERSHIP_LEVEL.silver, MEMBERSHIP_LEVEL.gold];

  return (
    <div className="w-full">
      <section className="py-16 px-4 sm:px-6 lg:px-8 bg-gradient-to-b from-background to-background border-b border-border">
        <div className="max-w-3xl mx-auto text-center">
          <h1 className="text-4xl md:text-5xl font-bold mb-4 pb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {t.title}
          </h1>
          <p className="text-lg text-muted-foreground">{t.intro}</p>
          {bestDiscount > 0 && (
            <p className="mt-3 text-base font-semibold text-primary">{fmt(t.saveUpTo, { discount: bestDiscount })}</p>
          )}
        </div>
      </section>

      <section className="py-16 px-4 sm:px-6 lg:px-10 bg-card flex flex-col items-center">
        <div className="w-full max-w-6xl grid gap-6 lg:grid-cols-3">
          {levels.map((cardLevel) => {
            const text = t.levels[cardLevel];
            const highlighted = cardLevel === MEMBERSHIP_LEVEL.silver;
            const isCurrent = level === cardLevel;
            const paid = cardLevel === MEMBERSHIP_LEVEL.bronze ? null : cardLevel;
            const monthly = paid && prices[paid].monthly;
            const annual = paid && prices[paid].annual;
            const discount = paid && discounts[paid];
            return (
              <div
                key={cardLevel}
                className={`relative flex flex-col bg-secondary rounded-xl border p-8 ${
                  highlighted ? 'border-primary shadow-lg shadow-primary/10' : 'border-border'
                }`}
              >
                {highlighted && (
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wide bg-primary text-white">
                    {t.mostPopular}
                  </span>
                )}
                <div className="flex items-center gap-3 mb-2">
                  <Medal className={`h-7 w-7 shrink-0 ${MEDAL_COLOR[cardLevel]}`} />
                  <h2 className="text-2xl font-bold text-foreground">{t.levelNames[cardLevel]}</h2>
                  {isCurrent && (
                    <span className="ml-auto px-3 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400">
                      {t.currentPlan}
                    </span>
                  )}
                </div>
                <p className="text-muted-foreground mb-6 min-h-12">{text.tagline}</p>

                {paid ? (
                  <div className="mb-6">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-foreground">{(monthly && formatPrice(monthly)) ?? '—'}</span>
                      <span className="text-muted-foreground">{t.perMonth}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground flex flex-wrap items-center gap-2">
                      <span>{fmt(t.orAnnual, { price: (annual && formatPrice(annual)) ?? '—' })}</span>
                      {discount ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-primary/15 text-primary">
                          {fmt(t.save, { discount })}
                        </span>
                      ) : null}
                    </p>
                  </div>
                ) : (
                  <div className="mb-6">
                    <div className="flex items-baseline gap-2">
                      <span className="text-4xl font-bold text-foreground">{t.free}</span>
                      <span className="text-muted-foreground">{t.forever}</span>
                    </div>
                    <p className="mt-2 text-sm text-muted-foreground">&nbsp;</p>
                  </div>
                )}

                <ul className="space-y-3 mb-8 flex-1">
                  {text.features.map((feature) => (
                    <li key={feature} className="flex gap-3 text-foreground">
                      <Check className="h-5 w-5 shrink-0 text-primary mt-0.5" />
                      <span>{feature}</span>
                    </li>
                  ))}
                  {'limits' in text && (
                    <li className="flex gap-3 text-muted-foreground">
                      <Info className="h-5 w-5 shrink-0 mt-0.5" />
                      <span>{text.limits}</span>
                    </li>
                  )}
                </ul>

                {paid ? <PaidActions level={paid} user={user} t={t} /> : <BronzeAction user={user} t={t} />}
                {paid === MEMBERSHIP_LEVEL.gold && upgradingFromSilver && (
                  <p className="mt-3 text-xs text-muted-foreground text-center">{t.upgradeNote}</p>
                )}
              </div>
            );
          })}
        </div>
        <p className="mt-10 max-w-2xl text-center text-sm text-muted-foreground">{t.fineprint}</p>
      </section>
    </div>
  );
}
