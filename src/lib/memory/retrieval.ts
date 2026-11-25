import { createHash } from 'node:crypto';
import { query, transaction } from '@/lib/db';
import { cosine, EMBEDDING_VERSION, embedTexts, vectorLiteral, activeSpec } from './embeddings';
import { OfflineError } from './localServices';
import { rank, type RankInput, type RankMode, type Scored } from './ranking';
import { parseRetrieval, type MemoryConfig, type MemoryStatus, type RetrievalParams } from './rules';
import { ensureMemorySchema, vectorAvailable, vectorIndexName } from './schema';
import { getConfig } from './store';

// The retrieval engine (docs/AI_MEMORY_ARCHITECTURE.md, Retrieval). The caller has already authenticated and
// resolved the namespaces it may read (api.ts, resolveNamespaces); nothing here widens them. Candidates come from
// semantic search (pgvector's HNSW index on this model's embeddings, or cosine in memory without pgvector) and
// keyword search (Postgres full text), then ranking.ts decides. When Ollama can't embed the query, retrieval
// carries on with keywords only and says so (degraded).

const CANDIDATES = 60;
const IN_MEMORY_LIMIT = 5_000;

export type RetrieveRequest = {
  query: string;
  namespaceIds: string[];
  mode?: RankMode;
  params?: Partial<RetrievalParams>;
  profileId?: string | null;
  categoryKeys?: string[];
  includeSensitive?: boolean;
  client: string;
  userId: number | null;
  requestId?: string | null;
  inspector?: boolean;
  record?: boolean;
  model?: string | null;
  // Who is asking, for the owner check in SQL: a user's own space is read only by that user, or by an Admin who
  // named it (override). Without it, no user-owned memory is ever returned.
  owner?: { actingUserId: number | null; override: boolean };
};

// The owner check, a second line behind namespace resolution: appended to every retrieval query. A user's own space
// is returned only to that user, and only while they have AI Memory turned on (consent.ts); an Admin naming the space
// (override, audited) still sees it, e.g. to answer a privacy request.
function ownerGuard(owner: RetrieveRequest['owner'], params: unknown[]): string {
  if (owner?.override) return '';
  params.push(owner?.actingUserId ?? null);
  return ` AND (n.owner_user_id IS NULL OR (n.owner_user_id = $${params.length}::int
    AND EXISTS (SELECT 1 FROM racingcoach."Users" consent WHERE consent.id = n.owner_user_id AND consent.ai_memory_opt_in_at IS NOT NULL)))`;
}

export type RetrieveResult = {
  context: string;
  memories: Scored[];
  excluded: Scored[];
  candidates: number;
  tokens: number;
  mode: RankMode;
  degraded: string | null;
  embeddingModel: string | null;
  rankingVersion: string;
  params: RetrievalParams;
  profile: { id: string; name: string } | null;
  timings: { totalMs: number; embedMs: number | null; semanticMs: number | null; keywordMs: number | null };
  accessLogId: number | null;
};

type Row = Record<string, unknown>;

const SELECT = `
  SELECT m.id, m.title, m.content, m.importance, m.confidence, m.is_pinned, m.is_active, m.is_sensitive, m.status, m.expires_at,
         m.updated_at, m.last_verified_at, m.content_hash, c.key AS category_key, c.name AS category_name, n.path AS namespace_path
  FROM ai_memory."Memories" m
  JOIN ai_memory."MemoryCategories" c ON c.id = m.category_id
  JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id`;

// What normal retrieval may ever see; the inspector also looks at the rest of the authorized namespaces (archived,
// expired, turned off) to show why they were left out
const retrievable = (alias = 'm') => `${alias}.status = 'Active' AND ${alias}.is_active AND (${alias}.expires_at IS NULL OR ${alias}.expires_at > now())`;
const inspectable = (alias = 'm') => `${alias}.status IN ('Active', 'Approved', 'Archived', 'Expired', 'Superseded')`;

function toInput(r: Row, semantic: number | null, keyword: number | null): RankInput {
  return {
    id: r.id as string,
    title: r.title as string,
    content: r.content as string,
    categoryKey: r.category_key as string,
    categoryName: r.category_name as string,
    namespacePath: r.namespace_path as string,
    importance: Number(r.importance),
    confidence: Number(r.confidence),
    isPinned: r.is_pinned as boolean,
    isActive: r.is_active as boolean,
    isSensitive: r.is_sensitive as boolean,
    status: r.status as MemoryStatus,
    expiresAt: r.expires_at ? new Date(r.expires_at as Date).toISOString() : null,
    updatedAt: new Date(r.updated_at as Date).toISOString(),
    lastVerifiedAt: r.last_verified_at ? new Date(r.last_verified_at as Date).toISOString() : null,
    contentHash: r.content_hash as string,
    semantic,
    keyword,
  };
}

// Words joined with OR, so a natural question finds memories sharing any of its words; ranked by ts_rank_cd
export function keywordQuery(text: string): string | null {
  const words = [...new Set(text.toLowerCase().normalize('NFKC').match(/[\p{L}\p{N}]{2,}/gu) ?? [])].slice(0, 32);
  return words.length ? words.map((w) => `'${w.replace(/'/g, '')}'`).join(' | ') : null;
}

export async function resolveProfile(config: MemoryConfig, profileId: string | null | undefined, context: { client: string; namespaceIds: string[]; model?: string | null }) {
  const profiles = await query<{ id: string; name: string; params: unknown; applies_to: { models?: string[]; applications?: string[]; namespaces?: string[] } }>(
    `SELECT id, name, params, applies_to FROM ai_memory."MemoryRetrievalProfiles"`
  );
  const pick =
    (profileId && profiles.find((p) => p.id === profileId)) ||
    (context.model && profiles.find((p) => p.applies_to?.models?.includes(context.model!))) ||
    profiles.find((p) => p.applies_to?.applications?.includes(context.client)) ||
    profiles.find((p) => p.applies_to?.namespaces?.some((n) => context.namespaceIds.includes(n))) ||
    (config.system.activeProfileId && profiles.find((p) => p.id === config.system.activeProfileId)) ||
    null;
  return pick ? { profile: { id: pick.id, name: pick.name }, params: parseRetrieval(pick.params) } : { profile: null, params: config.retrieval };
}

export async function retrieve(req: RetrieveRequest): Promise<RetrieveResult> {
  const started = Date.now();
  await ensureMemorySchema();
  const config = await getConfig();
  const resolved = await resolveProfile(config, req.profileId, { client: req.client, namespaceIds: req.namespaceIds, model: req.model });
  const params = parseRetrieval({ ...resolved.params, ...(req.params ?? {}), weights: { ...resolved.params.weights, ...(req.params?.weights ?? {}) } });
  const requestedMode: RankMode = req.mode ?? 'hybrid';
  const timings = { totalMs: 0, embedMs: null as number | null, semanticMs: null as number | null, keywordMs: null as number | null };
  const empty = (degraded: string | null): RetrieveResult => ({
    context: '',
    memories: [],
    excluded: [],
    candidates: 0,
    tokens: 0,
    mode: requestedMode,
    degraded,
    embeddingModel: null,
    rankingVersion: 'rank-v1',
    params,
    profile: resolved.profile,
    timings: { ...timings, totalMs: Date.now() - started },
    accessLogId: null,
  });
  if (!config.system.enabled) return empty('memoryDisabled');
  if (!req.namespaceIds.length) return empty('noNamespaces');
  const text = req.query.trim().slice(0, 2000);
  const filter = req.inspector ? inspectable() : retrievable();
  const categoryFilter = req.categoryKeys?.length ? ` AND c.key = ANY($CAT::text[])` : '';
  const withCat = (sql: string, params2: unknown[]): { sql: string; params: unknown[] } => {
    if (!req.categoryKeys?.length) return { sql, params: params2 };
    params2.push(req.categoryKeys);
    return { sql: sql.replace('$CAT', `$${params2.length}`), params: params2 };
  };

  // 1. The query's embedding
  const spec = activeSpec(config.providers);
  let vector: number[] | null = null;
  let degraded: string | null = null;
  let mode = requestedMode;
  if (mode !== 'keyword' && text) {
    try {
      const e = await embedTexts(spec, [text], config.providers);
      vector = e.vectors[0];
      timings.embedMs = e.ms;
    } catch (error) {
      degraded = error instanceof OfflineError ? `embeddingUnavailable:${error.reason}` : 'embeddingFailed';
      mode = 'keyword';
    }
  }

  const found = new Map<string, { row: Row; semantic: number | null; keyword: number | null }>();

  // 2. Semantic candidates, from this model's embeddings of the memory's current version only
  if (vector) {
    const t = Date.now();
    const dims = vector.length;
    const useIndex = (await vectorAvailable()) && dims <= 2000;
    if (useIndex) {
      const index = vectorIndexName(spec.model, dims);
      const hasIndex = (await query(`SELECT 1 FROM pg_indexes WHERE schemaname = 'ai_memory' AND indexname = $1`, [index])).length > 0;
      const rows = await transaction(async (db) => {
        // pgvector 0.8's iterative scan keeps an HNSW search going until enough rows pass the namespace filter
        if (hasIndex) await db.query(`SET LOCAL hnsw.iterative_scan = relaxed_order`).catch(() => undefined);
        const q = withCat(
          `${SELECT}
           JOIN ai_memory."MemoryEmbeddings" e ON e.memory_id = m.id AND e.model = $2 AND e.dimensions = ${dims} AND e.indexing_status = 'ready'
             AND e.embedding_version = $3 AND e.memory_version = m.version
           WHERE ${filter} AND m.namespace_id = ANY($4::uuid[])${categoryFilter}$OWNER
           ORDER BY (e.embedding::vector(${dims})) <=> ($1::vector(${dims})) LIMIT ${CANDIDATES}`,
          [vectorLiteral(vector), spec.model, EMBEDDING_VERSION, req.namespaceIds]
        );
        q.sql = q.sql.replace('$OWNER', ownerGuard(req.owner, q.params));
        const r = await db.query(q.sql.replace('SELECT m.id,', `SELECT 1 - ((e.embedding::vector(${dims})) <=> ($1::vector(${dims}))) AS similarity, m.id,`), q.params);
        return r.rows as Row[];
      });
      for (const r of rows) found.set(r.id as string, { row: r, semantic: Number(r.similarity), keyword: null });
    } else {
      const q = withCat(
        `${SELECT.replace('SELECT m.id,', 'SELECT e.embedding, m.id,')}
         JOIN ai_memory."MemoryEmbeddings" e ON e.memory_id = m.id AND e.model = $1 AND e.dimensions = $2 AND e.indexing_status = 'ready'
           AND e.embedding_version = $3 AND e.memory_version = m.version
         WHERE ${filter} AND m.namespace_id = ANY($4::uuid[])${categoryFilter}$OWNER LIMIT ${IN_MEMORY_LIMIT}`,
        [spec.model, dims, EMBEDDING_VERSION, req.namespaceIds]
      );
      q.sql = q.sql.replace('$OWNER', ownerGuard(req.owner, q.params));
      const rows = await query<Row>(q.sql, q.params);
      rows
        .map((r) => ({ r, s: cosine(vector!, r.embedding as number[]) }))
        .sort((a, b) => b.s - a.s)
        .slice(0, CANDIDATES)
        .forEach(({ r, s }) => found.set(r.id as string, { row: r, semantic: s, keyword: null }));
    }
    timings.semanticMs = Date.now() - t;
  }

  // 3. Keyword candidates
  const tsq = keywordQuery(text);
  if (tsq && mode !== 'semantic') {
    const t = Date.now();
    const q = withCat(
      `${SELECT.replace('SELECT m.id,', `SELECT ts_rank_cd(m.search_tsv, to_tsquery('english', $1)) AS kw, m.id,`)}
       WHERE ${filter} AND m.namespace_id = ANY($2::uuid[]) AND m.search_tsv @@ to_tsquery('english', $1)${categoryFilter}$OWNER
       ORDER BY kw DESC LIMIT ${CANDIDATES}`,
      [tsq, req.namespaceIds]
    );
    q.sql = q.sql.replace('$OWNER', ownerGuard(req.owner, q.params));
    const rows = await query<Row>(q.sql, q.params).catch((error) => {
      console.warn('Memory keyword search failed:', error instanceof Error ? error.message : error);
      return [] as Row[];
    });
    for (const r of rows) {
      const prior = found.get(r.id as string);
      if (prior) prior.keyword = Number(r.kw);
      else found.set(r.id as string, { row: r, semantic: null, keyword: Number(r.kw) });
    }
    timings.keywordMs = Date.now() - t;
  }

  // 4. Pinned memories are always candidates (they still need to be relevant enough, and fit)
  const pinnedParams: unknown[] = [req.namespaceIds];
  const pinnedOwner = ownerGuard(req.owner, pinnedParams);
  const pinned = await query<Row>(`${SELECT} WHERE ${filter} AND m.is_pinned AND m.namespace_id = ANY($1::uuid[])${pinnedOwner} LIMIT 50`, pinnedParams);
  for (const r of pinned) if (!found.has(r.id as string)) found.set(r.id as string, { row: r, semantic: null, keyword: null });
  // A pinned memory found only by being pinned gets its similarity here when there's a query vector
  if (vector) {
    const missing = [...found.values()].filter((f) => f.semantic === null).map((f) => f.row.id as string);
    if (missing.length) {
      const rows = await query<{ memory_id: string; embedding: number[] }>(
        `SELECT e.memory_id, e.embedding FROM ai_memory."MemoryEmbeddings" e JOIN ai_memory."Memories" m ON m.id = e.memory_id
         WHERE e.memory_id = ANY($1::uuid[]) AND e.model = $2 AND e.dimensions = $3 AND e.indexing_status = 'ready' AND e.memory_version = m.version`,
        [missing, spec.model, vector.length]
      );
      for (const r of rows) found.get(r.memory_id)!.semantic = cosine(vector, r.embedding);
    }
  }

  const inputs = [...found.values()].map((f) => toInput(f.row, f.semantic, f.keyword));
  const ranked = rank(inputs, params, { mode, includeSensitive: req.includeSensitive });
  timings.totalMs = Date.now() - started;
  const result: RetrieveResult = {
    context: ranked.context,
    memories: ranked.selected,
    excluded: ranked.scored.filter((s) => s.excluded),
    candidates: inputs.length,
    tokens: ranked.tokens,
    mode,
    degraded,
    embeddingModel: vector ? spec.model : null,
    rankingVersion: ranked.version,
    params,
    profile: resolved.profile,
    timings,
    accessLogId: null,
  };
  if (req.record !== false) result.accessLogId = await recordAccess(req, result);
  return result;
}

// Analytics keep a hash of the query, never its text; an inspector run doesn't count as a memory being used
async function recordAccess(req: RetrieveRequest, r: RetrieveResult): Promise<number | null> {
  try {
    const ids = r.memories.map((m) => m.id);
    const rows = await query<{ id: string }>(
      `INSERT INTO ai_memory."MemoryAccessLog" (request_id, client, user_id, namespace_ids, query_hash, profile_id, ranking_version, mode, degraded,
         embedding_model, candidates, returned, tokens, latency_ms, embed_ms, semantic_ms, keyword_ms, memory_ids, inspector)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19) RETURNING id`,
      [
        req.requestId ?? null,
        req.client.slice(0, 60),
        req.userId,
        req.namespaceIds,
        createHash('sha256').update(req.query).digest('hex').slice(0, 32),
        r.profile?.id ?? null,
        r.rankingVersion,
        r.mode,
        r.degraded,
        r.embeddingModel,
        r.candidates,
        r.memories.length,
        r.tokens,
        r.timings.totalMs,
        r.timings.embedMs,
        r.timings.semanticMs,
        r.timings.keywordMs,
        ids,
        req.inspector === true,
      ]
    );
    if (ids.length && !req.inspector) {
      await query(`UPDATE ai_memory."Memories" SET access_count = access_count + 1, last_accessed_at = now() WHERE id = ANY($1::uuid[])`, [ids]);
    }
    return Number(rows[0].id);
  } catch (error) {
    console.error('Failed to record a memory retrieval:', error);
    return null;
  }
}

// Similar memories to a text (duplicate and conflict detection), in the given namespaces, active or not yet
// approved but never deleted or rejected
export async function similarMemories(text: string, namespaceIds: string[], limit = 8, owner?: RetrieveRequest['owner']): Promise<{ id: string; title: string; content: string; similarity: number; isLocked: boolean; namespaceId: string; version: number; updatedAt: string; confidence: number }[]> {
  await ensureMemorySchema();
  const config = await getConfig();
  const spec = activeSpec(config.providers);
  const { vectors } = await embedTexts(spec, [text], config.providers);
  const v = vectors[0];
  const simParams: unknown[] = [spec.model, v.length, namespaceIds];
  const rows = await query<Row>(
    `SELECT m.id, m.title, m.content, m.is_locked, m.namespace_id, m.version, m.updated_at, m.confidence, e.embedding
     FROM ai_memory."Memories" m JOIN ai_memory."MemoryEmbeddings" e ON e.memory_id = m.id AND e.model = $1 AND e.dimensions = $2 AND e.indexing_status = 'ready'
     JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id
     WHERE m.status IN ('Active', 'Approved', 'Pending') AND m.namespace_id = ANY($3::uuid[])$OWNER LIMIT ${IN_MEMORY_LIMIT}`.replace('$OWNER', ownerGuard(owner, simParams)),
    simParams
  );
  return rows
    .map((r) => ({
      id: r.id as string,
      title: r.title as string,
      content: r.content as string,
      similarity: cosine(v, r.embedding as number[]),
      isLocked: r.is_locked as boolean,
      namespaceId: r.namespace_id as string,
      version: Number(r.version),
      updatedAt: new Date(r.updated_at as Date).toISOString(),
      confidence: Number(r.confidence),
    }))
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, limit);
}
