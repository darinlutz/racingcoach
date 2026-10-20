import Link from 'next/link';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import AdminTimeZone from '@/components/AdminTimeZone';
import SubscriptionStatusBadge from '@/components/SubscriptionStatusBadge';
import { isTimeZone } from '@/lib/activityReport';
import { fmt, LANGUAGE_LOCALES } from '@/lib/i18n/languages';
import { getDictionary } from '@/lib/i18n/server';
import { canSeeSubscribers } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import {
  type DiscountHistoryRow,
  formatMinorAmount,
  isCurrentDiscount,
  readSubscriberDetails,
  stripeDashboardUrl,
  type SubscriptionHistoryRow,
} from '@/lib/subscriberReport';

// One account on the Subscribers page: its details, every subscription it has had, every discount applied to them
// (the original signup code first), payment status and cancellation feedback, with links to Stripe's Dashboard.
// Coaches and Admins only; anyone else gets a 404.

const cardClass = 'bg-secondary rounded-xl border border-border p-4 sm:p-6';
const linkClass = 'text-primary hover:text-primary-strong underline underline-offset-2 transition-colors';

export default async function SubscriberDetailsPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const user = await getCurrentUser();
  if (!user || !canSeeSubscribers(user.role)) notFound();

  const { id } = await params;
  const query = await searchParams;
  const userId = Number(id);
  if (!Number.isInteger(userId) || userId <= 0) notFound();
  const details = await readSubscriberDetails(userId);
  if (!details) notFound();

  const t = getDictionary(user.preferredLanguage);
  const s = t.subscribers;
  const locale = LANGUAGE_LOCALES[user.preferredLanguage];
  const zone = typeof query.tz === 'string' && isTimeZone(query.tz) ? query.tz : 'UTC';
  const formatDate = new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: 'medium' });
  const formatTime = new Intl.DateTimeFormat(locale, { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' });
  const date = (iso: string | null) => (iso ? formatDate.format(new Date(iso)) : '—');
  const time = (iso: string | null) => (iso ? formatTime.format(new Date(iso)) : '—');
  const percent = (value: number) => `${value.toLocaleString(locale, { maximumFractionDigits: 3 })}%`;

  const { user: account, subscriptions, discounts, cancellations } = details;
  const subscriptionById = new Map(subscriptions.map((sub) => [sub.stripeSubscriptionId, sub]));
  // The one Users points at, else the latest
  const current = subscriptionById.get(account.stripeSubscriptionId ?? '') ?? subscriptions[0];
  const original = discounts.find((d) => d.atSignup) ?? discounts[0];
  const currentDiscounts = discounts.filter((d) => isCurrentDiscount(d, subscriptionById.get(d.stripeSubscriptionId)));
  const livemode = current?.livemode ?? true;

  const money = (sub: SubscriptionHistoryRow, amount: number | null) =>
    amount === null ? '—' : `${formatMinorAmount(amount, sub.currency, locale)}${sub.billingInterval ? (s.perInterval[sub.billingInterval] ?? '') : ''}`;
  const codeLabel = (d: DiscountHistoryRow) =>
    d.codeStatus === 'known' ? d.promotionCode : d.codeStatus === 'coupon' ? fmt(s.couponOnly, { coupon: d.couponName ?? d.stripeCouponId ?? '' }) : s.unknownCode;
  const amountOff = (d: DiscountHistoryRow) =>
    d.percentOff !== null
      ? percent(d.percentOff)
      : d.amountOff !== null && d.amountOffCurrency
        ? formatMinorAmount(d.amountOff, d.amountOffCurrency, locale)
        : '—';
  const duration = (d: DiscountHistoryRow) =>
    d.duration === 'once'
      ? s.durationOnce
      : d.duration === 'repeating'
        ? fmt(s.durationRepeating, { months: d.durationInMonths ?? '?' })
        : d.duration === 'forever'
          ? s.durationForever
          : '—';
  const discountSummary = (d: DiscountHistoryRow | undefined) =>
    d ? `${codeLabel(d)} · ${amountOff(d)} · ${duration(d)}` : s.noDiscount;
  const paymentStatus = (sub: SubscriptionHistoryRow | undefined) =>
    !sub
      ? '—'
      : sub.status === 'past_due' || sub.status === 'unpaid'
        ? s.paymentFailing
        : sub.latestInvoiceStatus
          ? (s.invoiceStatuses[sub.latestInvoiceStatus] ?? sub.latestInvoiceStatus)
          : '—';
  const stripeLink = (kind: 'customers' | 'subscriptions', stripeId: string | null, live: boolean) =>
    stripeId ? (
      <span className="font-mono text-xs break-all">
        {stripeId}{' '}
        <a href={stripeDashboardUrl(kind, stripeId, live)} target="_blank" rel="noreferrer" className={linkClass}>
          {s.openInStripe}
        </a>
      </span>
    ) : (
      '—'
    );

  return (
    <section data-no-track className="py-10 px-4">
      <AdminTimeZone current={typeof query.tz === 'string' ? query.tz : null} />
      <div className="site-container space-y-6">
        <div>
          <Link href={`/admin/subscribers?tz=${encodeURIComponent(zone)}`} className="text-sm text-muted-foreground hover:text-primary transition-colors">
            {s.backToSubscribers}
          </Link>
          <h1 className="text-3xl font-bold text-foreground">{account.userName}</h1>
          <p className="text-sm text-muted-foreground">{account.emailAddress}</p>
        </div>

        <div className="grid gap-4 lg:grid-cols-3">
          <div className={cardClass}>
            <h2 className="text-lg font-bold text-foreground mb-3">{s.account}</h2>
            <Fields
              items={[
                [s.userId, account.id],
                [s.email, account.emailAddress],
                [s.role, t.admin.roles[account.role] ?? account.role],
                [s.membershipLevel, account.membershipLevel],
                [s.accountStatus, account.accountStatus],
                [s.accountCreated, time(account.signedUpAt)],
                [s.paidThrough, date(account.subscriptionEndDate)],
                [s.stripeCustomerId, stripeLink('customers', current?.stripeCustomerId ?? account.stripeCustomerId, livemode)],
              ]}
            />
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-bold text-foreground mb-3">{s.billing}</h2>
            <Fields
              items={[
                [s.status, current ? <SubscriptionStatusBadge status={current.status} label={s.statuses[current.status] ?? current.status} /> : s.statuses.none],
                [s.plan, current?.plan ? (s.plans[current.plan] ?? current.plan) : '—'],
                [s.stripeSubscriptionId, stripeLink('subscriptions', current?.stripeSubscriptionId ?? account.stripeSubscriptionId, livemode)],
                [s.originalPrice, current ? money(current, current.originalAmount) : '—'],
                [s.currentPrice, current ? money(current, current.currentAmount) : '—'],
                [s.nextInvoice, date(current?.nextInvoiceAt ?? null)],
                [s.paymentStatus, paymentStatus(current)],
                [s.lastPayment, time(current?.lastPaymentAt ?? null)],
                [s.lastFailedPayment, time(current?.lastPaymentFailedAt ?? null)],
                [s.canceledOn, time(current?.canceledAt ?? null)],
              ]}
            />
          </div>

          <div className={cardClass}>
            <h2 className="text-lg font-bold text-foreground mb-3">{s.discount}</h2>
            <Fields
              items={[
                [s.originalCode, discountSummary(original)],
                [s.applied, time(original?.appliedAt ?? null)],
                [s.expires, original ? (original.duration === 'forever' ? s.durationForever : date(original.expiresAt)) : '—'],
                [
                  s.currentDiscount,
                  currentDiscounts.length ? (
                    <span className="space-y-1">
                      {currentDiscounts.map((d) => (
                        <span key={d.discountKey} className="block">{discountSummary(d)}</span>
                      ))}
                    </span>
                  ) : (
                    s.noDiscount
                  ),
                ],
              ]}
            />
          </div>
        </div>

        <div className={cardClass}>
          <h2 className="text-lg font-bold text-foreground mb-3">{s.subscriptionHistory}</h2>
          {subscriptions.length === 0 ? (
            <p className="text-sm text-muted-foreground">{s.noSubscriptions}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    {[s.stripeSubscriptionId, s.plan, s.status, s.originalPrice, s.currentPrice, s.started, s.renewalDate, s.canceledOn, s.paymentStatus].map((h) => (
                      <th key={h} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {subscriptions.map((sub) => (
                    <tr key={sub.stripeSubscriptionId} className="align-top">
                      <td className="px-3 py-2">
                        <a href={stripeDashboardUrl('subscriptions', sub.stripeSubscriptionId, sub.livemode)} target="_blank" rel="noreferrer" className={`${linkClass} font-mono text-xs`}>
                          {sub.stripeSubscriptionId}
                        </a>
                        {sub === current && <span className="ml-2 text-xs text-primary">{s.current}</span>}
                        <p className="text-xs text-muted-foreground">{fmt(s.synced, { time: time(sub.syncedAt) })}</p>
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap">{sub.plan ? (s.plans[sub.plan] ?? sub.plan) : '—'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        <SubscriptionStatusBadge status={sub.status} label={s.statuses[sub.status] ?? sub.status} />
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{money(sub, sub.originalAmount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{money(sub, sub.currentAmount)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{date(sub.startedAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">
                        {sub.endedAt
                          ? fmt(s.endedOn, { date: date(sub.endedAt) })
                          : sub.cancelAtPeriodEnd || sub.cancelAt
                            ? fmt(s.cancelsOn, { date: date(sub.cancelAt ?? sub.currentPeriodEnd) })
                            : date(sub.currentPeriodEnd)}
                      </td>
                      <td className="px-3 py-2 whitespace-nowrap tabular-nums">{date(sub.canceledAt)}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{paymentStatus(sub)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div className={cardClass}>
          <h2 className="text-lg font-bold text-foreground mb-3">{s.discountHistory}</h2>
          {discounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">{s.noDiscounts}</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr>
                    {[s.discountCode, s.discount, s.duration, s.applied, s.expires, s.removed, s.stripeSubscriptionId, ''].map((h, i) => (
                      <th key={i} className="px-3 py-2 font-medium whitespace-nowrap">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {discounts.map((d) => {
                    const isCurrent = currentDiscounts.includes(d);
                    return (
                      <tr key={d.discountKey} className="align-top">
                        <td className="px-3 py-2 whitespace-nowrap">
                          <span className="font-mono">{codeLabel(d)}</span>
                          <p className="text-xs text-muted-foreground">
                            {d.atSignup ? s.atSignup : s.addedLater}
                            {d.couponName && d.codeStatus === 'known' ? ` · ${d.couponName}` : ''}
                          </p>
                        </td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{amountOff(d)}</td>
                        <td className="px-3 py-2 whitespace-nowrap">{duration(d)}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{date(d.appliedAt)}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{date(d.expiresAt)}</td>
                        <td className="px-3 py-2 whitespace-nowrap tabular-nums">{date(d.removedAt)}</td>
                        <td className="px-3 py-2 font-mono text-xs">{d.stripeSubscriptionId}</td>
                        <td className="px-3 py-2 whitespace-nowrap">
                          <SubscriptionStatusBadge status={isCurrent ? 'active' : 'ended'} label={isCurrent ? s.current : s.ended} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {cancellations.length > 0 && (
          <div className={cardClass}>
            <h2 className="text-lg font-bold text-foreground mb-3">{s.cancellations}</h2>
            <ul className="space-y-3 text-sm">
              {cancellations.map((c) => (
                <li key={`${c.stripeSubscriptionId}:${c.canceledAt}`}>
                  <p className="text-foreground">
                    {time(c.canceledAt)} · {c.reason}
                  </p>
                  {c.notes && <p className="text-muted-foreground whitespace-pre-wrap">{c.notes}</p>}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </section>
  );
}

// Label and value pairs down a card
function Fields({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="space-y-2 text-sm">
      {items.map(([label, value]) => (
        <div key={label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3">
          <dt className="text-muted-foreground">{label}</dt>
          <dd className="text-foreground break-words">{value}</dd>
        </div>
      ))}
    </dl>
  );
}
