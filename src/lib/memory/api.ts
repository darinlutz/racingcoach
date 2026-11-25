import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { query } from '@/lib/db';
import { isAdmin } from '@/lib/roles';
import { getCurrentUser } from '@/lib/session';
import { getUserById, type User } from '@/lib/users';
import { BodyTooLargeError, readJsonLimited } from '@/lib/requestBody';
import { OfflineError } from './localServices';
import { parseUserSubject, resolveNamespaces, userNamespacePath, type NamespaceRow } from './rules';
import { ensureMemorySchema } from './schema';
import { audit, ensureUserNamespace, InputError, listNamespaces, LockedError, NotFoundError, SecretContentError, TombstonedError, TransitionError, VersionConflictError, type Actor } from './store';
import { EmbeddingPolicyError } from './embeddings';

// The Memory API's authentication and authorization (docs/AI_MEMORY_SECURITY.md). Two kinds of caller:
//   - an Admin signed in to the site (the Memory Manager): every scope, every namespace that isn't customer data
//     unless asked for by name; anyone else signed in gets a 404, like the Admin page;
//   - an API client (Open WebUI's filter, future Clarivex apps): "Authorization: Bearer cmk_...", a key stored as a
//     SHA-256 hash, with scopes and the namespaces it may use, acting for the Admin who created it (still checked to
//     be an Admin on every request). A client with subjects (e.g. Open WebUI user IDs) must name one of them in
//     X-Memory-Subject; the server checks it, never trusting the caller to say who it is.
// Every response carries X-Request-Id (the caller's, if it sent a sane one), and errors are { error: { code,
// message, requestId } }. Rate limits are per caller, in this server's memory.

// memory:users lets a client act for end users: X-Memory-Subject is user:<id>, and the key then reaches only that
// user's own space for its application (and approved globals), never the client's other namespaces
export const SCOPES = ['memory:read', 'memory:write', 'memory:extract', 'memory:feedback', 'memory:users', 'memory:admin'] as const;
export type Scope = (typeof SCOPES)[number];

export type MemoryCaller = {
  kind: 'admin' | 'client';
  user: User;
  actor: Actor;
  client: string;
  clientId: string | null;
  subject: string | null;
  scopes: Set<Scope>;
  grant: string[] | 'all';
  globalRead: boolean;
  requestId: string;
  // The end user this request acts for (their own space only), or null; and whether the caller may open a user's
  // space by naming it (Admins in the Memory Manager, for support and privacy requests; audited)
  actingUserId: number | null;
  ownerOverride: boolean;
};

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) {
    super(message ?? code);
  }
}

// The space a user-acting caller writes to when it names none
export const ownSpacePath = (caller: MemoryCaller) => (caller.actingUserId !== null ? userNamespacePath(caller.actingUserId, caller.client) : null);

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export async function createApiClient(input: { name: string; application: string; scopes: Scope[]; namespaceIds: string[]; subjects: string[]; globalRead: boolean }, owner: User, actor: Actor) {
  await ensureMemorySchema();
  if (!input.name.trim() || input.name.length > 80 || !/^[a-z0-9-]{2,40}$/.test(input.application)) throw new InputError('badClient');
  const scopes = input.scopes.filter((s) => (SCOPES as readonly string[]).includes(s) && s !== 'memory:admin');
  // A key acting for end users is that and nothing else: no shared namespaces to mix with a customer's
  if (scopes.includes('memory:users') && input.namespaceIds.length) throw new InputError('usersKeyWithNamespaces');
  if (!scopes.length) throw new InputError('noScopes');
  const key = `cmk_${randomBytes(24).toString('base64url')}`;
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_memory."MemoryApiClients" (name, application, key_prefix, key_hash, owner_user_id, scopes, namespace_ids, global_read, subjects)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
    [input.name.trim(), input.application, key.slice(0, 10), hashKey(key), owner.id, scopes, input.namespaceIds, input.globalRead, input.subjects.map((s) => s.slice(0, 200)).slice(0, 50)]
  );
  await audit(actor, 'client.create', rows[0].id, 'ok', { name: input.name, application: input.application, scopes, namespaces: input.namespaceIds.length });
  return { id: rows[0].id, key };
}

export async function listApiClients() {
  await ensureMemorySchema();
  const rows = await query<Record<string, unknown>>(`SELECT id, name, application, key_prefix, scopes, namespace_ids, global_read, subjects, created_at, last_used_at, revoked_at FROM ai_memory."MemoryApiClients" ORDER BY created_at DESC`);
  return rows.map((r) => ({
    id: r.id as string,
    name: r.name as string,
    application: r.application as string,
    keyPrefix: r.key_prefix as string,
    scopes: r.scopes as string[],
    namespaceIds: r.namespace_ids as string[],
    globalRead: r.global_read as boolean,
    subjects: r.subjects as string[],
    createdAt: new Date(r.created_at as Date).toISOString(),
    lastUsedAt: r.last_used_at ? new Date(r.last_used_at as Date).toISOString() : null,
    revokedAt: r.revoked_at ? new Date(r.revoked_at as Date).toISOString() : null,
  }));
}

export async function revokeApiClient(id: string, actor: Actor) {
  await query(`UPDATE ai_memory."MemoryApiClients" SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL`, [id]);
  await audit(actor, 'client.revoke', id, 'ok');
}

const recent = new Map<string, number[]>();
export function rateLimited(key: string, perMinute: number): boolean {
  const now = Date.now();
  const times = (recent.get(key) ?? []).filter((t) => now - t < 60_000);
  if (times.length >= perMinute) {
    recent.set(key, times);
    return true;
  }
  times.push(now);
  recent.set(key, times);
  if (recent.size > 5_000) for (const [k, v] of recent) if (!v.some((t) => now - t < 60_000)) recent.delete(k);
  return false;
}

const requestIdOf = (request: Request) => {
  const given = request.headers.get('x-request-id');
  return given && /^[A-Za-z0-9._:-]{8,100}$/.test(given) ? given : randomUUID();
};

export async function authenticate(request: Request): Promise<MemoryCaller> {
  const requestId = requestIdOf(request);
  const header = request.headers.get('authorization');
  if (header?.startsWith('Bearer ')) {
    const key = header.slice(7).trim();
    if (!/^cmk_[A-Za-z0-9_-]{20,64}$/.test(key)) throw new ApiError(401, 'unauthorized');
    await ensureMemorySchema();
    const hash = hashKey(key);
    const rows = await query<{ id: string; name: string; application: string; key_hash: string; owner_user_id: number; scopes: string[]; namespace_ids: string[]; global_read: boolean; subjects: string[] }>(
      `SELECT id, name, application, key_hash, owner_user_id, scopes, namespace_ids, global_read, subjects FROM ai_memory."MemoryApiClients" WHERE key_hash = $1 AND revoked_at IS NULL`,
      [hash]
    );
    const c = rows[0];
    if (!c || !timingSafeEqual(Buffer.from(c.key_hash), Buffer.from(hash))) throw new ApiError(401, 'unauthorized');
    const owner = await getUserById(c.owner_user_id);
    // The service is Admin-only for now: a key outlives nothing its owner lost
    if (!owner || !isAdmin(owner.role)) throw new ApiError(403, 'ownerNotAdmin');
    const subject = request.headers.get('x-memory-subject')?.trim() || null;
    if (c.subjects.length && (!subject || !c.subjects.includes(subject))) throw new ApiError(403, 'subjectNotAllowed');
    // Acting for an end user: the account must exist, and the key then reaches only that user's own space
    let actingUserId: number | null = null;
    if (c.scopes.includes('memory:users')) {
      actingUserId = parseUserSubject(subject);
      if (actingUserId === null) throw new ApiError(403, 'subjectNotAllowed', 'memory:users keys must name the user (user:<id>)');
      if (!(await getUserById(actingUserId))) throw new ApiError(403, 'subjectNotAllowed');
      await ensureUserNamespace(actingUserId, c.application);
    }
    void query(`UPDATE ai_memory."MemoryApiClients" SET last_used_at = now() WHERE id = $1 AND (last_used_at IS NULL OR last_used_at < now() - interval '1 minute')`, [c.id]).catch(() => undefined);
    return {
      kind: 'client',
      user: owner,
      actor: { userId: owner.id, clientId: c.id, requestId },
      client: c.application,
      clientId: c.id,
      subject,
      scopes: new Set(c.scopes as Scope[]),
      grant: actingUserId !== null ? [] : c.namespace_ids,
      globalRead: c.global_read,
      requestId,
      actingUserId,
      ownerOverride: false,
    };
  }
  const user = await getCurrentUser();
  if (!user || !isAdmin(user.role)) throw new ApiError(404, 'notFound');
  return { kind: 'admin', user, actor: { userId: user.id, requestId }, client: 'memory-manager', clientId: null, subject: null, scopes: new Set(SCOPES), grant: 'all', globalRead: true, requestId, actingUserId: null, ownerOverride: true };
}

export function requireScope(caller: MemoryCaller, scope: Scope) {
  if (!caller.scopes.has(scope)) throw new ApiError(403, 'missingScope', `This key lacks ${scope}`);
}

// The namespaces this caller may use for this request. A request naming namespaces it isn't granted is refused
// outright (403), never quietly narrowed, so a misconfigured client finds out.
export async function namespacesFor(caller: MemoryCaller, requested?: string[] | null, options: { includeChildren?: boolean; includeGlobal?: boolean } = {}): Promise<NamespaceRow[]> {
  const loaded = await listNamespaces({ owners: caller.actingUserId !== null ? [caller.actingUserId] : [], refs: caller.ownerOverride ? (requested ?? []) : [] });
  // An Admin naming a user's space brings in that user's other spaces under it (includeChildren), nobody else's
  const extra = caller.ownerOverride && options.includeChildren !== false ? [...new Set(loaded.filter((n) => n.ownerUserId !== null).map((n) => n.ownerUserId!))] : [];
  const all = (extra.length ? await listNamespaces({ owners: [...extra, ...(caller.actingUserId !== null ? [caller.actingUserId] : [])], refs: requested ?? [] }) : loaded).map((n) => ({
    id: n.id,
    path: n.path,
    kind: n.kind,
    isCustomerData: n.isCustomerData,
    globalApproved: n.globalApproved,
    enabled: n.enabled,
    ownerUserId: n.ownerUserId,
  }));
  const r = resolveNamespaces(all, {
    granted: caller.grant,
    requested: requested ?? undefined,
    includeChildren: options.includeChildren ?? true,
    includeGlobal: options.includeGlobal,
    globalGranted: caller.globalRead,
    actingUserId: caller.actingUserId,
    ownerOverride: caller.ownerOverride,
  });
  if (r.reason === 'mixesUsers') throw new ApiError(400, 'mixesUsers', 'Two users’ memory spaces cannot be combined');
  if (r.reason === 'mixesCustomerData') throw new ApiError(400, 'mixesCustomerData', 'Customer namespaces cannot be combined with others');
  if (r.refused.length) {
    await audit(caller.actor, 'namespace.refused', r.refused.join(',').slice(0, 200), 'refused', { client: caller.client });
    throw new ApiError(403, 'namespaceNotAllowed', 'Not authorized for one or more namespaces');
  }
  // An Admin opening a user's own space is recorded every time (whose, never what was in it)
  const others = [...new Set(r.allowed.filter((n) => n.ownerUserId !== null && n.ownerUserId !== undefined && n.ownerUserId !== caller.actingUserId).map((n) => n.ownerUserId))];
  if (others.length) await audit(caller.actor, 'namespace.userAccess', others.join(','), 'ok', { client: caller.client, namespaces: r.allowed.filter((n) => n.ownerUserId).map((n) => n.path) });
  return r.allowed;
}

export async function body(request: Request, max = 256 * 1024): Promise<Record<string, unknown>> {
  try {
    const v = await readJsonLimited(request, max);
    if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>;
    if (v === null || v === undefined) return {};
    throw new ApiError(400, 'notAnObject');
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error instanceof BodyTooLargeError ? 413 : 400, error instanceof BodyTooLargeError ? 'tooLarge' : 'notJson');
  }
}

const ERRORS: [new (...a: never[]) => Error, number, string][] = [
  [InputError, 400, 'invalid'],
  [NotFoundError, 404, 'notFound'],
  [VersionConflictError, 409, 'versionConflict'],
  [TransitionError, 409, 'invalidTransition'],
  [LockedError, 423, 'locked'],
  [SecretContentError, 422, 'secretContent'],
  [TombstonedError, 410, 'previouslyDeleted'],
  [EmbeddingPolicyError, 403, 'policyRefused'],
  [OfflineError, 503, 'serviceUnavailable'],
];

export function errorResponse(error: unknown, requestId: string): NextResponse {
  const headers = { 'x-request-id': requestId, 'cache-control': 'no-store' };
  if (error instanceof ApiError) return NextResponse.json({ error: { code: error.code, message: error.message, requestId } }, { status: error.status, headers });
  for (const [type, status, code] of ERRORS) {
    if (error instanceof type) {
      const detail = error instanceof InputError ? error.code : error instanceof VersionConflictError ? `version ${error.current}` : error.message;
      return NextResponse.json({ error: { code, message: detail, requestId, ...(error instanceof VersionConflictError ? { currentVersion: error.current } : {}) } }, { status, headers });
    }
  }
  console.error('Memory API error:', error);
  return NextResponse.json({ error: { code: 'internal', message: 'Something went wrong', requestId } }, { status: 500, headers });
}

type Limits = { scope: Scope; perMinute?: number };

// Every Memory API route: authenticate, check the scope and rate, run, and answer with the request ID
export function memoryRoute<C = unknown>(limits: Limits, handler: (request: Request, caller: MemoryCaller, context: C) => Promise<unknown>) {
  return async (request: Request, context: C): Promise<NextResponse> => {
    let requestId = requestIdOf(request);
    try {
      const caller = await authenticate(request);
      requestId = caller.requestId;
      requireScope(caller, limits.scope);
      const perMinute = limits.perMinute ?? (caller.kind === 'admin' ? 600 : 120);
      if (rateLimited(`${caller.clientId ?? `u${caller.user.id}`}:${limits.scope}`, perMinute)) throw new ApiError(429, 'rateLimited');
      const result = await handler(request, caller, context);
      if (result instanceof NextResponse) {
        result.headers.set('x-request-id', requestId);
        return result;
      }
      return NextResponse.json(result ?? { ok: true }, { headers: { 'x-request-id': requestId, 'cache-control': 'no-store' } });
    } catch (error) {
      return errorResponse(error, requestId);
    }
  };
}

export const params = async <T extends Record<string, string>>(context: { params: Promise<T> }): Promise<T> => context.params;

// Query-string helpers for GET routes
export function searchParams(request: Request) {
  const u = new URL(request.url).searchParams;
  return {
    str: (k: string, max = 200) => {
      const v = u.get(k);
      return v && v.length <= max ? v : undefined;
    },
    num: (k: string) => {
      const v = u.get(k);
      const n = v === null || v === '' ? NaN : Number(v);
      return Number.isFinite(n) ? n : undefined;
    },
    bool: (k: string) => (u.get(k) === 'true' ? true : u.get(k) === 'false' ? false : undefined),
    list: (k: string) => u.getAll(k).flatMap((v) => v.split(',')).map((v) => v.trim()).filter(Boolean).slice(0, 100),
  };
}
