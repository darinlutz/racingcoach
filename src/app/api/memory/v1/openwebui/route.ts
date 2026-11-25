import { memoryRoute, namespacesFor } from '@/lib/memory/api';
import { compareOpenWebui } from '@/lib/memory/importExport';
import { retrieve } from '@/lib/memory/retrieval';
import { labJson, labServer } from '@/lib/aiLab/gatewayClient';
import { body } from '@/lib/memory/api';
import { str } from '@/lib/memory/validate';

// Open WebUI migration: which native memories are already in the centralized store (GET), and the same question
// answered by both, side by side (POST { query })
export const GET = memoryRoute({ scope: 'memory:admin' }, async () => compareOpenWebui());

export const POST = memoryRoute({ scope: 'memory:admin', perMinute: 20 }, async (request, caller) => {
  const b = await body(request, 8 * 1024);
  const q = str(b.query, 2000, 'query', true)!;
  const allowed = await namespacesFor(caller, null);
  const [central, native] = await Promise.all([
    retrieve({ query: q, namespaceIds: allowed.map((n) => n.id), client: 'migration-compare', userId: caller.user.id, record: false, owner: { actingUserId: null, override: caller.ownerOverride } }),
    labServer().then((s) => labJson(s, 'POST /lab/webui/memories/query', { content: q, k: 10 })).catch((error: unknown) => ({ status: 503, body: { error: error instanceof Error ? error.message : 'unavailable' } })),
  ]);
  return { central: central.memories.map((m) => ({ id: m.id, content: m.content, score: m.score })), native: native.status === 200 ? native.body : { error: native.body.error } };
});
