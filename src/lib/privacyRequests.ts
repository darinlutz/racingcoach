// Privacy requests in the database (the tables are in privacyDb.ts, the rules in privacyRules.ts): creating them,
// verifying a requester without an account by email, the requester's own history, the Admin page's list and detail,
// and every status change, recorded in "PrivacyRequestEvents" with who made it. Every read for a requester is scoped
// to their account (or, for someone without one, nothing: they're answered by email).
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from './db';
import {
  canExtend,
  canTransition,
  dueDate,
  extendedDueDate,
  isClosed,
  needsReason,
  type RequestStatus,
  type RequestType,
  type VerificationMethod,
} from './privacyRules';
import { ensureUserSchema } from './users';

export type RequestScope = {
  // erasure: the categories asked for
  categories?: string[];
  // access or portability exports
  exportKind?: 'access' | 'portability';
  // rectification: what the requester says is wrong and what it should be
  corrections?: { field: string; current: string; corrected: string }[];
};

export type PrivacyRequest = {
  id: string;
  userId: number | null;
  deletedUserId: number | null;
  requesterName: string | null;
  requesterEmail: string | null;
  type: RequestType;
  details: string;
  scope: RequestScope;
  status: RequestStatus;
  verificationStatus: 'unverified' | 'verified' | 'failed';
  verificationMethod: VerificationMethod | null;
  verifiedAt: Date | null;
  submittedAt: Date;
  dueAt: Date;
  extendedDueAt: Date | null;
  extensionReason: string | null;
  completedAt: Date | null;
  resolution: string | null;
  legalJustification: string | null;
  retained: { category: string; reason: string }[];
  updatedAt: Date;
};

export type RequestEvent = {
  id: number;
  at: Date;
  actor: 'requester' | 'admin' | 'system';
  actorId: number | null;
  event: string;
  fromStatus: RequestStatus | null;
  toStatus: RequestStatus | null;
  note: string | null;
  visibleToRequester: boolean;
};

type Queryable = Pick<PoolClient, 'query'>;

const COLUMNS = `id, user_id, deleted_user_id, requester_name, requester_email, request_type, details, scope, status,
  verification_status, verification_method, verified_at, submitted_at, due_at, extended_due_at, extension_reason,
  completed_at, resolution, legal_justification, retained, updated_at`;

const date = (value: unknown) => (value ? new Date(value as string) : null);

function rowToRequest(row: Record<string, unknown>): PrivacyRequest {
  return {
    id: row.id as string,
    userId: row.user_id === null ? null : Number(row.user_id),
    deletedUserId: row.deleted_user_id === null ? null : Number(row.deleted_user_id),
    requesterName: (row.requester_name as string | null) ?? null,
    requesterEmail: (row.requester_email as string | null) ?? null,
    type: row.request_type as RequestType,
    details: row.details as string,
    scope: (row.scope as RequestScope) ?? {},
    status: row.status as RequestStatus,
    verificationStatus: row.verification_status as PrivacyRequest['verificationStatus'],
    verificationMethod: (row.verification_method as VerificationMethod | null) ?? null,
    verifiedAt: date(row.verified_at),
    submittedAt: new Date(row.submitted_at as string),
    dueAt: new Date(row.due_at as string),
    extendedDueAt: date(row.extended_due_at),
    extensionReason: (row.extension_reason as string | null) ?? null,
    completedAt: date(row.completed_at),
    resolution: (row.resolution as string | null) ?? null,
    legalJustification: (row.legal_justification as string | null) ?? null,
    retained: (row.retained as PrivacyRequest['retained']) ?? [],
    updatedAt: new Date(row.updated_at as string),
  };
}

function rowToEvent(row: Record<string, unknown>): RequestEvent {
  return {
    id: Number(row.id),
    at: new Date(row.at as string),
    actor: row.actor as RequestEvent['actor'],
    actorId: row.actor_id === null ? null : Number(row.actor_id),
    event: row.event as string,
    fromStatus: (row.from_status as RequestStatus | null) ?? null,
    toStatus: (row.to_status as RequestStatus | null) ?? null,
    note: (row.note as string | null) ?? null,
    visibleToRequester: row.visible_to_requester === true,
  };
}

export async function addEvent(
  client: Queryable,
  requestId: string,
  event: {
    actor: RequestEvent['actor'];
    actorId?: number | null;
    event: string;
    fromStatus?: RequestStatus | null;
    toStatus?: RequestStatus | null;
    note?: string | null;
    visibleToRequester?: boolean;
  }
): Promise<void> {
  await client.query(
    `INSERT INTO racingcoach."PrivacyRequestEvents" (request_id, actor, actor_id, event, from_status, to_status, note, visible_to_requester)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      requestId,
      event.actor,
      event.actorId ?? null,
      event.event,
      event.fromStatus ?? null,
      event.toStatus ?? null,
      event.note ?? null,
      event.visibleToRequester ?? false,
    ]
  );
}

// A new request. With a verification method (a signed-in requester) it starts Submitted; without one (someone who
// isn't signed in) Pending Verification until they follow the emailed link. Either way the deadline runs from now.
export async function createRequest(
  client: Queryable,
  input: {
    userId: number | null;
    requesterName: string | null;
    requesterEmail: string | null;
    type: RequestType;
    details: string;
    scope?: RequestScope;
    verifiedBy: VerificationMethod | null;
    status?: RequestStatus;
  },
  now: Date = new Date()
): Promise<PrivacyRequest> {
  const id = randomUUID();
  const verified = input.verifiedBy !== null;
  const status: RequestStatus = input.status ?? (verified ? 'submitted' : 'pending_verification');
  const { rows } = await client.query(
    `INSERT INTO racingcoach."PrivacyRequests"
       (id, user_id, requester_name, requester_email, request_type, details, scope, status, verification_status,
        verification_method, verified_at, submitted_at, due_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
     RETURNING ${COLUMNS}`,
    [
      id,
      input.userId,
      input.requesterName,
      input.requesterEmail,
      input.type,
      input.details,
      JSON.stringify(input.scope ?? {}),
      status,
      verified ? 'verified' : 'unverified',
      input.verifiedBy,
      verified ? now : null,
      now,
      dueDate(now),
    ]
  );
  await addEvent(client, id, { actor: 'requester', actorId: input.userId, event: 'submitted', toStatus: status, visibleToRequester: true });
  if (verified) {
    await addEvent(client, id, { actor: 'system', event: 'verified', note: input.verifiedBy, visibleToRequester: true });
  }
  return rowToRequest(rows[0]);
}

// The requester's own requests, newest first
export async function listRequestsForUser(userId: number): Promise<PrivacyRequest[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT ${COLUMNS} FROM racingcoach."PrivacyRequests" WHERE user_id = $1 ORDER BY submitted_at DESC LIMIT 100`,
    [userId]
  );
  return rows.map(rowToRequest);
}

// One of the requester's own requests with the history they're shown, or null when it isn't theirs
export async function getRequestForUser(
  userId: number,
  id: string
): Promise<{ request: PrivacyRequest; events: RequestEvent[] } | null> {
  await ensureUserSchema();
  if (!isUuid(id)) return null;
  const [row] = await query(`SELECT ${COLUMNS} FROM racingcoach."PrivacyRequests" WHERE id = $1 AND user_id = $2`, [id, userId]);
  if (!row) return null;
  const events = await query(
    `SELECT * FROM racingcoach."PrivacyRequestEvents" WHERE request_id = $1 AND visible_to_requester ORDER BY at, id`,
    [id]
  );
  return { request: rowToRequest(row), events: events.map(rowToEvent) };
}

export async function countOpenRequests(userId: number, type?: RequestType): Promise<number> {
  await ensureUserSchema();
  const [row] = await query(
    `SELECT count(*)::int AS n FROM racingcoach."PrivacyRequests"
     WHERE user_id = $1 AND status NOT IN ('completed', 'rejected') AND ($2::text IS NULL OR request_type = $2)`,
    [userId, type ?? null]
  );
  return Number(row.n);
}

export const isUuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);

const hashToken = (token: string) => createHash('sha256').update(token).digest('hex');

const VERIFICATION_TTL_MS = 24 * 60 * 60 * 1000;

// A one-time link for the email address a request without an account gave; answers the raw token for the email
export async function createVerificationToken(client: Queryable, requestId: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  await client.query(
    'INSERT INTO racingcoach."PrivacyVerifications" (token_hash, request_id, expires_at) VALUES ($1, $2, $3)',
    [hashToken(token), requestId, new Date(Date.now() + VERIFICATION_TTL_MS)]
  );
  return token;
}

// Follows the emailed link: the request becomes Submitted (verified by email). Answers the request, or null when the
// link is unknown, used or expired. Following it again does nothing.
export async function verifyRequestByToken(token: string): Promise<PrivacyRequest | null> {
  await ensureUserSchema();
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  return transaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE racingcoach."PrivacyVerifications" SET used_at = now()
       WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING request_id`,
      [hashToken(token)]
    );
    if (!rows[0]) return null;
    const requestId = rows[0].request_id as string;
    const { rows: updated } = await client.query(
      `UPDATE racingcoach."PrivacyRequests"
       SET status = 'submitted', verification_status = 'verified', verification_method = 'email', verified_at = now(), updated_at = now()
       WHERE id = $1 AND status = 'pending_verification' RETURNING ${COLUMNS}`,
      [requestId]
    );
    if (!updated[0]) return null;
    await addEvent(client, requestId, {
      actor: 'requester',
      event: 'verified',
      fromStatus: 'pending_verification',
      toStatus: 'submitted',
      note: 'email',
      visibleToRequester: true,
    });
    return rowToRequest(updated[0]);
  });
}

// How many requests one email address made lately without an account, to limit the public form
export async function countRecentRequestsByEmail(email: string, sinceHours: number): Promise<number> {
  await ensureUserSchema();
  const [row] = await query(
    `SELECT count(*)::int AS n FROM racingcoach."PrivacyRequests"
     WHERE lower(requester_email) = lower($1) AND submitted_at > now() - make_interval(hours => $2)`,
    [email, sinceHours]
  );
  return Number(row.n);
}

export class TransitionError extends Error {
  constructor(readonly reason: 'notFound' | 'notAllowed' | 'reasonRequired' | 'cannotExtend') {
    super(`Privacy request transition refused: ${reason}`);
  }
}

export type TransitionInput = {
  to: RequestStatus;
  actor: RequestEvent['actor'];
  actorId?: number | null;
  // Shown to the requester: the outcome, or why it was refused or extended
  resolution?: string | null;
  // The Admin's record of the legal reasoning; never shown to the requester
  legalJustification?: string | null;
  retained?: { category: string; reason: string }[];
  note?: string | null;
};

// Moves a request to another status, if the rules allow it from where it is, under a row lock so two Admins (or an
// Admin and a job) can't both move it. Refusing and extending need a reason the requester is told. Answers the request.
export async function transitionRequest(id: string, input: TransitionInput, now: Date = new Date()): Promise<PrivacyRequest> {
  await ensureUserSchema();
  return transaction((client) => transitionWith(client, id, input, now));
}

export async function transitionWith(client: Queryable, id: string, input: TransitionInput, now: Date = new Date()): Promise<PrivacyRequest> {
  if (!isUuid(id)) throw new TransitionError('notFound');
  const { rows } = await client.query(`SELECT ${COLUMNS} FROM racingcoach."PrivacyRequests" WHERE id = $1 FOR UPDATE`, [id]);
  if (!rows[0]) throw new TransitionError('notFound');
  const current = rowToRequest(rows[0]);
  if (!canTransition(current.status, input.to)) throw new TransitionError('notAllowed');
  const reason = input.resolution?.trim() || null;
  if (needsReason(input.to) && !reason) throw new TransitionError('reasonRequired');
  if (input.to === 'extended' && !canExtend(current, now)) throw new TransitionError('cannotExtend');

  const closing = isClosed(input.to);
  const { rows: updated } = await client.query(
    `UPDATE racingcoach."PrivacyRequests" SET
       status = $2,
       updated_at = $3,
       completed_at = CASE WHEN $4 THEN $3 ELSE completed_at END,
       purge_after = CASE WHEN $4 THEN $3 + interval '3 years' ELSE purge_after END,
       closed_by = CASE WHEN $4 THEN $5 ELSE closed_by END,
       extended_due_at = CASE WHEN $2 = 'extended' THEN $6 ELSE extended_due_at END,
       extension_reason = CASE WHEN $2 = 'extended' THEN $7 ELSE extension_reason END,
       resolution = CASE WHEN $4 THEN $7 ELSE resolution END,
       legal_justification = COALESCE($8, legal_justification),
       retained = COALESCE($9::jsonb, retained),
       verification_status = CASE WHEN $2 = 'rejected' AND status = 'pending_verification' THEN 'failed' ELSE verification_status END
     WHERE id = $1 RETURNING ${COLUMNS}`,
    [
      id,
      input.to,
      now,
      closing,
      input.actorId ?? null,
      extendedDueDate(current.submittedAt),
      reason,
      input.legalJustification?.trim() || null,
      input.retained ? JSON.stringify(input.retained) : null,
    ]
  );
  await addEvent(client, id, {
    actor: input.actor,
    actorId: input.actorId,
    event: input.to === 'extended' ? 'extended' : 'statusChanged',
    fromStatus: current.status,
    toStatus: input.to,
    note: reason,
    visibleToRequester: true,
  });
  if (input.note?.trim()) {
    await addEvent(client, id, { actor: input.actor, actorId: input.actorId, event: 'note', note: input.note.trim() });
  }
  return rowToRequest(updated[0]);
}

// An Admin's internal note, or a record of a message sent to the requester (shown in their history)
export async function addNote(
  id: string,
  input: { actorId: number; note: string; communication: boolean }
): Promise<boolean> {
  await ensureUserSchema();
  if (!isUuid(id)) return false;
  return transaction(async (client) => {
    const { rows } = await client.query('SELECT id FROM racingcoach."PrivacyRequests" WHERE id = $1 FOR UPDATE', [id]);
    if (!rows[0]) return false;
    await addEvent(client, id, {
      actor: 'admin',
      actorId: input.actorId,
      event: input.communication ? 'communication' : 'note',
      note: input.note,
      visibleToRequester: input.communication,
    });
    await client.query('UPDATE racingcoach."PrivacyRequests" SET updated_at = now() WHERE id = $1', [id]);
    return true;
  });
}

// Links a verified request from someone without a session to the account with that email address, once an Admin has
// checked it's the same person (verification method 'manual')
export async function linkRequestToUser(id: string, userId: number, actorId: number): Promise<boolean> {
  await ensureUserSchema();
  if (!isUuid(id)) return false;
  return transaction(async (client) => {
    const { rowCount } = await client.query(
      `UPDATE racingcoach."PrivacyRequests" SET user_id = $2, verification_status = 'verified',
         verification_method = COALESCE(verification_method, 'manual'), verified_at = COALESCE(verified_at, now()), updated_at = now()
       WHERE id = $1 AND user_id IS NULL AND deleted_user_id IS NULL AND status NOT IN ('completed', 'rejected')`,
      [id, userId]
    );
    if (!rowCount) return false;
    await addEvent(client, id, { actor: 'admin', actorId, event: 'linkedToAccount', note: `account ${userId}` });
    return true;
  });
}

export type AdminRequestFilters = { status: RequestStatus | 'open' | 'all'; type: RequestType | 'all'; due: 'all' | 'overdue' | 'dueSoon' };

export type AdminRequestRow = PrivacyRequest & { accountName: string | null; accountEmail: string | null };

// The Admin page's list: open ones first by deadline. Admins only (the page and routes check)
export async function listRequestsForAdmin(filters: AdminRequestFilters): Promise<AdminRequestRow[]> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT ${COLUMNS.split(',').map((c) => `r.${c.trim()}`).join(', ')}, u.user_name AS account_name, u.email_address AS account_email
     FROM racingcoach."PrivacyRequests" r LEFT JOIN racingcoach."Users" u ON u.id = r.user_id
     WHERE ($1 = 'all' OR ($1 = 'open' AND r.status NOT IN ('completed', 'rejected')) OR r.status = $1)
       AND ($2 = 'all' OR r.request_type = $2)
       AND ($3 = 'all'
            OR ($3 = 'overdue' AND r.status NOT IN ('completed', 'rejected') AND COALESCE(r.extended_due_at, r.due_at) < now())
            OR ($3 = 'dueSoon' AND r.status NOT IN ('completed', 'rejected')
                AND COALESCE(r.extended_due_at, r.due_at) BETWEEN now() AND now() + interval '7 days'))
     ORDER BY (r.status IN ('completed', 'rejected')), COALESCE(r.extended_due_at, r.due_at), r.submitted_at
     LIMIT 500`,
    [filters.status, filters.type, filters.due]
  );
  return rows.map((row) => ({
    ...rowToRequest(row),
    accountName: (row.account_name as string | null) ?? null,
    accountEmail: (row.account_email as string | null) ?? null,
  }));
}

export type AdminJobRow = {
  id: number;
  kind: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  result: unknown;
  createdAt: Date;
  finishedAt: Date | null;
};

export type AdminExportRow = { id: string; kind: string; createdAt: Date; expiresAt: Date; sizeBytes: number; downloads: number; deletedAt: Date | null };

export async function getRequestForAdmin(id: string): Promise<{
  request: AdminRequestRow;
  events: RequestEvent[];
  jobs: AdminJobRow[];
  exports: AdminExportRow[];
  ledger: { category: string; erasedAt: Date }[];
} | null> {
  await ensureUserSchema();
  if (!isUuid(id)) return null;
  const [row] = await query(
    `SELECT ${COLUMNS.split(',').map((c) => `r.${c.trim()}`).join(', ')}, u.user_name AS account_name, u.email_address AS account_email
     FROM racingcoach."PrivacyRequests" r LEFT JOIN racingcoach."Users" u ON u.id = r.user_id WHERE r.id = $1`,
    [id]
  );
  if (!row) return null;
  const [events, jobs, exports, ledger] = await Promise.all([
    query('SELECT * FROM racingcoach."PrivacyRequestEvents" WHERE request_id = $1 ORDER BY at, id', [id]),
    query('SELECT * FROM racingcoach."PrivacyJobs" WHERE request_id = $1 ORDER BY id', [id]),
    query(
      `SELECT id, kind, created_at, expires_at, size_bytes, downloads, deleted_at FROM racingcoach."PrivacyExports"
       WHERE request_id = $1 ORDER BY created_at`,
      [id]
    ),
    query('SELECT category, erased_at FROM racingcoach."ErasureLedger" WHERE request_id = $1 ORDER BY erased_at', [id]),
  ]);
  return {
    request: {
      ...rowToRequest(row),
      accountName: (row.account_name as string | null) ?? null,
      accountEmail: (row.account_email as string | null) ?? null,
    },
    events: events.map(rowToEvent),
    jobs: jobs.map((job) => ({
      id: Number(job.id),
      kind: job.kind as string,
      status: job.status as string,
      attempts: Number(job.attempts),
      maxAttempts: Number(job.max_attempts),
      lastError: (job.last_error as string | null) ?? null,
      result: job.result,
      createdAt: new Date(job.created_at as string),
      finishedAt: date(job.finished_at),
    })),
    exports: exports.map((e) => ({
      id: e.id as string,
      kind: e.kind as string,
      createdAt: new Date(e.created_at as string),
      expiresAt: new Date(e.expires_at as string),
      sizeBytes: Number(e.size_bytes),
      downloads: Number(e.downloads),
      deletedAt: date(e.deleted_at),
    })),
    ledger: ledger.map((l) => ({ category: l.category as string, erasedAt: new Date(l.erased_at as string) })),
  };
}

// Counts for the Admin page's link card
export async function readRequestCounts(): Promise<{ open: number; overdue: number; dueSoon: number }> {
  await ensureUserSchema();
  const [row] = await query(
    `SELECT count(*) FILTER (WHERE status NOT IN ('completed', 'rejected'))::int AS open,
            count(*) FILTER (WHERE status NOT IN ('completed', 'rejected') AND COALESCE(extended_due_at, due_at) < now())::int AS overdue,
            count(*) FILTER (WHERE status NOT IN ('completed', 'rejected')
                             AND COALESCE(extended_due_at, due_at) BETWEEN now() AND now() + interval '7 days')::int AS due_soon
     FROM racingcoach."PrivacyRequests"`
  );
  return { open: Number(row.open), overdue: Number(row.overdue), dueSoon: Number(row.due_soon) };
}

// Requests closed more than 3 years ago, with their history and jobs (the job sweep runs it daily). Answers how many
export async function purgeClosedRequests(): Promise<number> {
  await ensureUserSchema();
  const rows = await query('DELETE FROM racingcoach."PrivacyRequests" WHERE purge_after < now() RETURNING id');
  return rows.length;
}

// Requests nobody verified within 30 days are rejected (verification failed), so they don't sit open forever
export async function expireUnverifiedRequests(): Promise<number> {
  await ensureUserSchema();
  const stale = await query(
    `SELECT id FROM racingcoach."PrivacyRequests" WHERE status = 'pending_verification' AND submitted_at < now() - interval '30 days'`
  );
  let expired = 0;
  for (const { id } of stale) {
    try {
      await transitionRequest(id as string, {
        to: 'rejected',
        actor: 'system',
        resolution: 'The email address was not confirmed within 30 days, so we could not verify the request. You can submit it again.',
        legalJustification: 'Article 12(6): identity could not be confirmed.',
      });
      expired += 1;
    } catch (error) {
      if (!(error instanceof TransitionError)) throw error;
    }
  }
  return expired;
}

// The history Privacy Request History shows, for all of the requester's own requests at once, by request
export async function listVisibleEventsForUser(userId: number): Promise<Map<string, RequestEvent[]>> {
  await ensureUserSchema();
  const rows = await query(
    `SELECT e.* FROM racingcoach."PrivacyRequestEvents" e JOIN racingcoach."PrivacyRequests" r ON r.id = e.request_id
     WHERE r.user_id = $1 AND e.visible_to_requester ORDER BY e.at, e.id`,
    [userId]
  );
  const byRequest = new Map<string, RequestEvent[]>();
  for (const row of rows) {
    const list = byRequest.get(row.request_id as string) ?? [];
    list.push(rowToEvent(row));
    byRequest.set(row.request_id as string, list);
  }
  return byRequest;
}
