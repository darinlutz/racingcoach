import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminTimeZone from '@/components/AdminTimeZone';
import AiModelManager from '@/components/AiModelManager';
import CollectorLogsViewer from '@/components/CollectorLogsViewer';
import SiteSettingsManager from '@/components/SiteSettingsManager';
import UserRoleManager from '@/components/UserRoleManager';
import {
  ACTIVITY_PAGE_SIZE,
  activityFilterParams,
  type ActivityFilters,
  type CountedItem,
  dateInZone,
  describeUserAgent,
  listUsersForAdmin,
  MAX_EXPORT_ROWS,
  parseActivityFilters,
  readActivityReport,
} from '@/lib/activityReport';
import { getAiModels } from '@/lib/aiModels';
import { fmt, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getShowPricing } from '@/lib/siteSettings';

// The site owner's Admin page: Site Settings (src/components/SiteSettingsManager.tsx), AI Model Control
// (src/components/AiModelManager.tsx), User Roles (src/components/UserRoleManager.tsx), Collector Logs
// (src/components/CollectorLogsViewer.tsx), then racingcoach."ActivityLog",
// every page view and click, filtered through the URL (so a filtered view can be bookmarked), with totals,
// the top pages and controls, and a CSV export.
// Only for the Admin role; anyone else gets a 404, so the page's existence isn't advertised.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const filterLink = 'text-foreground hover:text-primary underline decoration-border underline-offset-2 transition-colors';

export default async function AdminPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) notFound();

  const params = await searchParams;
  const filters = parseActivityFilters(params);
  const t = getDictionary(user.preferredLanguage);
  const a = t.admin;
  const locale = LANGUAGE_LOCALES[user.preferredLanguage];
  const [report, users, showPricing, aiModels] = await Promise.all([
    readActivityReport(filters),
    listUsersForAdmin(),
    getShowPricing(),
    getAiModels(),
  ]);
  const { summary, topPages, topClicks, rows } = report;

  const href = (changes: Partial<ActivityFilters>) => `/admin?${activityFilterParams(filters, changes)}`;
  const number = (n: number) => n.toLocaleString(locale);
  const formatTime = new Intl.DateTimeFormat(locale, { timeZone: filters.timeZone, dateStyle: 'medium', timeStyle: 'medium' });
  const today = dateInZone(filters.timeZone);
  const first = summary.events === 0 ? 0 : (filters.page - 1) * ACTIVITY_PAGE_SIZE + 1;
  const last = Math.min(filters.page * ACTIVITY_PAGE_SIZE, summary.events);

  const presets = [
    { label: a.today, from: today, to: today },
    { label: a.last7, from: dateInZone(filters.timeZone, 6), to: null },
    { label: a.last30, from: dateInZone(filters.timeZone, 29), to: null },
    { label: a.allTime, from: null, to: null },
  ];
  const stats = [
    { label: a.events, value: summary.events },
    { label: a.pageViews, value: summary.pageViews },
    { label: a.clicks, value: summary.clicks },
    { label: a.users, value: summary.users },
    { label: a.visitors, value: summary.visitors },
    { label: a.sessions, value: summary.sessions },
  ];

  return (
    // The admin's own clicks here would only pile up rows about filtering the log
    <section data-no-track className="py-10 px-4">
      <AdminTimeZone current={typeof params.tz === 'string' ? params.tz : null} />
      <div className="site-container space-y-6">
        <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
          {a.pageTitle}
        </h1>

        <SiteSettingsManager showPricing={showPricing} />

        <AiModelManager models={aiModels} />

        <UserRoleManager users={users} currentUserId={user.id} />

        <CollectorLogsViewer
          initialUser={typeof params.logUser === 'string' ? params.logUser : null}
          initialRun={typeof params.logRun === 'string' ? params.logRun : null}
          timeZone={filters.timeZone}
          locale={locale}
        />

        <div className="pt-4">
          <h2 className="text-xl font-bold text-foreground mb-1">{a.title}</h2>
          <p className="text-sm text-muted-foreground">{fmt(a.intro, { timeZone: filters.timeZone })}</p>
        </div>

        {/* Filters: a plain GET form, so every view has its own URL */}
        <form action="/admin" method="get" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
          <input type="hidden" name="tz" value={filters.timeZone} />
          {filters.visitorId && <input type="hidden" name="visitor" value={filters.visitorId} />}
          {filters.sessionId && <input type="hidden" name="session" value={filters.sessionId} />}

          <div className="flex flex-wrap gap-2">
            {presets.map((preset) => {
              const active = preset.from === filters.from && preset.to === filters.to;
              return (
                <Link
                  key={preset.label}
                  href={href({ from: preset.from, to: preset.to })}
                  className={`px-3 py-1.5 rounded-full text-sm font-medium border transition-colors ${
                    active ? 'bg-primary/15 border-primary text-primary' : 'border-border text-muted-foreground hover:text-foreground'
                  }`}
                >
                  {preset.label}
                </Link>
              );
            })}
          </div>

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label htmlFor="from" className={labelClass}>{a.from}</label>
              <input id="from" name="from" type="date" defaultValue={filters.from ?? ''} className={inputClass} />
            </div>
            <div>
              <label htmlFor="to" className={labelClass}>{a.to}</label>
              <input id="to" name="to" type="date" defaultValue={filters.to ?? ''} className={inputClass} />
            </div>
            <div>
              <label htmlFor="user" className={labelClass}>{a.user}</label>
              <select id="user" name="user" defaultValue={filters.user ?? ''} className={inputClass}>
                <option value="">{a.everyone}</option>
                <option value="anonymous">{a.anonymous}</option>
                <option value="signed-in">{a.signedIn}</option>
                {users.map((u) => (
                  <option key={u.id} value={String(u.id)}>
                    {u.userName} ({u.emailAddress})
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="type" className={labelClass}>{a.event}</label>
              <select id="type" name="type" defaultValue={filters.eventType ?? ''} className={inputClass}>
                <option value="">{a.allEvents}</option>
                <option value="page_view">{a.pageViews}</option>
                <option value="click">{a.clicks}</option>
              </select>
            </div>
            <div>
              <label htmlFor="path" className={labelClass}>{a.pageContains}</label>
              <input id="path" name="path" defaultValue={filters.path ?? ''} placeholder={a.pagePlaceholder} className={inputClass} />
            </div>
            <div>
              <label htmlFor="q" className={labelClass}>{a.searchContains}</label>
              <input id="q" name="q" defaultValue={filters.search ?? ''} placeholder={a.searchPlaceholder} className={inputClass} />
            </div>
            <div>
              <label htmlFor="ip" className={labelClass}>{a.ipAddress}</label>
              <input id="ip" name="ip" defaultValue={filters.ipAddress ?? ''} className={inputClass} />
            </div>
            <label className="flex items-center gap-2 text-sm text-foreground self-end pb-2">
              <input type="checkbox" name="admins" value="include" defaultChecked={filters.includeAdmins} className="accent-primary" />
              {a.includeAdmins}
            </label>
          </div>

          {(filters.visitorId || filters.sessionId) && (
            <div className="flex flex-wrap gap-2">
              {filters.visitorId && (
                <Link href={href({ visitorId: null })} title={a.removeFilter} className="px-3 py-1 rounded-full text-sm bg-primary/15 text-primary">
                  {fmt(a.visitorChip, { id: filters.visitorId.slice(0, 8) })} ✕
                </Link>
              )}
              {filters.sessionId && (
                <Link href={href({ sessionId: null })} title={a.removeFilter} className="px-3 py-1 rounded-full text-sm bg-primary/15 text-primary">
                  {fmt(a.sessionChip, { id: filters.sessionId.slice(0, 8) })} ✕
                </Link>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors">
              {a.apply}
            </button>
            <Link href={`/admin?tz=${encodeURIComponent(filters.timeZone)}`} className="px-5 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors">
              {a.reset}
            </Link>
            <a
              href={`/api/admin/activity/export?${activityFilterParams(filters)}`}
              className="px-5 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors"
            >
              {a.exportCsv}
            </a>
            <span className="text-xs text-muted-foreground">{fmt(a.exportNote, { max: number(MAX_EXPORT_ROWS) })}</span>
          </div>
        </form>

        {/* Totals for the filtered rows */}
        <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
          {stats.map((stat) => (
            <div key={stat.label} className="bg-secondary rounded-xl border border-border px-4 py-3">
              <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
              <p className="text-2xl font-bold text-foreground tabular-nums">{number(stat.value)}</p>
            </div>
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <TopList
            title={a.topPages}
            items={topPages}
            empty={a.nothingYet}
            number={number}
            linkFor={(name) => href({ path: name, eventType: 'page_view' })}
          />
          <TopList
            title={a.topClicks}
            items={topClicks}
            empty={a.nothingYet}
            number={number}
            linkFor={(name) => href({ search: name, eventType: 'click' })}
          />
        </div>

        {/* The rows themselves, newest first */}
        <div className="bg-secondary rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-xs text-muted-foreground">
                <tr>
                  {[a.time, a.user, a.event, a.page, a.clicked, a.device, a.ipAddress, a.session].map((heading) => (
                    <th key={heading} className="px-3 py-2 font-medium whitespace-nowrap">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-muted-foreground">{a.noRows}</td>
                  </tr>
                )}
                {rows.map((row) => {
                  const device = describeUserAgent(row.userAgent);
                  return (
                    <tr key={row.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground tabular-nums">
                        {formatTime.format(new Date(row.occurredAt))}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.userId !== null ? (
                          <Link href={href({ user: String(row.userId) })} title={`${a.onlyUser}: ${row.emailAddress ?? ''}`} className={filterLink}>
                            {row.userName ?? `#${row.userId}`}
                          </Link>
                        ) : (
                          <Link href={href({ visitorId: row.visitorId })} title={a.onlyVisitor} className="text-muted-foreground hover:text-primary transition-colors">
                            {a.anonymousUser} · {row.visitorId.slice(0, 8)}
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${
                            row.eventType === 'click' ? 'bg-primary/15 text-primary' : 'bg-card text-muted-foreground border border-border'
                          }`}
                        >
                          {row.eventType === 'click' ? a.click : a.pageView}
                        </span>
                      </td>
                      <td className="px-3 py-2 max-w-[260px]">
                        <p className="truncate text-foreground" title={row.pageTitle ? `${row.path}\n${row.pageTitle}` : row.path}>
                          {row.path}
                        </p>
                        {row.eventType === 'page_view' && row.referrer && (
                          <p className="truncate text-xs text-muted-foreground" title={row.referrer}>
                            {fmt(a.cameFrom, { referrer: row.referrer })}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 max-w-[280px]">
                        {row.eventType === 'click' && (
                          <>
                            <p className="truncate text-foreground" title={row.label ?? undefined}>
                              {row.label ?? row.elementId ?? '—'}
                            </p>
                            <p className="truncate text-xs text-muted-foreground" title={row.targetHref ?? row.elementId ?? undefined}>
                              {[row.element, row.targetHref ? `→ ${row.targetHref}` : row.elementId && row.label ? `#${row.elementId}` : null]
                                .filter(Boolean)
                                .join(' ')}
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground" title={row.userAgent ?? undefined}>
                        <p>{device ?? '—'}</p>
                        {row.viewportWidth && row.viewportHeight && (
                          <p className="text-xs tabular-nums">
                            {row.viewportWidth}×{row.viewportHeight}
                            {row.language ? ` · ${row.language}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {row.ipAddress ? (
                          <Link href={href({ ipAddress: row.ipAddress })} title={a.onlyIp} className={filterLink}>
                            {row.ipAddress}
                          </Link>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">
                        <Link href={href({ sessionId: row.sessionId })} title={a.onlySession} className={filterLink}>
                          {row.sessionId.slice(0, 8)}
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">
              {fmt(a.showing, { first: number(first), last: number(last), total: number(summary.events) })}
            </span>
            <div className="flex gap-2">
              {filters.page > 1 && (
                <Link href={href({ page: filters.page - 1 })} className="px-4 py-1.5 rounded-lg border border-border hover:border-primary transition-colors">
                  {a.previous}
                </Link>
              )}
              {last < summary.events && (
                <Link href={href({ page: filters.page + 1 })} className="px-4 py-1.5 rounded-lg border border-border hover:border-primary transition-colors">
                  {a.next}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

// Top 10 list with bars scaled to the largest count; each name filters the table to it
function TopList({
  title,
  items,
  empty,
  number,
  linkFor,
}: {
  title: string;
  items: CountedItem[];
  empty: string;
  number: (n: number) => string;
  linkFor: (name: string) => string;
}) {
  const max = Math.max(1, ...items.map((item) => item.count));
  return (
    <div className="bg-secondary rounded-xl border border-border p-4">
      <h2 className="text-sm font-medium text-muted-foreground mb-3">{title}</h2>
      {items.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ol className="space-y-2">
          {items.map((item) => (
            <li key={item.name}>
              <div className="flex justify-between gap-3 text-sm">
                <Link href={linkFor(item.name)} className="truncate text-foreground hover:text-primary transition-colors" title={item.name}>
                  {item.name}
                </Link>
                <span className="text-muted-foreground tabular-nums">{number(item.count)}</span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-card">
                <div className="h-1.5 rounded-full bg-primary" style={{ width: `${(item.count / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
