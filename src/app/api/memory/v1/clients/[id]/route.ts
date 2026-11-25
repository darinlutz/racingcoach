import { ApiError, memoryRoute, revokeApiClient } from '@/lib/memory/api';
import { isUuid } from '@/lib/memory/rules';

type Ctx = { params: Promise<{ id: string }> };

export const DELETE = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 20 }, async (_request, caller, ctx) => {
  if (caller.kind !== 'admin') throw new ApiError(403, 'adminOnly');
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  await revokeApiClient(id, caller.actor);
  return { revoked: true };
});
