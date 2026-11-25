import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { query } from '@/lib/db';
import { runEvaluation } from '@/lib/memory/importExport';
import { isUuid } from '@/lib/memory/rules';
import { ensureMemorySchema } from '@/lib/memory/schema';
import { audit } from '@/lib/memory/store';
import { int, list, str } from '@/lib/memory/validate';

// The Evaluation Lab: datasets of cases (prompt, expected and excluded memories, expected answer) and runs
export const GET = memoryRoute({ scope: 'memory:admin' }, async () => {
  await ensureMemorySchema();
  const cases = await query<Record<string, unknown>>(`SELECT * FROM ai_memory."MemoryEvaluationCases" ORDER BY dataset, created_at LIMIT 1000`);
  const runs = await query<{ id: string; dataset: string; config: unknown; metrics: unknown; created_at: Date }>(`SELECT id, dataset, config, metrics, created_at FROM ai_memory."MemoryEvaluationRuns" ORDER BY created_at DESC LIMIT 100`);
  return { cases, runs: runs.map((r) => ({ ...r, created_at: undefined, createdAt: r.created_at.toISOString() })) };
});

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 10 }, async (request, caller) => {
  const b = await body(request, 64 * 1024);
  await ensureMemorySchema();
  if (b.action === 'addCase') {
    const ids = (v: unknown) => (Array.isArray(v) ? v.filter(isUuid).slice(0, 50) : []);
    const rows = await query<{ id: string }>(
      `INSERT INTO ai_memory."MemoryEvaluationCases" (dataset, prompt, expected_memory_ids, excluded_memory_ids, expected_answer, namespaces) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [str(b.dataset, 80, 'dataset', true), str(b.prompt, 2000, 'prompt', true), ids(b.expectedMemoryIds), ids(b.excludedMemoryIds), str(b.expectedAnswer, 2000, 'expectedAnswer') ?? '', list(b.namespaces, 'namespaces', 20) ?? []]
    );
    await audit(caller.actor, 'evaluation.addCase', rows[0].id, 'ok');
    return { id: rows[0].id };
  }
  if (b.action === 'deleteCase') {
    if (!isUuid(b.id)) throw new ApiError(400, 'invalid', 'id is required');
    await query(`DELETE FROM ai_memory."MemoryEvaluationCases" WHERE id = $1`, [b.id]);
    return { ok: true };
  }
  if (b.action === 'run') {
    const allowed = (await namespacesFor(caller, null)).map((n) => n.id);
    return runEvaluation(
      {
        dataset: str(b.dataset, 80, 'dataset', true)!,
        mode: b.mode === 'semantic' || b.mode === 'keyword' ? b.mode : 'hybrid',
        profileId: isUuid(b.profileId) ? b.profileId : null,
        k: int(b.k, 1, 50, 'k') ?? 5,
        compareDisabled: b.compareDisabled === true,
        answerModel: str(b.answerModel, 100, 'answerModel') ?? null,
        params: (b.params as Record<string, unknown>) ?? undefined,
      },
      allowed,
      caller.actor
    );
  }
  throw new ApiError(400, 'invalid', 'Unknown action');
});
