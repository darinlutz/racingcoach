import { memoryRoute } from '@/lib/memory/api';
import { serviceHealth } from '@/lib/memory/localServices';
import { pgvectorVersion, vectorAvailable } from '@/lib/memory/schema';
import { getConfig } from '@/lib/memory/store';

// Health for callers with a key (no detail for anyone else: 401/404). Postgres answering this is the service up;
// Ollama and Mem0 are optional and reported by their circuit breakers, not called here.
export const GET = memoryRoute({ scope: 'memory:read', perMinute: 60 }, async (_request, caller) => {
  const config = await getConfig();
  const h = serviceHealth();
  return {
    ok: true,
    enabled: config.system.enabled,
    caller: { kind: caller.kind, client: caller.client },
    postgres: true,
    pgvector: (await vectorAvailable()) ? await pgvectorVersion() : null,
    ollama: { circuitOpen: h.ollama.open, lastOkAt: h.ollama.lastOkAt, lastErrorAt: h.ollama.lastErrorAt },
    mem0: config.providers.intelligence === 'mem0' ? { circuitOpen: h.mem0.open, lastOkAt: h.mem0.lastOkAt, lastErrorAt: h.mem0.lastErrorAt } : null,
    embeddingModel: config.providers.embeddingModel,
  };
});
