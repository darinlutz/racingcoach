import { memoryRoute } from '@/lib/memory/api';
import { memoryFor } from '@/lib/memory/routeShared';
import { readHistory } from '@/lib/memory/store';

type Ctx = { params: Promise<{ id: string }> };

// Every version of a memory, newest first
export const GET = memoryRoute<Ctx>({ scope: 'memory:read' }, async (_request, caller, ctx) => {
  const { id } = await ctx.params;
  await memoryFor(caller, id);
  return { history: await readHistory(id) };
});
