import { NextResponse } from 'next/server';
import { type ActivityRow, parseActivityFilters, readActivityExport } from '@/lib/activityReport';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';

// The Admin page's Export CSV button: the activity log rows matching the page's filters (same URL
// parameters), newest first. Admin role only.

const COLUMNS: [string, (row: ActivityRow, local: Intl.DateTimeFormat) => string | number | null][] = [
  ['occurred_at_utc', (row) => row.occurredAt],
  ['occurred_at_local', (row, local) => local.format(new Date(row.occurredAt))],
  ['user_id', (row) => row.userId],
  ['user_name', (row) => row.userName],
  ['email_address', (row) => row.emailAddress],
  ['visitor_id', (row) => row.visitorId],
  ['session_id', (row) => row.sessionId],
  ['event_type', (row) => row.eventType],
  ['path', (row) => row.path],
  ['page_title', (row) => row.pageTitle],
  ['referrer', (row) => row.referrer],
  ['element', (row) => row.element],
  ['element_id', (row) => row.elementId],
  ['label', (row) => row.label],
  ['target_href', (row) => row.targetHref],
  ['viewport_width', (row) => row.viewportWidth],
  ['viewport_height', (row) => row.viewportHeight],
  ['language', (row) => row.language],
  ['ip_address', (row) => row.ipAddress],
  ['user_agent', (row) => row.userAgent],
];

function csvCell(value: string | number | null): string {
  if (value === null) return '';
  let text = String(value);
  // A leading = + - @ makes Excel run the cell as a formula; labels and paths come from visitors' browsers
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user || !isAdmin(user.role)) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }

    const filters = parseActivityFilters(Object.fromEntries(new URL(request.url).searchParams));
    const rows = await readActivityExport(filters);
    const local = new Intl.DateTimeFormat('sv-SE', {
      timeZone: filters.timeZone,
      dateStyle: 'short',
      timeStyle: 'medium',
    });
    const lines = [
      COLUMNS.map(([name]) => name).join(','),
      ...rows.map((row) => COLUMNS.map(([, value]) => csvCell(value(row, local))).join(',')),
    ];
    const stamp = new Date().toISOString().slice(0, 10);
    // The BOM makes Excel read the file as UTF-8 (accents in labels and page titles)
    return new NextResponse(`﻿${lines.join('\r\n')}\r\n`, {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="activity-log-${stamp}.csv"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Activity export error:', error);
    return NextResponse.json({ error: 'Failed to export the activity log' }, { status: 500 });
  }
}
