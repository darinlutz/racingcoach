import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { query } from '@/lib/db';
import { embedTexts } from '@/lib/memory/embeddings';
import { Mem0MemoryProvider, NativeMemoryProvider } from '@/lib/memory/intelligence';
import { installedModels, ollamaGenerateJson, resetBreakers, serviceHealth, usingDevOverride } from '@/lib/memory/localServices';
import { audit, getConfig } from '@/lib/memory/store';
import { str } from '@/lib/memory/validate';

// Providers: what each memory task uses, the installed Ollama models, each service's breaker and figures, and
// Test Connection / Test Model
export const GET = memoryRoute({ scope: 'memory:admin' }, async () => {
  const config = await getConfig();
  const [models, mem0] = await Promise.all([installedModels(), new Mem0MemoryProvider(config).healthCheck()]);
  const usage = await query<{ provider: string; jobs: number; failed: number; last_ok: Date | null; avg_ms: number | null }>(
    `SELECT coalesce(provider, type) AS provider, count(*)::int AS jobs, count(*) FILTER (WHERE status = 'Failed')::int AS failed,
            max(finished_at) FILTER (WHERE status = 'Completed') AS last_ok, round(avg(extract(epoch FROM (finished_at - started_at)) * 1000))::int AS avg_ms
     FROM ai_memory."MemoryJobs" WHERE created_at >= now() - interval '30 days' GROUP BY 1`
  );
  return {
    settings: config.providers,
    ollama: models,
    mem0,
    breakers: serviceHealth(),
    devOverride: usingDevOverride(),
    usage: usage.map((u) => ({ ...u, last_ok: u.last_ok ? u.last_ok.toISOString() : null })),
  };
});

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 20 }, async (request, caller) => {
  const b = await body(request, 8 * 1024);
  const config = await getConfig();
  const started = Date.now();
  let result: Record<string, unknown>;
  switch (b.action) {
    case 'resetBreakers':
      resetBreakers();
      result = { ok: true };
      break;
    case 'testEmbedding': {
      const model = str(b.model, 100, 'model') ?? config.providers.embeddingModel;
      const r = await embedTexts({ provider: b.provider === 'openai' ? 'openai' : 'ollama', model }, ['RacingCoach is a sim racing AI coaching platform.'], config.providers);
      result = { ok: true, model, dimensions: r.dimensions, ms: r.ms };
      break;
    }
    case 'testModel': {
      const model = str(b.model, 100, 'model', true)!;
      const r = await ollamaGenerateJson(model, 'Answer JSON {"ok": true, "word": "<one word>"}.', 'Say a word about racing.', { type: 'object', properties: { ok: { type: 'boolean' }, word: { type: 'string' } }, required: ['ok', 'word'] }, 60_000);
      result = { ok: true, model, answer: r.content.slice(0, 200), ms: r.ms, promptTokens: r.promptTokens, outputTokens: r.outputTokens };
      break;
    }
    case 'testMem0':
      result = { ...(await new Mem0MemoryProvider(config).healthCheck()), ms: Date.now() - started };
      break;
    case 'testNative':
      result = { ...(await new NativeMemoryProvider(config).classifyMemory('RacingCoach is hosted on Render.', [{ key: 'project', description: 'Facts about a project' }, { key: 'semantic', description: 'Facts' }])), ms: Date.now() - started };
      break;
    default:
      throw new ApiError(400, 'invalid', 'Unknown action');
  }
  await audit(caller.actor, `providers.${String(b.action)}`, null, 'ok', { ms: Date.now() - started });
  return result;
});
