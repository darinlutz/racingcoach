import { query } from '@/lib/db';
import { AI_MODEL_PRICES } from '@/lib/aiModelPrices';
import { installedModels, serviceHealth } from './localServices';
import { ensureMemorySchema, listVectorIndexes, pgvectorVersion, vectorAvailable } from './schema';
import { getConfig, getScoped } from './store';
import { embeddingCoverage } from './jobs';
import { Mem0MemoryProvider } from './intelligence';

// The Memory Manager's Overview and Analytics (docs/AI_MEMORY_OPERATIONS.md): real figures from the tables, each
// null when there's nothing to measure (no retrievals yet, no extraction jobs), never 0 for "unknown". No
// conversation text is read: the access log holds query hashes and memory IDs only.

export type Range = { from: string; to: string; namespaceIds?: string[] | null };

const days = (r: Range) => Math.max(1, Math.round((new Date(r.to).getTime() - new Date(r.from).getTime()) / 86_400_000));

export async function overview() {
  await ensureMemorySchema();
  const config = await getConfig();
  const [counts] = await query<Record<string, number>>(
    `SELECT count(*) FILTER (WHERE status <> 'Deleted')::int AS total,
            count(*) FILTER (WHERE status = 'Active' AND is_active)::int AS active,
            count(*) FILTER (WHERE is_pinned AND status <> 'Deleted')::int AS pinned,
            count(*) FILTER (WHERE is_locked AND status <> 'Deleted')::int AS locked,
            count(*) FILTER (WHERE status = 'Archived')::int AS archived,
            count(*) FILTER (WHERE status = 'Active' AND expires_at > now() AND expires_at <= now() + interval '14 days')::int AS expiring,
            count(*) FILTER (WHERE created_at >= date_trunc('day', now()) AND status <> 'Deleted')::int AS created_today
     FROM ai_memory."Memories"`
  );
  const [queue] = await query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM ai_memory."MemoryCandidates" WHERE status = 'Pending')::int AS pending,
            (SELECT count(*) FROM ai_memory."MemoryConflicts" WHERE status <> 'Resolved')::int AS conflicts,
            (SELECT count(*) FROM ai_memory."MemoryAccessLog" WHERE at >= date_trunc('day', now()) AND NOT inspector)::int AS retrievals_today,
            (SELECT coalesce(sum(returned), 0) FROM ai_memory."MemoryAccessLog" WHERE at >= date_trunc('day', now()) AND NOT inspector)::int AS retrieved_today,
            (SELECT round(avg(latency_ms))::int FROM ai_memory."MemoryAccessLog" WHERE at >= now() - interval '7 days' AND NOT inspector) AS avg_latency,
            (SELECT count(*) FROM ai_memory."MemoryJobs" WHERE type = 'extract' AND status = 'Completed' AND finished_at >= now() - interval '30 days')::int AS extract_ok,
            (SELECT count(*) FROM ai_memory."MemoryJobs" WHERE type = 'extract' AND status = 'Failed' AND finished_at >= now() - interval '30 days')::int AS extract_failed,
            (SELECT count(*) FROM ai_memory."MemoryJobs" WHERE status IN ('Pending', 'Deferred', 'Running'))::int AS jobs_waiting,
            (SELECT count(*) FROM ai_memory."MemoryJobs" WHERE status = 'Failed')::int AS jobs_failed,
            (SELECT max(finished_at) FROM ai_memory."MemoryJobs" WHERE status = 'Completed') AS last_job`
  );
  const coverage = await embeddingCoverage(config.providers.embeddingModel);
  const mem0 = config.providers.intelligence === 'mem0' ? await new Mem0MemoryProvider(config).healthCheck() : null;
  const ollama = await installedModels();
  const extractTotal = queue.extract_ok + queue.extract_failed;
  return {
    counts: { ...counts, pending: queue.pending, conflicts: queue.conflicts, retrievalsToday: queue.retrievals_today, retrievedToday: queue.retrieved_today },
    extractionSuccessRate: extractTotal ? queue.extract_ok / extractTotal : null,
    averageRetrievalMs: queue.avg_latency ?? null,
    embeddings: { model: config.providers.embeddingModel, ...coverage, pgvector: await pgvectorVersion(), indexes: await listVectorIndexes(), migration: await getScoped('state', 'embeddingMigration') },
    services: {
      postgres: { ok: true },
      pgvector: { ok: await vectorAvailable() },
      ollama: { ok: ollama.reachable, version: ollama.version, error: ollama.error, breaker: serviceHealth().ollama },
      mem0: mem0 ? { ok: mem0.ok, detail: mem0.detail, version: mem0.version ?? null, breaker: serviceHealth().mem0 } : { ok: null, detail: 'notSelected' },
      jobs: { waiting: queue.jobs_waiting, failed: queue.jobs_failed, lastCompletedAt: queue.last_job ? new Date(queue.last_job as unknown as Date).toISOString() : null },
    },
    mode: config.system.defaultMode,
    enabled: config.system.enabled,
  };
}

// The daily series for charts, filled with zeros only for days inside a range that has data at all
export async function analytics(r: Range) {
  await ensureMemorySchema();
  const ns = r.namespaceIds?.length ? r.namespaceIds : null;
  const p = [r.from, r.to, ns];
  const growth = await query<{ day: string; created: number; deleted: number }>(
    `WITH d AS (SELECT generate_series(date_trunc('day', $1::timestamptz), date_trunc('day', $2::timestamptz), interval '1 day') AS day)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
            (SELECT count(*) FROM ai_memory."Memories" m WHERE date_trunc('day', m.created_at) = d.day AND ($3::uuid[] IS NULL OR m.namespace_id = ANY($3)))::int AS created,
            ((SELECT count(*) FROM ai_memory."Memories" m WHERE date_trunc('day', m.deleted_at) = d.day AND ($3::uuid[] IS NULL OR m.namespace_id = ANY($3)))
             + (SELECT count(*) FROM ai_memory."MemoryDeletions" x WHERE date_trunc('day', x.deleted_at) = d.day AND ($3::uuid[] IS NULL OR x.namespace_id = ANY($3))))::int AS deleted
     FROM d ORDER BY d.day`,
    p
  );
  const [totals] = await query<{ before: number }>(`SELECT count(*)::int AS before FROM ai_memory."Memories" WHERE created_at < $1 AND status <> 'Deleted' AND ($2::uuid[] IS NULL OR namespace_id = ANY($2))`, [r.from, ns]);
  let running = totals.before;
  const growthSeries = growth.map((g) => ((running += g.created - g.deleted), { ...g, total: running }));
  const byCategory = await query<{ name: string; color: string; n: number }>(
    `SELECT c.name, c.color, count(m.id)::int AS n FROM ai_memory."MemoryCategories" c LEFT JOIN ai_memory."Memories" m ON m.category_id = c.id AND m.status <> 'Deleted' AND ($1::uuid[] IS NULL OR m.namespace_id = ANY($1))
     GROUP BY c.id ORDER BY n DESC`,
    [ns]
  );
  const byNamespace = await query<{ path: string; n: number }>(
    `SELECT n.path, count(m.id)::int AS n FROM ai_memory."MemoryNamespaces" n LEFT JOIN ai_memory."Memories" m ON m.namespace_id = n.id AND m.status <> 'Deleted'
     WHERE ($1::uuid[] IS NULL OR n.id = ANY($1)) GROUP BY n.id ORDER BY n DESC`,
    [ns]
  );
  const retrieval = await query<{ day: string; requests: number; empty: number; avg_ms: number | null; avg_tokens: number | null; avg_returned: number | null; degraded: number }>(
    `WITH d AS (SELECT generate_series(date_trunc('day', $1::timestamptz), date_trunc('day', $2::timestamptz), interval '1 day') AS day)
     SELECT to_char(d.day, 'YYYY-MM-DD') AS day, count(a.id)::int AS requests, count(a.id) FILTER (WHERE a.returned = 0)::int AS empty,
            round(avg(a.latency_ms))::int AS avg_ms, round(avg(a.tokens))::int AS avg_tokens, round(avg(a.returned)::numeric, 2)::float AS avg_returned,
            count(a.id) FILTER (WHERE a.degraded IS NOT NULL)::int AS degraded
     FROM d LEFT JOIN ai_memory."MemoryAccessLog" a ON date_trunc('day', a.at) = d.day AND NOT a.inspector AND ($3::uuid[] IS NULL OR a.namespace_ids && $3)
     GROUP BY d.day ORDER BY d.day`,
    p
  );
  const [lat] = await query<Record<string, number | null>>(
    `SELECT round(avg(latency_ms))::int AS total, round(avg(semantic_ms))::int AS semantic, round(avg(keyword_ms))::int AS keyword, round(avg(embed_ms))::int AS embed,
            percentile_disc(0.95) WITHIN GROUP (ORDER BY latency_ms) AS p95, count(*)::int AS n,
            count(*) FILTER (WHERE returned > 0)::int AS successful, count(*) FILTER (WHERE returned = 0)::int AS empty
     FROM ai_memory."MemoryAccessLog" WHERE at >= $1 AND at < $2 AND NOT inspector AND ($3::uuid[] IS NULL OR namespace_ids && $3)`,
    p
  );
  const most = await query<{ id: string; title: string; n: number }>(
    `SELECT m.id, m.title, count(*)::int AS n FROM ai_memory."MemoryAccessLog" a CROSS JOIN LATERAL unnest(a.memory_ids) AS mid JOIN ai_memory."Memories" m ON m.id = mid
     WHERE a.at >= $1 AND a.at < $2 AND NOT a.inspector AND ($3::uuid[] IS NULL OR m.namespace_id = ANY($3)) GROUP BY m.id ORDER BY n DESC LIMIT 10`,
    p
  );
  const [never] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_memory."Memories" WHERE status = 'Active' AND access_count = 0 AND created_at < now() - interval '7 days' AND ($1::uuid[] IS NULL OR namespace_id = ANY($1))`, [ns]);
  const extraction = await query<Record<string, number>>(
    `SELECT (SELECT count(*) FROM ai_memory."MemoryJobs" WHERE type = 'extract' AND created_at >= $1 AND created_at < $2)::int AS jobs,
            count(*)::int AS candidates,
            count(*) FILTER (WHERE status = 'Approved')::int AS approved,
            count(*) FILTER (WHERE status = 'Rejected')::int AS rejected,
            count(*) FILTER (WHERE status = 'Merged')::int AS merged,
            count(*) FILTER (WHERE status = 'Pending')::int AS pending,
            count(*) FILTER (WHERE 'duplicate' = ANY(flags))::int AS duplicates,
            count(*) FILTER (WHERE 'secret' = ANY(flags))::int AS secrets,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ai_memory."MemoryConflicts" k WHERE k.candidate_id = c.id))::int AS conflicts,
            count(*) FILTER (WHERE confidence < 0.4)::int AS conf_low,
            count(*) FILTER (WHERE confidence >= 0.4 AND confidence < 0.7)::int AS conf_mid,
            count(*) FILTER (WHERE confidence >= 0.7 AND confidence < 0.9)::int AS conf_high,
            count(*) FILTER (WHERE confidence >= 0.9)::int AS conf_top
     FROM ai_memory."MemoryCandidates" c WHERE created_at >= $1 AND created_at < $2 AND ($3::uuid[] IS NULL OR namespace_id = ANY($3))`,
    p
  );
  const e = extraction[0];
  const decided = e.approved + e.rejected + e.merged;
  const providers = await query<{ provider: string; jobs: number; failed: number; avg_ms: number | null }>(
    `SELECT coalesce(provider, type) AS provider, count(*)::int AS jobs, count(*) FILTER (WHERE status = 'Failed')::int AS failed,
            round(avg(extract(epoch FROM (finished_at - started_at)) * 1000))::int AS avg_ms
     FROM ai_memory."MemoryJobs" WHERE created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY jobs DESC`,
    [r.from, r.to]
  );
  // Local vs frontier, and cost, from the extraction jobs' recorded model calls
  const usage = await query<{ model: string; local: boolean; calls: number; prompt: number | null; output: number | null }>(
    `SELECT u->>'model' AS model, (u->>'local')::boolean AS local, count(*)::int AS calls,
            sum(nullif(u->>'promptTokens', '')::int) AS prompt, sum(nullif(u->>'outputTokens', '')::int) AS output
     FROM ai_memory."MemoryJobs" j CROSS JOIN LATERAL jsonb_array_elements(coalesce(j.result->'usage', '[]'::jsonb)) u
     WHERE j.type = 'extract' AND j.created_at >= $1 AND j.created_at < $2 GROUP BY 1, 2`,
    [r.from, r.to]
  );
  const priced = usage.map((u) => {
    const price = (AI_MODEL_PRICES as Record<string, { input: number; output: number } | undefined>)[u.model];
    return { ...u, costUsd: u.local ? 0 : price && u.prompt !== null && u.output !== null ? (u.prompt * price.input + u.output * price.output) / 1e6 : null };
  });
  const [embeds] = await query<{ n: number }>(`SELECT count(*)::int AS n FROM ai_memory."MemoryEmbeddings" WHERE updated_at >= $1 AND updated_at < $2`, [r.from, r.to]);
  const feedback = await query<{ rating: string; n: number }>(
    `SELECT f.rating, count(*)::int AS n FROM ai_memory."MemoryFeedback" f LEFT JOIN ai_memory."Memories" m ON m.id = f.memory_id
     WHERE f.at >= $1 AND f.at < $2 AND ($3::uuid[] IS NULL OR m.namespace_id = ANY($3)) GROUP BY f.rating`,
    p
  );
  const fb = Object.fromEntries(feedback.map((f) => [f.rating, f.n])) as Record<string, number>;
  const fbTotal = feedback.reduce((a, f) => a + f.n, 0);
  const [quality] = await query<Record<string, number>>(
    `SELECT count(*) FILTER (WHERE status = 'Active' AND coalesce(last_verified_at, updated_at) < now() - interval '180 days')::int AS stale,
            (SELECT count(*) FROM ai_memory."MemoryConflicts" WHERE status <> 'Resolved')::int AS conflicting
     FROM ai_memory."Memories" WHERE ($1::uuid[] IS NULL OR namespace_id = ANY($1))`,
    [ns]
  );
  const [storage] = await query<{ memories: string; embeddings: string; indexes: string; schema: string }>(
    `SELECT pg_total_relation_size('ai_memory."Memories"') AS memories, pg_total_relation_size('ai_memory."MemoryEmbeddings"') AS embeddings,
            coalesce((SELECT sum(pg_relation_size(format('ai_memory.%I', indexname)::regclass)) FROM pg_indexes WHERE schemaname = 'ai_memory' AND indexname LIKE 'memory_embeddings_hnsw_%'), 0) AS indexes,
            (SELECT sum(pg_total_relation_size(c.oid)) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'ai_memory' AND c.relkind = 'r') AS schema`
  );
  return {
    range: { ...r, days: days(r) },
    growth: growthSeries,
    byCategory,
    byNamespace,
    storage: { memoriesBytes: Number(storage.memories), embeddingsBytes: Number(storage.embeddings), vectorIndexBytes: Number(storage.indexes), schemaBytes: Number(storage.schema) },
    retrieval: { series: retrieval, latency: lat, mostRetrieved: most, neverRetrieved: never.n },
    extraction: {
      ...e,
      acceptanceRate: decided ? (e.approved + e.merged) / decided : null,
      duplicateRate: e.candidates ? e.duplicates / e.candidates : null,
      conflictRate: e.candidates ? e.conflicts / e.candidates : null,
    },
    providers: { jobs: providers, modelUsage: priced, embeddingsGenerated: embeds.n },
    quality: {
      feedback: fb,
      feedbackTotal: fbTotal,
      helpfulRate: fbTotal ? (fb.helpful ?? 0) / fbTotal : null,
      irrelevantRate: fbTotal ? (fb.irrelevant ?? 0) / fbTotal : null,
      incorrect: fb.incorrect ?? 0,
      outdated: fb.outdated ?? 0,
      stale: quality.stale,
      conflicting: quality.conflicting,
    },
  };
}

// Storage per memory measured from this database, then scaled (docs/AI_MEMORY_ARCHITECTURE.md, Capacity)
export async function storageEstimate() {
  const [m] = await query<{ n: number; bytes: string; ebytes: string; en: number; dims: number | null }>(
    `SELECT (SELECT count(*) FROM ai_memory."Memories")::int AS n, pg_total_relation_size('ai_memory."Memories"') AS bytes,
            pg_total_relation_size('ai_memory."MemoryEmbeddings"') AS ebytes, (SELECT count(*) FROM ai_memory."MemoryEmbeddings")::int AS en,
            (SELECT max(dimensions) FROM ai_memory."MemoryEmbeddings") AS dims`
  );
  const dims = m.dims ?? 1024;
  // Measured where there's enough data, else the design figures: ~2.5 KB a row with its history and indexes;
  // an embedding is 4 bytes a dimension plus row overhead, and HNSW (m=16) about the same again
  const perMemory = m.n >= 50 ? Number(m.bytes) / m.n : 2_500;
  const perEmbedding = m.en >= 50 ? Number(m.ebytes) / m.en : dims * 4 + 120;
  const hnsw = dims * 4 + 16 * 2 * 8;
  const at = (n: number) => ({ memories: n, bytes: Math.round(n * (perMemory + perEmbedding + hnsw)) });
  return { measured: m.n >= 50, perMemoryBytes: Math.round(perMemory), perEmbeddingBytes: Math.round(perEmbedding), hnswBytesPerVector: hnsw, dimensions: dims, estimates: [at(10_000), at(100_000), at(1_000_000)] };
}
