import Link from 'next/link';
import { notFound } from 'next/navigation';
import AdminTimeZone from '@/components/AdminTimeZone';
import StripeSyncButton from '@/components/StripeSyncButton';
import SubscriptionStatusBadge from '@/components/SubscriptionStatusBadge';
import { PLANS } from '@/lib/accountStatus';
import { fmt, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { canSeeSubscribers, isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { ACTIVE_STATUSES } from '@/lib/stripeBilling';
import {
  type CodeUsage,
  formatMinorAmount,
  listDiscountCodes,
  MAX_SUBSCRIBER_EXPORT_ROWS,
  parseSubscriberFilters,
  readCodeUsage,
  readSubscribers,
  SUBSCRIBER_STATUSES,
  subscriberFilterParams,
  SUBSCRIBERS_PAGE_SIZE,
  type SubscriberFilters,
  type SubscriberRow,
} from '@/lib/subscriberReport';

// The Admin page's Subscribers page: Discount Code Usage, then every registered account with its current
// subscription and original discount code (src/lib/subscriberReport.ts), searched, filtered, sorted and paged
// through the URL, with a CSV export and Sync from Stripe. Coaches and Admins only; anyone else gets a 404.

const inputClass =
  'w-full px-3 py-2 bg-card border border-border rounded-lg text-foreground text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors';
const labelClass = 'block text-xs font-medium text-muted-foreground mb-1';
const buttonClass = 'px-5 py-2 rounded-lg text-sm font-semibold border border-border text-foreground hover:border-primary transition-colors';

export default async function SubscribersPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user || !canSeeSubscribers(user.role)) notFound();

  const params = await searchParams;
  const filters = parseSubscriberFilters(params);
  const s = getDictionary(user.preferredLanguage).subscribers;
  const locale = LANGUAGE_LOCALES[user.preferredLanguage];
  const [{ rows, total }, usage, codes] = await Promise.all([readSubscribers(filters), readCodeUsage(), listDiscountCodes()]);

  const href = (changes: Partial<SubscriberFilters>) => `/admin/subscribers?${subscriberFilterParams(filters, changes)}`;
  const number = (n: number) => n.toLocaleString(locale);
  const formatDate = new Intl.DateTimeFormat(locale, { timeZone: filters.timeZone, dateStyle: 'medium' });
  const date = (iso: string | null) => (iso ? formatDate.format(new Date(iso)) : '—');
  const first = total === 0 ? 0 : (filters.page - 1) * SUBSCRIBERS_PAGE_SIZE + 1;
  const last = Math.min(filters.page * SUBSCRIBERS_PAGE_SIZE, total);

  const percent = (value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 3 })}%`;
  const price = (row: SubscriberRow, amount: number | null) =>
    amount === null || !row.currency
      ? '—'
      : `${formatMinorAmount(amount, row.currency, locale)}${row.billingInterval ? (s.perInterval[row.billingInterval] ?? '') : ''}`;
  const codeLabel = (codeStatus: string | null, code: string | null, couponName: string | null) =>
    codeStatus === 'known' ? code : codeStatus === 'coupon' ? fmt(s.couponOnly, { coupon: couponName ?? '' }) : codeStatus ? s.unknownCode : null;
  const renewal = (row: SubscriberRow) => {
    if (row.endedAt) return fmt(s.endedOn, { date: date(row.endedAt) });
    if (!ACTIVE_STATUSES.includes(row.status) || !row.currentPeriodEnd) return '—';
    return row.cancelAtPeriodEnd ? fmt(s.endsOn, { date: date(row.currentPeriodEnd) }) : date(row.currentPeriodEnd);
  };

  const stats = [
    { label: s.totalUsers, value: usage.totalUsers },
    { label: s.totalSubscribers, value: usage.totalSubscribers },
    { label: s.activePaid, value: usage.activePaidSubscribers },
    { label: s.withCode, value: usage.withCode },
    { label: s.withoutCode, value: usage.withoutCode },
  ];
  const discountOf = (code: CodeUsage) =>
    code.percents.length
      ? code.percents.map(percent).join(', ')
      : code.amountOff !== null && code.amountOffCurrency
        ? formatMinorAmount(code.amountOff, code.amountOffCurrency, locale)
        : '—';
  const columns = [
    s.name,
    s.email,
    s.signupDate,
    s.signupPromoCode,
    s.plan,
    s.status,
    s.originalPrice,
    s.discountCode,
    s.discountPercent,
    s.currentPrice,
    s.subscriptionDate,
    s.renewalDate,
  ];

  return (
    <section data-no-track className="py-10 px-4">
      <AdminTimeZone current={typeof params.tz === 'string' ? params.tz : null} />
      <div className="site-container space-y-6">
        <div>
          <Link
            href={isAdmin(user.role) ? `/admin?tz=${encodeURIComponent(filters.timeZone)}` : '/coach'}
            className="text-sm text-muted-foreground hover:text-primary transition-colors"
          >
            {isAdmin(user.role) ? s.backToAdmin : s.backToCoach}
          </Link>
          <h1 className="text-3xl font-bold bg-gradient-to-r from-primary-strong via-primary to-primary-strong bg-clip-text text-transparent">
            {s.pageTitle}
          </h1>
          <p className="text-sm text-muted-foreground mt-1">{s.intro}</p>
        </div>

        <div className="flex flex-wrap items-start gap-4">
          <StripeSyncButton />
          <p className="text-xs text-muted-foreground max-w-md pt-2">{s.syncHint}</p>
        </div>

        {/* Discount Code Usage */}
        <div className="space-y-3">
          <div>
            <h2 className="text-xl font-bold text-foreground">{s.usageTitle}</h2>
            <p className="text-sm text-muted-foreground">{s.usageIntro}</p>
          </div>
          <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-5">
            {stats.map((stat) => (
              <div key={stat.label} className="bg-secondary rounded-xl border border-border px-4 py-3">
                <p className="text-xs font-medium text-muted-foreground">{stat.label}</p>
                <p className="text-2xl font-bold text-foreground tabular-nums">{number(stat.value)}</p>
              </div>
            ))}
          </div>
          <div className="bg-secondary rounded-xl border border-border overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-card text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{s.discountCode}</th>
                    <th className="px-3 py-2 font-medium text-right">{s.pageTitle}</th>
                    <th className="px-3 py-2 font-medium text-right">{s.discount}</th>
                    <th className="px-3 py-2 font-medium text-right">{s.activeSubscribers}</th>
                    <th className="px-3 py-2 font-medium text-right">{s.redemptions}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {usage.codes.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-4 text-center text-muted-foreground">{s.noCodesYet}</td>
                    </tr>
                  )}
                  {usage.codes.map((code) => (
                    <tr key={`${code.codeStatus}:${code.code ?? code.couponName ?? ''}`}>
                      <td className="px-3 py-2 font-mono">
                        {code.codeStatus === 'known' && code.code ? (
                          <Link href={href({ code: code.code })} className="text-foreground hover:text-primary transition-colors">
                            {code.code}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{codeLabel(code.codeStatus, code.code, code.couponName)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{number(code.subscribers)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{discountOf(code)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{number(code.activeSubscribers)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{number(code.redemptions)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="px-3 py-2 font-mono">
                      <Link href={href({ code: 'none', status: null })} className="text-foreground hover:text-primary transition-colors">
                        {s.noneCode}
                      </Link>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{number(usage.noCode.subscribers)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{percent(0)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{number(usage.noCode.activeSubscribers)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">—</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Filters: a plain GET form, so every view has its own URL */}
        <form action="/admin/subscribers" method="get" className="bg-secondary rounded-xl border border-border p-4 sm:p-6 space-y-4">
          <input type="hidden" name="tz" value={filters.timeZone} />
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label htmlFor="q" className={labelClass}>{s.search}</label>
              <input id="q" name="q" defaultValue={filters.search ?? ''} placeholder={s.searchPlaceholder} className={inputClass} />
            </div>
            <div>
              <label htmlFor="status" className={labelClass}>{s.status}</label>
              <select id="status" name="status" defaultValue={filters.status ?? ''} className={inputClass}>
                <option value="">{s.allStatuses}</option>
                {SUBSCRIBER_STATUSES.map((status) => (
                  <option key={status} value={status}>{s.statuses[status] ?? status}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="plan" className={labelClass}>{s.plan}</label>
              <select id="plan" name="plan" defaultValue={filters.plan ?? ''} className={inputClass}>
                <option value="">{s.allPlans}</option>
                {Object.keys(PLANS).map((plan) => (
                  <option key={plan} value={plan}>{s.plans[plan] ?? plan}</option>
                ))}
                <option value="none">{s.noPlan}</option>
              </select>
            </div>
            <div>
              <label htmlFor="code" className={labelClass}>{s.codeFilter}</label>
              <select id="code" name="code" defaultValue={filters.code ?? ''} className={inputClass}>
                <option value="">{s.allCodes}</option>
                <option value="any">{s.usedAnyCode}</option>
                <option value="none">{s.usedNoCode}</option>
                {codes.map((code) => (
                  <option key={code} value={code}>{code}</option>
                ))}
                {filters.code && !['any', 'none'].includes(filters.code) && !codes.includes(filters.code) && (
                  <option value={filters.code}>{filters.code}</option>
                )}
              </select>
            </div>
            <div>
              <label htmlFor="from" className={labelClass}>{s.signupFrom}</label>
              <input id="from" name="from" type="date" defaultValue={filters.from ?? ''} className={inputClass} />
            </div>
            <div>
              <label htmlFor="to" className={labelClass}>{s.signupTo}</label>
              <input id="to" name="to" type="date" defaultValue={filters.to ?? ''} className={inputClass} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label htmlFor="sort" className={labelClass}>{s.sortBy}</label>
                <select id="sort" name="sort" defaultValue={filters.sort} className={inputClass}>
                  {Object.entries(s.sorts).map(([value, label]) => (
                    <option key={value} value={value}>{label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="dir" className={labelClass}>{s.order}</label>
                <select id="dir" name="dir" defaultValue={filters.dir} className={inputClass}>
                  <option value="desc">{s.descending}</option>
                  <option value="asc">{s.ascending}</option>
                </select>
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="submit" className="px-5 py-2 rounded-lg text-sm font-semibold text-white bg-primary hover:bg-primary-strong transition-colors">
              {s.apply}
            </button>
            <Link href={`/admin/subscribers?tz=${encodeURIComponent(filters.timeZone)}`} className={buttonClass}>
              {s.reset}
            </Link>
            <a href={`/api/admin/subscribers/export?${subscriberFilterParams(filters)}`} className={buttonClass}>
              {s.exportCsv}
            </a>
            <span className="text-xs text-muted-foreground">{fmt(s.exportNote, { max: number(MAX_SUBSCRIBER_EXPORT_ROWS) })}</span>
          </div>
        </form>

        {/* The accounts */}
        <div className="bg-secondary rounded-xl border border-border overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-card text-left text-xs text-muted-foreground">
                <tr>
                  {columns.map((heading) => (
                    <th key={heading} className="px-3 py-2 font-medium whitespace-nowrap">{heading}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={columns.length} className="px-3 py-8 text-center text-muted-foreground">{s.noRows}</td>
                  </tr>
                )}
                {rows.map((row) => {
                  const code = codeLabel(row.codeStatus, row.promotionCode, row.couponName);
                  return (
                    <tr key={row.userId} className={`align-top ${row.accountDeleted ? 'opacity-75' : ''}`}>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {row.accountDeleted ? (
                          <span className="italic text-muted-foreground">{fmt(s.deletedAccount, { id: row.userId })}</span>
                        ) : (
                          <Link
                            href={`/admin/subscribers/${row.userId}?tz=${encodeURIComponent(filters.timeZone)}`}
                            className="font-medium text-foreground hover:text-primary underline decoration-border underline-offset-2 transition-colors"
                          >
                            {row.userName}
                          </Link>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap text-muted-foreground">{row.emailAddress ?? '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{date(row.signedUpAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">
                        {row.signupPromoCode ?? <span className="text-muted-foreground">—</span>}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{row.plan ? (s.plans[row.plan] ?? row.plan) : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <SubscriptionStatusBadge status={row.status} label={s.statuses[row.status] ?? row.status} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{price(row, row.originalAmount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap font-mono">
                        {row.codeStatus === 'known' && row.promotionCode ? (
                          <Link href={href({ code: row.promotionCode })} className="hover:text-primary transition-colors">
                            {row.promotionCode}
                          </Link>
                        ) : (
                          <span className="text-muted-foreground">{code ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {row.percentOff !== null ? percent(row.percentOff) : '—'}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{price(row, row.currentAmount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{date(row.subscriptionStartedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{renewal(row)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-t border-border text-sm">
            <span className="text-muted-foreground">
              {fmt(s.showing, { first: number(first), last: number(last), total: number(total) })}
            </span>
            <div className="flex gap-2">
              {filters.page > 1 && (
                <Link href={href({ page: filters.page - 1 })} className="px-4 py-1.5 rounded-lg border border-border hover:border-primary transition-colors">
                  {s.previous}
                </Link>
              )}
              {last < total && (
                <Link href={href({ page: filters.page + 1 })} className="px-4 py-1.5 rounded-lg border border-border hover:border-primary transition-colors">
                  {s.next}
                </Link>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
