// The privacy request worker, inside the web server like the lap retention cleanup (src/instrumentation.ts starts it):
// every 15 s it claims queued "PrivacyJobs" (FOR UPDATE SKIP LOCKED, so several instances never run one job twice)
// and runs them: an export (personalDataExport.ts), an erasure (dataErasure.ts), or deleting stored files. A failed
// job is retried with growing delays up to max_attempts, then left failed and its request put In Review for an Admin.
// A job whose server stopped mid-run is claimed again once its lock lapses; each job is idempotent. Hourly it sweeps:
// expired exports, unverified requests, requests and ledger rows past their retention, ledger copies, and IP addresses
// and browser details past 13 months (activityRetention.ts).
// At start it re-applies the erasure ledger (reapplyErasures), for a database restored from a backup.
import { purgeNetworkDetails } from './activityRetention';
import { query, transaction, withClient } from './db';
import { eraseCategories, mirrorLedger, purgeOldLedger, reapplyErasures } from './dataErasure';
import { deleteVideoObject } from './objectStorage';
import { createExport, expireExports } from './personalDataExport';
import { notifyOwnerOfRequest, quietly, sendRequestUpdate } from './privacyEmail';
import { addEvent, expireUnverifiedRequests, purgeClosedRequests, transitionWith, type PrivacyRequest } from './privacyRequests';
import { cleanCategories, type ExportKind } from './privacyRules';
import { purgeOldCollectorLogs, redactStoredRadioText } from './collectorLogs';
import { ensureUserSchema } from './users';

type Queryable = { query: (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };

export type JobKind = 'export' | 'erasure' | 'purgeObjects';

const TICK_MS = 15 * 1000;
const SWEEP_MS = 60 * 60 * 1000;
const LOCK_MINUTES = 30;
const JOBS_PER_TICK = 3;

// Queues a job on the caller's transaction. An export is queued once per request.
export async function enqueueJob(client: Queryable, requestId: string | null, kind: JobKind, payload: Record<string, unknown>): Promise<void> {
  await client.query(
    `INSERT INTO racingcoach."PrivacyJobs" (request_id, kind, payload) VALUES ($1, $2, $3)
     ${kind === 'export' ? `ON CONFLICT (request_id, kind) WHERE kind = 'export' DO NOTHING` : ''}`,
    [requestId, kind, JSON.stringify(payload)]
  );
}

type Job = { id: number; requestId: string | null; kind: JobKind; attempts: number; maxAttempts: number; payload: Record<string, unknown> };

async function claimJob(): Promise<Job | null> {
  const [row] = await query(
    `UPDATE racingcoach."PrivacyJobs" SET status = 'running', attempts = attempts + 1, started_at = now(),
       locked_until = now() + make_interval(mins => ${LOCK_MINUTES})
     WHERE id = (
       SELECT id FROM racingcoach."PrivacyJobs"
       WHERE (status = 'queued' AND run_after <= now()) OR (status = 'running' AND locked_until < now())
       ORDER BY run_after, id FOR UPDATE SKIP LOCKED LIMIT 1)
     RETURNING id, request_id, kind, attempts, max_attempts, payload`
  );
  if (!row) return null;
  return {
    id: Number(row.id),
    requestId: (row.request_id as string | null) ?? null,
    kind: row.kind as JobKind,
    attempts: Number(row.attempts),
    maxAttempts: Number(row.max_attempts),
    payload: (row.payload as Record<string, unknown>) ?? {},
  };
}

async function loadRequest(id: string): Promise<{ status: string; userId: number | null; email: string | null } | null> {
  const rows = await query(
    `SELECT r.status, r.user_id, COALESCE(u.email_address, r.requester_email) AS email
     FROM racingcoach."PrivacyRequests" r LEFT JOIN racingcoach."Users" u ON u.id = r.user_id WHERE r.id = $1`,
    [id]
  );
  const row = rows[0];
  return row ? { status: row.status as string, userId: row.user_id === null ? null : Number(row.user_id), email: (row.email as string | null) ?? null } : null;
}

async function runExport(job: Job): Promise<Record<string, unknown>> {
  const request = job.requestId ? await loadRequest(job.requestId) : null;
  if (!request || request.userId === null) return { skipped: 'no account' };
  if (request.status === 'completed' || request.status === 'rejected') return { skipped: 'request closed' };
  const kind: ExportKind = job.payload.exportKind === 'portability' ? 'portability' : 'access';
  const stored = await createExport(request.userId, kind, job.requestId!);
  const done = await transaction(async (client) => {
    await addEvent(client, job.requestId!, { actor: 'system', event: 'exportReady', note: stored.id, visibleToRequester: true });
    return transitionWith(client, job.requestId!, {
      to: 'completed',
      actor: 'system',
      resolution: `Your ${kind === 'access' ? 'data' : 'portable data'} export is ready to download until ${stored.expiresAt.toISOString().slice(0, 16).replace('T', ' ')} UTC.`,
    });
  });
  if (request.email) {
    await quietly(
      sendRequestUpdate(request.email, { requestId: done.id, type: done.type, headline: 'your export is ready', message: done.resolution, signedIn: true }),
      'export ready'
    );
  }
  return { exportId: stored.id, sizeBytes: stored.sizeBytes };
}

async function runErasure(job: Job): Promise<Record<string, unknown>> {
  const request = job.requestId ? await loadRequest(job.requestId) : null;
  if (!request || request.userId === null) return { skipped: 'no account' };
  if (request.status === 'completed' || request.status === 'rejected') return { skipped: 'request closed' };
  const categories = cleanCategories(job.payload.categories);
  const counts = (await eraseCategories(request.userId, categories, job.requestId!)) ?? {};
  // Categories still waiting on an Admin's review keep the request open
  const [scope] = await query('SELECT scope FROM racingcoach."PrivacyRequests" WHERE id = $1', [job.requestId]);
  const asked = cleanCategories((scope?.scope as { categories?: unknown })?.categories);
  const erasedSoFar = new Set(
    (await query('SELECT DISTINCT category FROM racingcoach."ErasureLedger" WHERE request_id = $1', [job.requestId])).map((row) => row.category as string)
  );
  const waiting = asked.filter((category) => !erasedSoFar.has(category));
  let done: PrivacyRequest | null = null;
  await transaction(async (client) => {
    await addEvent(client, job.requestId!, {
      actor: 'system',
      event: 'erased',
      note: Object.entries(counts).map(([category, rows]) => `${category}: ${rows}`).join(', ') || 'nothing to erase',
      visibleToRequester: true,
    });
    if (waiting.length) {
      if (request.status !== 'in_review') {
        await transitionWith(client, job.requestId!, {
          to: 'in_review',
          actor: 'system',
          resolution: null,
          note: `Waiting for review: ${waiting.join(', ')}`,
        });
      }
    } else {
      done = await transitionWith(client, job.requestId!, {
        to: 'completed',
        actor: 'system',
        resolution: 'The data you chose was deleted.',
        legalJustification: 'Article 17(1).',
        retained: categories.includes('laps')
          ? [{ category: 'laps', reason: 'A record of each deleted lap’s collector ID and completion time (no telemetry) stops it being uploaded again, until it would have expired.' }]
          : [],
      });
    }
  });
  if (waiting.length) {
    await quietly(notifyOwnerOfRequest({ requestId: job.requestId!, type: 'erasure', review: true }), 'owner review');
  } else if (done && request.email) {
    const finished = done as PrivacyRequest;
    await quietly(
      sendRequestUpdate(request.email, { requestId: finished.id, type: finished.type, headline: 'completed', message: finished.resolution, signedIn: true }),
      'erasure done'
    );
  }
  return { counts, waitingForReview: waiting };
}

async function runPurgeObjects(job: Job): Promise<Record<string, unknown>> {
  const keys = Array.isArray(job.payload.keys) ? (job.payload.keys as unknown[]).filter((key): key is string => typeof key === 'string') : [];
  for (const key of keys) await deleteVideoObject(key);
  return { deleted: keys.length };
}

const RUNNERS: Record<JobKind, (job: Job) => Promise<Record<string, unknown>>> = {
  export: runExport,
  erasure: runErasure,
  purgeObjects: runPurgeObjects,
};

// 1, 2, 4, 8... minutes, at most an hour
const backoffMinutes = (attempts: number) => Math.min(60, 2 ** Math.max(0, attempts - 1));

export async function runJob(job: Job): Promise<void> {
  try {
    const result = await RUNNERS[job.kind](job);
    await query(
      `UPDATE racingcoach."PrivacyJobs" SET status = 'succeeded', result = $2, finished_at = now(), locked_until = NULL, last_error = NULL WHERE id = $1`,
      [job.id, JSON.stringify(result)]
    );
  } catch (error) {
    // The message only, never data
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const final = job.attempts >= job.maxAttempts;
    await query(
      `UPDATE racingcoach."PrivacyJobs" SET status = $2, last_error = $3, locked_until = NULL,
         run_after = now() + make_interval(mins => $4), finished_at = CASE WHEN $2 = 'failed' THEN now() ELSE NULL END
       WHERE id = $1`,
      [job.id, final ? 'failed' : 'queued', message, backoffMinutes(job.attempts)]
    );
    console.error(`Privacy job ${job.id} (${job.kind}) attempt ${job.attempts} failed: ${message}`);
    if (final && job.requestId) {
      // An Admin has to look at it now
      await transaction(async (client) => {
        await addEvent(client, job.requestId!, { actor: 'system', event: 'jobFailed', note: `${job.kind}: ${message}` });
        const { rows } = await client.query('SELECT status FROM racingcoach."PrivacyRequests" WHERE id = $1', [job.requestId]);
        if (rows[0] && rows[0].status === 'processing') {
          await transitionWith(client, job.requestId!, { to: 'in_review', actor: 'system', resolution: null, note: 'A job failed; see the jobs below.' });
        }
      }).catch((err) => console.error('Privacy job failure record failed:', err instanceof Error ? err.message : err));
      await quietly(notifyOwnerOfRequest({ requestId: job.requestId, type: 'other', review: true }), 'job failed');
    }
  }
}

// Runs what's due now; answers how many jobs ran
export async function runDueJobs(limit = JOBS_PER_TICK): Promise<number> {
  await ensureUserSchema();
  let ran = 0;
  while (ran < limit) {
    const job = await claimJob();
    if (!job) break;
    await runJob(job);
    ran += 1;
  }
  return ran;
}

// Puts a failed job back in the queue (the Admin page's Retry)
export async function retryJob(jobId: number): Promise<boolean> {
  await ensureUserSchema();
  const rows = await query(
    `UPDATE racingcoach."PrivacyJobs" SET status = 'queued', attempts = 0, run_after = now(), last_error = NULL, finished_at = NULL
     WHERE id = $1 AND status = 'failed' RETURNING request_id`,
    [jobId]
  );
  return rows.length > 0;
}

// Sign-in sessions and password reset links past their expiry (milliseconds) and email confirmation links past theirs:
// they no longer work, and were otherwise only deleted when their user signed out or reset again
async function purgeExpiredAuthRows(): Promise<number> {
  const sessions = await query('DELETE FROM racingcoach."Sessions" WHERE expires_at < $1 RETURNING 1', [Date.now()]);
  const resets = await query('DELETE FROM racingcoach."PasswordResets" WHERE expires_at < $1 RETURNING 1', [Date.now()]);
  const links = await query('DELETE FROM racingcoach."EmailVerifications" WHERE expires_at < now() RETURNING 1');
  return sessions.length + resets.length + links.length;
}

export async function sweep(): Promise<void> {
  const steps: [string, () => Promise<number>][] = [
    ['expired exports', expireExports],
    ['unverified requests', expireUnverifiedRequests],
    ['closed requests', purgeClosedRequests],
    ['old ledger', purgeOldLedger],
    ['ledger copies', mirrorLedger],
    ['rows past 13 months cleared of IP addresses and browser details', () => withClient(purgeNetworkDetails)],
    ['collector log lines past 90 days deleted', purgeOldCollectorLogs],
    ['collector log lines cleared of radio and message text', redactStoredRadioText],
    ['expired sign-in sessions, reset and confirmation links deleted', purgeExpiredAuthRows],
  ];
  for (const [what, step] of steps) {
    try {
      const n = await step();
      if (n) console.log(`Privacy sweep: ${n} ${what}`);
    } catch (error) {
      console.error(`Privacy sweep (${what}) failed:`, error instanceof Error ? error.message : error);
    }
  }
}

const globalForPrivacy = globalThis as typeof globalThis & { privacyJobsTimer?: NodeJS.Timeout };

export function startPrivacyJobs(): void {
  if (globalForPrivacy.privacyJobsTimer || !process.env.DATABASE_URL) return;
  let lastSweep = 0;
  let started = false;
  globalForPrivacy.privacyJobsTimer = setTimeout(function tick() {
    void (async () => {
      try {
        if (!started) {
          started = true;
          const { restoredEntries, reapplied } = await reapplyErasures();
          if (restoredEntries || reapplied) console.log(`Erasure ledger: ${restoredEntries} entries restored, ${reapplied} rows erased again`);
        }
        await runDueJobs();
        if (Date.now() - lastSweep >= SWEEP_MS) {
          lastSweep = Date.now();
          await sweep();
        }
      } catch (error) {
        console.error('Privacy jobs tick failed:', error instanceof Error ? error.message : error);
      }
    })().finally(() => {
      globalForPrivacy.privacyJobsTimer = setTimeout(tick, TICK_MS).unref();
    });
  }, TICK_MS).unref();
}
