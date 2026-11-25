import { body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { retrieve } from '@/lib/memory/retrieval';
import { getConfig, listMemories } from '@/lib/memory/store';
import { int, list, str } from '@/lib/memory/validate';

// Search the library (keyword, semantic or hybrid) without building a context: for people and tools browsing
// memories. Semantic and hybrid go through the retrieval engine with generous limits; keyword is the library query.
export const POST = memoryRoute({ scope: 'memory:read', perMinute: 120 }, async (request, caller) => {
  const b = await body(request, 32 * 1024);
  const q = str(b.query, 2000, 'query', true)!;
  const limit = int(b.limit, 1, 100, 'limit') ?? 25;
  const allowed = await namespacesFor(caller, list(b.namespaces, 'namespaces', 50) ?? null);
  const mode = b.mode === 'semantic' || b.mode === 'hybrid' ? b.mode : 'keyword';
  if (mode === 'keyword') {
    const config = await getConfig();
    const r = await listMemories({ q, namespaceIds: allowed.map((n) => n.id), limit }, config.providers.embeddingModel);
    return { mode, total: r.total, results: r.items.map((m) => ({ id: m.id, score: null, memory: m })) };
  }
  const r = await retrieve({
    query: q,
    namespaceIds: allowed.map((n) => n.id),
    mode,
    params: { maxMemories: limit, maxContextTokens: 16_384, maxPerCategory: limit, minSimilarity: 0.2 },
    client: caller.client,
    userId: caller.user.id,
    requestId: caller.requestId,
    record: false,
    includeSensitive: caller.kind === 'admin',
    owner: { actingUserId: caller.actingUserId, override: caller.ownerOverride },
  });
  const config = await getConfig();
  const full = await listMemories({ ids: r.memories.map((m) => m.id), namespaceIds: allowed.map((n) => n.id), limit: 100 }, config.providers.embeddingModel);
  const byId = new Map(full.items.map((m) => [m.id, m]));
  return { mode: r.mode, degraded: r.degraded, total: r.memories.length, results: r.memories.map((m) => ({ id: m.id, score: m.score, semantic: m.factors.semantic, keyword: m.factors.keyword, memory: byId.get(m.id) ?? null })) };
});
