import Image from 'next/image';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { CSSProperties } from 'react';
import { Check } from 'lucide-react';
import type Stripe from 'stripe';
import {
  ACCOUNT_STATUS,
  levelRank,
  MEMBERSHIP_LEVEL,
  type MembershipLevel,
  type Plan,
} from '@/lib/accountStatus';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { getDictionary, getLanguage } from '@/lib/i18n/server';
import { withReturnTo } from '@/lib/returnTo';
import { getCurrentUser } from '@/lib/session';
import { formatPrice, getPlanPrice, getStripeConfig } from '@/lib/stripePlans';
import { canBuy, type User } from '@/lib/users';

// The layout came from the Lovable project darinlutz/eleven-laps-pricing

type PaidLevel = typeof MEMBERSHIP_LEVEL.silver | typeof MEMBERSHIP_LEVEL.gold;

// Each paid level's Monthly plan (Annual plans are no longer offered; existing annual subscriptions still renew)
const LEVEL_PLANS: Record<PaidLevel, Plan> = {
  Silver: 'silver_monthly',
  Gold: 'gold_monthly',
};

// Each card's color (globals.css, per theme) and trophy
const TIER_COLOR: Record<MembershipLevel, string> = {
  Bronze: 'var(--tier-bronze)',
  Silver: 'var(--tier-silver)',
  Gold: 'var(--tier-gold)',
};
const trophyUrl = (level: MembershipLevel) => `/assets/pricing/trophy-${level.toLowerCase()}.webp`;

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

const buttonClass =
  'tier-btn mt-8 block w-full rounded-lg py-3 text-center font-display text-sm font-extrabold uppercase tracking-widest transition';

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

// The Subscribe button, or why there's nothing to buy at this level
function PaidActions({ level, user, t }: { level: PaidLevel; user: User | null; t: Dictionary['pricing'] }) {
  const plan = LEVEL_PLANS[level];
  if (user && user.accountStatus === ACCOUNT_STATUS.subscribed && levelRank(user.membershipLevel) >= levelRank(level)) {
    return <DisabledButton label={user.membershipLevel === level ? t.currentPlan : t.included} />;
  }
  if (!user) {
    return <Link href="/signup" className={buttonClass}>{t.subscribe}</Link>;
  }
  return (
    <form action="/api/create-checkout-session" method="POST">
      <button type="submit" name="plan" value={plan} disabled={!canBuy(user, plan)} className={buttonClass}>
        {t.subscribe}
      </button>
    </form>
  );
}

export default async function PricingPage() {
  const [user, silverMonthly, goldMonthly] = await Promise.all([
    getCurrentUser(),
    loadPrice('silver_monthly'),
    loadPrice('gold_monthly'),
  ]);
  // Like My Sessions, signed-out visitors log in first and come back here
  if (!user) redirect(withReturnTo('/login', '/pricing'));
  const t = getDictionary(await getLanguage(user)).pricing;
  const prices: Record<PaidLevel, Stripe.Price | null> = { Silver: silverMonthly, Gold: goldMonthly };
  // Bronze, or the level of a current (or canceled but still paid for) subscription
  const level = user?.membershipLevel ?? null;
  // A Silver subscriber buying Gold replaces their Silver subscription
  const upgradingFromSilver =
    user?.accountStatus === ACCOUNT_STATUS.subscribed && user.membershipLevel === MEMBERSHIP_LEVEL.silver;

  const levels: MembershipLevel[] = [MEMBERSHIP_LEVEL.bronze, MEMBERSHIP_LEVEL.silver, MEMBERSHIP_LEVEL.gold];

  return (
    <div className="relative w-full overflow-hidden bg-background text-foreground">
      <div className="checker-strip absolute inset-x-0 top-0 h-6" />
      <section className="mx-auto max-w-6xl px-4 pb-24 pt-20 sm:px-6">
        <header className="mx-auto max-w-2xl text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.3em] text-primary">{t.eyebrow}</p>
          <h1 className="mt-4 font-display text-4xl font-extrabold uppercase tracking-tight md:text-6xl">{t.title}</h1>
          <p className="mt-5 text-lg text-muted-foreground">{t.intro}</p>
        </header>

        <div className="mt-16 grid items-stretch gap-8 md:grid-cols-3">
          {levels.map((cardLevel) => {
            const text: { tagline: string; includes?: string; features: string[] } = t.levels[cardLevel];
            const featured = cardLevel === MEMBERSHIP_LEVEL.gold;
            const isCurrent = level === cardLevel;
            const paid = cardLevel === MEMBERSHIP_LEVEL.bronze ? null : cardLevel;
            const monthly = paid && prices[paid];
            const name = t.levelNames[cardLevel] ?? cardLevel;
            return (
              <article
                key={cardLevel}
                style={{ '--tier': TIER_COLOR[cardLevel] } as CSSProperties}
                className={`tier-card relative flex flex-col overflow-hidden rounded-2xl border bg-card ${
                  featured ? 'md:-translate-y-4' : ''
                }`}
              >
                <div className="tier-glow pointer-events-none absolute inset-0" />
                {(featured || isCurrent) && (
                  <span className="tier-btn absolute right-4 top-4 z-10 rounded-full px-3 py-1 text-xs font-bold uppercase tracking-wider">
                    {isCurrent ? t.currentPlan : t.mostPopular}
                  </span>
                )}
                {/* The trophies are on black, in either theme */}
                <div className="relative flex justify-center bg-black pt-6">
                  <Image src={trophyUrl(cardLevel)} alt="" width={192} height={192} className="h-48 w-48 object-contain" />
                </div>
                <div className="relative flex flex-1 flex-col p-8">
                  <h2 className="tier-text font-display text-2xl font-extrabold uppercase tracking-wide">{name}</h2>
                  <p className="mt-1 text-muted-foreground">{text.tagline}</p>
                  <div className="mt-6 flex items-baseline gap-2">
                    <span className="font-display text-4xl font-extrabold">
                      {paid ? ((monthly && formatPrice(monthly)) ?? '—') : t.free}
                    </span>
                    <span className="text-muted-foreground">{paid ? t.perMonth : t.forever}</span>
                  </div>
                  <div className="my-6 h-px bg-border" />
                  {text.includes && (
                    <p className="mb-3 text-sm font-semibold uppercase tracking-wider text-muted-foreground">
                      {text.includes}
                    </p>
                  )}
                  <ul className="flex-1 space-y-3">
                    {text.features.map((feature) => (
                      <li key={feature} className="flex items-start gap-3">
                        <Check className="tier-text mt-0.5 h-5 w-5 shrink-0" />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                  {paid ? <PaidActions level={paid} user={user} t={t} /> : <BronzeAction user={user} t={t} />}
                  {paid === MEMBERSHIP_LEVEL.gold && upgradingFromSilver && (
                    <p className="mt-3 text-center text-xs text-muted-foreground">{t.upgradeNote}</p>
                  )}
                </div>
              </article>
            );
          })}
        </div>
        <p className="mx-auto mt-12 max-w-2xl text-center text-sm text-muted-foreground">{t.fineprint}</p>
      </section>
    </div>
  );
}
