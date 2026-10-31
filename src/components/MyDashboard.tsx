import Image from 'next/image';
import Link from 'next/link';
import { Car, ChevronRight, Clock, Flag, Gauge, MapPin, Route, Settings, type LucideIcon } from 'lucide-react';
import LocalTime from '@/components/LocalTime';
import ProfilePicture from '@/components/ProfilePicture';
import { MEMBERSHIP_LEVEL, MEMBERSHIP_LEVEL_VALUES } from '@/lib/accountStatus';
import { carPictureUrl } from '@/lib/carPictures';
import { countryFlagClass, countryName } from '@/lib/countryCodes';
import type { DashboardData } from '@/lib/dashboard';
import { hasManageableSubscription, longDistance, maskEmail, splitDriverName, TRACK_MAP_VIEW_BOX, type SubscriptionState } from '@/lib/dashboardRules';
import { fmt, LANGUAGE_LOCALES, LANGUAGE_NAMES, plural } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { retentionDays } from '@/lib/lapRetentionRules';
import type { User } from '@/lib/users';

const TIER_CLASS: Record<string, string> = {
  [MEMBERSHIP_LEVEL.bronze]: 'tier-bronze',
  [MEMBERSHIP_LEVEL.silver]: 'tier-silver',
  [MEMBERSHIP_LEVEL.gold]: 'tier-gold',
};

const trophyUrl = (level: string) => `/assets/dashboard/trophy-${level.toLowerCase()}.webp`;

// The dot beside the subscription's state
const STATE_DOT: Record<SubscriptionState, string> = {
  free: 'bg-muted-foreground',
  active: 'bg-positive',
  trialing: 'bg-positive',
  complimentary: 'bg-positive',
  pastDue: 'bg-tele-warn',
  paused: 'bg-tele-warn',
  cancelScheduled: 'bg-tele-warn',
  canceled: 'bg-tele-warn',
  ended: 'bg-muted-foreground',
  expired: 'bg-muted-foreground',
};

const focusRing = 'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background';
const redButton = `inline-flex w-fit items-center gap-2 rounded-md bg-primary font-display font-bold uppercase tracking-wider text-primary-foreground transition-colors hover:bg-primary-strong ${focusRing}`;

function SectionTitle({ id, children }: { id: string; children: string }) {
  return (
    <div className="mb-5 flex items-center gap-3">
      <span className="h-5 w-1 skew-x-[-16deg] bg-primary" aria-hidden />
      <h2 id={id} className="font-display text-2xl font-bold uppercase tracking-wider">{children}</h2>
      <span className="h-px flex-1 bg-border" aria-hidden />
    </div>
  );
}

function StatCard({ icon: Icon, label, value, unit, note }: { icon: LucideIcon; label: string; value: React.ReactNode; unit?: string; note?: React.ReactNode }) {
  return (
    <div className="dash-card group relative overflow-hidden p-4 transition hover:-translate-y-1 hover:border-primary/40 sm:p-6">
      <span className="absolute left-0 top-0 h-full w-1 bg-primary/70 transition-colors group-hover:bg-primary" aria-hidden />
      <Icon className="size-5 text-primary" strokeWidth={1.5} aria-hidden />
      <p className="mt-4 font-display text-3xl font-bold tabular-nums sm:text-5xl">
        {value}
        {unit && <span className="ml-1 text-lg font-semibold text-muted-foreground">{unit}</span>}
      </p>
      <p className="dash-label mt-1 text-muted-foreground">{label}</p>
      {note && <p className="mt-2 text-xs text-muted-foreground">{note}</p>}
    </div>
  );
}

// The page's sections, from what src/lib/dashboard.ts read for the signed-in user
export default function MyDashboard({ user, data, viewPlans, pictureVersion }: { user: User; data: DashboardData; viewPlans: boolean; pictureVersion: string | null }) {
  const language = user.preferredLanguage;
  const dictionary = getDictionary(language);
  const t = dictionary.myDashboard;
  const locale = LANGUAGE_LOCALES[language];
  const number = (value: number, digits = 0) => value.toLocaleString(locale, { maximumFractionDigits: digits });
  const { careerStatistics: stats, recentSession: session, subscription } = data;

  const name = splitDriverName(user.userName);
  const tier = dictionary.pricing.levelNames[user.membershipLevel] ?? user.membershipLevel;
  const tierClass = TIER_CLASS[user.membershipLevel] ?? TIER_CLASS[MEMBERSHIP_LEVEL.bronze];
  const carPicture = session && carPictureUrl(session.car);
  // Long names get the smaller size so they fit on a phone
  const nameSize = Math.max(name.first.length, name.last.length) > 11 ? 'text-5xl sm:text-7xl lg:text-8xl' : 'text-7xl sm:text-8xl lg:text-9xl';
  const signup = user.signupDate ? <LocalTime iso={user.signupDate} format="date" /> : '—';
  const manage = hasManageableSubscription(subscription.state);
  const unavailable = <span className="text-muted-foreground">—</span>;
  const unavailableNote = stats ? undefined : t.notAvailable;

  return (
    <div className="my-dashboard pb-20">
      <section aria-label={t.driverProfile} className="dash-hero relative overflow-hidden border-b border-border">
        <div className="mx-auto grid max-w-7xl items-center gap-6 px-6 py-10 md:grid-cols-2 md:py-16">
          <div className="dash-rise relative flex justify-center">
            <div className="absolute inset-10 rounded-full bg-primary/30 blur-3xl" aria-hidden />
            <ProfilePicture version={pictureVersion} />
          </div>
          <div className="dash-rise min-w-0 [animation-delay:120ms]">
            <p className="dash-label text-primary">{t.racingDriver}</p>
            <h1 className={`mt-2 font-display font-extrabold uppercase italic leading-[0.85] tracking-tight [overflow-wrap:anywhere] ${nameSize}`}>
              {name.first && <>{name.first}<br /></>}
              <span className="text-primary">{name.last}</span>
              {user.country && (
                <span
                  role="img"
                  aria-label={countryName(user.country, locale)}
                  title={countryName(user.country, locale)}
                  className={`${countryFlagClass(user.country)} ml-3 rounded-[3px] align-middle text-2xl shadow-[0_0_0_1px_rgba(0,0,0,0.15)] sm:text-3xl`}
                />
              )}
            </h1>
            <div className="dash-telemetry-line mt-6 w-48" aria-hidden />
            <div className="mt-6 flex flex-wrap items-center gap-4">
              <span className={`${tierClass} inline-flex items-center gap-2 rounded-full border border-(--tier) bg-card px-4 py-1.5 font-display text-sm font-bold uppercase tracking-widest text-(--tier)`}>
                <Image src={trophyUrl(user.membershipLevel in TIER_CLASS ? user.membershipLevel : MEMBERSHIP_LEVEL.bronze)} alt="" width={20} height={20} className="size-5 rounded-full object-cover" />
                {fmt(t.tierMember, { tier })}
              </span>
              <span className="text-muted-foreground">{t.memberSince} <span className="text-foreground">{signup}</span></span>
              <span className="text-muted-foreground">{t.preferredLanguage} <span className="text-foreground">{LANGUAGE_NAMES[language]}</span></span>
            </div>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-7xl space-y-14 px-6 pt-10">
        <section aria-labelledby="dashboard-last">
          <SectionTitle id="dashboard-last">{t.lastOnTrack}</SectionTitle>
          {session ? (
            <div className="dash-card grid overflow-hidden md:grid-cols-[1.3fr_1fr]">
              {carPicture ? (
                <Image src={carPicture} alt={session.car} width={992} height={672} sizes="(min-width: 768px) 56vw, 100vw" className="h-full w-full object-cover" />
              ) : (
                <div className="grid min-h-48 place-items-center bg-background/40">
                  <Car className="size-24 text-muted-foreground" strokeWidth={1} aria-hidden />
                </div>
              )}
              <div className="flex min-w-0 flex-col justify-center gap-4 p-6 sm:p-8">
                <div>
                  <p className="dash-label text-muted-foreground">{dictionary.laps.sessionTypes[session.sessionType] ?? session.sessionType}</p>
                  <h3 className="font-display text-4xl font-bold uppercase">{session.car}</h3>
                </div>
                <div className="flex items-start gap-3">
                  {session.mapPath ? (
                    <svg viewBox={TRACK_MAP_VIEW_BOX} role="img" aria-label={fmt(t.trackMap, { track: session.track })} className="h-16 w-24 shrink-0 text-primary" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
                      <path d={session.mapPath} />
                    </svg>
                  ) : (
                    <MapPin className="size-8 shrink-0 text-primary" strokeWidth={1.5} aria-hidden />
                  )}
                  <div className="min-w-0">
                    <p className="font-semibold">{session.track}</p>
                    {session.config && <p className="text-sm text-muted-foreground">{fmt(t.configuration, { config: session.config })}</p>}
                  </div>
                </div>
                <p className="text-sm text-muted-foreground">{t.lastDriven} <LocalTime iso={session.at} format="dateTime" className="text-foreground" /></p>
                {/* There's no page for one session: it's listed on My Sessions */}
                <Link href="/racing" className={`${redButton} group px-5 py-2.5`}>
                  {t.viewSessions} <ChevronRight className="size-4 transition group-hover:translate-x-1" aria-hidden />
                </Link>
              </div>
            </div>
          ) : (
            <div className="dash-card flex flex-col items-start gap-3 p-6 sm:p-8">
              <Flag className="size-8 text-primary" strokeWidth={1.5} aria-hidden />
              <h3 className="font-display text-3xl font-bold uppercase">{stats ? t.noSessionsTitle : t.notAvailable}</h3>
              {stats && <p className="max-w-2xl text-muted-foreground">{t.noSessionsText}</p>}
              {stats && <Link href="/installing" className={`${redButton} mt-2 px-5 py-2.5`}>{t.installCollector} <ChevronRight className="size-4" aria-hidden /></Link>}
            </div>
          )}
        </section>

        <section aria-labelledby="dashboard-stats">
          <SectionTitle id="dashboard-stats">{t.statistics}</SectionTitle>
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-3">
            <StatCard
              icon={Route}
              label={t.totalLaps}
              value={stats ? number(stats.laps) : unavailable}
              note={stats ? stats.lapsThisWeek > 0 && fmt(t.lapsThisWeek, { n: number(stats.lapsThisWeek) }) : unavailableNote}
            />
            <StatCard
              icon={Flag}
              label={t.totalSessions}
              value={stats ? number(stats.sessions) : unavailable}
              note={stats ? stats.sessions > 0 && plural(language, Math.round((stats.laps / stats.sessions) * 10) / 10, t.lapsPerSession, { n: number(stats.laps / stats.sessions, 1) }) : unavailableNote}
            />
            <StatCard
              icon={Gauge}
              label={t.distanceDriven}
              value={stats && (stats.distanceFeet !== null || stats.laps === 0) ? number(longDistance(stats.distanceFeet ?? 0, user.units)) : unavailable}
              unit={stats && (stats.distanceFeet !== null || stats.laps === 0) ? (user.units === 'metric' ? t.kilometers : t.miles) : undefined}
              note={
                !stats || (stats.distanceFeet === null && stats.laps > 0)
                  ? t.notAvailable
                  : stats.lapsWithoutLength > 0 && plural(language, stats.lapsWithoutLength, t.lapsWithoutLength)
              }
            />
            <StatCard icon={Car} label={t.uniqueCars} value={stats ? number(stats.cars) : unavailable} note={unavailableNote} />
            <StatCard icon={MapPin} label={t.tracksDriven} value={stats ? number(stats.tracks) : unavailable} note={unavailableNote} />
            <StatCard
              icon={Clock}
              label={t.lastActive}
              value={stats?.lastActive ? <LocalTime iso={stats.lastActive} format="relative" className="block text-2xl sm:text-4xl" /> : unavailable}
              note={stats?.lastActive ? <LocalTime iso={stats.lastActive} format="dateTime" /> : stats ? t.noLapsYet : t.notAvailable}
            />
          </div>
          <p className="mt-4 text-sm text-muted-foreground">
            {fmt(t.statisticsNote, { tier, days: retentionDays(user.membershipLevel) })}{' '}
            <Link href="/privacy#lap-telemetry-retention" className={`text-foreground underline hover:text-primary ${focusRing}`}>{t.learnMore}</Link>
          </p>
        </section>

        <section aria-labelledby="dashboard-membership">
          <SectionTitle id="dashboard-membership">{t.membership}</SectionTitle>
          <div className="dash-card p-4 sm:p-6 md:p-10">
            <div className="grid grid-cols-3 items-end gap-3 md:gap-8">
              {MEMBERSHIP_LEVEL_VALUES.map((level) => {
                const active = level === user.membershipLevel;
                const levelName = dictionary.pricing.levelNames[level] ?? level;
                return (
                  <div key={level} className={`${TIER_CLASS[level]} flex flex-col items-center text-center`} aria-current={active ? 'true' : undefined}>
                    <Image
                      src={trophyUrl(level)}
                      alt={fmt(t.trophyAlt, { tier: levelName })}
                      width={512}
                      height={512}
                      sizes={active ? '(min-width: 768px) 16rem, 28vw' : '(min-width: 768px) 10rem, 22vw'}
                      className={`rounded-xl ${active ? 'w-full max-w-64 ring-1 ring-(--tier) shadow-[0_0_60px_-10px_var(--tier)]' : 'w-4/5 max-w-40 opacity-40 grayscale-[40%]'}`}
                    />
                    <p className={`mt-3 font-display font-bold uppercase tracking-[0.25em] ${active ? 'text-lg text-(--tier) sm:text-2xl' : 'text-xs text-muted-foreground sm:text-sm'}`}>{levelName}</p>
                    {active && <span className="dash-label mt-1 text-primary">{t.currentTier}</span>}
                  </div>
                );
              })}
            </div>
            <p className="mt-6 text-center text-xs text-muted-foreground">{t.trophyNote}</p>
            <div className="mt-6 flex flex-col gap-6 border-t border-border pt-6 md:flex-row md:items-center md:justify-between">
              <dl className="grid grid-cols-2 gap-6 sm:grid-cols-3">
                <div>
                  <dt className="dash-label text-muted-foreground">{t.plan}</dt>
                  <dd className={`${tierClass} font-display text-xl font-bold text-(--tier)`}>{tier}</dd>
                </div>
                <div>
                  <dt className="dash-label text-muted-foreground">{t.status}</dt>
                  <dd className="flex items-center gap-2 font-semibold">
                    <span className={`size-2 shrink-0 rounded-full ${STATE_DOT[subscription.state]}`} aria-hidden />
                    {t.states[subscription.state]}
                  </dd>
                </div>
                {subscription.dateKind && subscription.date && (
                  <div>
                    <dt className="dash-label text-muted-foreground">{t.dates[subscription.dateKind]}</dt>
                    <dd className="font-semibold"><LocalTime iso={subscription.date} format="date" /></dd>
                  </div>
                )}
              </dl>
              {/* Canceling and changing plans are on the Account page and the Pricing page; there's no Stripe customer portal */}
              {(manage || viewPlans) && (
                <Link
                  href={manage ? '/account#subscription' : '/pricing'}
                  className={`${tierClass} inline-flex items-center justify-center rounded-md border border-(--tier) px-5 py-2.5 text-center font-display font-bold uppercase tracking-wider text-(--tier) transition-colors hover:bg-secondary ${focusRing}`}
                >
                  {manage ? t.manageSubscription : dictionary.account.viewPlans}
                </Link>
              )}
            </div>
          </div>
        </section>

        <section aria-labelledby="dashboard-account">
          <SectionTitle id="dashboard-account">{t.account}</SectionTitle>
          <div className="dash-card p-6 md:p-8">
            <dl className="grid gap-x-10 gap-y-6 sm:grid-cols-2">
              {[
                [t.fullName, user.userName],
                [t.signupDate, signup],
                [t.preferredLanguage, LANGUAGE_NAMES[language]],
                [t.subscription, tier],
                [t.accountEmail, maskEmail(user.emailAddress)],
              ].map(([label, value], i) => (
                <div key={i} className="min-w-0 border-b border-border pb-4">
                  <dt className="dash-label text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold [overflow-wrap:anywhere]">{value}</dd>
                </div>
              ))}
            </dl>
            <Link href="/account" className={`${redButton} mt-8 px-6 py-3 text-lg`}>
              <Settings className="size-5" aria-hidden /> {dictionary.nav.myAccount}
            </Link>
          </div>
        </section>
      </div>
    </div>
  );
}
