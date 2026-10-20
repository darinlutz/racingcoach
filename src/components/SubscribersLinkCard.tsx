import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';

// The Subscribers box at the top of the Admin and Coach pages, linking to the Subscribers page
// (src/app/admin/subscribers/). The time zone is passed on when the page knows it; otherwise the
// Subscribers page adds the browser's (AdminTimeZone).
export default function SubscribersLinkCard({ t, timeZone }: { t: Dictionary['subscribers']; timeZone?: string }) {
  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t.pageTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.adminLinkHint}</p>
      </div>
      <Link
        href={timeZone ? `/admin/subscribers?tz=${encodeURIComponent(timeZone)}` : '/admin/subscribers'}
        className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors"
      >
        {t.openSubscribers}
      </Link>
    </div>
  );
}
