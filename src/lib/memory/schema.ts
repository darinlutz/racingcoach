import { createHash } from 'node:crypto';
import { query } from '@/lib/db';
import { ensureUserSchema } from '@/lib/users';
import { DEFAULT_CATEGORIES, DEFAULT_NAMESPACES, parentPath } from './rules';

// The Clarivex Memory Service's tables (docs/AI_MEMORY_ARCHITECTURE.md, Database), in their own schema, ai_memory,
// in the site's database. Created on first use, additive only (IF NOT EXISTS), like the AI Lab's, so nothing here
// can stop the site; not part of ensureUserSchema. Every row tied to a person references racingcoach."Users" with
// ON DELETE CASCADE, so Delete Account removes their memories, history, embeddings and logs.
//
// Embeddings are REAL[] (the source of truth, readable without any extension). When pgvector is installed, each
// embedding model gets its own partial HNSW index on the expression embedding::vector(dims) (ensureVectorIndex), so
// models of different dimensions live side by side and a new model's index is built before retrieval switches to it.

export const MEMORY_SCHEMA = [
  `CREATE SCHEMA IF NOT EXISTS ai_memory`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryNamespaces" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     parent_id UUID REFERENCES ai_memory."MemoryNamespaces"(id) ON DELETE CASCADE,
     path TEXT NOT NULL UNIQUE,
     name TEXT NOT NULL,
     kind TEXT NOT NULL CHECK (kind IN ('personal', 'application', 'project', 'admin', 'organization', 'global', 'experiment')),
     tenant_id TEXT NOT NULL DEFAULT 'clarivex',
     owner_user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     description TEXT NOT NULL DEFAULT '',
     is_customer_data BOOLEAN NOT NULL DEFAULT false,
     global_approved BOOLEAN NOT NULL DEFAULT false,
     enabled BOOLEAN NOT NULL DEFAULT true,
     mode TEXT CHECK (mode IN ('disabled', 'readOnly', 'manual', 'approvalRequired', 'hybrid', 'automatic')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CHECK (kind = 'global' OR NOT global_approved),
     -- A user's own space is always customer data, never a shared global
     CONSTRAINT namespaces_owned_customer CHECK (owner_user_id IS NULL OR (is_customer_data AND kind <> 'global'))
   )`,
  `CREATE INDEX IF NOT EXISTS memory_namespaces_owner ON ai_memory."MemoryNamespaces" (owner_user_id) WHERE owner_user_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryCategories" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     key TEXT NOT NULL UNIQUE CHECK (key ~ '^[a-z][a-zA-Z0-9]{1,39}$'),
     name TEXT NOT NULL,
     description TEXT NOT NULL DEFAULT '',
     example TEXT NOT NULL DEFAULT '',
     color TEXT NOT NULL DEFAULT '#64748b' CHECK (color ~ '^#[0-9a-fA-F]{6}$'),
     icon TEXT NOT NULL DEFAULT 'Tag',
     default_importance SMALLINT NOT NULL DEFAULT 5 CHECK (default_importance BETWEEN 1 AND 10),
     retention_rule TEXT NOT NULL DEFAULT 'untilChanged' CHECK (retention_rule IN ('untilChanged', 'days', 'untilSuperseded', 'untilCompleted', 'configurable', 'followsRelated')),
     retention_days INTEGER CHECK (retention_days IS NULL OR retention_days > 0),
     extraction_eligible BOOLEAN NOT NULL DEFAULT true,
     requires_approval BOOLEAN NOT NULL DEFAULT true,
     auto_update TEXT NOT NULL DEFAULT 'propose' CHECK (auto_update IN ('never', 'propose', 'automatic')),
     mode TEXT CHECK (mode IN ('disabled', 'readOnly', 'manual', 'approvalRequired', 'hybrid', 'automatic')),
     enabled BOOLEAN NOT NULL DEFAULT true,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ai_memory."Memories" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     tenant_id TEXT NOT NULL DEFAULT 'clarivex',
     -- Namespaces are only ever deleted with the account that owns them, taking that user's memories along
     namespace_id UUID NOT NULL REFERENCES ai_memory."MemoryNamespaces"(id) ON DELETE CASCADE,
     category_id UUID NOT NULL REFERENCES ai_memory."MemoryCategories"(id) ON DELETE RESTRICT,
     title TEXT NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
     content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
     summary TEXT CHECK (summary IS NULL OR length(summary) <= 1000),
     importance SMALLINT NOT NULL DEFAULT 5 CHECK (importance BETWEEN 1 AND 10),
     confidence REAL NOT NULL DEFAULT 1 CHECK (confidence BETWEEN 0 AND 1),
     source_model TEXT,
     source_conversation_id TEXT,
     source_message_id TEXT,
     source_application TEXT NOT NULL DEFAULT 'memory-manager',
     source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('manual', 'extraction', 'import', 'openWebuiMigration', 'api', 'merge')),
     source_reference TEXT,
     is_pinned BOOLEAN NOT NULL DEFAULT false,
     is_locked BOOLEAN NOT NULL DEFAULT false,
     is_active BOOLEAN NOT NULL DEFAULT false,
     is_sensitive BOOLEAN NOT NULL DEFAULT false,
     status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Active', 'Archived', 'Superseded', 'Expired', 'Rejected', 'Deleted')),
     version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_accessed_at TIMESTAMPTZ,
     last_verified_at TIMESTAMPTZ,
     expires_at TIMESTAMPTZ,
     deleted_at TIMESTAMPTZ,
     access_count INTEGER NOT NULL DEFAULT 0,
     supersedes_memory_id UUID REFERENCES ai_memory."Memories"(id) ON DELETE SET NULL,
     content_hash TEXT NOT NULL,
     metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
     search_tsv tsvector GENERATED ALWAYS AS (to_tsvector('english', title || ' ' || content || ' ' || coalesce(summary, ''))) STORED,
     CONSTRAINT memories_active_status CHECK (NOT is_active OR status = 'Active'),
     CONSTRAINT memories_deleted_at CHECK ((status = 'Deleted') = (deleted_at IS NOT NULL))
   )`,
  // Defense in depth for per-user memory: a memory in a user's own namespace always belongs to that user, whoever
  // wrote it (an Admin, an import, extraction), so Delete Account's cascade and the privacy export find it, and it
  // can't be moved into someone else's space without becoming theirs
  `CREATE OR REPLACE FUNCTION ai_memory.memories_owner() RETURNS trigger LANGUAGE plpgsql AS $$
   DECLARE owner INTEGER;
   BEGIN
     SELECT owner_user_id INTO owner FROM ai_memory."MemoryNamespaces" WHERE id = NEW.namespace_id;
     IF owner IS NOT NULL THEN NEW.user_id := owner; END IF;
     RETURN NEW;
   END $$`,
  `DROP TRIGGER IF EXISTS memories_owner ON ai_memory."Memories"`,
  `CREATE TRIGGER memories_owner BEFORE INSERT OR UPDATE OF namespace_id, user_id ON ai_memory."Memories" FOR EACH ROW EXECUTE FUNCTION ai_memory.memories_owner()`,
  `CREATE INDEX IF NOT EXISTS memories_namespace_status ON ai_memory."Memories" (namespace_id, status) WHERE status <> 'Deleted'`,
  `CREATE INDEX IF NOT EXISTS memories_retrievable ON ai_memory."Memories" (namespace_id) WHERE status = 'Active' AND is_active`,
  `CREATE INDEX IF NOT EXISTS memories_tsv ON ai_memory."Memories" USING gin (search_tsv)`,
  `CREATE INDEX IF NOT EXISTS memories_expires ON ai_memory."Memories" (expires_at) WHERE expires_at IS NOT NULL AND status = 'Active'`,
  `CREATE INDEX IF NOT EXISTS memories_created ON ai_memory."Memories" (created_at DESC)`,
  // One live memory per text per namespace: a duplicate create answers the existing one
  `CREATE UNIQUE INDEX IF NOT EXISTS memories_unique_content ON ai_memory."Memories" (namespace_id, content_hash) WHERE status NOT IN ('Deleted', 'Rejected', 'Superseded')`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryEmbeddings" (
     id BIGSERIAL PRIMARY KEY,
     memory_id UUID NOT NULL REFERENCES ai_memory."Memories"(id) ON DELETE CASCADE,
     memory_version INTEGER NOT NULL,
     provider TEXT NOT NULL,
     model TEXT NOT NULL,
     dimensions INTEGER NOT NULL CHECK (dimensions BETWEEN 8 AND 8192),
     embedding_version TEXT NOT NULL DEFAULT 'v1',
     embedding REAL[] NOT NULL,
     indexing_status TEXT NOT NULL DEFAULT 'ready' CHECK (indexing_status IN ('ready', 'stale', 'failed')),
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CHECK (cardinality(embedding) = dimensions),
     UNIQUE (memory_id, model, embedding_version)
   )`,
  `CREATE INDEX IF NOT EXISTS memory_embeddings_model ON ai_memory."MemoryEmbeddings" (model, dimensions) WHERE indexing_status = 'ready'`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryHistory" (
     id BIGSERIAL PRIMARY KEY,
     memory_id UUID NOT NULL REFERENCES ai_memory."Memories"(id) ON DELETE CASCADE,
     version INTEGER NOT NULL,
     change_type TEXT NOT NULL,
     snapshot JSONB NOT NULL,
     changed_fields TEXT[] NOT NULL DEFAULT '{}',
     actor_user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     actor_system TEXT,
     reason TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS memory_history_memory ON ai_memory."MemoryHistory" (memory_id, version DESC)`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryJobs" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     type TEXT NOT NULL CHECK (type IN ('extract', 'embed', 'reembed', 'sync', 'reconcile', 'cleanup', 'import', 'export', 'evaluate')),
     status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Running', 'Completed', 'Failed', 'Deferred', 'Cancelled')),
     user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     payload JSONB NOT NULL DEFAULT '{}'::jsonb,
     idempotency_key TEXT UNIQUE,
     attempts INTEGER NOT NULL DEFAULT 0,
     max_attempts INTEGER NOT NULL DEFAULT 5,
     run_after TIMESTAMPTZ NOT NULL DEFAULT now(),
     locked_at TIMESTAMPTZ,
     locked_by TEXT,
     progress REAL NOT NULL DEFAULT 0,
     provider TEXT,
     result JSONB,
     error TEXT,
     dead_letter BOOLEAN NOT NULL DEFAULT false,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     started_at TIMESTAMPTZ,
     finished_at TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS memory_jobs_ready ON ai_memory."MemoryJobs" (run_after) WHERE status IN ('Pending', 'Deferred')`,
  `CREATE INDEX IF NOT EXISTS memory_jobs_created ON ai_memory."MemoryJobs" (created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryCandidates" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     job_id UUID REFERENCES ai_memory."MemoryJobs"(id) ON DELETE SET NULL,
     user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     namespace_id UUID NOT NULL REFERENCES ai_memory."MemoryNamespaces"(id) ON DELETE CASCADE,
     category_id UUID NOT NULL REFERENCES ai_memory."MemoryCategories"(id) ON DELETE RESTRICT,
     title TEXT NOT NULL,
     content TEXT NOT NULL,
     importance SMALLINT NOT NULL CHECK (importance BETWEEN 1 AND 10),
     confidence REAL NOT NULL CHECK (confidence BETWEEN 0 AND 1),
     operation TEXT NOT NULL CHECK (operation IN ('add', 'update', 'merge', 'delete')),
     target_memory_id UUID REFERENCES ai_memory."Memories"(id) ON DELETE SET NULL,
     duplicate_of UUID REFERENCES ai_memory."Memories"(id) ON DELETE SET NULL,
     evidence TEXT NOT NULL DEFAULT '',
     rationale TEXT NOT NULL DEFAULT '',
     speaker TEXT NOT NULL DEFAULT 'unknown',
     sensitivity TEXT NOT NULL DEFAULT 'none' CHECK (sensitivity IN ('none', 'personal', 'secret')),
     flags TEXT[] NOT NULL DEFAULT '{}',
     expires_at TIMESTAMPTZ,
     source_application TEXT NOT NULL,
     source_model TEXT,
     source_conversation_id TEXT,
     source_message_id TEXT,
     provider TEXT NOT NULL,
     content_hash TEXT NOT NULL,
     status TEXT NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending', 'Approved', 'Rejected', 'Merged', 'Discarded')),
     decided_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     decided_at TIMESTAMPTZ,
     result_memory_id UUID REFERENCES ai_memory."Memories"(id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS memory_candidates_pending ON ai_memory."MemoryCandidates" (created_at DESC) WHERE status = 'Pending'`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryConflicts" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     existing_memory_id UUID NOT NULL REFERENCES ai_memory."Memories"(id) ON DELETE CASCADE,
     candidate_id UUID REFERENCES ai_memory."MemoryCandidates"(id) ON DELETE CASCADE,
     other_memory_id UUID REFERENCES ai_memory."Memories"(id) ON DELETE CASCADE,
     kind TEXT NOT NULL CHECK (kind IN ('contradiction', 'lockedChange', 'update')),
     similarity REAL,
     explanation TEXT NOT NULL DEFAULT '',
     recommended TEXT NOT NULL DEFAULT 'defer',
     detected_by TEXT NOT NULL DEFAULT 'rule',
     status TEXT NOT NULL DEFAULT 'Open' CHECK (status IN ('Open', 'Resolved', 'Deferred')),
     resolution TEXT,
     resolved_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     resolved_at TIMESTAMPTZ,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CHECK (candidate_id IS NOT NULL OR other_memory_id IS NOT NULL)
   )`,
  `CREATE INDEX IF NOT EXISTS memory_conflicts_open ON ai_memory."MemoryConflicts" (created_at DESC) WHERE status <> 'Resolved'`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryRelationships" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     from_memory_id UUID NOT NULL REFERENCES ai_memory."Memories"(id) ON DELETE CASCADE,
     to_memory_id UUID NOT NULL REFERENCES ai_memory."Memories"(id) ON DELETE CASCADE,
     type TEXT NOT NULL CHECK (type IN ('relatedTo', 'dependsOn', 'supersedes', 'contradicts', 'supports', 'derivedFrom', 'belongsToProject', 'previousVersion', 'associatedDecision')),
     origin TEXT NOT NULL DEFAULT 'manual' CHECK (origin IN ('manual', 'ai', 'system')),
     status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('proposed', 'active', 'rejected')),
     note TEXT NOT NULL DEFAULT '',
     created_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     CHECK (from_memory_id <> to_memory_id),
     UNIQUE (from_memory_id, to_memory_id, type)
   )`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemorySettings" (
     scope_type TEXT NOT NULL CHECK (scope_type IN ('global', 'application', 'user', 'state')),
     scope_key TEXT NOT NULL,
     settings JSONB NOT NULL,
     updated_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (scope_type, scope_key)
   )`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryRetrievalProfiles" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     name TEXT NOT NULL UNIQUE,
     params JSONB NOT NULL,
     applies_to JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // What was retrieved, never the query's text (a hash of it), so analytics hold no conversation content
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryAccessLog" (
     id BIGSERIAL PRIMARY KEY,
     at TIMESTAMPTZ NOT NULL DEFAULT now(),
     request_id TEXT,
     client TEXT NOT NULL,
     user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     namespace_ids UUID[] NOT NULL DEFAULT '{}',
     query_hash TEXT,
     profile_id UUID,
     ranking_version TEXT NOT NULL,
     mode TEXT NOT NULL,
     degraded TEXT,
     embedding_model TEXT,
     candidates INTEGER NOT NULL DEFAULT 0,
     returned INTEGER NOT NULL DEFAULT 0,
     tokens INTEGER NOT NULL DEFAULT 0,
     latency_ms INTEGER,
     embed_ms INTEGER,
     semantic_ms INTEGER,
     keyword_ms INTEGER,
     memory_ids UUID[] NOT NULL DEFAULT '{}',
     inspector BOOLEAN NOT NULL DEFAULT false,
     error TEXT
   )`,
  `CREATE INDEX IF NOT EXISTS memory_access_at ON ai_memory."MemoryAccessLog" (at DESC)`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryFeedback" (
     id BIGSERIAL PRIMARY KEY,
     at TIMESTAMPTZ NOT NULL DEFAULT now(),
     memory_id UUID REFERENCES ai_memory."Memories"(id) ON DELETE CASCADE,
     access_log_id BIGINT REFERENCES ai_memory."MemoryAccessLog"(id) ON DELETE SET NULL,
     user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     rating TEXT NOT NULL CHECK (rating IN ('helpful', 'notHelpful', 'incorrect', 'outdated', 'irrelevant', 'missingContext')),
     note TEXT NOT NULL DEFAULT ''
   )`,
  // The outbox (docs/AI_MEMORY_ARCHITECTURE.md, Synchronization): written in the same transaction as the memory
  // change, so a secondary index (Mem0) never misses one and never gets one that was rolled back
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryProviderSync" (
     id BIGSERIAL PRIMARY KEY,
     memory_id UUID NOT NULL,
     provider TEXT NOT NULL,
     operation TEXT NOT NULL CHECK (operation IN ('upsert', 'delete')),
     memory_version INTEGER NOT NULL,
     status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done', 'failed', 'skipped')),
     attempts INTEGER NOT NULL DEFAULT 0,
     last_error TEXT,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     processed_at TIMESTAMPTZ
   )`,
  `CREATE INDEX IF NOT EXISTS memory_sync_pending ON ai_memory."MemoryProviderSync" (created_at) WHERE status IN ('pending', 'failed')`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryProviderRecords" (
     memory_id UUID NOT NULL,
     provider TEXT NOT NULL,
     external_id TEXT NOT NULL,
     synced_version INTEGER NOT NULL,
     synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     PRIMARY KEY (memory_id, provider)
   )`,
  // Tombstones: a deleted memory's ID and text, so no sync, stale job, import or restore brings it back. Holds a
  // hash only, never the text.
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryDeletions" (
     memory_id UUID PRIMARY KEY,
     namespace_id UUID,
     content_hash TEXT NOT NULL,
     user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     reason TEXT NOT NULL,
     permanent BOOLEAN NOT NULL DEFAULT true,
     deleted_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE INDEX IF NOT EXISTS memory_deletions_hash ON ai_memory."MemoryDeletions" (content_hash)`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryApiClients" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     name TEXT NOT NULL,
     application TEXT NOT NULL,
     key_prefix TEXT NOT NULL,
     key_hash TEXT NOT NULL UNIQUE,
     owner_user_id INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     scopes TEXT[] NOT NULL,
     namespace_ids UUID[] NOT NULL DEFAULT '{}',
     global_read BOOLEAN NOT NULL DEFAULT false,
     subjects TEXT[] NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     last_used_at TIMESTAMPTZ,
     revoked_at TIMESTAMPTZ
   )`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryAuditLog" (
     id BIGSERIAL PRIMARY KEY,
     at TIMESTAMPTZ NOT NULL DEFAULT now(),
     request_id TEXT,
     actor_user_id INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     actor_client_id UUID,
     action TEXT NOT NULL,
     target TEXT,
     outcome TEXT NOT NULL CHECK (outcome IN ('ok', 'refused', 'failed')),
     detail JSONB
   )`,
  `CREATE INDEX IF NOT EXISTS memory_audit_at ON ai_memory."MemoryAuditLog" (at DESC)`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryEvaluationCases" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     dataset TEXT NOT NULL,
     prompt TEXT NOT NULL,
     expected_memory_ids UUID[] NOT NULL DEFAULT '{}',
     excluded_memory_ids UUID[] NOT NULL DEFAULT '{}',
     expected_answer TEXT NOT NULL DEFAULT '',
     namespaces TEXT[] NOT NULL DEFAULT '{}',
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryEvaluationRuns" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     dataset TEXT NOT NULL,
     config JSONB NOT NULL,
     metrics JSONB NOT NULL,
     results JSONB NOT NULL,
     created_by INTEGER REFERENCES racingcoach."Users"(id) ON DELETE SET NULL,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  // Exports and training datasets: kept in the database for 72 hours and downloaded only by whoever made them,
  // never through a storage URL
  `CREATE TABLE IF NOT EXISTS ai_memory."MemoryExports" (
     id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     kind TEXT NOT NULL CHECK (kind IN ('memories', 'history', 'fineTuning')),
     format TEXT NOT NULL,
     file_name TEXT NOT NULL,
     content BYTEA NOT NULL,
     stats JSONB NOT NULL DEFAULT '{}'::jsonb,
     created_by INTEGER NOT NULL REFERENCES racingcoach."Users"(id) ON DELETE CASCADE,
     created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
     expires_at TIMESTAMPTZ NOT NULL DEFAULT now() + interval '72 hours'
   )`,
];

const globalForSchema = globalThis as unknown as { memorySchema?: Promise<void>; memoryVector?: boolean };

export function ensureMemorySchema(): Promise<void> {
  globalForSchema.memorySchema ??= (async () => {
    await ensureUserSchema();
    await ensureVectorExtension();
    for (const statement of MEMORY_SCHEMA) await query(statement);
    await seedDefaults();
  })().catch((error) => {
    globalForSchema.memorySchema = undefined;
    throw error;
  });
  return globalForSchema.memorySchema;
}

// pgvector, when the database has it (Render Postgres does; CREATE EXTENSION needs the database owner). Without it
// semantic search runs in memory over the namespaces' embeddings instead (retrieval.ts); nothing else changes.
async function ensureVectorExtension(): Promise<void> {
  try {
    await query('CREATE EXTENSION IF NOT EXISTS vector');
  } catch (error) {
    console.warn('Memory: the pgvector extension is not available; semantic search runs in memory', error instanceof Error ? error.message : error);
  }
  const rows = await query<{ version: string }>(`SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'`);
  globalForSchema.memoryVector = rows.length > 0;
}

export async function vectorAvailable(): Promise<boolean> {
  await ensureMemorySchema();
  return globalForSchema.memoryVector === true;
}

export async function pgvectorVersion(): Promise<string | null> {
  const rows = await query<{ version: string }>(`SELECT extversion AS version FROM pg_extension WHERE extname = 'vector'`);
  return rows[0]?.version ?? null;
}

// One HNSW index per model and size, on the same expression retrieval orders by, so the planner uses it
export const vectorIndexName = (model: string, dimensions: number) =>
  `memory_embeddings_hnsw_${createHash('sha256').update(`${model}:${dimensions}`).digest('hex').slice(0, 12)}`;

const literal = (value: string) => `'${value.replace(/'/g, "''")}'`;

export async function ensureVectorIndex(model: string, dimensions: number): Promise<{ created: boolean; name: string } | null> {
  if (!(await vectorAvailable())) return null;
  if (!Number.isInteger(dimensions) || dimensions < 8 || dimensions > 2000) return null; // HNSW indexes vectors up to 2,000 dimensions
  const name = vectorIndexName(model, dimensions);
  const exists = await query(`SELECT 1 FROM pg_indexes WHERE schemaname = 'ai_memory' AND indexname = $1`, [name]);
  if (exists.length) return { created: false, name };
  // The model goes in as a literal: a partial index's WHERE can't take parameters. It's checked against
  // MODEL_NAME by parseConfig before it gets here, and quoted anyway.
  await query(
    `CREATE INDEX IF NOT EXISTS ${name} ON ai_memory."MemoryEmbeddings" USING hnsw ((embedding::vector(${dimensions})) vector_cosine_ops)
     WHERE model = ${literal(model)} AND dimensions = ${dimensions} AND indexing_status = 'ready'`
  );
  return { created: true, name };
}

export async function listVectorIndexes(): Promise<{ name: string; definition: string; bytes: number }[]> {
  const rows = await query<{ indexname: string; indexdef: string; bytes: string }>(
    `SELECT i.indexname, i.indexdef, pg_relation_size(format('ai_memory.%I', i.indexname)::regclass) AS bytes
     FROM pg_indexes i WHERE i.schemaname = 'ai_memory' AND i.indexname LIKE 'memory_embeddings_hnsw_%'`
  );
  return rows.map((r) => ({ name: r.indexname, definition: r.indexdef, bytes: Number(r.bytes) }));
}

// The seeded categories and namespaces, once each (an Admin's later edits are kept)
async function seedDefaults(): Promise<void> {
  for (const c of DEFAULT_CATEGORIES) {
    await query(
      `INSERT INTO ai_memory."MemoryCategories" (key, name, description, example, color, icon, default_importance, retention_rule, retention_days, extraction_eligible, requires_approval, auto_update)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) ON CONFLICT (key) DO NOTHING`,
      [c.key, c.name, c.description, c.example, c.color, c.icon, c.defaultImportance, c.retentionRule, c.retentionDays, c.extractionEligible, c.requiresApproval, c.autoUpdate]
    );
  }
  for (const n of DEFAULT_NAMESPACES) {
    const parent = parentPath(n.path);
    await query(
      `INSERT INTO ai_memory."MemoryNamespaces" (path, name, kind, description, is_customer_data, parent_id)
       VALUES ($1, $2, $3, $4, $5, (SELECT id FROM ai_memory."MemoryNamespaces" WHERE path = $6)) ON CONFLICT (path) DO NOTHING`,
      [n.path, n.name, n.kind, n.description, n.customer === true, parent]
    );
  }
}
