import { redirect } from 'next/navigation';
import CancelSubscriptionButton from '@/components/CancelSubscriptionButton';
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

export default async function AccountPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/login');
  const isMonthly = user.accountStatus === ACCOUNT_STATUS.monthly;
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
          {isMonthly && (
            <div className="flex justify-between gap-4 px-4 py-3">
              <dt className="text-sm font-medium text-muted-foreground">Subscription End Date</dt>
              <dd className="text-foreground font-medium text-right">
                {formatDate(user.subscriptionEndDate)}
              </dd>
            </div>
          )}
        </dl>

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
