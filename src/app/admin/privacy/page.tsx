import Link from 'next/link';
import { notFound } from 'next/navigation';
import { fmt, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { listRequestsForAdmin, readRequestCounts, type AdminRequestFilters } from '@/lib/privacyRequests';
import { currentDeadline, deadlineState, isRequestStatus, isRequestType, REQUEST_STATUSES, REQUEST_TYPES, requestReference } from '@/lib/privacyRules';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// Admin > Privacy Requests: every data subject request, open ones first by deadline, filtered through the URL
// (status, type, due). Admins only; anyone else gets a 404, so the page's existence isn't advertised. The requests'
// own pages are /admin/privacy/[id].

const DEADLINE_CLASS: Record<string, string> = {
  overdue: 'bg-red-500/15 text-red-400',
  dueSoon: 'bg-amber-400/15 text-amber-400',
  onTrack: 'bg-green-500/15 text-green-400',
  closed: 'bg-secondary text-muted-foreground',
};

export default async function AdminPrivacyPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) notFound();
  const dictionary = getDictionary(user.preferredLanguage);
  const t = dictionary.privacyAdmin;
  const p = dictionary.privacyRights;
  const locale = LANGUAGE_LOCALES[user.preferredLanguage];
  const params = await searchParams;
  const filters: AdminRequestFilters = {
    status: params.status === 'all' || isRequestStatus(params.status) ? (params.status as AdminRequestFilters['status']) : 'open',
    type: isRequestType(params.type) ? params.type : 'all',
    due: params.due === 'overdue' || params.due === 'dueSoon' ? params.due : 'all',
  };
  const [requests, counts] = await Promise.all([listRequestsForAdmin(filters), readRequestCounts()]);
  const now = new Date();
  const formatDate = (date: Date) => date.toLocaleDateString(locale, { dateStyle: 'medium', timeZone: 'UTC' });
  const selectClass = 'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm';

  return (
    <section className="py-10 px-4">
      <div className="mx-auto w-full max-w-6xl">
        <Link href="/admin" className="text-sm text-muted-foreground hover:text-primary">← {t.backToAdmin}</Link>
        <h1 className="mt-2 text-3xl font-bold text-foreground">{t.title}</h1>
        <p className="mt-1 text-muted-foreground">{t.intro}</p>
        <p className="mt-2 text-sm text-foreground">{fmt(t.counts, counts)}</p>

        <form method="GET" className="mt-6 grid gap-3 sm:grid-cols-4 items-end">
          <label className="text-xs font-medium text-muted-foreground">
            {t.filters.status}
            <select name="status" defaultValue={filters.status} className={selectClass}>
              <option value="open">{t.filters.open}</option>
              <option value="all">{t.filters.all}</option>
              {REQUEST_STATUSES.map((status) => (
                <option key={status} value={status}>{p.statuses[status]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            {t.filters.type}
            <select name="type" defaultValue={filters.type} className={selectClass}>
              <option value="all">{t.filters.all}</option>
              {REQUEST_TYPES.map((type) => (
                <option key={type} value={type}>{p.types[type]}</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-medium text-muted-foreground">
            {t.filters.due}
            <select name="due" defaultValue={filters.due} className={selectClass}>
              <option value="all">{t.filters.all}</option>
              <option value="overdue">{t.filters.overdue}</option>
              <option value="dueSoon">{t.filters.dueSoon}</option>
            </select>
          </label>
          <button type="submit" className="px-4 py-2 rounded-lg font-semibold text-white bg-primary hover:bg-primary-strong">
            {dictionary.common.done}
          </button>
        </form>

        <div className="mt-6 overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="bg-secondary text-left text-muted-foreground">
              <tr>
                {[t.columns.reference, t.columns.type, t.columns.requester, t.columns.status, t.columns.submitted, t.columns.due].map((h) => (
                  <th key={h} scope="col" className="px-3 py-2 font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border bg-card">
              {requests.length === 0 && (
                <tr><td colSpan={6} className="px-3 py-6 text-center text-muted-foreground">{t.none}</td></tr>
              )}
              {requests.map((request) => {
                const state = deadlineState(request, now);
                return (
                  <tr key={request.id}>
                    <td className="px-3 py-2">
                      <Link href={`/admin/privacy/${request.id}`} className="font-mono text-primary hover:underline">{requestReference(request.id)}</Link>
                    </td>
                    <td className="px-3 py-2 text-foreground">{p.types[request.type] ?? request.type}</td>
                    <td className="px-3 py-2 text-foreground">
                      {request.accountName
                        ? `${request.accountName} (${request.accountEmail})`
                        : request.deletedUserId
                          ? fmt(t.deletedAccount, { id: request.deletedUserId })
                          : `${request.requesterName ?? ''} ${request.requesterEmail ? `<${request.requesterEmail}>` : ''} · ${t.noAccount}`}
                    </td>
                    <td className="px-3 py-2 text-foreground">{p.statuses[request.status]}</td>
                    <td className="px-3 py-2 text-muted-foreground">{formatDate(request.submittedAt)}</td>
                    <td className="px-3 py-2">
                      <span className="text-muted-foreground">{formatDate(currentDeadline(request))}</span>{' '}
                      <span className={`ml-1 px-2 py-0.5 rounded-full text-xs ${DEADLINE_CLASS[state]}`}>{t.deadline[state]}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
