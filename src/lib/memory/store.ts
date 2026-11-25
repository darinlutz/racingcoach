import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import { query, transaction } from '@/lib/db';
import { ensureMemorySchema } from './schema';
import {
  activeAllowed,
  canTransition,
  DEFAULT_CONFIG,
  defaultExpiry,
  detectSensitive,
  isUuid,
  LIMITS,
  NAMESPACE_PATH,
  normalizeContent,
  parentPath,
  parseConfig,
  SETTING_EFFECTS,
  titleFrom,
  type MemoryConfig,
  type MemoryMode,
  type MemoryStatus,
  type NamespaceKind,
  type RelationshipType,
  type RetentionRule,
  type AutoUpdatePolicy,
  USER_APPLICATION,
  USERS_ROOT,
  userNamespacePath,
  userRootPath,
} from './rules';

// The authoritative memory store (docs/AI_MEMORY_ARCHITECTURE.md). Every change is one transaction holding the
// memory row, its history entry, the outbox entry for secondary indexes and the job that embeds it, so they never
// disagree. Updates carry the version the caller saw (optimistic concurrency): a stale one is refused with
// VersionConflictError rather than overwriting someone else's change. Locked memories refuse every automated change.

export type Actor = { userId: number | null; clientId?: string | null; system?: string | null; requestId?: string | null };

export class VersionConflictError extends Error {
  constructor(public current: number) {
    super(`The memory changed (now version ${current})`);
  }
}
export class LockedError extends Error {}
export class TransitionError extends Error {}
export class NotFoundError extends Error {}
export class InputError extends Error {
  constructor(public code: string, message?: string) {
    super(message ?? code);
  }
}

type Db = Pick<PoolClient, 'query'>;
const rowsOf = async <T,>(db: Db | null, sql: string, params: unknown[] = []): Promise<T[]> =>
  db ? ((await db.query(sql, params)).rows as T[]) : ((await query(sql, params)) as T[]);

export const contentHash = (content: string) => createHash('sha256').update(normalizeContent(content)).digest('hex');
const iso = (d: Date | string | null | undefined) => (d ? new Date(d).toISOString() : null);

// ---- Settings ----

const CONFIG_KEY = 'config';

export async function getConfig(): Promise<MemoryConfig> {
  await ensureMemorySchema();
  const rows = await query<{ settings: unknown }>(`SELECT settings FROM ai_memory."MemorySettings" WHERE scope_type = 'global' AND scope_key = $1`, [CONFIG_KEY]);
  return rows[0] ? parseConfig(rows[0].settings) : parseConfig(DEFAULT_CONFIG);
}

const flatten = (o: Record<string, unknown>, prefix = ''): Record<string, unknown> =>
  Object.entries(o).reduce<Record<string, unknown>>((acc, [k, v]) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(acc, flatten(v as Record<string, unknown>, `${prefix}${k}.`));
    else acc[`${prefix}${k}`] = v;
    return acc;
  }, {});

export async function saveConfig(next: unknown, actor: Actor): Promise<{ config: MemoryConfig; changed: string[]; effects: Record<string, string> }> {
  const before = await getConfig();
  const merged = parseConfig({ ...before, ...(next as object), system: { ...before.system, ...((next as MemoryConfig)?.system ?? {}) }, extraction: { ...before.extraction, ...((next as MemoryConfig)?.extraction ?? {}) }, retrieval: { ...before.retrieval, ...((next as MemoryConfig)?.retrieval ?? {}) }, providers: { ...before.providers, ...((next as MemoryConfig)?.providers ?? {}) } });
  const a = flatten(before as unknown as Record<string, unknown>);
  const b = flatten(merged as unknown as Record<string, unknown>);
  const changed = Object.keys(b).filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]));
  const effects: Record<string, string> = {};
  for (const k of changed) if (SETTING_EFFECTS[k]) effects[k] = SETTING_EFFECTS[k]!;
  await query(
    `INSERT INTO ai_memory."MemorySettings" (scope_type, scope_key, settings, updated_by) VALUES ('global', $1, $2, $3)
     ON CONFLICT (scope_type, scope_key) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [CONFIG_KEY, JSON.stringify(merged), actor.userId]
  );
  if (changed.length) await audit(actor, 'settings.update', null, 'ok', { changed, before: Object.fromEntries(changed.map((k) => [k, a[k]])), after: Object.fromEntries(changed.map((k) => [k, b[k]])) });
  return { config: merged, changed, effects };
}

// Per-application and per-user modes, and the service's own state (embedding migration, sync cursor)
export async function getScoped<T>(scopeType: 'application' | 'user' | 'state', key: string): Promise<T | null> {
  await ensureMemorySchema();
  const rows = await query<{ settings: T }>(`SELECT settings FROM ai_memory."MemorySettings" WHERE scope_type = $1 AND scope_key = $2`, [scopeType, key]);
  return rows[0]?.settings ?? null;
}

export async function listScoped(scopeType: 'application' | 'user' | 'state'): Promise<{ key: string; settings: unknown; updatedAt: string }[]> {
  await ensureMemorySchema();
  const rows = await query<{ scope_key: string; settings: unknown; updated_at: Date }>(`SELECT scope_key, settings, updated_at FROM ai_memory."MemorySettings" WHERE scope_type = $1 ORDER BY scope_key`, [scopeType]);
  return rows.map((r) => ({ key: r.scope_key, settings: r.settings, updatedAt: r.updated_at.toISOString() }));
}

export async function setScoped(scopeType: 'application' | 'user' | 'state', key: string, settings: unknown, actor: Actor | null, db: Db | null = null): Promise<void> {
  await ensureMemorySchema();
  await rowsOf(
    db,
    `INSERT INTO ai_memory."MemorySettings" (scope_type, scope_key, settings, updated_by) VALUES ($1, $2, $3, $4)
     ON CONFLICT (scope_type, scope_key) DO UPDATE SET settings = EXCLUDED.settings, updated_by = EXCLUDED.updated_by, updated_at = now()`,
    [scopeType, key, JSON.stringify(settings), actor?.userId ?? null]
  );
  if (actor && scopeType !== 'state') await audit(actor, `settings.${scopeType}`, key, 'ok', { settings });
}

// ---- Namespaces and categories ----

export type Namespace = {
  id: string;
  parentId: string | null;
  path: string;
  name: string;
  kind: NamespaceKind;
  description: string;
  isCustomerData: boolean;
  globalApproved: boolean;
  enabled: boolean;
  mode: MemoryMode | null;
  ownerUserId: number | null;
  memoryCount: number;
};

// The shared namespaces, plus the user-owned ones asked for: one user's (owners), or named ones (refs, IDs or
// paths). Never every user's at once unless an Admin's report asks (owners 'all'), so a request can't even list
// other people's spaces and thousands of customers don't load with every call.
export async function listNamespaces(options: { owners?: number[] | 'all'; refs?: string[] } = {}): Promise<Namespace[]> {
  await ensureMemorySchema();
  const owners = options.owners === 'all' ? null : (options.owners ?? []).filter((n) => Number.isInteger(n));
  const refs = (options.refs ?? []).filter((r) => typeof r === 'string' && r.length <= 300);
  const rows = await query<Record<string, unknown>>(
    `SELECT n.*, (SELECT count(*) FROM ai_memory."Memories" m WHERE m.namespace_id = n.id AND m.status <> 'Deleted')::int AS memory_count
     FROM ai_memory."MemoryNamespaces" n
     WHERE n.owner_user_id IS NULL OR $1::boolean OR n.owner_user_id = ANY($2::int[]) OR n.path = ANY($3::text[]) OR n.id::text = ANY($3::text[])
     ORDER BY n.path`,
    [options.owners === 'all', owners ?? [], refs]
  );
  return rows.map((r) => ({
    id: r.id as string,
    parentId: (r.parent_id as string) ?? null,
    path: r.path as string,
    name: r.name as string,
    kind: r.kind as NamespaceKind,
    description: r.description as string,
    isCustomerData: r.is_customer_data as boolean,
    globalApproved: r.global_approved as boolean,
    enabled: r.enabled as boolean,
    mode: (r.mode as MemoryMode) ?? null,
    ownerUserId: (r.owner_user_id as number) ?? null,
    memoryCount: r.memory_count as number,
  }));
}

// A user's own memory space for one application (users/u<id>/<application>), made on first use. Both levels are
// owned by the user and customer data, so ownership rules and Delete Account's cascade cover them.
export async function ensureUserNamespace(userId: number, application: string): Promise<Namespace> {
  await ensureMemorySchema();
  if (!Number.isInteger(userId) || userId < 1 || !USER_APPLICATION.test(application)) throw new InputError('badUserNamespace');
  const root = userRootPath(userId);
  const path = userNamespacePath(userId, application);
  await query(
    `INSERT INTO ai_memory."MemoryNamespaces" (path, name, kind, description, is_customer_data, owner_user_id, parent_id)
     VALUES ($1, $2, 'personal', 'A user’s own memory', true, $3, (SELECT id FROM ai_memory."MemoryNamespaces" WHERE path = $4)) ON CONFLICT (path) DO NOTHING`,
    [root, `User ${userId}`, userId, USERS_ROOT]
  );
  await query(
    `INSERT INTO ai_memory."MemoryNamespaces" (path, name, kind, description, is_customer_data, owner_user_id, parent_id)
     VALUES ($1, $2, 'personal', 'A user’s own memory in one application', true, $3, (SELECT id FROM ai_memory."MemoryNamespaces" WHERE path = $4)) ON CONFLICT (path) DO NOTHING`,
    [path, application, userId, root]
  );
  const ns = (await listNamespaces({ owners: [userId] })).find((n) => n.path === path);
  // A path taken by anything but this user's own space is refused, never shared
  if (!ns || ns.ownerUserId !== userId) throw new InputError('badUserNamespace');
  return ns;
}

export async function createNamespace(input: { path: string; name: string; kind: NamespaceKind; description?: string; isCustomerData?: boolean }, actor: Actor): Promise<Namespace> {
  await ensureMemorySchema();
  if (!NAMESPACE_PATH.test(input.path)) throw new InputError('badPath');
  // Users' own spaces are made only by ensureUserNamespace, never by hand
  if (input.path === USERS_ROOT || input.path.startsWith(`${USERS_ROOT}/`)) throw new InputError('reservedPath');
  if (!input.name.trim() || input.name.length > 100) throw new InputError('badName');
  const parent = parentPath(input.path);
  if (parent) {
    const p = await query(`SELECT 1 FROM ai_memory."MemoryNamespaces" WHERE path = $1`, [parent]);
    if (!p.length) throw new InputError('noParent');
  }
  const rows = await query<{ id: string }>(
    `INSERT INTO ai_memory."MemoryNamespaces" (path, name, kind, description, is_customer_data, parent_id)
     VALUES ($1, $2, $3, $4, $5, (SELECT id FROM ai_memory."MemoryNamespaces" WHERE path = $6)) ON CONFLICT (path) DO NOTHING RETURNING id`,
    [input.path, input.name.trim(), input.kind, (input.description ?? '').slice(0, 500), input.isCustomerData === true, parent]
  );
  if (!rows[0]) throw new InputError('exists');
  await audit(actor, 'namespace.create', input.path, 'ok', { kind: input.kind });
  return (await listNamespaces()).find((n) => n.id === rows[0].id)!;
}

export async function updateNamespace(
  id: string,
  patch: Partial<{ name: string; description: string; enabled: boolean; mode: MemoryMode | null; isCustomerData: boolean; globalApproved: boolean }>,
  actor: Actor
): Promise<void> {
  await ensureMemorySchema();
  const sets: string[] = [];
  const params: unknown[] = [id];
  const set = (col: string, v: unknown) => {
    params.push(v);
    sets.push(`${col} = $${params.length}`);
  };
  if (typeof patch.name === 'string' && patch.name.trim()) set('name', patch.name.trim().slice(0, 100));
  if (typeof patch.description === 'string') set('description', patch.description.slice(0, 500));
  if (typeof patch.enabled === 'boolean') set('enabled', patch.enabled);
  if (patch.mode !== undefined) set('mode', patch.mode);
  if (typeof patch.isCustomerData === 'boolean') set('is_customer_data', patch.isCustomerData);
  if (typeof patch.globalApproved === 'boolean') set('global_approved', patch.globalApproved);
  if (!sets.length) return;
  const r = await query(`UPDATE ai_memory."MemoryNamespaces" SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING path`, params);
  if (!r.length) throw new NotFoundError('namespace');
  await audit(actor, 'namespace.update', String((r[0] as { path: string }).path), 'ok', patch as Record<string, unknown>);
}

export type Category = {
  id: string;
  key: string;
  name: string;
  description: string;
  example: string;
  color: string;
  icon: string;
  defaultImportance: number;
  retentionRule: RetentionRule;
  retentionDays: number | null;
  extractionEligible: boolean;
  requiresApproval: boolean;
  autoUpdate: AutoUpdatePolicy;
  mode: MemoryMode | null;
  enabled: boolean;
  memoryCount: number;
};

export async function listCategories(): Promise<Category[]> {
  await ensureMemorySchema();
  const rows = await query<Record<string, unknown>>(
    `SELECT c.*, (SELECT count(*) FROM ai_memory."Memories" m WHERE m.category_id = c.id AND m.status <> 'Deleted')::int AS memory_count
     FROM ai_memory."MemoryCategories" c ORDER BY c.name`
  );
  return rows.map((r) => ({
    id: r.id as string,
    key: r.key as string,
    name: r.name as string,
    description: r.description as string,
    example: r.example as string,
    color: r.color as string,
    icon: r.icon as string,
    defaultImportance: Number(r.default_importance),
    retentionRule: r.retention_rule as RetentionRule,
    retentionDays: (r.retention_days as number) ?? null,
    extractionEligible: r.extraction_eligible as boolean,
    requiresApproval: r.requires_approval as boolean,
    autoUpdate: r.auto_update as AutoUpdatePolicy,
    mode: (r.mode as MemoryMode) ?? null,
    enabled: r.enabled as boolean,
    memoryCount: r.memory_count as number,
  }));
}

const CATEGORY_COLUMNS: Record<string, string> = {
  name: 'name',
  description: 'description',
  example: 'example',
  color: 'color',
  icon: 'icon',
  defaultImportance: 'default_importance',
  retentionRule: 'retention_rule',
  retentionDays: 'retention_days',
  extractionEligible: 'extraction_eligible',
  requiresApproval: 'requires_approval',
  autoUpdate: 'auto_update',
  mode: 'mode',
  enabled: 'enabled',
};

export async function saveCategory(id: string | null, input: Partial<Category> & { key?: string }, actor: Actor): Promise<Category> {
  await ensureMemorySchema();
  const values = Object.entries(CATEGORY_COLUMNS).filter(([k]) => (input as Record<string, unknown>)[k] !== undefined);
  try {
    let resultId = id;
    if (id) {
      const params: unknown[] = [id, ...values.map(([k]) => (input as Record<string, unknown>)[k])];
      if (values.length) {
        const r = await query(`UPDATE ai_memory."MemoryCategories" SET ${values.map(([, c], i) => `${c} = $${i + 2}`).join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`, params);
        if (!r.length) throw new NotFoundError('category');
      }
    } else {
      if (!input.key || !/^[a-z][a-zA-Z0-9]{1,39}$/.test(input.key) || !input.name?.trim()) throw new InputError('badCategory');
      const cols = ['key', ...values.map(([, c]) => c)];
      const params = [input.key, ...values.map(([k]) => (input as Record<string, unknown>)[k])];
      const r = await query<{ id: string }>(`INSERT INTO ai_memory."MemoryCategories" (${cols.join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`, params);
      resultId = r[0].id;
    }
    await audit(actor, id ? 'category.update' : 'category.create', input.key ?? id, 'ok', Object.fromEntries(values.map(([k]) => [k, (input as Record<string, unknown>)[k]])));
    return (await listCategories()).find((c) => c.id === resultId)!;
  } catch (error) {
    if ((error as { code?: string }).code === '23514' || (error as { code?: string }).code === '22P02') throw new InputError('badCategory');
    if ((error as { code?: string }).code === '23505') throw new InputError('exists');
    throw error;
  }
}

// ---- Memories ----

export type MemoryRecord = {
  id: string;
  userId: number | null;
  tenantId: string;
  namespaceId: string;
  namespacePath: string;
  categoryId: string;
  categoryKey: string;
  categoryName: string;
  categoryColor: string;
  title: string;
  content: string;
  summary: string | null;
  importance: number;
  confidence: number;
  sourceModel: string | null;
  sourceConversationId: string | null;
  sourceMessageId: string | null;
  sourceApplication: string;
  sourceType: string;
  sourceReference: string | null;
  isPinned: boolean;
  isLocked: boolean;
  isActive: boolean;
  isSensitive: boolean;
  status: MemoryStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string | null;
  lastVerifiedAt: string | null;
  expiresAt: string | null;
  accessCount: number;
  supersedesMemoryId: string | null;
  contentHash: string;
  metadata: Record<string, unknown>;
  embedding: { model: string; dimensions: number; status: string; version: number; current: boolean } | null;
};

export const MEMORY_SELECT = `
  SELECT m.*, n.path AS namespace_path, c.key AS category_key, c.name AS category_name, c.color AS category_color,
         e.model AS e_model, e.dimensions AS e_dimensions, e.indexing_status AS e_status, e.memory_version AS e_version
  FROM ai_memory."Memories" m
  JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id
  JOIN ai_memory."MemoryCategories" c ON c.id = m.category_id
  LEFT JOIN LATERAL (SELECT model, dimensions, indexing_status, memory_version FROM ai_memory."MemoryEmbeddings" e
                     WHERE e.memory_id = m.id AND e.model = $1 ORDER BY e.updated_at DESC LIMIT 1) e ON true`;

export function toRecord(r: Record<string, unknown>): MemoryRecord {
  return {
    id: r.id as string,
    userId: (r.user_id as number) ?? null,
    tenantId: r.tenant_id as string,
    namespaceId: r.namespace_id as string,
    namespacePath: r.namespace_path as string,
    categoryId: r.category_id as string,
    categoryKey: r.category_key as string,
    categoryName: r.category_name as string,
    categoryColor: r.category_color as string,
    title: r.title as string,
    content: r.content as string,
    summary: (r.summary as string) ?? null,
    importance: Number(r.importance),
    confidence: Number(r.confidence),
    sourceModel: (r.source_model as string) ?? null,
    sourceConversationId: (r.source_conversation_id as string) ?? null,
    sourceMessageId: (r.source_message_id as string) ?? null,
    sourceApplication: r.source_application as string,
    sourceType: r.source_type as string,
    sourceReference: (r.source_reference as string) ?? null,
    isPinned: r.is_pinned as boolean,
    isLocked: r.is_locked as boolean,
    isActive: r.is_active as boolean,
    isSensitive: r.is_sensitive as boolean,
    status: r.status as MemoryStatus,
    version: Number(r.version),
    createdAt: iso(r.created_at as Date)!,
    updatedAt: iso(r.updated_at as Date)!,
    lastAccessedAt: iso(r.last_accessed_at as Date),
    lastVerifiedAt: iso(r.last_verified_at as Date),
    expiresAt: iso(r.expires_at as Date),
    accessCount: Number(r.access_count),
    supersedesMemoryId: (r.supersedes_memory_id as string) ?? null,
    contentHash: r.content_hash as string,
    metadata: (r.metadata as Record<string, unknown>) ?? {},
    embedding: r.e_model
      ? { model: r.e_model as string, dimensions: Number(r.e_dimensions), status: r.e_status as string, version: Number(r.e_version), current: Number(r.e_version) === Number(r.version) && r.e_status === 'ready' }
      : null,
  };
}

export type MemoryFilters = {
  q?: string;
  namespaceIds?: string[];
  categoryIds?: string[];
  statuses?: MemoryStatus[];
  pinned?: boolean;
  locked?: boolean;
  sensitive?: boolean;
  active?: boolean;
  expiring?: 'expired' | 'soon' | 'never';
  sourceApplication?: string;
  sourceModel?: string;
  minImportance?: number;
  maxImportance?: number;
  minConfidence?: number;
  createdFrom?: string;
  createdTo?: string;
  accessedFrom?: string;
  accessedTo?: string;
  ids?: string[];
  sort?: 'created' | 'updated' | 'accessed' | 'importance' | 'confidence' | 'accessCount' | 'title' | 'expires';
  direction?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
};

const SORTS: Record<NonNullable<MemoryFilters['sort']>, string> = {
  created: 'm.created_at',
  updated: 'm.updated_at',
  accessed: 'm.last_accessed_at',
  importance: 'm.importance',
  confidence: 'm.confidence',
  accessCount: 'm.access_count',
  title: 'lower(m.title)',
  expires: 'm.expires_at',
};

// The Memory Library's query: every filter is a parameter, the sort a fixed column, never text from the request
export async function listMemories(f: MemoryFilters, embeddingModel: string): Promise<{ items: MemoryRecord[]; total: number }> {
  await ensureMemorySchema();
  const params: unknown[] = [embeddingModel];
  const where: string[] = [];
  const p = (v: unknown) => {
    params.push(v);
    return `$${params.length}`;
  };
  if (f.statuses?.length) where.push(`m.status = ANY(${p(f.statuses)}::text[])`);
  else where.push(`m.status <> 'Deleted'`);
  if (f.ids?.length) where.push(`m.id = ANY(${p(f.ids.filter(isUuid))}::uuid[])`);
  if (f.namespaceIds) where.push(`m.namespace_id = ANY(${p(f.namespaceIds.filter(isUuid))}::uuid[])`);
  if (f.categoryIds?.length) where.push(`m.category_id = ANY(${p(f.categoryIds.filter(isUuid))}::uuid[])`);
  if (typeof f.pinned === 'boolean') where.push(`m.is_pinned = ${p(f.pinned)}`);
  if (typeof f.locked === 'boolean') where.push(`m.is_locked = ${p(f.locked)}`);
  if (typeof f.sensitive === 'boolean') where.push(`m.is_sensitive = ${p(f.sensitive)}`);
  if (typeof f.active === 'boolean') where.push(`m.is_active = ${p(f.active)}`);
  if (f.expiring === 'expired') where.push(`m.expires_at IS NOT NULL AND m.expires_at <= now()`);
  if (f.expiring === 'soon') where.push(`m.expires_at > now() AND m.expires_at <= now() + interval '14 days'`);
  if (f.expiring === 'never') where.push(`m.expires_at IS NULL`);
  if (f.sourceApplication) where.push(`m.source_application = ${p(f.sourceApplication)}`);
  if (f.sourceModel) where.push(`m.source_model = ${p(f.sourceModel)}`);
  if (f.minImportance) where.push(`m.importance >= ${p(f.minImportance)}`);
  if (f.maxImportance) where.push(`m.importance <= ${p(f.maxImportance)}`);
  if (f.minConfidence !== undefined) where.push(`m.confidence >= ${p(f.minConfidence)}`);
  if (f.createdFrom) where.push(`m.created_at >= ${p(f.createdFrom)}::timestamptz`);
  if (f.createdTo) where.push(`m.created_at < ${p(f.createdTo)}::timestamptz`);
  if (f.accessedFrom) where.push(`m.last_accessed_at >= ${p(f.accessedFrom)}::timestamptz`);
  if (f.accessedTo) where.push(`m.last_accessed_at < ${p(f.accessedTo)}::timestamptz`);
  if (f.q?.trim()) {
    const q = f.q.trim().slice(0, LIMITS.query);
    where.push(`(m.search_tsv @@ websearch_to_tsquery('english', ${p(q)}) OR m.title ILIKE ${p(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`)} OR m.content ILIKE $${params.length})`);
  }
  const sort = SORTS[f.sort ?? 'updated'] ?? SORTS.updated;
  const dir = f.direction === 'asc' ? 'ASC' : 'DESC';
  const limit = Math.min(200, Math.max(1, f.limit ?? 50));
  const offset = Math.max(0, f.offset ?? 0);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows, count] = await Promise.all([
    query<Record<string, unknown>>(`${MEMORY_SELECT} ${whereSql} ORDER BY ${sort} ${dir} NULLS LAST, m.id LIMIT ${limit} OFFSET ${offset}`, params),
    query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_memory."Memories" m ${whereSql}`.replace(/\$(\d+)/g, (_, i) => `$${Number(i) - 1}`), params.slice(1)),
  ]);
  return { items: rows.map(toRecord), total: count[0]?.n ?? 0 };
}

export async function getMemory(id: string, embeddingModel: string, db: Db | null = null): Promise<MemoryRecord | null> {
  if (!isUuid(id)) return null;
  await ensureMemorySchema();
  const rows = await rowsOf<Record<string, unknown>>(db, `${MEMORY_SELECT} WHERE m.id = $2`, [embeddingModel, id]);
  return rows[0] ? toRecord(rows[0]) : null;
}

const snapshotOf = (m: MemoryRecord) => ({
  title: m.title,
  content: m.content,
  summary: m.summary,
  categoryId: m.categoryId,
  categoryKey: m.categoryKey,
  namespaceId: m.namespaceId,
  namespacePath: m.namespacePath,
  importance: m.importance,
  confidence: m.confidence,
  status: m.status,
  isPinned: m.isPinned,
  isLocked: m.isLocked,
  isActive: m.isActive,
  isSensitive: m.isSensitive,
  expiresAt: m.expiresAt,
  supersedesMemoryId: m.supersedesMemoryId,
});

async function writeHistory(db: Db, m: MemoryRecord, changeType: string, changed: string[], actor: Actor, reason?: string | null) {
  await db.query(
    `INSERT INTO ai_memory."MemoryHistory" (memory_id, version, change_type, snapshot, changed_fields, actor_user_id, actor_system, reason)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [m.id, m.version, changeType, JSON.stringify(snapshotOf(m)), changed, actor.userId, actor.system ?? (actor.clientId ? `client:${actor.clientId}` : null), reason?.slice(0, LIMITS.reason) ?? null]
  );
}

// The outbox entry for each secondary index: Mem0 is the only one today, and only while it's the intelligence
// provider (a provider switched on later is caught up by reconciliation)
async function outbox(db: Db, memoryId: string, operation: 'upsert' | 'delete', version: number, providers: string[]) {
  for (const provider of providers) {
    await db.query(`INSERT INTO ai_memory."MemoryProviderSync" (memory_id, provider, operation, memory_version) VALUES ($1, $2, $3, $4)`, [memoryId, provider, operation, version]);
  }
}

export async function enqueueJob(
  db: Db | null,
  type: 'extract' | 'embed' | 'reembed' | 'sync' | 'reconcile' | 'cleanup' | 'import' | 'export' | 'evaluate',
  payload: Record<string, unknown>,
  options: { idempotencyKey?: string | null; userId?: number | null; maxAttempts?: number; runAfter?: Date } = {}
): Promise<{ id: string; created: boolean }> {
  const rows = await rowsOf<{ id: string; created: boolean }>(
    db,
    `INSERT INTO ai_memory."MemoryJobs" (type, payload, idempotency_key, user_id, max_attempts, run_after)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (idempotency_key) DO UPDATE SET idempotency_key = EXCLUDED.idempotency_key
     RETURNING id, (xmax = 0) AS created`,
    [type, JSON.stringify(payload), options.idempotencyKey ?? null, options.userId ?? null, options.maxAttempts ?? 5, options.runAfter ?? new Date()]
  );
  return rows[0];
}

const syncProviders = (config: MemoryConfig) => (config.providers.intelligence === 'mem0' ? ['mem0'] : []);

export type CreateInput = {
  title?: string | null;
  content: string;
  summary?: string | null;
  namespaceId: string;
  categoryId: string;
  importance?: number;
  confidence?: number;
  isPinned?: boolean;
  isLocked?: boolean;
  isSensitive?: boolean;
  expiresAt?: string | null;
  sourceModel?: string | null;
  sourceConversationId?: string | null;
  sourceMessageId?: string | null;
  sourceApplication?: string;
  sourceType?: 'manual' | 'extraction' | 'import' | 'openWebuiMigration' | 'api' | 'merge';
  sourceReference?: string | null;
  supersedesMemoryId?: string | null;
  metadata?: Record<string, unknown>;
  status?: 'Active' | 'Pending' | 'Approved';
  ownerUserId?: number | null;
};

export class SecretContentError extends Error {}
export class TombstonedError extends Error {}

// A new memory. Automated sources (extraction, import, migration) are refused for anything that was permanently
// deleted (a tombstone with the same text), so nothing deleted comes back; a person typing it again may.
export async function createMemory(
  input: CreateInput,
  actor: Actor,
  options: { automated?: boolean; db?: Db } = {}
): Promise<{ memory: MemoryRecord; duplicate: boolean }> {
  await ensureMemorySchema();
  const config = await getConfig();
  const content = input.content?.replace(/\r\n/g, '\n').trim() ?? '';
  if (!content || content.length > LIMITS.content) throw new InputError('badContent');
  const title = (input.title?.trim() || titleFrom(content)).slice(0, LIMITS.title);
  const sensitive = detectSensitive(`${title}\n${content}`);
  if (sensitive.sensitivity === 'secret') throw new SecretContentError(sensitive.kinds.join(', '));
  if (!isUuid(input.namespaceId) || !isUuid(input.categoryId)) throw new InputError('badReference');
  if (input.metadata && JSON.stringify(input.metadata).length > LIMITS.metadataBytes) throw new InputError('metadataTooLarge');
  const hash = contentHash(content);
  const work = async (db: Db) => {
    if (options.automated) {
      const tomb = await db.query(`SELECT 1 FROM ai_memory."MemoryDeletions" WHERE content_hash = $1 AND (namespace_id = $2 OR namespace_id IS NULL)`, [hash, input.namespaceId]);
      if (tomb.rowCount) throw new TombstonedError('This memory was permanently deleted');
    }
    const existing = await db.query(`SELECT id FROM ai_memory."Memories" WHERE namespace_id = $1 AND content_hash = $2 AND status NOT IN ('Deleted', 'Rejected', 'Superseded')`, [input.namespaceId, hash]);
    if (existing.rowCount) return { memory: (await getMemory(existing.rows[0].id, config.providers.embeddingModel, db))!, duplicate: true };
    const cat = await db.query(`SELECT retention_rule, retention_days, default_importance FROM ai_memory."MemoryCategories" WHERE id = $1`, [input.categoryId]);
    if (!cat.rowCount) throw new InputError('badCategory');
    const ns = await db.query(`SELECT 1 FROM ai_memory."MemoryNamespaces" WHERE id = $1`, [input.namespaceId]);
    if (!ns.rowCount) throw new InputError('badNamespace');
    const expires =
      input.expiresAt !== undefined
        ? input.expiresAt
        : iso(defaultExpiry({ retentionRule: cat.rows[0].retention_rule, retentionDays: cat.rows[0].retention_days }));
    const status = input.status ?? 'Active';
    const r = await db.query(
      `INSERT INTO ai_memory."Memories" (user_id, namespace_id, category_id, title, content, summary, importance, confidence, source_model,
         source_conversation_id, source_message_id, source_application, source_type, source_reference, is_pinned, is_locked, is_active, is_sensitive,
         status, expires_at, supersedes_memory_id, content_hash, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23) RETURNING id`,
      [
        input.ownerUserId ?? actor.userId,
        input.namespaceId,
        input.categoryId,
        title,
        content,
        input.summary?.slice(0, LIMITS.summary) ?? null,
        Math.round(Math.min(10, Math.max(1, input.importance ?? Number(cat.rows[0].default_importance)))),
        Math.min(1, Math.max(0, input.confidence ?? 1)),
        input.sourceModel ?? null,
        input.sourceConversationId?.slice(0, 200) ?? null,
        input.sourceMessageId?.slice(0, 200) ?? null,
        (input.sourceApplication ?? 'memory-manager').slice(0, 60),
        input.sourceType ?? 'manual',
        input.sourceReference?.slice(0, 500) ?? null,
        input.isPinned === true,
        input.isLocked === true,
        status === 'Active',
        input.isSensitive === true || sensitive.sensitivity === 'personal',
        status,
        expires,
        input.supersedesMemoryId ?? null,
        hash,
        JSON.stringify(input.metadata ?? {}),
      ]
    );
    const memory = (await getMemory(r.rows[0].id, config.providers.embeddingModel, db))!;
    await writeHistory(db, memory, 'create', [], actor);
    await enqueueJob(db, 'embed', { memoryId: memory.id, version: memory.version }, { idempotencyKey: `embed:${memory.id}:${memory.version}:${config.providers.embeddingModel}` });
    if (status === 'Active') await outbox(db, memory.id, 'upsert', memory.version, syncProviders(config));
    return { memory, duplicate: false };
  };
  try {
    const result = options.db ? await work(options.db) : await transaction(work);
    if (!result.duplicate) await audit(actor, 'memory.create', result.memory.id, 'ok', { namespace: result.memory.namespacePath, category: result.memory.categoryKey, source: result.memory.sourceType });
    return result;
  } catch (error) {
    if ((error as { code?: string }).code === '23505') {
      const again = await query<{ id: string }>(`SELECT id FROM ai_memory."Memories" WHERE namespace_id = $1 AND content_hash = $2 AND status NOT IN ('Deleted', 'Rejected', 'Superseded')`, [input.namespaceId, hash]);
      if (again[0]) return { memory: (await getMemory(again[0].id, config.providers.embeddingModel))!, duplicate: true };
    }
    throw error;
  }
}

export type MemoryPatch = Partial<{
  title: string;
  content: string;
  summary: string | null;
  namespaceId: string;
  categoryId: string;
  importance: number;
  confidence: number;
  isPinned: boolean;
  isLocked: boolean;
  isActive: boolean;
  isSensitive: boolean;
  expiresAt: string | null;
  lastVerifiedAt: string | null;
  metadata: Record<string, unknown>;
  status: MemoryStatus;
  supersedesMemoryId: string | null;
}>;

const FIELD_COLUMNS: Record<string, string> = {
  title: 'title',
  content: 'content',
  summary: 'summary',
  namespaceId: 'namespace_id',
  categoryId: 'category_id',
  importance: 'importance',
  confidence: 'confidence',
  isPinned: 'is_pinned',
  isLocked: 'is_locked',
  isActive: 'is_active',
  isSensitive: 'is_sensitive',
  expiresAt: 'expires_at',
  lastVerifiedAt: 'last_verified_at',
  metadata: 'metadata',
  status: 'status',
  supersedesMemoryId: 'supersedes_memory_id',
};

// Any change to a memory. `expectedVersion` is the version the caller saw; automated callers (extraction,
// conflicts resolved by rule) pass automated: true and can't touch a locked memory, nor unlock one.
export async function updateMemory(
  id: string,
  patch: MemoryPatch,
  expectedVersion: number | null,
  actor: Actor,
  options: { automated?: boolean; changeType?: string; reason?: string | null; db?: Db } = {}
): Promise<MemoryRecord> {
  await ensureMemorySchema();
  const config = await getConfig();
  const work = async (db: Db) => {
    const locked = await db.query(`SELECT id FROM ai_memory."Memories" WHERE id = $1 FOR UPDATE`, [id]);
    if (!locked.rowCount) throw new NotFoundError('memory');
    const before = (await getMemory(id, config.providers.embeddingModel, db))!;
    if (before.status === 'Deleted' && patch.status !== undefined && patch.status !== 'Deleted') throw new TransitionError('A deleted memory stays deleted');
    if (expectedVersion !== null && expectedVersion !== before.version) throw new VersionConflictError(before.version);
    if (options.automated && before.isLocked) throw new LockedError('The memory is locked');
    const next: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) if (v !== undefined && k in FIELD_COLUMNS) next[k] = v;
    if (typeof next.content === 'string') {
      next.content = (next.content as string).trim();
      if (!next.content || (next.content as string).length > LIMITS.content) throw new InputError('badContent');
      const sensitive = detectSensitive(next.content as string);
      if (sensitive.sensitivity === 'secret') throw new SecretContentError(sensitive.kinds.join(', '));
      if (sensitive.sensitivity === 'personal') next.isSensitive = true;
    }
    if (typeof next.title === 'string') next.title = ((next.title as string).trim() || titleFrom((next.content as string) ?? before.content)).slice(0, LIMITS.title);
    if (next.importance !== undefined) next.importance = Math.round(Math.min(10, Math.max(1, Number(next.importance))));
    if (next.confidence !== undefined) next.confidence = Math.min(1, Math.max(0, Number(next.confidence)));
    if (next.namespaceId !== undefined && !isUuid(next.namespaceId)) throw new InputError('badNamespace');
    if (next.categoryId !== undefined && !isUuid(next.categoryId)) throw new InputError('badCategory');
    const status = (next.status as MemoryStatus | undefined) ?? before.status;
    if (!canTransition(before.status, status)) throw new TransitionError(`${before.status} → ${status} is not allowed`);
    // Leaving Active turns retrieval off; becoming Active turns it on unless the caller said otherwise
    if (status !== before.status) {
      if (!activeAllowed(status)) next.isActive = false;
      else if (next.isActive === undefined) next.isActive = true;
    }
    if (next.isActive === true && !activeAllowed(status)) throw new TransitionError('Only an Active memory can be retrieved');
    const changed = Object.keys(next).filter((k) => JSON.stringify((before as unknown as Record<string, unknown>)[k]) !== JSON.stringify(next[k]));
    if (!changed.length) return before;
    const contentChanged = changed.includes('content') || changed.includes('title');
    const cols = changed.map((k) => FIELD_COLUMNS[k]);
    const params: unknown[] = [id, ...changed.map((k) => (k === 'metadata' ? JSON.stringify(next[k]) : next[k]))];
    const extra = [`version = version + 1`, `updated_at = now()`];
    if (contentChanged) {
      params.push(contentHash((next.content as string) ?? before.content));
      extra.push(`content_hash = $${params.length}`);
    }
    if (status === 'Deleted') extra.push('deleted_at = now()');
    await db.query(`UPDATE ai_memory."Memories" SET ${cols.map((c, i) => `${c} = $${i + 2}`).join(', ')}, ${extra.join(', ')} WHERE id = $1`, params);
    const after = (await getMemory(id, config.providers.embeddingModel, db))!;
    await writeHistory(db, after, options.changeType ?? (status !== before.status ? `status:${status}` : 'update'), changed, actor, options.reason);
    if (contentChanged) {
      await db.query(`UPDATE ai_memory."MemoryEmbeddings" SET indexing_status = 'stale', updated_at = now() WHERE memory_id = $1`, [id]);
      await enqueueJob(db, 'embed', { memoryId: id, version: after.version }, { idempotencyKey: `embed:${id}:${after.version}:${config.providers.embeddingModel}` });
    }
    const providers = syncProviders(config);
    if (after.status === 'Active' && after.isActive) await outbox(db, id, 'upsert', after.version, providers);
    else if (before.status === 'Active' && before.isActive) await outbox(db, id, 'delete', after.version, providers);
    return after;
  };
  const after = options.db ? await work(options.db) : await transaction(work);
  await audit(actor, options.changeType ? `memory.${options.changeType}` : 'memory.update', id, 'ok', { version: after.version, fields: Object.keys(patch) });
  return after;
}

// Soft delete (status Deleted, kept until the purge) or permanent: the row and everything derived from it (history,
// embeddings, relationships, feedback, conflicts cascade), a tombstone so nothing brings it back, and the outbox
// entry that removes it from Mem0. A permanent delete is allowed whatever the operating mode.
export async function deleteMemory(id: string, actor: Actor, options: { permanent: boolean; reason: string }): Promise<{ deleted: boolean }> {
  await ensureMemorySchema();
  const config = await getConfig();
  if (!options.permanent) {
    const m = await getMemory(id, config.providers.embeddingModel);
    if (!m) throw new NotFoundError('memory');
    if (m.status === 'Deleted') return { deleted: false };
    await updateMemory(id, { status: 'Deleted' }, null, actor, { changeType: 'delete', reason: options.reason });
    return { deleted: true };
  }
  const done = await transaction(async (db) => {
    const r = await db.query(`SELECT id, namespace_id, content_hash, user_id, version FROM ai_memory."Memories" WHERE id = $1 FOR UPDATE`, [id]);
    if (!r.rowCount) return false;
    const m = r.rows[0];
    await db.query(
      `INSERT INTO ai_memory."MemoryDeletions" (memory_id, namespace_id, content_hash, user_id, reason) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (memory_id) DO NOTHING`,
      [id, m.namespace_id, m.content_hash, m.user_id, options.reason.slice(0, 200)]
    );
    await db.query(`DELETE FROM ai_memory."Memories" WHERE id = $1`, [id]);
    await db.query(`UPDATE ai_memory."MemoryAccessLog" SET memory_ids = array_remove(memory_ids, $1::uuid) WHERE $1::uuid = ANY(memory_ids)`, [id]);
    await db.query(`UPDATE ai_memory."MemoryEvaluationCases" SET expected_memory_ids = array_remove(expected_memory_ids, $1::uuid), excluded_memory_ids = array_remove(excluded_memory_ids, $1::uuid)`, [id]);
    // Pending sync of the old content is pointless now; the delete replaces it (for every provider it reached)
    await db.query(`UPDATE ai_memory."MemoryProviderSync" SET status = 'skipped', processed_at = now() WHERE memory_id = $1 AND status IN ('pending', 'failed')`, [id]);
    const reached = await db.query(`SELECT provider FROM ai_memory."MemoryProviderRecords" WHERE memory_id = $1`, [id]);
    await outbox(db, id, 'delete', Number(m.version) + 1, [...new Set([...reached.rows.map((x) => x.provider as string), ...syncProviders(config)])]);
    // Jobs still queued for it would find nothing; cancel them so they don't retry
    await db.query(`UPDATE ai_memory."MemoryJobs" SET status = 'Cancelled', finished_at = now(), error = 'memory deleted' WHERE status IN ('Pending', 'Deferred', 'Failed') AND payload->>'memoryId' = $1`, [id]);
    return true;
  });
  await audit(actor, 'memory.deletePermanent', id, done ? 'ok' : 'refused', { reason: options.reason });
  return { deleted: done };
}

export type HistoryEntry = { id: number; version: number; changeType: string; snapshot: Record<string, unknown>; changedFields: string[]; actor: string | null; reason: string | null; at: string };

export async function readHistory(id: string): Promise<HistoryEntry[]> {
  await ensureMemorySchema();
  if (!isUuid(id)) return [];
  const rows = await query<Record<string, unknown>>(
    `SELECT h.*, u.user_name FROM ai_memory."MemoryHistory" h LEFT JOIN racingcoach."Users" u ON u.id = h.actor_user_id
     WHERE h.memory_id = $1 ORDER BY h.version DESC, h.id DESC LIMIT 200`,
    [id]
  );
  return rows.map((r) => ({
    id: Number(r.id),
    version: Number(r.version),
    changeType: r.change_type as string,
    snapshot: r.snapshot as Record<string, unknown>,
    changedFields: (r.changed_fields as string[]) ?? [],
    actor: (r.user_name as string) ?? (r.actor_system as string) ?? null,
    reason: (r.reason as string) ?? null,
    at: iso(r.created_at as Date)!,
  }));
}

// Restoring a version writes it again as the newest version (history is never rewritten), and re-embeds it
export async function restoreVersion(id: string, version: number, expectedVersion: number, actor: Actor): Promise<MemoryRecord> {
  const entry = (await readHistory(id)).find((h) => h.version === version);
  if (!entry) throw new NotFoundError('version');
  const s = entry.snapshot as Record<string, unknown>;
  return updateMemory(
    id,
    {
      title: s.title as string,
      content: s.content as string,
      summary: (s.summary as string) ?? null,
      categoryId: s.categoryId as string,
      namespaceId: s.namespaceId as string,
      importance: Number(s.importance),
      confidence: Number(s.confidence),
      expiresAt: (s.expiresAt as string) ?? null,
    },
    expectedVersion,
    actor,
    { changeType: 'restore', reason: `Restored version ${version}` }
  );
}

// ---- Relationships ----

export type Relationship = { id: string; fromId: string; toId: string; type: RelationshipType; origin: string; status: string; note: string; createdAt: string };

export async function listRelationships(memoryIds?: string[]): Promise<Relationship[]> {
  await ensureMemorySchema();
  const rows = await query<Record<string, unknown>>(
    memoryIds
      ? `SELECT * FROM ai_memory."MemoryRelationships" WHERE from_memory_id = ANY($1::uuid[]) OR to_memory_id = ANY($1::uuid[]) ORDER BY created_at DESC LIMIT 2000`
      : `SELECT * FROM ai_memory."MemoryRelationships" ORDER BY created_at DESC LIMIT 2000`,
    memoryIds ? [memoryIds.filter(isUuid)] : []
  );
  return rows.map((r) => ({ id: r.id as string, fromId: r.from_memory_id as string, toId: r.to_memory_id as string, type: r.type as RelationshipType, origin: r.origin as string, status: r.status as string, note: r.note as string, createdAt: iso(r.created_at as Date)! }));
}

export async function addRelationship(input: { fromId: string; toId: string; type: RelationshipType; note?: string; origin?: 'manual' | 'ai' | 'system' }, actor: Actor, db: Db | null = null): Promise<Relationship | null> {
  await ensureMemorySchema();
  if (!isUuid(input.fromId) || !isUuid(input.toId) || input.fromId === input.toId) throw new InputError('badRelationship');
  const origin = input.origin ?? 'manual';
  const rows = await rowsOf<{ id: string }>(
    db,
    `INSERT INTO ai_memory."MemoryRelationships" (from_memory_id, to_memory_id, type, origin, status, note, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (from_memory_id, to_memory_id, type) DO NOTHING RETURNING id`,
    [input.fromId, input.toId, input.type, origin, origin === 'ai' ? 'proposed' : 'active', (input.note ?? '').slice(0, 500), actor.userId]
  );
  if (!rows[0]) return null;
  if (!db) await audit(actor, 'relationship.create', rows[0].id, 'ok', { type: input.type, origin });
  return (await listRelationships([input.fromId])).find((r) => r.id === rows[0].id) ?? null;
}

export async function updateRelationship(id: string, status: 'active' | 'rejected' | 'deleted', actor: Actor): Promise<void> {
  await ensureMemorySchema();
  if (status === 'deleted') await query(`DELETE FROM ai_memory."MemoryRelationships" WHERE id = $1`, [id]);
  else await query(`UPDATE ai_memory."MemoryRelationships" SET status = $2 WHERE id = $1`, [id, status]);
  await audit(actor, `relationship.${status}`, id, 'ok');
}

// ---- Audit ----

export async function audit(actor: Actor, action: string, target: string | null | undefined, outcome: 'ok' | 'refused' | 'failed', detail?: Record<string, unknown>): Promise<void> {
  try {
    await ensureMemorySchema();
    await query(
      `INSERT INTO ai_memory."MemoryAuditLog" (request_id, actor_user_id, actor_client_id, action, target, outcome, detail) VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [actor.requestId ?? null, actor.userId, actor.clientId ?? null, action, target?.slice(0, 200) ?? null, outcome, detail ? JSON.stringify(detail).slice(0, 8000) : null]
    );
  } catch (error) {
    console.error('Failed to write the memory audit log:', error);
  }
}

export async function readAudit(f: { action?: string; target?: string; limit?: number; offset?: number }) {
  await ensureMemorySchema();
  const params: unknown[] = [];
  const where: string[] = [];
  if (f.action) {
    params.push(`${f.action}%`);
    where.push(`a.action LIKE $${params.length}`);
  }
  if (f.target) {
    params.push(f.target);
    where.push(`a.target = $${params.length}`);
  }
  const limit = Math.min(500, Math.max(1, f.limit ?? 100));
  const rows = await query<Record<string, unknown>>(
    `SELECT a.*, u.user_name, c.name AS client_name FROM ai_memory."MemoryAuditLog" a
     LEFT JOIN racingcoach."Users" u ON u.id = a.actor_user_id LEFT JOIN ai_memory."MemoryApiClients" c ON c.id = a.actor_client_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY a.at DESC LIMIT ${limit} OFFSET ${Math.max(0, f.offset ?? 0)}`,
    params
  );
  return rows.map((r) => ({
    id: Number(r.id),
    at: iso(r.at as Date)!,
    requestId: (r.request_id as string) ?? null,
    actor: (r.user_name as string) ?? (r.client_name ? `API: ${r.client_name}` : null),
    action: r.action as string,
    target: (r.target as string) ?? null,
    outcome: r.outcome as string,
    detail: r.detail ?? null,
  }));
}
