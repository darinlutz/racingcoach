import { ACTIVE_STATUSES } from '@/lib/stripeBilling';

// A subscription's status on the Subscribers pages: running subscriptions stand out, failing payments are red,
// everything else (no subscription, canceled...) is muted
export default function SubscriptionStatusBadge({ status, label }: { status: string; label: string }) {
  const color =
    status === 'past_due' || status === 'unpaid'
      ? 'bg-red-500/15 text-red-500'
      : ACTIVE_STATUSES.includes(status)
        ? 'bg-primary/15 text-primary'
        : 'bg-card text-muted-foreground border border-border';
  return <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${color}`}>{label}</span>;
}
