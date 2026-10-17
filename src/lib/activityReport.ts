import { query } from './db';
import { ROLES } from './roles';
import { ensureUserSchema } from './users';

// Reading racingcoach."ActivityLog" for the Admin page (src/app/admin/page.tsx) and its CSV export
// (/api/admin/activity/export). Both take the same filters, straight from the page's URL.

export const ACTIVITY_PAGE_SIZE = 100;
// The CSV export stops here, so one click can't pull the whole table into memory
export const MAX_EXPORT_ROWS = 50_000;

export type ActivityFilters = {
  // YYYY-MM-DD in timeZone, both inclusive; null = no limit
  from: string | null;
  to: string | null;
  // IANA time zone the dates are in and times are shown in, e.g. America/New_York
  timeZone: string;
  // 'anonymous', 'signed-in', a user ID, or null for everyone
  user: string | null;
  eventType: 'page_view' | 'click' | null;
  // Text the page's path contains
  path: string | null;
  // Text the clicked control's label, id or link contains
  search: string | null;
  visitorId: string | null;
  sessionId: string | null;
  ipAddress: string | null;
  // The site owner's own clicks are left out unless this is set
  includeAdmins: boolean;
  page: number;
};

export type ActivityRow = {
  id: string;
  occurredAt: string;
  userId: number | null;
  userName: string | null;
  emailAddress: string | null;
  visitorId: string;
  sessionId: string;
  eventType: string;
  path: string;
  pageTitle: string | null;
  referrer: string | null;
  element: string | null;
  elementId: string | null;
  label: string | null;
  targetHref: string | null;
  viewportWidth: number | null;
  viewportHeight: number | null;
  language: string | null;
  ipAddress: string | null;
  userAgent: string | null;
};

export type ActivitySummary = {
  events: number;
  pageViews: number;
  clicks: number;
  users: number;
  visitors: number;
  sessions: number;
};

export type CountedItem = { name: string; count: number };

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isTimeZone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

// Today's date (YYYY-MM-DD) in a time zone, `daysAgo` days back
export function dateInZone(timeZone: string, daysAgo = 0): string {
  const day = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
  // en-CA formats as YYYY-MM-DD
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(day);
}

type Params = Record<string, string | string[] | undefined>;

function one(params: Params, key: string): string | null {
  const value = params[key];
  const text = (Array.isArray(value) ? value[0] : value)?.trim();
  return text ? text.slice(0, 500) : null;
}

// The page's URL parameters as filters, dropping anything malformed. With no `from` at all (a fresh visit,
// not a cleared box), the last 7 days are shown.
export function parseActivityFilters(params: Params): ActivityFilters {
  const zone = one(params, 'tz');
  const timeZone = zone && isTimeZone(zone) ? zone : 'UTC';
  const from = one(params, 'from');
  const to = one(params, 'to');
  const user = one(params, 'user');
  const type = one(params, 'type');
  const visitorId = one(params, 'visitor');
  const sessionId = one(params, 'session');
  const page = Number(one(params, 'page'));
  return {
    from: 'from' in params ? (from && DATE_RE.test(from) ? from : null) : dateInZone(timeZone, 6),
    to: to && DATE_RE.test(to) ? to : null,
    timeZone,
    user: user === 'anonymous' || user === 'signed-in' || (user && /^\d+$/.test(user)) ? user : null,
    eventType: type === 'page_view' || type === 'click' ? type : null,
    path: one(params, 'path'),
    search: one(params, 'q'),
    visitorId: visitorId && UUID_RE.test(visitorId) ? visitorId : null,
    sessionId: sessionId && UUID_RE.test(sessionId) ? sessionId : null,
    ipAddress: one(params, 'ip'),
    includeAdmins: one(params, 'admins') === 'include',
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

// The filters as URL parameters (for links that change one of them), leaving out empty ones
export function activityFilterParams(filters: ActivityFilters, changes: Partial<ActivityFilters> = {}): URLSearchParams {
  const f = { ...filters, page: 1, ...changes };
  const params = new URLSearchParams();
  params.set('tz', f.timeZone);
  // Always present, so a cleared box stays cleared instead of falling back to the last 7 days
  params.set('from', f.from ?? '');
  if (f.to) params.set('to', f.to);
  if (f.user) params.set('user', f.user);
  if (f.eventType) params.set('type', f.eventType);
  if (f.path) params.set('path', f.path);
  if (f.search) params.set('q', f.search);
  if (f.visitorId) params.set('visitor', f.visitorId);
  if (f.sessionId) params.set('session', f.sessionId);
  if (f.ipAddress) params.set('ip', f.ipAddress);
  if (f.includeAdmins) params.set('admins', 'include');
  if (f.page > 1) params.set('page', String(f.page));
  return params;
}

// LIKE treats % and _ as wildcards; a search for "50%" means the text
function likeContains(text: string): string {
  return `%${text.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

// The WHERE clause for the filters, over ActivityLog as a and Users as u
function whereClause(filters: ActivityFilters): { sql: string; params: unknown[] } {
  const conditions: string[] = [];
  const params: unknown[] = [];
  const add = (value: unknown) => {
    params.push(value);
    return `$${params.length}`;
  };

  // Dates are whole days in the admin's time zone
  if (filters.from) {
    conditions.push(`a.occurred_at >= (${add(filters.from)}::date)::timestamp AT TIME ZONE ${add(filters.timeZone)}`);
  }
  if (filters.to) {
    conditions.push(`a.occurred_at < (${add(filters.to)}::date + 1)::timestamp AT TIME ZONE ${add(filters.timeZone)}`);
  }
  if (filters.user === 'anonymous') conditions.push('a.user_id IS NULL');
  else if (filters.user === 'signed-in') conditions.push('a.user_id IS NOT NULL');
  else if (filters.user) conditions.push(`a.user_id = ${add(Number(filters.user))}`);
  if (filters.eventType) conditions.push(`a.event_type = ${add(filters.eventType)}`);
  if (filters.path) conditions.push(`a.path ILIKE ${add(likeContains(filters.path))}`);
  if (filters.search) {
    const p = add(likeContains(filters.search));
    conditions.push(`(a.label ILIKE ${p} OR a.element_id ILIKE ${p} OR a.target_href ILIKE ${p})`);
  }
  if (filters.visitorId) conditions.push(`a.visitor_id = ${add(filters.visitorId)}`);
  if (filters.sessionId) conditions.push(`a.session_id = ${add(filters.sessionId)}`);
  if (filters.ipAddress) conditions.push(`a.ip_address = ${add(filters.ipAddress)}`);
  if (!filters.includeAdmins) conditions.push(`(u.role IS NULL OR u.role <> ${add(ROLES.admin)})`);

  return { sql: conditions.length ? `WHERE ${conditions.join(' AND ')}` : '', params };
}

const FROM = 'FROM racingcoach."ActivityLog" a LEFT JOIN racingcoach."Users" u ON u.id = a.user_id';

const ROW_COLUMNS = `a.id, a.occurred_at, a.user_id, u.user_name, u.email_address, a.visitor_id, a.session_id,
  a.event_type, a.path, a.page_title, a.referrer, a.element, a.element_id, a.label, a.target_href,
  a.viewport_width, a.viewport_height, a.language, a.ip_address, a.user_agent`;

function toRow(row: Record<string, unknown>): ActivityRow {
  return {
    // BIGINT comes back from pg as a string
    id: String(row.id),
    occurredAt: (row.occurred_at as Date).toISOString(),
    userId: row.user_id === null ? null : Number(row.user_id),
    userName: (row.user_name as string | null) ?? null,
    emailAddress: (row.email_address as string | null) ?? null,
    visitorId: row.visitor_id as string,
    sessionId: row.session_id as string,
    eventType: row.event_type as string,
    path: row.path as string,
    pageTitle: (row.page_title as string | null) ?? null,
    referrer: (row.referrer as string | null) ?? null,
    element: (row.element as string | null) ?? null,
    elementId: (row.element_id as string | null) ?? null,
    label: (row.label as string | null) ?? null,
    targetHref: (row.target_href as string | null) ?? null,
    viewportWidth: (row.viewport_width as number | null) ?? null,
    viewportHeight: (row.viewport_height as number | null) ?? null,
    language: (row.language as string | null) ?? null,
    ipAddress: (row.ip_address as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
  };
}

// Everything the Admin page shows for one set of filters
export async function readActivityReport(filters: ActivityFilters): Promise<{
  summary: ActivitySummary;
  topPages: CountedItem[];
  topClicks: CountedItem[];
  rows: ActivityRow[];
}> {
  await ensureUserSchema();
  const where = whereClause(filters);
  const and = (condition: string) => (where.sql ? `${where.sql} AND ${condition}` : `WHERE ${condition}`);
  const offset = (filters.page - 1) * ACTIVITY_PAGE_SIZE;

  const [[summary], topPages, topClicks, rows] = await Promise.all([
    query(
      `SELECT count(*) AS events,
              count(*) FILTER (WHERE a.event_type = 'page_view') AS page_views,
              count(*) FILTER (WHERE a.event_type = 'click') AS clicks,
              count(DISTINCT a.user_id) AS users,
              count(DISTINCT a.visitor_id) AS visitors,
              count(DISTINCT a.session_id) AS sessions
       ${FROM} ${where.sql}`,
      where.params
    ),
    query(
      `SELECT a.path AS name, count(*) AS count ${FROM} ${and("a.event_type = 'page_view'")}
       GROUP BY a.path ORDER BY count(*) DESC, a.path LIMIT 10`,
      where.params
    ),
    query(
      `SELECT coalesce(a.label, a.element_id, a.target_href, a.element, '?') AS name, count(*) AS count
       ${FROM} ${and("a.event_type = 'click'")}
       GROUP BY 1 ORDER BY count(*) DESC, 1 LIMIT 10`,
      where.params
    ),
    query(
      `SELECT ${ROW_COLUMNS} ${FROM} ${where.sql} ORDER BY a.occurred_at DESC, a.id DESC
       LIMIT ${ACTIVITY_PAGE_SIZE} OFFSET ${offset}`,
      where.params
    ),
  ]);

  const counted = (items: Record<string, unknown>[]) => items.map((item) => ({ name: String(item.name), count: Number(item.count) }));
  return {
    summary: {
      events: Number(summary.events),
      pageViews: Number(summary.page_views),
      clicks: Number(summary.clicks),
      users: Number(summary.users),
      visitors: Number(summary.visitors),
      sessions: Number(summary.sessions),
    },
    topPages: counted(topPages),
    topClicks: counted(topClicks),
    rows: rows.map(toRow),
  };
}

// The filtered rows for the CSV export, newest first, up to MAX_EXPORT_ROWS
export async function readActivityExport(filters: ActivityFilters): Promise<ActivityRow[]> {
  await ensureUserSchema();
  const where = whereClause(filters);
  const rows = await query(
    `SELECT ${ROW_COLUMNS} ${FROM} ${where.sql} ORDER BY a.occurred_at DESC, a.id DESC LIMIT ${MAX_EXPORT_ROWS}`,
    where.params
  );
  return rows.map(toRow);
}

export type AdminUser = { id: number; userName: string; emailAddress: string; role: string; membershipLevel: string };

// Every account, for the Admin page's user filter and User Roles section (role and membership level)
export async function listUsersForAdmin(): Promise<AdminUser[]> {
  await ensureUserSchema();
  const rows = await query(
    'SELECT id, user_name, email_address, role, membership_level FROM racingcoach."Users" ORDER BY lower(user_name), id'
  );
  return rows.map((row) => ({
    id: Number(row.id),
    userName: row.user_name,
    emailAddress: row.email_address,
    role: row.role,
    membershipLevel: row.membership_level,
  }));
}

// "Chrome · Windows" from a user agent, for the table (the full string is in the export)
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /OPR\//.test(userAgent)
      ? 'Opera'
      : /Firefox\//.test(userAgent)
        ? 'Firefox'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : /Safari\//.test(userAgent)
            ? 'Safari'
            : /bot|crawl|spider/i.test(userAgent)
              ? 'Bot'
              : null;
  const os = /iPhone|iPad/.test(userAgent)
    ? 'iOS'
    : /Android/.test(userAgent)
      ? 'Android'
      : /Windows/.test(userAgent)
        ? 'Windows'
        : /Mac OS X/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : null;
  return [browser, os].filter(Boolean).join(' · ') || null;
}
