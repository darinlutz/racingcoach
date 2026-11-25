import { memoryRoute } from '@/lib/memory/api';
import { embedMemory } from '@/lib/memory/jobs';
import { memoryFor } from '@/lib/memory/routeShared';
import { audit } from '@/lib/memory/store';

type Ctx = { params: Promise<{ id: string }> };

// Recalculates the memory's embedding with the active model now (503 when the embedding model is offline)
export const POST = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 60 }, async (_request, caller, ctx) => {
  const { id } = await ctx.params;
  const m = await memoryFor(caller, id);
  const r = await embedMemory(id, m.version);
  await audit(caller.actor, 'memory.reembed', id, 'ok', r);
  return r;
});
