import { hostname } from 'node:os';
import { query } from '@/lib/db';
import { EMBEDDING_VERSION, embeddingText, embedTexts, type EmbeddingSpec } from './embeddings';
import { DeferError, runExtraction, type ExtractPayload } from './extraction';
import { mem0Call, OfflineError } from './localServices';
import { ensureMemorySchema, ensureVectorIndex } from './schema';
import { deleteMemory, enqueueJob, getConfig, getScoped, setScoped, updateMemory, type Actor } from './store';

// The Memory Service's durable jobs (docs/AI_MEMORY_OPERATIONS.md): rows in ai_memory."MemoryJobs", claimed with
// FOR UPDATE SKIP LOCKED so any number of web servers share them, retried with exponential backoff, and Failed
// (dead letter) after max_attempts. A provider that's offline defers a job (Deferred, tried again later, without
// using an attempt) for up to 7 days. Every handler is idempotent: an embed job for an old version or a deleted
// memory does nothing, and sync never writes a memory that isn't Active in Postgres now, so no stale job can bring a
// deleted memory back.
//
// The worker runs on the live server (src/instrumentation.ts, behind backgroundJobsEnabled), polling every 5 s;
// elsewhere an Admin's action runs a small batch (kickJobs), and Jobs and Synchronization's Run Now runs one.

const WORKER = `${hostname()}:${process.pid}`;
const SYSTEM: Actor = { userId: null, system: 'memory-jobs' };
const MAX_DEFER_DAYS = 7;

export type JobRow = { id: string; type: string; payload: Record<string, unknown>; attempts: number; max_attempts: number; created_at: Date; user_id: number | null };

export async function claimJobs(limit: number, types?: string[]): Promise<JobRow[]> {
  await ensureMemorySchema();
  return query<JobRow>(
    `UPDATE ai_memory."MemoryJobs" j SET status = 'Running', locked_at = now(), locked_by = $2, started_at = coalesce(started_at, now())
     WHERE j.id IN (SELECT id FROM ai_memory."MemoryJobs" WHERE status IN ('Pending', 'Deferred') AND run_after <= now()
                    ${types?.length ? 'AND type = ANY($3::text[])' : ''} ORDER BY run_after LIMIT $1 FOR UPDATE SKIP LOCKED)
     RETURNING j.id, j.type, j.payload, j.attempts, j.max_attempts, j.created_at, j.user_id`,
    types?.length ? [limit, WORKER, types] : [limit, WORKER]
  );
}

// Jobs left Running by a server that stopped mid-job go back to Pending after 10 minutes
export async function releaseStuckJobs(): Promise<number> {
  const r = await query(`UPDATE ai_memory."MemoryJobs" SET status = 'Pending', locked_at = NULL, locked_by = NULL WHERE status = 'Running' AND locked_at < now() - interval '10 minutes' RETURNING id`);
  return r.length;
}

async function finish(job: JobRow, status: 'Completed' | 'Cancelled', result: unknown, provider?: string | null) {
  await query(`UPDATE ai_memory."MemoryJobs" SET status = $2, result = $3, progress = 1, finished_at = now(), locked_at = NULL, error = NULL, provider = coalesce($4, provider) WHERE id = $1`, [
    job.id,
    status,
    JSON.stringify(result ?? null),
    provider ?? null,
  ]);
}

async function defer(job: JobRow, reason: string, delayMs: number) {
  const tooOld = Date.now() - job.created_at.getTime() > MAX_DEFER_DAYS * 86_400_000;
  if (tooOld) return fail(job, `Deferred for over ${MAX_DEFER_DAYS} days: ${reason}`, true);
  await query(`UPDATE ai_memory."MemoryJobs" SET status = 'Deferred', error = $2, run_after = now() + ($3 || ' milliseconds')::interval, locked_at = NULL WHERE id = $1`, [job.id, reason.slice(0, 500), String(delayMs)]);
}

async function fail(job: JobRow, message: string, final = false) {
  const attempts = job.attempts + 1;
  const dead = final || attempts >= job.max_attempts;
  // 30 s, 1, 2, 4, 8... minutes, at most an hour
  const backoffMs = Math.min(3_600_000, 30_000 * 2 ** (attempts - 1));
  await query(
    `UPDATE ai_memory."MemoryJobs" SET attempts = $2, status = $3, error = $4, dead_letter = $5, locked_at = NULL,
       run_after = now() + ($6 || ' milliseconds')::interval, finished_at = CASE WHEN $5 THEN now() ELSE NULL END WHERE id = $1`,
    [job.id, attempts, dead ? 'Failed' : 'Pending', message.slice(0, 1000), dead, String(backoffMs)]
  );
}

export async function runJob(job: JobRow): Promise<void> {
  try {
    switch (job.type) {
      case 'embed': {
        const r = await embedMemory(String(job.payload.memoryId), Number(job.payload.version));
        return finish(job, 'Completed', r, 'embeddings');
      }
      case 'reembed': {
        const r = await reembedBatch(job.payload as { model: string; provider: 'ollama' | 'openai' });
        if (r.remaining > 0) {
          // More to do: the same job carries on, so its progress is one figure
          await query(`UPDATE ai_memory."MemoryJobs" SET status = 'Pending', progress = $2, result = $3, locked_at = NULL WHERE id = $1`, [job.id, r.progress, JSON.stringify(r)]);
          return;
        }
        return finish(job, 'Completed', r, 'embeddings');
      }
      case 'extract': {
        const r = await runExtraction(job.id, job.payload as unknown as ExtractPayload);
        return finish(job, 'Completed', r, r.provider ?? null);
      }
      case 'sync': {
        const r = await processOutbox(Number(job.payload.limit ?? 100));
        return finish(job, 'Completed', r, 'mem0');
      }
      case 'reconcile': {
        const r = await reconcileMem0();
        return finish(job, 'Completed', r, 'mem0');
      }
      case 'cleanup': {
        const r = await runCleanup();
        return finish(job, 'Completed', r, null);
      }
      case 'import': {
        const { runImportJob } = await import('./importExport');
        const r = await runImportJob(job.payload, job.user_id);
        return finish(job, 'Completed', r, null);
      }
      default:
        return finish(job, 'Cancelled', { error: `No handler for ${job.type}` });
    }
  } catch (error) {
    if (error instanceof DeferError) return defer(job, error.reason, error.delayMs);
    if (error instanceof OfflineError) return defer(job, `${error.service}:${error.reason}`, error.reason === 'memoryBusy' || error.reason === 'productionBusy' ? 30_000 : 120_000);
    console.error(`Memory job ${job.type} ${job.id} failed:`, error);
    return fail(job, error instanceof Error ? error.message : String(error));
  }
}

export async function runJobs(options: { limit?: number; types?: string[] } = {}): Promise<{ ran: number }> {
  const config = await getConfig();
  const jobs = await claimJobs(options.limit ?? config.system.jobConcurrency, options.types);
  await Promise.all(jobs.map(runJob));
  return { ran: jobs.length };
}

// After a change or a queued extraction: a few jobs straight away, without waiting for the worker's next poll
// (and where there's no worker, e.g. a development server). Never awaited, so the request doesn't wait for them.
export function kickJobs(): void {
  void runJobs({ limit: 3 }).catch((error) => console.warn('Memory jobs:', error instanceof Error ? error.message : error));
}

const globalForWorker = globalThis as unknown as { memoryWorker?: NodeJS.Timeout; memorySchedule?: NodeJS.Timeout; memoryBusy?: boolean };

export function startMemoryJobs(): void {
  if (globalForWorker.memoryWorker) return;
  const tick = async () => {
    if (globalForWorker.memoryBusy) return;
    globalForWorker.memoryBusy = true;
    try {
      await runJobs();
    } catch (error) {
      console.error('Memory job worker:', error);
    } finally {
      globalForWorker.memoryBusy = false;
    }
  };
  globalForWorker.memoryWorker = setInterval(tick, 5_000);
  globalForWorker.memoryWorker.unref?.();
  // The schedule: outbox every sync interval, cleanup hourly, reconciliation daily, each queued once per window
  const schedule = async () => {
    try {
      const config = await getConfig();
      await releaseStuckJobs();
      const window = (minutes: number) => Math.floor(Date.now() / (minutes * 60_000));
      await enqueueJob(null, 'sync', { limit: 200 }, { idempotencyKey: `sync:${window(config.system.syncIntervalMinutes)}` });
      await enqueueJob(null, 'cleanup', {}, { idempotencyKey: `cleanup:${window(60)}` });
      if (config.providers.intelligence === 'mem0') await enqueueJob(null, 'reconcile', {}, { idempotencyKey: `reconcile:${window(24 * 60)}` });
    } catch (error) {
      console.error('Memory job schedule:', error);
    }
  };
  setTimeout(schedule, 60_000).unref?.();
  globalForWorker.memorySchedule = setInterval(schedule, 60_000);
  globalForWorker.memorySchedule.unref?.();
}

// ---- Embeddings ----

export async function storeEmbedding(memoryId: string, version: number, spec: EmbeddingSpec, vector: number[]): Promise<void> {
  await query(
    `INSERT INTO ai_memory."MemoryEmbeddings" (memory_id, memory_version, provider, model, dimensions, embedding_version, embedding, indexing_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready')
     ON CONFLICT (memory_id, model, embedding_version) DO UPDATE SET memory_version = EXCLUDED.memory_version, provider = EXCLUDED.provider,
       dimensions = EXCLUDED.dimensions, embedding = EXCLUDED.embedding, indexing_status = 'ready', updated_at = now()
     WHERE ai_memory."MemoryEmbeddings".memory_version <= EXCLUDED.memory_version`,
    [memoryId, version, spec.provider, spec.model, vector.length, EMBEDDING_VERSION, vector]
  );
}

export async function embedMemory(memoryId: string, version: number, spec?: EmbeddingSpec): Promise<{ skipped?: string; model?: string; dimensions?: number }> {
  const config = await getConfig();
  const use = spec ?? { provider: config.providers.embeddingProvider, model: config.providers.embeddingModel };
  const rows = await query<{ title: string; content: string; version: number; status: string }>(`SELECT title, content, version, status FROM ai_memory."Memories" WHERE id = $1`, [memoryId]);
  const m = rows[0];
  if (!m) return { skipped: 'gone' };
  if (m.status === 'Deleted' || m.status === 'Rejected') return { skipped: m.status };
  if (Number(m.version) > version && !spec) return { skipped: 'newerVersion' };
  const { vectors, dimensions } = await embedTexts(use, [embeddingText(m)], config.providers);
  await storeEmbedding(memoryId, Number(m.version), use, vectors[0]);
  await ensureVectorIndex(use.model, dimensions).catch((error) => console.warn('Memory: vector index not built:', error instanceof Error ? error.message : error));
  return { model: use.model, dimensions };
}

// Embedding migration (docs/AI_MEMORY_OPERATIONS.md): every live memory embedded with the target model in batches,
// while retrieval keeps using the active one; the index is built first, and the switch is the Admin's, once
// coverage is complete (switchEmbeddingModel)
export async function reembedBatch(p: { model: string; provider: 'ollama' | 'openai' }) {
  const config = await getConfig();
  const spec: EmbeddingSpec = { provider: p.provider, model: p.model };
  const todo = await query<{ id: string; title: string; content: string; version: number }>(
    `SELECT m.id, m.title, m.content, m.version FROM ai_memory."Memories" m
     WHERE m.status NOT IN ('Deleted', 'Rejected')
       AND NOT EXISTS (SELECT 1 FROM ai_memory."MemoryEmbeddings" e WHERE e.memory_id = m.id AND e.model = $1 AND e.memory_version = m.version AND e.indexing_status = 'ready')
     ORDER BY m.updated_at DESC LIMIT 32`,
    [p.model]
  );
  if (todo.length) {
    const { vectors, dimensions } = await embedTexts(spec, todo.map(embeddingText), config.providers);
    for (let i = 0; i < todo.length; i++) await storeEmbedding(todo[i].id, Number(todo[i].version), spec, vectors[i]);
    await ensureVectorIndex(p.model, dimensions).catch(() => undefined);
  }
  const coverage = await embeddingCoverage(p.model);
  await setScoped('state', 'embeddingMigration', { target: p.model, provider: p.provider, ...coverage, updatedAt: new Date().toISOString() }, null);
  return { ...coverage, progress: coverage.total ? coverage.embedded / coverage.total : 1, remaining: coverage.total - coverage.embedded };
}

export async function embeddingCoverage(model: string): Promise<{ total: number; embedded: number; stale: number; dimensions: number | null }> {
  const rows = await query<{ total: number; embedded: number; stale: number; dims: number | null }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ai_memory."MemoryEmbeddings" e WHERE e.memory_id = m.id AND e.model = $1 AND e.memory_version = m.version AND e.indexing_status = 'ready'))::int AS embedded,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ai_memory."MemoryEmbeddings" e WHERE e.memory_id = m.id AND e.model = $1 AND (e.memory_version < m.version OR e.indexing_status <> 'ready')))::int AS stale,
            (SELECT max(dimensions) FROM ai_memory."MemoryEmbeddings" WHERE model = $1) AS dims
     FROM ai_memory."Memories" m WHERE m.status NOT IN ('Deleted', 'Rejected')`,
    [model]
  );
  return { total: rows[0].total, embedded: rows[0].embedded, stale: rows[0].stale, dimensions: rows[0].dims };
}

// ---- Mem0 synchronization ----

type OutboxRow = { id: string; memory_id: string; provider: string; operation: 'upsert' | 'delete'; memory_version: number; attempts: number };

export async function processOutbox(limit = 100): Promise<{ processed: number; failed: number; skipped: number; offline: boolean }> {
  await ensureMemorySchema();
  const out = { processed: 0, failed: 0, skipped: 0, offline: false };
  const rows = await query<OutboxRow>(
    `SELECT id, memory_id, provider, operation, memory_version, attempts FROM ai_memory."MemoryProviderSync"
     WHERE status IN ('pending', 'failed') AND attempts < 10 ORDER BY id LIMIT $1`,
    [limit]
  );
  for (const r of rows) {
    try {
      const done = await applySync(r);
      await query(`UPDATE ai_memory."MemoryProviderSync" SET status = $2, processed_at = now() WHERE id = $1`, [r.id, done ? 'done' : 'skipped']);
      if (done) out.processed++;
      else out.skipped++;
    } catch (error) {
      if (error instanceof OfflineError) {
        out.offline = true;
        break; // the rest wait for the next run
      }
      out.failed++;
      await query(`UPDATE ai_memory."MemoryProviderSync" SET status = 'failed', attempts = attempts + 1, last_error = $2 WHERE id = $1`, [r.id, (error instanceof Error ? error.message : String(error)).slice(0, 500)]);
    }
  }
  return out;
}

async function applySync(r: OutboxRow): Promise<boolean> {
  if (r.provider !== 'mem0') return false;
  // Never trust the event's snapshot: what's in Postgres now decides
  const rows = await query<{ id: string; title: string; content: string; version: number; status: string; is_active: boolean; path: string; key: string }>(
    `SELECT m.id, m.title, m.content, m.version, m.status, m.is_active, n.path, c.key FROM ai_memory."Memories" m
     JOIN ai_memory."MemoryNamespaces" n ON n.id = m.namespace_id JOIN ai_memory."MemoryCategories" c ON c.id = m.category_id WHERE m.id = $1`,
    [r.memory_id]
  );
  const m = rows[0];
  const tomb = await query(`SELECT 1 FROM ai_memory."MemoryDeletions" WHERE memory_id = $1`, [r.memory_id]);
  const live = m && !tomb.length && m.status === 'Active' && m.is_active;
  const record = await query<{ synced_version: number }>(`SELECT synced_version FROM ai_memory."MemoryProviderRecords" WHERE memory_id = $1 AND provider = 'mem0'`, [r.memory_id]);
  if (r.operation === 'upsert' && live) {
    if (record[0] && Number(record[0].synced_version) >= Number(m.version)) return false;
    const res = await mem0Call('upsert', { memory_id: m.id, namespace: m.path, text: m.content, metadata: { title: m.title, category: m.key, version: Number(m.version) } });
    const externalId = Array.isArray(res.ids) ? String(res.ids[0] ?? m.id) : m.id;
    await query(
      `INSERT INTO ai_memory."MemoryProviderRecords" (memory_id, provider, external_id, synced_version) VALUES ($1, 'mem0', $2, $3)
       ON CONFLICT (memory_id, provider) DO UPDATE SET external_id = EXCLUDED.external_id, synced_version = EXCLUDED.synced_version, synced_at = now()`,
      [m.id, externalId, Number(m.version)]
    );
    return true;
  }
  // A delete, or an upsert of something no longer live: make sure Mem0 doesn't have it
  await mem0Call('delete', { memory_id: r.memory_id });
  await query(`DELETE FROM ai_memory."MemoryProviderRecords" WHERE memory_id = $1 AND provider = 'mem0'`, [r.memory_id]);
  return true;
}

// Reconciliation: Mem0's index against Postgres. Anything Mem0 holds that isn't Active here is deleted from it;
// anything Active here that Mem0 lacks (or holds an older version of) gets an upsert in the outbox.
export async function reconcileMem0(): Promise<{ inMem0: number; removed: number; queued: number }> {
  const listed = await mem0Call('list', {}, 60_000);
  const entries = (Array.isArray(listed.memories) ? listed.memories : []) as { memory_id?: string; version?: number }[];
  const active = await query<{ id: string; version: number }>(`SELECT id, version FROM ai_memory."Memories" WHERE status = 'Active' AND is_active`);
  const activeById = new Map(active.map((a) => [a.id, Number(a.version)]));
  const inMem0 = new Map(entries.filter((e) => typeof e.memory_id === 'string').map((e) => [e.memory_id!, Number(e.version ?? 0)]));
  let removed = 0;
  for (const id of inMem0.keys()) {
    if (!activeById.has(id)) {
      await mem0Call('delete', { memory_id: id });
      await query(`DELETE FROM ai_memory."MemoryProviderRecords" WHERE memory_id = $1 AND provider = 'mem0'`, [id]);
      removed++;
    }
  }
  let queued = 0;
  for (const [id, version] of activeById) {
    if ((inMem0.get(id) ?? -1) < version) {
      await query(`INSERT INTO ai_memory."MemoryProviderSync" (memory_id, provider, operation, memory_version) VALUES ($1, 'mem0', 'upsert', $2)`, [id, version]);
      queued++;
    }
  }
  return { inMem0: inMem0.size, removed, queued };
}

// ---- Lifecycle ----

export async function runCleanup(): Promise<Record<string, number>> {
  await ensureMemorySchema();
  const config = await getConfig();
  const out: Record<string, number> = { expired: 0, purged: 0, staleEmbeddings: 0, accessLog: 0, exports: 0, candidates: 0, outbox: 0, jobs: 0, audit: 0, verificationDue: 0 };
  // Expiry: Active past expires_at becomes Expired (with history), so it's out of retrieval even before this runs
  const due = await query<{ id: string; version: number }>(`SELECT id, version FROM ai_memory."Memories" WHERE status = 'Active' AND expires_at IS NOT NULL AND expires_at <= now() LIMIT 500`);
  for (const m of due) {
    try {
      await updateMemory(m.id, { status: 'Expired' }, Number(m.version), SYSTEM, { changeType: 'expire', reason: 'Reached its expiry date' });
      out.expired++;
    } catch (error) {
      console.warn('Memory expiry:', error instanceof Error ? error.message : error);
    }
  }
  // Soft-deleted past the retention period are removed for good
  const old = await query<{ id: string }>(`SELECT id FROM ai_memory."Memories" WHERE status = 'Deleted' AND deleted_at < now() - ($1 || ' days')::interval LIMIT 500`, [String(config.system.deletedRetentionDays)]);
  for (const m of old) {
    await deleteMemory(m.id, SYSTEM, { permanent: true, reason: 'Deleted retention period ended' });
    out.purged++;
  }
  // Embeddings of an older version, kept a day in case of a quick restore
  out.staleEmbeddings = (await query(`DELETE FROM ai_memory."MemoryEmbeddings" e USING ai_memory."Memories" m WHERE e.memory_id = m.id AND e.memory_version < m.version AND e.updated_at < now() - interval '1 day' RETURNING e.id`)).length;
  out.accessLog = (await query(`DELETE FROM ai_memory."MemoryAccessLog" WHERE at < now() - interval '180 days' RETURNING id`)).length;
  out.exports = (await query(`DELETE FROM ai_memory."MemoryExports" WHERE expires_at < now() RETURNING id`)).length;
  out.candidates = (await query(`DELETE FROM ai_memory."MemoryCandidates" WHERE status <> 'Pending' AND coalesce(decided_at, created_at) < now() - interval '180 days' RETURNING id`)).length;
  out.outbox = (await query(`DELETE FROM ai_memory."MemoryProviderSync" WHERE status IN ('done', 'skipped') AND processed_at < now() - interval '30 days' RETURNING id`)).length;
  out.jobs = (await query(`DELETE FROM ai_memory."MemoryJobs" WHERE status IN ('Completed', 'Cancelled') AND finished_at < now() - interval '30 days' RETURNING id`)).length;
  out.audit = (await query(`DELETE FROM ai_memory."MemoryAuditLog" WHERE at < now() - interval '365 days' RETURNING id`)).length;
  // Verification reminders: important facts unverified for 180 days are counted for the Overview (nothing changes)
  out.verificationDue = (await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_memory."Memories" WHERE status = 'Active' AND importance >= 7 AND coalesce(last_verified_at, created_at) < now() - interval '180 days'`))[0].n;
  await setScoped('state', 'lastCleanup', { at: new Date().toISOString(), ...out }, null);
  return out;
}

export async function switchEmbeddingModel(model: string, provider: 'ollama' | 'openai', actor: Actor): Promise<{ switched: boolean; coverage: Awaited<ReturnType<typeof embeddingCoverage>> }> {
  const coverage = await embeddingCoverage(model);
  if (coverage.total > 0 && coverage.embedded < coverage.total) return { switched: false, coverage };
  const { saveConfig } = await import('./store');
  await saveConfig({ providers: { embeddingModel: model, embeddingProvider: provider } }, actor);
  await setScoped('state', 'embeddingMigration', { target: model, provider, ...coverage, switchedAt: new Date().toISOString() }, null);
  return { switched: true, coverage };
}

export const migrationState = () => getScoped<Record<string, unknown>>('state', 'embeddingMigration');
