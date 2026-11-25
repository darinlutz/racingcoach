import { ApiError, body, memoryRoute } from '@/lib/memory/api';
import { resolveConflict } from '@/lib/memory/decisions';
import { kickJobs } from '@/lib/memory/jobs';
import { CONFLICT_RESOLUTIONS, isUuid, type ConflictResolution } from '@/lib/memory/rules';
import { str } from '@/lib/memory/validate';

type Ctx = { params: Promise<{ id: string }> };

export const POST = memoryRoute<Ctx>({ scope: 'memory:admin', perMinute: 120 }, async (request, caller, ctx) => {
  const { id } = await ctx.params;
  if (!isUuid(id)) throw new ApiError(404, 'notFound');
  const b = await body(request);
  if (!(CONFLICT_RESOLUTIONS as readonly unknown[]).includes(b.resolution)) throw new ApiError(400, 'invalid', 'Unknown resolution');
  const r = await resolveConflict(id, b.resolution as ConflictResolution, caller.actor, { mergedContent: str(b.mergedContent, 4000, 'mergedContent') ?? null, note: str(b.note, 500, 'note') });
  kickJobs();
  return r;
});
