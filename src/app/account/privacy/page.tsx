import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import CookieConsentStatus from '@/components/CookieConsentStatus';
import CorrectMyInformation from '@/components/CorrectMyInformation';
import DeleteAccountButton from '@/components/DeleteAccountButton';
import DownloadMyData from '@/components/DownloadMyData';
import PrivacyReauthProvider from '@/components/PrivacyReauthProvider';
import RequestDataDeletion from '@/components/RequestDataDeletion';
import SubmitPrivacyRequest from '@/components/SubmitPrivacyRequest';
import { ACCOUNT_STATUS } from '@/lib/accountStatus';
import { fmt, LANGUAGE_LOCALES, plural } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { countPersonalData, listExportsForUser } from '@/lib/personalDataExport';
import { ARTICLE_15_NOTES, LEGAL_BASIS_TEXT, PERSONAL_DATA_INVENTORY } from '@/lib/personalDataInventory';
import { listRequestsForUser, listVisibleEventsForUser } from '@/lib/privacyRequests';
import { currentDeadline, isClosed, requestReference } from '@/lib/privacyRules';
import { isRecentlyReauthenticated } from '@/lib/reauth';
import { withReturnTo } from '@/lib/returnTo';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { MAX_USER_NAME_LENGTH } from '@/lib/users';

// Privacy & Data Rights (My Settings > Privacy & Data Rights): the GDPR rights of Articles 15-22 for the signed-in
// user. View My Personal Data (the inventory with this account's counts), Download My Data, Correct My Information,
// Request Data Deletion, Delete My Account, cookie and optional consents, Submit a Privacy Request and the history.
// Everything on it is read for the session's own account; nothing takes a user ID.

const STATUS_CLASS: Record<string, string> = {
  completed: 'bg-green-500/15 text-green-400',
  rejected: 'bg-red-500/15 text-red-400',
  extended: 'bg-amber-400/15 text-amber-400',
};

function Section({ id, title, intro, children }: { id: string; title: string; intro: string; children?: ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="mt-6 scroll-mt-24 bg-card rounded-lg border border-border px-4 py-5 sm:px-6">
      <h2 id={`${id}-title`} className="text-lg font-semibold text-foreground">{title}</h2>
      <p className="mt-1 mb-4 text-sm text-muted-foreground">{intro}</p>
      {children}
    </section>
  );
}

export default async function PrivacyRightsPage() {
  const user = await getCurrentUser();
  if (!user) redirect(withReturnTo('/login', '/account/privacy'));
  const dictionary = getDictionary(user.preferredLanguage);
  const t = dictionary.privacyRights;
  const locale = LANGUAGE_LOCALES[user.preferredLanguage];
  const formatDate = (date: Date | string | null) =>
    date ? new Date(date).toLocaleDateString(locale, { dateStyle: 'long', timeZone: 'UTC' }) : '—';

  const [counts, exports, requests, events, confirmed] = await Promise.all([
    countPersonalData(user.id),
    listExportsForUser(user.id),
    listRequestsForUser(user.id),
    listVisibleEventsForUser(user.id),
    isRecentlyReauthenticated(user),
  ]);
  const preparing = requests.some((r) => (r.type === 'access' || r.type === 'portability') && r.status === 'processing');
  const categoryCount = (key: string) => counts[key];

  return (
    <section className="py-12 px-4 bg-gradient-to-b from-background to-background flex justify-center">
      <div className="w-full max-w-3xl">
        <Link href="/account" className="text-sm text-muted-foreground hover:text-primary">← {t.backToSettings}</Link>
        <h1 className="mt-2 text-3xl font-bold mb-2 bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {t.title}
        </h1>
        <p className="text-muted-foreground">{t.intro}</p>
        <nav aria-label={t.title} className="mt-4 flex flex-wrap gap-2 text-sm">
          {[
            ['view', t.view.title],
            ['download', t.download.title],
            ['correct', t.correct.title],
            ['erase', t.erase.title],
            ['delete-account', t.deleteAccount.title],
            ['cookies', t.cookies.title],
            ['consents', t.consents.title],
            ['request', t.submit.title],
            ['history', t.history.title],
          ].map(([id, label]) => (
            <a key={id} href={`#${id}`} className="px-3 py-1 rounded-full border border-border text-muted-foreground hover:border-primary hover:text-primary">
              {label}
            </a>
          ))}
        </nav>

        <PrivacyReauthProvider initialConfirmed={confirmed} hasPassword={user.hasPassword}>
          <Section id="view" title={t.view.title} intro={t.view.intro}>
            <dl className="divide-y divide-border rounded-lg border border-border bg-secondary text-sm">
              {[
                [dictionary.account.name, user.userName],
                [dictionary.account.email, user.emailAddress],
                [dictionary.account.membershipLevel, dictionary.pricing.levelNames[user.membershipLevel] ?? user.membershipLevel],
                [t.view.memberSince, formatDate(user.signupDate)],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between gap-4 px-4 py-2">
                  <dt className="text-muted-foreground">{label}</dt>
                  <dd className="text-right text-foreground break-all">{value}</dd>
                </div>
              ))}
            </dl>
            {t.englishOnly && user.preferredLanguage !== 'en' && <p className="mt-3 text-xs text-muted-foreground">{t.englishOnly}</p>}
            <ul className="mt-3 space-y-2">
              {PERSONAL_DATA_INVENTORY.map((category) => {
                const count = categoryCount(category.key);
                return (
                  <li key={category.key}>
                    <details className="group rounded-lg border border-border bg-secondary px-4 py-3">
                      <summary className="flex cursor-pointer list-none items-center justify-between gap-3">
                        <span className="font-medium text-foreground">{category.title}</span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {count === undefined ? '' : plural(user.preferredLanguage, count, t.view.items)}
                        </span>
                      </summary>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                        <p className="text-foreground">{category.description}</p>
                        <p><strong>{t.view.purpose}:</strong> {category.purpose}</p>
                        <p><strong>{t.view.legalBasis}:</strong> {category.legalBasis.map((basis) => LEGAL_BASIS_TEXT[basis]).join('; ')}</p>
                        <p><strong>{t.view.source}:</strong> {category.source}</p>
                        <p><strong>{t.view.storage}:</strong> {category.storage}</p>
                        <p><strong>{t.view.retention}:</strong> {category.retention}</p>
                        <p><strong>{t.view.recipients}:</strong> {category.recipients.join('; ')}</p>
                        {category.retainedReason && <p><strong>{t.view.note}:</strong> {category.retainedReason}</p>}
                      </div>
                    </details>
                  </li>
                );
              })}
            </ul>
            <div className="mt-4 space-y-2 text-sm text-muted-foreground">
              <p><strong className="text-foreground">{t.view.transfers}:</strong> {ARTICLE_15_NOTES.transfers}</p>
              <p><strong className="text-foreground">{t.view.automated}:</strong> {ARTICLE_15_NOTES.automatedDecisions}</p>
              <p><strong className="text-foreground">{t.view.rights}:</strong> {ARTICLE_15_NOTES.rights}</p>
            </div>
          </Section>

          <Section id="download" title={t.download.title} intro={t.download.intro}>
            <DownloadMyData exports={exports} preparing={preparing} />
          </Section>

          <Section id="correct" title={t.correct.title} intro={t.correct.intro}>
            <CorrectMyInformation userName={user.userName} maxNameLength={MAX_USER_NAME_LENGTH} />
          </Section>

          <Section id="erase" title={t.erase.title} intro={t.erase.intro}>
            <RequestDataDeletion counts={counts} />
          </Section>

          <Section id="delete-account" title={t.deleteAccount.title} intro={t.deleteAccount.intro}>
            {isAdmin(user.role) ? (
              <p className="text-sm text-muted-foreground">{t.deleteAccount.admin}</p>
            ) : (
              <DeleteAccountButton isSubscribed={user.accountStatus === ACCOUNT_STATUS.subscribed} hasPassword={user.hasPassword} />
            )}
          </Section>

          <Section id="cookies" title={t.cookies.title} intro={t.cookies.intro}>
            <CookieConsentStatus />
            <Link href="/cookies" className="mt-3 inline-block text-sm text-primary hover:underline">{t.cookies.policy}</Link>
          </Section>

          <Section id="consents" title={t.consents.title} intro={t.consents.intro}>
            <dl className="divide-y divide-border rounded-lg border border-border bg-secondary text-sm">
              <div className="px-4 py-3">
                <dt className="font-medium text-foreground">{t.consents.analytics}</dt>
                <dd className="text-muted-foreground">{t.consents.analyticsHint}</dd>
              </div>
              <div className="px-4 py-3">
                <dt className="font-medium text-foreground">{t.consents.marketing}</dt>
                <dd className="text-muted-foreground">{t.consents.marketingHint}</dd>
              </div>
            </dl>
            <p className="mt-3 text-sm text-muted-foreground">{t.consents.other}</p>
          </Section>

          <Section id="request" title={t.submit.title} intro={t.submit.intro}>
            <SubmitPrivacyRequest />
          </Section>

          <Section id="history" title={t.history.title} intro={t.history.intro}>
            {requests.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t.history.none}</p>
            ) : (
              <ul className="space-y-2">
                {requests.map((request) => (
                  <li key={request.id}>
                    <details className="rounded-lg border border-border bg-secondary px-4 py-3">
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0">
                          <span className="block font-medium text-foreground">{t.types[request.type] ?? request.type}</span>
                          <span className="block text-xs text-muted-foreground">
                            {t.history.reference} {requestReference(request.id)} · {t.history.submitted} {formatDate(request.submittedAt)}
                            {!isClosed(request.status) && ` · ${t.history.due} ${formatDate(currentDeadline(request))}`}
                          </span>
                        </span>
                        <span className={`shrink-0 px-3 py-1 rounded-full text-xs font-medium ${STATUS_CLASS[request.status] ?? 'bg-primary/15 text-primary'}`}>
                          {t.statuses[request.status] ?? request.status}
                        </span>
                      </summary>
                      <div className="mt-3 space-y-2 text-sm">
                        {request.extendedDueAt && (
                          <p className="text-muted-foreground">
                            {fmt(t.history.extendedTo, { date: formatDate(request.extendedDueAt) })}
                            {request.extensionReason && ` — ${request.extensionReason}`}
                          </p>
                        )}
                        {request.resolution && (
                          <p><strong className="text-foreground">{t.history.outcome}:</strong> <span className="text-muted-foreground">{request.resolution}</span></p>
                        )}
                        {request.retained.length > 0 && (
                          <div>
                            <p className="font-medium text-foreground">{t.history.retained}</p>
                            <ul className="mt-1 list-disc pl-5 text-muted-foreground">
                              {request.retained.map((item) => (
                                <li key={item.category}>{item.reason}</li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <ol className="border-l border-border pl-4 text-muted-foreground">
                          {(events.get(request.id) ?? []).map((event) => (
                            <li key={event.id} className="py-1">
                              <span className="text-xs">{new Date(event.at).toLocaleString(locale, { dateStyle: 'medium', timeStyle: 'short' })}</span>{' '}
                              <span className="text-foreground">
                                {event.toStatus && event.event === 'statusChanged'
                                  ? t.statuses[event.toStatus] ?? event.toStatus
                                  : t.history.events[event.event] ?? event.event}
                              </span>
                              {event.event === 'communication' && event.note && <p className="mt-1 whitespace-pre-wrap">{event.note}</p>}
                            </li>
                          ))}
                        </ol>
                      </div>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </PrivacyReauthProvider>
      </div>
    </section>
  );
}
