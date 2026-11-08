import { query } from './db';
import { describeError, fingerprint } from './errorFingerprint';
import { emailOwner } from './ownerNotifications';

// The site's own error monitoring, with no outside service (docs/launch-readiness-audit-2026-11-07.md, F-33). Server
// errors are caught where they're logged (console.error, which the routes call for every error they catch) and where
// Next.js reports one nothing caught (onRequestError in src/instrumentation.ts), grouped by kind (errorFingerprint.ts),
// counted in memory and written to racingcoach."ServerErrors" once a minute. A kind not seen before, or seen again after
// a day without it, is emailed to the site owner (one email a minute at most, 20 a day). The Admin page lists them.
// Rows are kept 30 days after an error was last seen. The text is scrubbed of email addresses, keys and query strings.

const FLUSH_MS = 60_000;
const MAX_KINDS_WAITING = 300;
const MAX_EMAILS_PER_DAY = 20;
const KEEP_DAYS = 30;

type Pending = { source: string; message: string; detail: string; count: number };

const g = globalThis as typeof globalThis & {
  errorMonitorPending?: Map<string, Pending>;
  errorMonitorOriginalConsoleError?: typeof console.error;
  errorMonitorTimer?: NodeJS.Timeout;
};
const pending = (g.errorMonitorPending ??= new Map());

// Counts one error; never throws, never logs through console.error (it would count itself)
export function recordError(source: string, args: unknown[]): void {
  try {
    const { message, detail } = describeError(args);
    const key = fingerprint(source, message);
    const seen = pending.get(key);
    if (seen) {
      seen.count += 1;
      return;
    }
    if (pending.size >= MAX_KINDS_WAITING) return;
    pending.set(key, { source, message, detail, count: 1 });
  } catch {
    // The monitor must never take anything down with it
  }
}

// Every console.error from here on is counted too (most routes catch their errors and log them that way)
export function captureConsoleErrors(): void {
  if (g.errorMonitorOriginalConsoleError) return;
  const original = console.error.bind(console);
  g.errorMonitorOriginalConsoleError = original;
  console.error = (...args: unknown[]) => {
    original(...args);
    recordError('server', args);
  };
}

export async function ensureErrorTable(): Promise<void> {
  await query(`CREATE TABLE IF NOT EXISTS racingcoach."ServerErrors" (
    fingerprint TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    message TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    count BIGINT NOT NULL DEFAULT 0,
    first_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen TIMESTAMPTZ NOT NULL DEFAULT now(),
    emailed_at TIMESTAMPTZ
  )`);
  await query('CREATE INDEX IF NOT EXISTS server_errors_last_seen_idx ON racingcoach."ServerErrors" (last_seen)');
}

// Writes what was counted since the last flush and emails the owner about new kinds; exported for tests
export async function flushErrors(): Promise<{ written: number; emailed: number }> {
  if (pending.size === 0) return { written: 0, emailed: 0 };
  const batch = [...pending.entries()];
  pending.clear();
  const fresh: Pending[] = [];
  for (const [key, e] of batch) {
    // "New" is a kind never seen, or not seen for a day: one that keeps happening isn't emailed again
    const [row] = await query<{ fresh: boolean }>(
      `WITH before AS (SELECT last_seen FROM racingcoach."ServerErrors" WHERE fingerprint = $1)
       INSERT INTO racingcoach."ServerErrors" (fingerprint, source, message, detail, count)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (fingerprint) DO UPDATE SET count = "ServerErrors".count + EXCLUDED.count, last_seen = now(),
         message = EXCLUDED.message, detail = CASE WHEN EXCLUDED.detail <> '' THEN EXCLUDED.detail ELSE "ServerErrors".detail END
       RETURNING COALESCE((SELECT last_seen FROM before) < now() - interval '1 day', true) AS fresh`,
      [key, e.source, e.message, e.detail, e.count]
    );
    if (row?.fresh) fresh.push(e);
  }
  if (fresh.length === 0) return { written: batch.length, emailed: 0 };

  const [sent] = await query<{ n: string }>(
    `SELECT count(DISTINCT emailed_at) AS n FROM racingcoach."ServerErrors" WHERE emailed_at > now() - interval '1 day'`
  );
  if (Number(sent.n) >= MAX_EMAILS_PER_DAY) return { written: batch.length, emailed: 0 };
  const site = process.env.SITE_URL?.trim().replace(/\/+$/, '') ?? '';
  const ok = await emailOwner(
    `RacingCoach.app: ${fresh.length === 1 ? 'a new server error' : `${fresh.length} new server errors`}`,
    [
      ...fresh.slice(0, 10).map((e) => `${e.message}\n  (${e.count}× in the last minute${e.source === 'server' ? '' : `, ${e.source}`})`),
      ...(fresh.length > 10 ? [`…and ${fresh.length - 10} more`] : []),
      '',
      site ? `All errors: ${site}/admin#monitoring` : 'All errors: the Admin page, Monitoring',
    ].join('\n\n')
  );
  if (ok) {
    await query(`UPDATE racingcoach."ServerErrors" SET emailed_at = now() WHERE fingerprint = ANY($1)`, [
      fresh.map((e) => fingerprint(e.source, e.message)),
    ]);
  }
  return { written: batch.length, emailed: ok ? fresh.length : 0 };
}

export async function purgeOldErrors(): Promise<number> {
  const rows = await query(
    `DELETE FROM racingcoach."ServerErrors" WHERE last_seen < now() - make_interval(days => $1) RETURNING 1`,
    [KEEP_DAYS]
  );
  return rows.length;
}

// The Admin page's Server Errors section: the kinds seen in the last week, most recent first
export type ServerErrorRow = { source: string; message: string; detail: string; count: number; firstSeen: string; lastSeen: string };
export async function readRecentErrors(limit = 30): Promise<ServerErrorRow[]> {
  await ensureErrorTable();
  const rows = await query<{ source: string; message: string; detail: string; count: string; first_seen: Date; last_seen: Date }>(
    `SELECT source, message, detail, count, first_seen, last_seen FROM racingcoach."ServerErrors"
     WHERE last_seen > now() - interval '7 days' ORDER BY last_seen DESC LIMIT $1`,
    [limit]
  );
  return rows.map((r) => ({
    source: r.source,
    message: r.message,
    detail: r.detail,
    count: Number(r.count),
    firstSeen: r.first_seen.toISOString(),
    lastSeen: r.last_seen.toISOString(),
  }));
}

// From src/instrumentation.ts: counts console.errors from now on, and writes them every minute (old ones purged hourly)
export function startErrorMonitor(): void {
  if (g.errorMonitorTimer || !process.env.DATABASE_URL) return;
  captureConsoleErrors();
  let ticks = 0;
  const tick = async () => {
    try {
      await ensureErrorTable();
      await flushErrors();
      if (ticks++ % 60 === 0) await purgeOldErrors();
    } catch (error) {
      // Not console.error: that would be counted, and fail again, every minute
      console.warn('Error monitor:', error instanceof Error ? error.message : error);
    }
  };
  g.errorMonitorTimer = setInterval(tick, FLUSH_MS);
  g.errorMonitorTimer.unref();
}
