import Link from 'next/link';
import type { Dictionary } from '@/lib/i18n/dictionaries/en';
import { fmt } from '@/lib/i18n/languages';

// The Privacy Requests box on the Admin page, linking to Admin > Privacy Requests (src/app/admin/privacy/) with how
// many are open, overdue and due within a week, so a deadline isn't missed
export default function PrivacyRequestsLinkCard({
  t,
  counts,
}: {
  t: Dictionary['privacyAdmin'];
  counts: { open: number; overdue: number; dueSoon: number };
}) {
  return (
    <div className="bg-secondary rounded-xl border border-border p-4 sm:p-6 flex flex-wrap items-center justify-between gap-4">
      <div>
        <h2 className="text-xl font-bold text-foreground">{t.link}</h2>
        <p className="text-sm text-muted-foreground">{t.linkDescription}</p>
        <p className={`text-sm ${counts.overdue ? 'text-red-400 font-semibold' : 'text-foreground'}`}>{fmt(t.counts, counts)}</p>
      </div>
      <Link href="/admin/privacy" className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors">
        {t.link}
      </Link>
    </div>
  );
}
