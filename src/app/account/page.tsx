import { redirect } from 'next/navigation';
import CancelSubscriptionButton from '@/components/CancelSubscriptionButton';
import { DISCORD_INVITE_URL, getDiscordConnection } from '@/lib/discord';
import { getCurrentUser } from '@/lib/session';
import { canBuy } from '@/lib/users';
import { ACCOUNT_STATUS } from '@/lib/accountStatus';

// Green for a current subscription, red once it's canceled or expired,
// blue (the site color) otherwise
function statusBadgeClass(accountStatus: string): string {
  switch (accountStatus) {
    case ACCOUNT_STATUS.monthly:
    case ACCOUNT_STATUS.lifetime:
      return 'bg-green-500/15 text-green-400';
    case ACCOUNT_STATUS.canceled:
    case ACCOUNT_STATUS.expired:
      return 'bg-primary/15 text-red-300';
    default:
      return 'bg-primary/15 text-primary';
  }
}

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-US', { dateStyle: 'long' });
}

// What /api/discord/* send back in ?discord=, and whether it's good news
const DISCORD_MESSAGES: Record<string, { text: string; ok: boolean }> = {
  disconnected: { text: 'Your Discord account has been unlinked.', ok: true },
  canceled: { text: 'Discord linking was canceled.', ok: false },
  expired: { text: 'That Discord link request expired. Please try again.', ok: false },
  taken: { text: 'That Discord account is already linked to another RacingCoach account.', ok: false },
  unavailable: { text: 'Discord linking is not available right now.', ok: false },
  error: { text: 'Something went wrong linking Discord. Please try again.', ok: false },
};

export default async function AccountPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const { discord: discordResult } = await searchParams;
  const discordMessage = typeof discordResult === 'string' ? DISCORD_MESSAGES[discordResult] : undefined;
  const discord = await getDiscordConnection(user.id);
  const isMonthly = user.accountStatus === ACCOUNT_STATUS.monthly;
  // A canceled monthly subscription keeps its end date: the end of the last paid month
  const showEndDate = isMonthly || (user.accountStatus === ACCOUNT_STATUS.canceled && user.subscriptionEndDate !== null);
  const canBuyMonthly = canBuy(user, 'monthly');
  const canBuyLifetime = canBuy(user, 'lifetime');

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-lg bg-secondary rounded-xl border border-border p-6 sm:p-8">
        <h1 className="text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          My Account
        </h1>
        <p className="text-muted-foreground mb-8">Your account details.</p>

        <dl className="divide-y divide-border bg-card rounded-lg border border-border">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">Email</dt>
            <dd className="text-foreground font-medium text-right break-all">
              {user.emailAddress}
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">Name</dt>
            <dd className="text-foreground font-medium text-right">
              {user.userName}
            </dd>
          </div>
          <div className="flex justify-between items-center gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">Account Status</dt>
            <dd>
              <span
                className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${statusBadgeClass(user.accountStatus)}`}
              >
                {user.accountStatus}
              </span>
            </dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-sm font-medium text-muted-foreground">Signup Date</dt>
            <dd className="text-foreground font-medium text-right">
              {formatDate(user.signupDate)}
            </dd>
          </div>
          {showEndDate && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-sm font-medium text-muted-foreground">Subscription End Date</dt>
              <dd className="text-foreground font-medium text-right">
                {formatDate(user.subscriptionEndDate)}
              </dd>
            </div>
          )}
        </dl>

        {/* Linked Discord account */}
        <div className="mt-6 bg-card rounded-lg border border-border px-4 py-4">
          <h2 className="text-sm font-medium text-muted-foreground mb-3">Discord</h2>
          {discordMessage && (
            <p
              className={`mb-3 p-3 rounded-lg text-sm ${
                discordMessage.ok ? 'bg-green-500/15 text-green-400' : 'bg-primary/15 border border-primary/40 text-red-300'
              }`}
            >
              {discordMessage.text}
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
                    @{discord.username} · linked {formatDate(discord.connectedAt)}
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
                  Join Server
                </a>
                <form action="/api/discord/disconnect" method="POST">
                  <button
                    type="submit"
                    className="px-4 py-2 text-sm font-semibold rounded-lg text-foreground bg-card border border-border hover:border-primary hover:text-primary transition-colors"
                  >
                    Disconnect
                  </button>
                </form>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-between gap-4">
              <p className="text-sm text-muted-foreground">Link your Discord account to RacingCoach.</p>
              {/* A plain link: /api/discord/connect redirects to Discord, then on to the server invite */}
              <a
                href="/api/discord/connect"
                className="shrink-0 px-4 py-2 text-sm font-semibold rounded-lg text-white bg-[#5865F2] hover:bg-[#4752C4] transition-colors"
              >
                Connect Discord
              </a>
            </div>
          )}
        </div>

        {(canBuyMonthly || canBuyLifetime) && (
          <form action="/api/create-checkout-session" method="POST" className="mt-8 space-y-3">
            {canBuyMonthly && (
              <button
                type="submit"
                name="plan"
                value="monthly"
                className="w-full px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors"
              >
                Monthly Subscription
              </button>
            )}
            {canBuyLifetime && (
              <button
                type="submit"
                name="plan"
                value="lifetime"
                className="w-full px-6 py-3 rounded-lg font-semibold text-white bg-gradient-to-r from-primary to-primary-strong hover:from-primary-strong hover:to-primary transition-colors"
              >
                {isMonthly ? 'Upgrade to Lifetime Subscription' : 'Lifetime Subscription'}
              </button>
            )}
          </form>
        )}

        {isMonthly && <CancelSubscriptionButton />}
      </div>
    </section>
  );
}
