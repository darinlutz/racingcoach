import Link from 'next/link';
import { redirect } from 'next/navigation';
import CancelSubscriptionButton from '@/components/CancelSubscriptionButton';
import ChangePasswordButton from '@/components/ChangePasswordButton';
import CollectorKeyCard from '@/components/CollectorKeyCard';
import DeleteAccountButton from '@/components/DeleteAccountButton';
import InCarCoachInstructionsCard from '@/components/InCarCoachInstructionsCard';
import LanguageSelect from '@/components/LanguageSelect';
import MyAiUsageCard from '@/components/MyAiUsageCard';
import ThemeToggle from '@/components/ThemeToggle';
import UnitsToggle from '@/components/UnitsToggle';
import { COACH_VOICES, getCoachVoice, SPANISH_ACCENTS } from '@/lib/coachVoice';
import { getCollectorKey } from '@/lib/collectorKeys';
import { DISCORD_INVITE_URL, getDiscordConnection } from '@/lib/discord';
import { fmt, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { readOwnAiUsage } from '@/lib/rateLimits';
import { canUseInCarCoach, isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getEnableAiFeatures, getShowPricing } from '@/lib/siteSettings';
import { canBuyAnything, getInCarCoachInstructions, MAX_IN_CAR_COACH_INSTRUCTIONS } from '@/lib/users';
import { ACCOUNT_STATUS, MEMBERSHIP_LEVEL } from '@/lib/accountStatus';

// Each level's medal color
function levelBadgeClass(membershipLevel: string): string {
  switch (membershipLevel) {
    case MEMBERSHIP_LEVEL.gold:
      return 'bg-amber-400/15 text-amber-400';
    case MEMBERSHIP_LEVEL.silver:
      return 'bg-slate-300/15 text-slate-300';
    default:
      return 'bg-[#cd7f32]/15 text-[#cd7f32]';
  }
}

// What /api/discord/* send back in ?discord= that's good news; the rest are problems
const DISCORD_OK = new Set(['disconnected']);

const selectClass =
  'w-full px-4 py-3 bg-card border border-border rounded-lg text-foreground focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const t = getDictionary(user.preferredLanguage);
  const locale = LANGUAGE_LOCALES[user.preferredLanguage];
  const formatDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(locale, { dateStyle: 'long' }) : '—');

  const { discord: discordResult } = await searchParams;
  const discordText = typeof discordResult === 'string' ? t.account.discordMessages[discordResult] : undefined;
  const discordOk = typeof discordResult === 'string' && DISCORD_OK.has(discordResult);
  const [discord, collectorKey, inCarCoachInstructions, coachVoice, showPricing, enableAiFeatures, aiUsage] = await Promise.all([
    getDiscordConnection(user.id),
    getCollectorKey(user.id),
    getInCarCoachInstructions(user.id),
    getCoachVoice(user.id),
    getShowPricing(),
    getEnableAiFeatures(),
    readOwnAiUsage(user.id),
  ]);
  const isSubscribed = user.accountStatus === ACCOUNT_STATUS.subscribed;
  // A canceled subscription keeps its end date: the end of the last paid period
  const showEndDate =
    user.subscriptionEndDate !== null &&
    (isSubscribed || user.accountStatus === ACCOUNT_STATUS.canceled);
  // Everyone but a current Gold subscriber has a plan to buy or upgrade to
  const canUpgrade = canBuyAnything(user);
  // The Admin page's Show Pricing hides View Membership Plans too, like the nav bar's Pricing link
  const showViewPlans = showPricing && canUpgrade;

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-2xl bg-secondary rounded-xl border border-border p-6 sm:p-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.account.title}
        </h1>
        <p className="text-muted-foreground mb-8">{t.account.intro}</p>

        <dl className="divide-y divide-border bg-card rounded-lg border border-border">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">{t.account.email}</dt>
            <dd className="text-foreground font-medium text-right break-all">
              {user.emailAddress}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">{t.account.name}</dt>
            <dd className="text-foreground font-medium text-right">
              {user.userName}
            </dd>
          </div>
          <div className="flex justify-between items-center gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">{t.account.membershipLevel}</dt>
            <dd>
              <span
                className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${levelBadgeClass(user.membershipLevel)}`}
              >
                {t.pricing.levelNames[user.membershipLevel] ?? user.membershipLevel}
              </span>
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">{t.admin.role}</dt>
            <dd className="text-foreground font-medium text-right">
              {t.admin.roles[user.role] ?? user.role}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">{t.account.signupDate}</dt>
            <dd className="text-foreground font-medium text-right">
              {formatDate(user.signupDate)}
            </dd>
          </div>
          {showEndDate && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-sm font-medium text-muted-foreground">{t.account.subscriptionEndDate}</dt>
              <dd className="text-foreground font-medium text-right">
                {formatDate(user.subscriptionEndDate)}
              </dd>
            </div>
          )}
        </dl>

        {/* Accounts made through Google sign-in have no password to change until Forgot Password sets one */}
        {user.hasPassword && <ChangePasswordButton />}

        {/* The site's language, including what the AI features answer in, Standard / Metric units, and Dark Mode / Light Mode */}
        <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">{t.preferences.title}</h2>
          <LanguageSelect id="preferredLanguage" className={selectClass} />
          <p className="mt-2 text-sm text-muted-foreground">{t.preferences.languageHint}</p>
          <div className="mt-5">
            <UnitsToggle />
          </div>
          <div className="mt-5">
            <ThemeToggle theme={user.theme} />
          </div>
        </div>

        {/* Linked Discord account */}
        <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">{t.account.discord}</h2>
          {discordText && (
            <p
              className={`mb-3 p-3 rounded-lg text-sm ${
                discordOk ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'
              }`}
            >
              {discordText}
            </p>
          )}
          {discord ? (
            <div className="flex items-center justify-between gap-4">
              <div className="flex items-center gap-3 min-w-0">
                {discord.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- small remote avatar, not worth configuring next/image for
                  <img src={discord.avatarUrl} alt="" width={40} height={40} className="w-10 h-10 rounded-full" />
                )}
                <div className="min-w-0">
                  <p className="text-foreground font-medium truncate">{discord.globalName ?? discord.username}</p>
                  <p className="text-sm text-muted-foreground truncate">
                    {fmt(t.account.discordLinked, { username: discord.username, date: formatDate(discord.connectedAt) })}
                  </p>
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap justify-end gap-2">
                <a
                  href={DISCORD_INVITE_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 text-sm font-semibold rounded-lg text-white bg-[#5865F2] hover:bg-[#4752C4] transition-colors"
                >
                  {t.account.joinServer}
                </a>
                <form action="/api/discord/disconnect" method="POST">
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors"
                  >
                    {t.account.disconnect}
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">{t.account.linkDiscord}</p>
              {/* A plain link: /api/discord/connect redirects to Discord, then on to the server invite */}
              <a
                href="/api/discord/connect"
                className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-[#5865F2] hover:bg-[#4752C4] transition-colors"
              >
                {t.account.connectDiscord}
              </a>
            </div>
          )}
        </div>

        <CollectorKeyCard initialKey={collectorKey} />

        {/* Hidden when the Admin page turns Enable AI Features off */}
        {enableAiFeatures && (
          <InCarCoachInstructionsCard
            instructions={inCarCoachInstructions}
            maxLength={MAX_IN_CAR_COACH_INSTRUCTIONS}
            voice={coachVoice.voice}
            voices={COACH_VOICES}
            spanishAccent={coachVoice.spanishAccent}
            spanishAccents={SPANISH_ACCENTS}
            available={canUseInCarCoach(user)}
            viewPlans={showViewPlans}
          />
        )}

        {enableAiFeatures && <MyAiUsageCard day={aiUsage.day} week={aiUsage.week} />}

        {showViewPlans && (
          <Link
            href="/pricing"
            className="mt-8 block w-full px-6 py-3 rounded-lg font-semibold text-center text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors"
          >
            {t.account.viewPlans}
          </Link>
        )}

        {isSubscribed && <CancelSubscriptionButton />}

        {/* Admins can't delete their account (the API refuses too) */}
        {!isAdmin(user.role) && <DeleteAccountButton isSubscribed={isSubscribed} />}
      </div>
    </section>
  );
}
