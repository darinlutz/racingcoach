import { NextResponse } from 'next/server';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { parseSubscriberFilters, readSubscriberExport, type SubscriberRow } from '@/lib/subscriberReport';

// The Subscribers page's Export CSV button: the accounts matching the page's filters (same URL parameters), in its
// order. Amounts are in the currency's minor units (cents), as Stripe gives them. Admin role only.

const COLUMNS: [string, (row: SubscriberRow, local: Intl.DateTimeFormat) => string | number | null][] = [
  ['user_id', (row) => row.userId],
  ['account_deleted', (row) => String(row.accountDeleted)],
  ['name', (row) => row.userName],
  ['email', (row) => row.emailAddress],
  ['signup_date', (row, local) => (row.signedUpAt ? local.format(new Date(row.signedUpAt)) : null)],
  ['subscription_status', (row) => row.status],
  ['plan', (row) => row.plan],
  ['currency', (row) => row.currency],
  ['original_price_minor', (row) => row.originalAmount],
  ['current_price_minor', (row) => row.currentAmount],
  ['billing_interval', (row) => (row.billingInterval ? `${row.billingIntervalCount ?? 1} ${row.billingInterval}` : null)],
  ['discount_code', (row) => row.promotionCode],
  ['discount_code_status', (row) => row.codeStatus],
  ['coupon_name', (row) => row.couponName],
  ['discount_percent', (row) => row.percentOff],
  ['discount_amount_off_minor', (row) => row.amountOff],
  ['discount_duration', (row) => row.duration],
  ['discount_duration_months', (row) => row.durationInMonths],
  ['subscription_date', (row, local) => (row.subscriptionStartedAt ? local.format(new Date(row.subscriptionStartedAt)) : null)],
  ['renewal_date', (row, local) => (row.currentPeriodEnd ? local.format(new Date(row.currentPeriodEnd)) : null)],
  ['cancel_at_period_end', (row) => (row.stripeSubscriptionId ? String(row.cancelAtPeriodEnd) : null)],
  ['canceled_at', (row, local) => (row.canceledAt ? local.format(new Date(row.canceledAt)) : null)],
  ['stripe_customer_id', (row) => row.stripeCustomerId],
  ['stripe_subscription_id', (row) => row.stripeSubscriptionId],
];

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  // A leading = + - @ makes Excel run the cell as a formula; names come from users
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const filters = parseSubscriberFilters(Object.fromEntries(new URL(request.url).searchParams));
    const rows = await readSubscriberExport(filters);
    const local = new Intl.DateTimeFormat('sv-SE', { timeZone: filters.timeZone, dateStyle: 'short', timeStyle: 'medium' });
    const lines = [
      COLUMNS.map(([name]) => name).join(','),
      ...rows.map((row) => COLUMNS.map(([, value]) => csvCell(value(row, local))).join(',')),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    // The BOM makes Excel read the file as UTF-8 (accents in names)
    return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="subscribers-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Subscriber export error:', error);
    return NextResponse.json({ error: 'Failed to export subscribers' }, { status: 500 });
  }
}
