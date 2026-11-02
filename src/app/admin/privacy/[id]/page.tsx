import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import PrivacyRequestActions from '@/components/PrivacyRequestActions';
import { fmt, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { getRequestForAdmin } from '@/lib/privacyRequests';
import { canExtend, currentDeadline, deadlineState, nextStatuses, requestReference, REVIEWED_CATEGORIES } from '@/lib/privacyRules';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// One privacy request for an Admin: the requester, verification, scope, deadline, outcome, the whole history, the jobs
// that ran for it, its exports and erasures, and the actions (PrivacyRequestActions). Admins only; 404 otherwise.
export default async function AdminPrivacyRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) notFound();
  const { id } = await params;
  const detail = await getRequestForAdmin(id);
  if (!detail) notFound();
  const { request, events, jobs, exports, ledger } = detail;
  const dictionary = getDictionary(user.preferredLanguage);
  const t = dictionary.privacyAdmin;
  const p = dictionary.privacyRights;
  const locale = LANGUAGE_LOCALES[user.preferredLanguage];
  const when = (date: Date | null) => (date ? date.toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }) + ' UTC' : '—');
  const now = new Date();
  const state = deadlineState(request, now);
  const asked = (request.scope.categories ?? []) as string[];
  const reviewed = asked.filter((category) => (REVIEWED_CATEGORIES as readonly string[]).includes(category));

  const row = (label: string, value: ReactNode) => (
    <div className="grid gap-1 px-4 py-2 sm:grid-cols-[12rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-foreground break-words">{value}</dd>
    </div>
  );

  return (
    <section className="py-10 px-4">
      <div className="mx-auto w-full max-w-4xl">
        <Link href="/admin/privacy" className="text-sm text-muted-foreground hover:text-primary">← {t.backToList}</Link>
        <h1 className="mt-2 text-2xl font-bold text-foreground">
          {requestReference(request.id)} · {p.types[request.type] ?? request.type}
        </h1>
        <p className="mt-1 text-sm text-foreground">
          {p.statuses[request.status]} · {t.deadline[state]}
        </p>

        <dl className="mt-6 divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {row(
            t.detail.requester,
            request.requesterName || request.requesterEmail ? `${request.requesterName ?? ''} ${request.requesterEmail ? `<${request.requesterEmail}>` : ''}` : '—'
          )}
          {row(
            t.detail.account,
            request.userId !== null
              ? `${request.accountName} <${request.accountEmail}> (#${request.userId})`
              : request.deletedUserId
                ? fmt(t.deletedAccount, { id: request.deletedUserId })
                : t.noAccount
          )}
          {row(t.detail.verification, `${request.verificationStatus}${request.verificationMethod ? ` (${request.verificationMethod})` : ''} · ${when(request.verifiedAt)}`)}
          {row(t.columns.submitted, when(request.submittedAt))}
          {row(
            t.detail.deadline,
            `${when(currentDeadline(request))}${request.extendedDueAt ? ` (${when(request.dueAt)} → ${request.extensionReason ?? ''})` : ''}`
          )}
          {row(t.detail.details, <span className="whitespace-pre-wrap">{request.details || '—'}</span>)}
          {row(t.detail.scope, <code className="text-xs">{JSON.stringify(request.scope)}</code>)}
          {row(t.detail.resolution, request.resolution ?? '—')}
          {row(t.detail.justification, request.legalJustification ?? '—')}
          {row(
            t.detail.retained,
            request.retained.length ? (
              <ul className="list-disc pl-5">{request.retained.map((item) => <li key={item.category}>{item.category}: {item.reason}</li>)}</ul>
            ) : (
              '—'
            )
          )}
        </dl>

        <PrivacyRequestActions
          requestId={request.id}
          nextStatuses={[...nextStatuses(request.status)].filter((status) => status !== 'extended' || canExtend(request, now))}
          linked={request.userId !== null}
          reviewedCategories={reviewed}
          exportKind={request.type === 'portability' ? 'portability' : 'access'}
        />

        <h2 className="mt-8 text-lg font-semibold text-foreground">{t.detail.jobs}</h2>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {jobs.length === 0 && <li className="px-4 py-2 text-muted-foreground">—</li>}
          {jobs.map((job) => (
            <li key={job.id} className="px-4 py-2">
              <span className="font-medium text-foreground">#{job.id} {job.kind}</span> · {job.status} ·{' '}
              {fmt(t.detail.attempts, { attempts: job.attempts, max: job.maxAttempts })}
              {job.lastError && <p className="text-red-400">{job.lastError}</p>}
              {job.result !== null && job.result !== undefined && <code className="block text-xs text-muted-foreground">{JSON.stringify(job.result)}</code>}
              {job.status === 'failed' && <PrivacyRequestActions requestId={request.id} retryJobId={job.id} />}
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-lg font-semibold text-foreground">{t.detail.exports}</h2>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {exports.length === 0 && <li className="px-4 py-2 text-muted-foreground">—</li>}
          {exports.map((file) => (
            <li key={file.id} className="px-4 py-2 text-foreground">
              {file.kind} · {when(file.createdAt)} → {when(file.expiresAt)} · {Math.ceil(file.sizeBytes / 1024)} KB ·{' '}
              {fmt(t.detail.downloads, { n: file.downloads })}
              {file.deletedAt && ` · ${t.detail.deleted}`}
            </li>
          ))}
        </ul>

        <h2 className="mt-8 text-lg font-semibold text-foreground">{t.detail.ledger}</h2>
        <ul className="mt-2 divide-y divide-border rounded-lg border border-border bg-card text-sm">
          {ledger.length === 0 && <li className="px-4 py-2 text-muted-foreground">—</li>}
          {ledger.map((entry, i) => (
            <li key={i} className="px-4 py-2 text-foreground">{entry.category} · {when(entry.erasedAt)}</li>
          ))}
        </ul>

        <h2 className="mt-8 text-lg font-semibold text-foreground">{t.detail.history}</h2>
        <ol className="mt-2 space-y-1 border-l border-border pl-4 text-sm">
          {events.map((event) => (
            <li key={event.id}>
              <span className="text-xs text-muted-foreground">{when(event.at)}</span>{' '}
              <span className="text-foreground">
                {event.actor}{event.actorId !== null ? ` #${event.actorId}` : ''}: {event.event}
                {event.fromStatus || event.toStatus ? ` (${event.fromStatus ?? '—'} → ${event.toStatus ?? '—'})` : ''}
              </span>
              {event.visibleToRequester ? '' : ' 🔒'}
              {event.note && <p className="whitespace-pre-wrap text-muted-foreground">{event.note}</p>}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
