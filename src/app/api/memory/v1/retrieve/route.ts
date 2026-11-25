import { ApiError, body, memoryRoute, namespacesFor } from '@/lib/memory/api';
import { retrieve } from '@/lib/memory/retrieval';
import { canRetrieve, effectiveMode, isUuid, type MemoryMode } from '@/lib/memory/rules';
import { getConfig, getScoped, listNamespaces } from '@/lib/memory/store';
import { bool, list, str } from '@/lib/memory/validate';

// Retrieval for an LLM request (docs/AI_MEMORY_API.md): the memory context to put before the conversation, built
// only from approved memories in namespaces the caller may read. API clients get the selected memories and the
// context; only an Admin's Retrieval Inspector (inspect: true) sees what was left out, and why.
export const POST = memoryRoute({ scope: 'memory:read', perMinute: 240 }, async (request, caller) => {
  const b = await body(request, 64 * 1024);
  const text = str(b.query, 2000, 'query', true)!;
  const inspect = bool(b.inspect, 'inspect') === true && caller.kind === 'admin';
  const allowed = await namespacesFor(caller, list(b.namespaces, 'namespaces', 50) ?? null, { includeChildren: bool(b.includeChildren, 'includeChildren') ?? true });
  const config = await getConfig();
  // Disabled anywhere along the way means nothing is retrieved
  const app = await getScoped<{ mode?: MemoryMode }>('application', caller.client);
  const all = await listNamespaces();
  const ok = allowed.filter((n) => {
    const ns = all.find((x) => x.id === n.id);
    return canRetrieve(effectiveMode({ global: config.system.defaultMode, application: app?.mode ?? null, namespace: ns?.mode ?? null }, { memoryEnabled: config.system.enabled, customerData: false, customerCaptureEnabled: true, sensitive: false, categoryRequiresApproval: false, categoryExtractionEligible: true }).mode);
  });
  const mode = b.mode === 'semantic' || b.mode === 'keyword' || b.mode === 'hybrid' ? b.mode : undefined;
  const profileId = typeof b.profileId === 'string' && isUuid(b.profileId) ? b.profileId : null;
  if (b.params !== undefined && caller.kind !== 'admin') throw new ApiError(403, 'adminOnly', 'Only the Retrieval Inspector may override parameters');
  const r = await retrieve({
    query: text,
    namespaceIds: ok.map((n) => n.id),
    mode,
    profileId,
    params: (b.params as never) ?? undefined,
    categoryKeys: list(b.categories, 'categories', 20),
    includeSensitive: caller.kind === 'admin' && bool(b.includeSensitive, 'includeSensitive') === true,
    client: caller.client,
    userId: caller.user.id,
    requestId: caller.requestId,
    inspector: inspect,
    model: str(b.model, 100, 'model') ?? null,
    owner: { actingUserId: caller.actingUserId, override: caller.ownerOverride },
  });
  const brief = (m: (typeof r.memories)[number]) => ({ id: m.id, title: m.title, content: m.content, category: m.categoryKey, namespace: m.namespacePath, score: Number(m.score.toFixed(4)), rank: m.rank });
  const base = { context: r.context, memories: r.memories.map(brief), tokens: r.tokens, mode: r.mode, degraded: r.degraded, accessLogId: r.accessLogId, rankingVersion: r.rankingVersion, requestId: caller.requestId };
  if (!inspect) return base;
  return {
    ...base,
    inspector: {
      namespaces: ok.map((n) => n.path),
      embeddingModel: r.embeddingModel,
      params: r.params,
      profile: r.profile,
      candidates: r.candidates,
      selected: r.memories,
      excluded: r.excluded,
      timings: r.timings,
    },
  };
});
