import { z } from 'zod';
import { query } from './db';
import { redactUrl } from './redactUrl';
import { ensureUserSchema } from './users';

// The site's activity log (racingcoach."ActivityLog"): every page view and every click on a link, button
// or other control, sent in batches by src/components/ActivityTracker.tsx to /api/activity.
// Never holds what people type: the tracker only records which control was clicked and its visible label.

export const ACTIVITY_EVENT_TYPES = ['page_view', 'click'] as const;

// A batch from one tab. The tracker sends at most this many events at once.
export const MAX_ACTIVITY_EVENTS = 50;

// Remembers an anonymous visitor across visits, so their activity before signing up or logging in can be
// tied to the account afterwards
export const VISITOR_COOKIE = 'visitor_id';

// Long text is cut rather than rejected, so one odd label doesn't lose the whole batch
const text = (max: number) =>
  z
    .string()
    .transform((s) => s.trim().slice(0, max))
    .nullish();

const activityEventSchema = z.object({
  type: z.enum(ACTIVITY_EVENT_TYPES),
  occurredAt: z.number().int().positive(),
  path: z.string().min(1).transform((s) => s.slice(0, 2000)),
  pageTitle: text(300),
  referrer: text(2000),
  element: text(40),
  elementId: text(200),
  label: text(200),
  targetHref: text(2000),
  viewportWidth: z.number().int().min(0).max(100_000).nullish(),
  viewportHeight: z.number().int().min(0).max(100_000).nullish(),
});

export const activityBatchSchema = z.object({
  sessionId: z.uuid(),
  language: text(20),
  events: z.array(activityEventSchema).min(1).max(MAX_ACTIVITY_EVENTS),
});

export type ActivityBatch = z.infer<typeof activityBatchSchema>;

export type ActivityContext = {
  userId: number | null;
  visitorId: string;
  ipAddress: string | null;
  userAgent: string | null;
};

// The browser's clock can be off, so a time more than a day from the server's is replaced with the server's
function clampTime(occurredAt: number): Date {
  const now = Date.now();
  return Math.abs(occurredAt - now) > 24 * 60 * 60 * 1000 ? new Date(now) : new Date(occurredAt);
}

export async function logActivity(batch: ActivityBatch, context: ActivityContext): Promise<void> {
  await ensureUserSchema();
  const columns = [
    'occurred_at', 'user_id', 'visitor_id', 'session_id', 'event_type', 'path', 'page_title', 'referrer', 'element',
    'element_id', 'label', 'target_href', 'viewport_width', 'viewport_height', 'language', 'ip_address', 'user_agent',
  ];
  const params: unknown[] = [];
  const rows = batch.events.map((event) => {
    const values = [
      clampTime(event.occurredAt),
      context.userId,
      context.visitorId,
      batch.sessionId,
      event.type,
      redactUrl(event.path),
      event.pageTitle ?? null,
      event.referrer ? redactUrl(event.referrer) : null,
      event.element ?? null,
      event.elementId ?? null,
      event.label ?? null,
      event.targetHref ? redactUrl(event.targetHref) : null,
      event.viewportWidth ?? null,
      event.viewportHeight ?? null,
      batch.language ?? null,
      context.ipAddress,
      context.userAgent?.slice(0, 500) ?? null,
    ];
    const placeholders = values.map((value) => {
      params.push(value);
      return `$${params.length}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  await query(`INSERT INTO racingcoach."ActivityLog" (${columns.join(', ')}) VALUES ${rows.join(', ')}`, params);
}
