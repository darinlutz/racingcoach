import { z } from 'zod';
import { query } from './db';
import { ensureUserSchema } from './users';

// The telemetry collector's activity log (racingcoach."CollectorLogs"): every line it writes to collector.log,
// sent in batches by LogUploader.cs to /api/collector/log, so problems on a sim PC can be looked into without
// asking for the file. Lines older than KEEP_DAYS are deleted as new ones arrive.

export const MAX_LOG_LINES = 500;
const MAX_MESSAGE_CHARS = 4000;
const KEEP_DAYS = 90;

export const collectorLogBatchSchema = z.object({
  runId: z.uuid(),
  version: z.string().trim().max(40).nullish(),
  lines: z
    .array(
      z.object({
        seq: z.number().int().positive(),
        at: z.iso.datetime({ offset: true }),
        // Long lines are cut rather than rejected, so one odd line doesn't lose the batch
        message: z.string().transform((s) => s.slice(0, MAX_MESSAGE_CHARS)),
        isError: z.boolean().default(false),
      })
    )
    .min(1)
    .max(MAX_LOG_LINES),
});

export type CollectorLogBatch = z.infer<typeof collectorLogBatchSchema>;

// Stores a batch; lines already stored (a batch sent again after a timeout) are skipped
export async function saveCollectorLog(userId: number, batch: CollectorLogBatch): Promise<void> {
  await ensureUserSchema();
  const params: unknown[] = [userId, batch.runId, batch.version ?? null];
  const rows = batch.lines.map((line) => {
    params.push(line.seq, line.at, line.isError, line.message);
    const n = params.length;
    return `($1, $2, $${n - 3}, $${n - 2}, $${n - 1}, $${n}, $3)`;
  });
  await query(
    `INSERT INTO racingcoach."CollectorLogs" (user_id, run_id, seq, logged_at, is_error, message, collector_version)
     VALUES ${rows.join(', ')}
     ON CONFLICT (user_id, run_id, seq) DO NOTHING`,
    params
  );
  await query(
    `DELETE FROM racingcoach."CollectorLogs" WHERE user_id = $1 AND logged_at < now() - make_interval(days => $2)`,
    [userId, KEEP_DAYS]
  );
}

// The Admin page's Collector Logs section (src/components/CollectorLogsViewer.tsx), through
// /api/admin/collector-logs: users with logs, their runs, and a run's lines with the review agent's verdicts

const MAX_RUNS = 100;
const MAX_LINES = 5000;
const LATEST_LINES = 500; // without a run picked

export type CollectorLogUser = { id: number; userName: string; emailAddress: string; lastLoggedAt: string };
export type CollectorLogRun = {
  runId: string;
  userId: number;
  userName: string;
  startedAt: string;
  endedAt: string;
  lines: number;
  errors: number;
  version: string | null;
  problems: number;
};
export type CollectorLogLineRow = {
  id: string;
  userId: number;
  userName: string;
  runId: string;
  seq: number;
  loggedAt: string;
  isError: boolean;
  message: string;
};
export type CollectorLogReviewRow = {
  id: string;
  runId: string;
  fromSeq: number;
  toSeq: number;
  reviewedAt: string;
  problem: boolean;
  title: string | null;
  explanation: string | null;
  fix: string | null;
  emailedAt: string | null;
};

export type CollectorLogsView = {
  users: CollectorLogUser[];
  runs: CollectorLogRun[];
  lines: CollectorLogLineRow[];
  reviews: CollectorLogReviewRow[];
  // Lines were cut to the newest MAX_LINES (or LATEST_LINES without a run)
  truncated: boolean;
};

export async function readCollectorLogs(userId: number | null, runId: string | null): Promise<CollectorLogsView> {
  await ensureUserSchema();
  const iso = (d: Date | null) => (d ? d.toISOString() : null);

  const users = await query<{ id: number; user_name: string; email_address: string; last_logged_at: Date }>(
    `SELECT u.id, u.user_name, u.email_address, max(l.logged_at) AS last_logged_at
     FROM racingcoach."CollectorLogs" l JOIN racingcoach."Users" u ON u.id = l.user_id
     GROUP BY u.id ORDER BY last_logged_at DESC`
  );

  const runs = await query<{
    run_id: string; user_id: number; user_name: string; started_at: Date; ended_at: Date;
    lines: string; errors: string; version: string | null; problems: string;
  }>(
    `SELECT l.run_id, l.user_id, u.user_name, min(l.logged_at) AS started_at, max(l.logged_at) AS ended_at,
            count(*) AS lines, count(*) FILTER (WHERE l.is_error) AS errors, max(l.collector_version) AS version,
            (SELECT count(*) FROM racingcoach."CollectorLogReviews" r
              WHERE r.user_id = l.user_id AND r.run_id = l.run_id AND r.problem) AS problems
     FROM racingcoach."CollectorLogs" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE ($1::int IS NULL OR l.user_id = $1)
     GROUP BY l.run_id, l.user_id, u.user_name ORDER BY ended_at DESC LIMIT $2`,
    [userId, MAX_RUNS]
  );

  const limit = runId ? MAX_LINES : LATEST_LINES;
  const lines = await query<{
    id: string; user_id: number; user_name: string; run_id: string; seq: number; logged_at: Date; is_error: boolean; message: string;
  }>(
    `SELECT l.id, l.user_id, u.user_name, l.run_id, l.seq, l.logged_at, l.is_error, l.message
     FROM racingcoach."CollectorLogs" l JOIN racingcoach."Users" u ON u.id = l.user_id
     WHERE ($1::int IS NULL OR l.user_id = $1) AND ($2::uuid IS NULL OR l.run_id = $2)
     ORDER BY l.logged_at DESC, l.seq DESC LIMIT $3`,
    [userId, runId, limit + 1]
  );

  const reviews = await query<{
    id: string; run_id: string; from_seq: number; to_seq: number; reviewed_at: Date; problem: boolean;
    title: string | null; explanation: string | null; fix: string | null; emailed_at: Date | null;
  }>(
    `SELECT id, run_id, from_seq, to_seq, reviewed_at, problem, title, explanation, fix, emailed_at
     FROM racingcoach."CollectorLogReviews"
     WHERE ($1::int IS NULL OR user_id = $1) AND ($2::uuid IS NULL OR run_id = $2) AND problem
     ORDER BY reviewed_at DESC LIMIT 50`,
    [userId, runId]
  );

  return {
    users: users.map((u) => ({ id: u.id, userName: u.user_name, emailAddress: u.email_address, lastLoggedAt: iso(u.last_logged_at)! })),
    runs: runs.map((r) => ({
      runId: r.run_id,
      userId: r.user_id,
      userName: r.user_name,
      startedAt: iso(r.started_at)!,
      endedAt: iso(r.ended_at)!,
      lines: Number(r.lines),
      errors: Number(r.errors),
      version: r.version,
      problems: Number(r.problems),
    })),
    // Oldest first, as the log file reads
    lines: lines
      .slice(0, limit)
      .reverse()
      .map((l) => ({
        id: String(l.id),
        userId: l.user_id,
        userName: l.user_name,
        runId: l.run_id,
        seq: l.seq,
        loggedAt: iso(l.logged_at)!,
        isError: l.is_error,
        message: l.message,
      })),
    reviews: reviews.map((r) => ({
      id: String(r.id),
      runId: r.run_id,
      fromSeq: r.from_seq,
      toSeq: r.to_seq,
      reviewedAt: iso(r.reviewed_at)!,
      problem: r.problem,
      title: r.title,
      explanation: r.explanation,
      fix: r.fix,
      emailedAt: iso(r.emailed_at),
    })),
    truncated: lines.length > limit,
  };
}
