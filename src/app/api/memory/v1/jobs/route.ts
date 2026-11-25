import { ApiError, body, memoryRoute, searchParams } from '@/lib/memory/api';
import { query } from '@/lib/db';
import { embeddingCoverage, migrationState, processOutbox, reconcileMem0, runCleanup, runJobs, switchEmbeddingModel } from '@/lib/memory/jobs';
import { isUuid } from '@/lib/memory/rules';
import { ensureMemorySchema, ensureVectorIndex, listVectorIndexes } from '@/lib/memory/schema';
import { audit, enqueueJob, getConfig, getScoped, saveConfig } from '@/lib/memory/store';
import { str } from '@/lib/memory/validate';

// Jobs and Synchronization: the job list, the outbox and the controls (docs/AI_MEMORY_OPERATIONS.md)
export const GET = memoryRoute({ scope: 'memory:admin' }, async (request) => {
  await ensureMemorySchema();
  const sp = searchParams(request);
  const status = sp.str('status');
  const type = sp.str('type');
  const rows = await query<Record<string, unknown>>(
    `SELECT id, type, status, attempts, max_attempts, progress, provider, error, dead_letter, created_at, started_at, finished_at, run_after, result
     FROM ai_memory."MemoryJobs" WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR type = $2) ORDER BY created_at DESC LIMIT 200`,
    [status ?? null, type ?? null]
  );
  const [outbox] = await query<Record<string, number>>(
    `SELECT count(*) FILTER (WHERE status = 'pending')::int AS pending, count(*) FILTER (WHERE status = 'failed')::int AS failed, count(*) FILTER (WHERE status = 'done')::int AS done FROM ai_memory."MemoryProviderSync"`
  );
  const counts = await query<{ status: string; n: number }>(`SELECT status, count(*)::int AS n FROM ai_memory."MemoryJobs" GROUP BY status`);
  const config = await getConfig();
  return {
    jobs: rows.map((r) => ({ ...r, created_at: undefined, createdAt: iso(r.created_at), startedAt: iso(r.started_at), finishedAt: iso(r.finished_at), runAfter: iso(r.run_after) })),
    counts: Object.fromEntries(counts.map((c) => [c.status, c.n])),
    outbox,
    extractionPaused: config.extraction.paused,
    migration: await migrationState(),
    coverage: await embeddingCoverage(config.providers.embeddingModel),
    indexes: await listVectorIndexes(),
    lastCleanup: await getScoped('state', 'lastCleanup'),
  };
});

const iso = (d: unknown) => (d ? new Date(d as Date).toISOString() : null);

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 60 }, async (request, caller) => {
  const b = await body(request, 8 * 1024);
  const id = typeof b.id === 'string' && isUuid(b.id) ? b.id : null;
  let result: unknown;
  switch (b.action) {
    case 'runNow':
      result = await runJobs({ limit: 5 });
      break;
    case 'retry':
      if (!id) throw new ApiError(400, 'invalid', 'id is required');
      await query(`UPDATE ai_memory."MemoryJobs" SET status = 'Pending', attempts = 0, dead_letter = false, run_after = now(), error = NULL, finished_at = NULL WHERE id = $1 AND status IN ('Failed', 'Deferred', 'Cancelled')`, [id]);
      result = { ok: true };
      break;
    case 'cancel':
      if (!id) throw new ApiError(400, 'invalid', 'id is required');
      await query(`UPDATE ai_memory."MemoryJobs" SET status = 'Cancelled', finished_at = now() WHERE id = $1 AND status IN ('Pending', 'Deferred', 'Failed')`, [id]);
      result = { ok: true };
      break;
    case 'pauseExtraction':
    case 'resumeExtraction':
      await saveConfig({ extraction: { paused: b.action === 'pauseExtraction' } }, caller.actor);
      result = { paused: b.action === 'pauseExtraction' };
      break;
    case 'sync':
      result = await processOutbox(200);
      break;
    case 'reconcile':
      result = await reconcileMem0();
      break;
    case 'cleanup':
      result = await runCleanup();
      break;
    case 'rebuildIndex': {
      const config = await getConfig();
      const coverage = await embeddingCoverage(config.providers.embeddingModel);
      if (!coverage.dimensions) throw new ApiError(409, 'noEmbeddings', 'No embeddings of the active model yet');
      await query(`DROP INDEX IF EXISTS ai_memory.${(await listVectorIndexes()).find((i) => i.definition.includes(`'${config.providers.embeddingModel}'`))?.name ?? 'memory_embeddings_hnsw_none'}`);
      result = await ensureVectorIndex(config.providers.embeddingModel, coverage.dimensions);
      break;
    }
    case 'reembedAll':
    case 'startMigration': {
      const config = await getConfig();
      const model = str(b.model, 100, 'model') ?? config.providers.embeddingModel;
      const provider = b.provider === 'openai' ? 'openai' : b.provider === 'ollama' ? 'ollama' : config.providers.embeddingProvider;
      if (b.action === 'reembedAll' && model === config.providers.embeddingModel) await query(`UPDATE ai_memory."MemoryEmbeddings" SET indexing_status = 'stale' WHERE model = $1`, [model]);
      result = await enqueueJob(null, 'reembed', { model, provider }, { idempotencyKey: `reembed:${model}:${Date.now()}`, maxAttempts: 20 });
      break;
    }
    case 'switchModel': {
      const model = str(b.model, 100, 'model', true)!;
      result = await switchEmbeddingModel(model, b.provider === 'openai' ? 'openai' : 'ollama', caller.actor);
      break;
    }
    default:
      throw new ApiError(400, 'invalid', 'Unknown action');
  }
  await audit(caller.actor, `jobs.${String(b.action)}`, id, 'ok');
  return { result };
});
