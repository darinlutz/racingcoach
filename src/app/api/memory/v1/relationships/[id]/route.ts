import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { isUuid } from '@/lib/memory/rules';
import { updateRelationship } from '@/lib/memory/store';

type Ctx = { params: Promise<{ id: string }> };

// Accept or reject a proposed relationship
export const PATCH = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 60 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  const b = await body(request, 2 * 1024);
  if (b.status !== 'active' && b.status !== 'rejected') throw new ApiError(400, 'invalid', 'status is active or rejected');
  await updateRelationship(id, b.status, caller.actor);
  return { ok: true };
});

export const DELETE = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 60 }, async (_request, caller, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  await updateRelationship(id, 'deleted', caller.actor);
  return { ok: true };
});
